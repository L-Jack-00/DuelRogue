/**
 * src/ui/vectorBaker.js
 * 게임 실행 직후 모든 정적 SVG 벡터 그래픽(<filter>/<feGaussianBlur>/그라데이션 포함)을
 * 고해상도 래스터 PNG Blob 텍스처로 사전 베이킹(Pre-Baking)하여 런타임 렉을 제거합니다.
 */

export const VECTOR_BAKE_SPECS = [
  // 카드 프레임 & 뒷면 & 공용 폴백 (풀사이즈 + 축소 썸네일용 2단계 밉맵 베이킹)
  { path: 'assets/frames/card_frame_unit_blank.svg', width: 800, height: 1120, thumbWidth: 240, thumbHeight: 336 },
  { path: 'assets/frames/card_frame_spell_blank.svg', width: 800, height: 1120, thumbWidth: 240, thumbHeight: 336 },
  { path: 'assets/frames/card_frame_token_blank.svg', width: 800, height: 1120, thumbWidth: 240, thumbHeight: 336 },
  { path: 'assets/ui/card_back.svg', width: 640, height: 896, thumbWidth: 240, thumbHeight: 336 },
  { path: 'assets/placeholders/procedural_fallback.svg', width: 640, height: 480, thumbWidth: 240, thumbHeight: 180 },

  // 상점 부스터 팩
  { path: 'assets/ui/pack_blue.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_red.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_purple.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_neutral.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_legend.svg', width: 480, height: 720 },

  // 운명 타로 카드
  { path: 'assets/ui/tarot_justice.svg', width: 512, height: 592 },
  { path: 'assets/ui/tarot_zeal.svg', width: 512, height: 592 },
  { path: 'assets/ui/tarot_chaos.svg', width: 512, height: 592 },

  // 체크포인트 거점 포털 & NPC 초상화 & 앱 아이콘
  { path: 'assets/ui/portal_shop.svg', width: 512, height: 512 },
  { path: 'assets/ui/portal_alley.svg', width: 512, height: 512 },
  { path: 'assets/ui/portal_trunk.svg', width: 512, height: 512 },
  { path: 'assets/ui/portal_arena.svg', width: 512, height: 512 },
  { path: 'assets/ui/npc_fortune.svg', width: 360, height: 440 },
  { path: 'assets/ui/npc_shopkeeper.svg', width: 280, height: 320 },
  { path: 'assets/ui/npc_merchant.svg', width: 280, height: 320 },
  { path: 'assets/ui/app_icon.svg', width: 256, height: 256 },
];

const bakedUrlMap = new Map();
const bakedThumbUrlMap = new Map();
let bakeStats = {
  ready: false,
  bakedCount: 0,
  totalCount: VECTOR_BAKE_SPECS.length,
  durationMs: 0,
};
let activeBakePromise = null;

/** 경로 문자열을 일관된 키 형태로 정규화한다 */
export function normalizeVectorAssetKey(src) {
  if (!src || typeof src !== 'string') return '';
  return src.trim().replace(/^\.\//, '').split('?')[0].split('#')[0];
}

/**
 * 베이킹 완료된 PNG Blob URL이 있으면 즉시 반환하고, 아직 없으면 원본 경로를 반환한다.
 * compact=true이면 축소 카드/썸네일용 단계적 다운샘플링(밉맵) 텍스처를 우선 반환한다.
 */
export function resolveBakedAsset(src, { compact = false } = {}) {
  const key = normalizeVectorAssetKey(src);
  if (!key) return src;
  if (compact) {
    return bakedThumbUrlMap.get(key) || bakedUrlMap.get(key) || src;
  }
  return bakedUrlMap.get(key) || src;
}

/** 현재 벡터 베이킹 상태 통계를 반환한다 */
export function getVectorBakeStats() {
  return { ...bakeStats };
}

/** SVG XML 문자열에 명시적 픽셀 width/height를 주입해 고해상도 래스터화를 보장한다 */
export function injectSvgPixelDimensions(svgText, width, height) {
  if (!svgText || typeof svgText !== 'string') return svgText;
  return svgText.replace(/<svg\b([^>]*)>/i, (_full, attrs) => {
    const cleaned = attrs
      .replace(/\swidth\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\sheight\s*=\s*["'][^"']*["']/gi, '');
    return `<svg${cleaned} width="${width}" height="${height}">`;
  });
}

function loadHtmlImage(src, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`SVG decode timeout: ${src}`));
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`SVG load error: ${src}`));
    };
    img.src = src;
  });
}

/**
 * 고해상도 캔버스를 0.5x씩 단계적으로 축소(step-down mipmap)해
 * 작은 배율에서 얇은 선·문양이 깨지거나 사라지는 앨리어싱을 줄인다.
 */
export function stepDownMipmapCanvas(sourceCanvas, targetWidth, targetHeight) {
  let cur = sourceCanvas;
  while (cur.width * 0.5 > targetWidth || cur.height * 0.5 > targetHeight) {
    const nextW = Math.max(targetWidth, Math.round(cur.width * 0.5));
    const nextH = Math.max(targetHeight, Math.round(cur.height * 0.5));
    if (nextW === cur.width && nextH === cur.height) break;
    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextW;
    stepCanvas.height = nextH;
    const sctx = stepCanvas.getContext('2d');
    if (!sctx) break;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(cur, 0, 0, nextW, nextH);
    cur = stepCanvas;
  }
  if (cur.width !== targetWidth || cur.height !== targetHeight) {
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetWidth;
    finalCanvas.height = targetHeight;
    const fctx = finalCanvas.getContext('2d');
    if (fctx) {
      fctx.imageSmoothingEnabled = true;
      fctx.imageSmoothingQuality = 'high';
      fctx.drawImage(cur, 0, 0, targetWidth, targetHeight);
      return finalCanvas;
    }
  }
  return cur;
}

async function bakeSingleVectorAsset(spec) {
  const key = normalizeVectorAssetKey(spec.path);
  if (!key || bakedUrlMap.has(key)) return bakedUrlMap.get(key) || null;

  let tempSvgUrl = null;
  try {
    let sourceForImg = key;
    if (typeof fetch === 'function') {
      const resp = await fetch(key);
      if (resp.ok) {
        const rawSvg = await resp.text();
        const sizedSvg = injectSvgPixelDimensions(rawSvg, spec.width, spec.height);
        const svgBlob = new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' });
        tempSvgUrl = URL.createObjectURL(svgBlob);
        sourceForImg = tempSvgUrl;
      }
    }

    const img = await loadHtmlImage(sourceForImg);
    const canvas = document.createElement('canvas');
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, spec.width, spec.height);
    ctx.drawImage(img, 0, 0, spec.width, spec.height);

    const pngBlob = await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
    if (!pngBlob) return null;

    const pngUrl = URL.createObjectURL(pngBlob);
    bakedUrlMap.set(key, pngUrl);

    // 축소 카드·썸네일용 단계적 다운샘플링 밉맵 PNG도 함께 베이킹
    if (spec.thumbWidth && spec.thumbHeight && (spec.thumbWidth < spec.width || spec.thumbHeight < spec.height)) {
      const thumbCanvas = stepDownMipmapCanvas(canvas, spec.thumbWidth, spec.thumbHeight);
      const thumbBlob = await new Promise((resolve) => {
        thumbCanvas.toBlob((blob) => resolve(blob), 'image/png');
      });
      if (thumbBlob) {
        bakedThumbUrlMap.set(key, URL.createObjectURL(thumbBlob));
      }
    }

    return pngUrl;
  } catch {
    return null;
  } finally {
    if (tempSvgUrl) {
      try {
        URL.revokeObjectURL(tempSvgUrl);
      } catch {
        // 무시
      }
    }
  }
}

/** 이미 DOM에 마운트된 정적 SVG `<img>` 요소를 베이킹된 래스터 URL로 즉시 교체한다 */
export function upgradeDomSvgImages(root = document) {
  if (typeof document === 'undefined' || !root?.querySelectorAll) return 0;
  let upgraded = 0;
  root.querySelectorAll('img').forEach((img) => {
    const raw = img.dataset.rawSrc || img.getAttribute('src') || '';
    const key = normalizeVectorAssetKey(raw);
    if (!key.endsWith('.svg')) return;
    const useCompact = img.dataset.compact === '1'
      || Boolean(img.closest?.('.battlefield-view, .trunk-card-tile, .unit-field-card'));
    const baked = (useCompact ? bakedThumbUrlMap.get(key) : null) || bakedUrlMap.get(key);
    if (baked && img.getAttribute('src') !== baked) {
      img.dataset.rawSrc = key;
      img.src = baked;
      upgraded += 1;
    }
  });
  return upgraded;
}

/** CSS 커스텀 프로퍼티(--baked-card-back-url 등)에 베이킹된 텍스처를 반영한다 */
function syncBakedCssTextures() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const bakedCardBack = bakedUrlMap.get('assets/ui/card_back.svg');
  if (bakedCardBack) {
    document.documentElement.style.setProperty('--baked-card-back-url', `url("${bakedCardBack}")`);
  }
}

/**
 * 게임 실행 직후 모든 벡터 그래픽을 비동기 배치로 베이킹한다.
 * 헤드리스/테스트 환경에서는 안전하게 no-op으로 반환한다.
 */
export async function bakeAllVectorAssets({ onProgress } = {}) {
  if (activeBakePromise) return activeBakePromise;
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    bakeStats = { ready: true, bakedCount: 0, totalCount: VECTOR_BAKE_SPECS.length, durationMs: 0 };
    return bakeStats;
  }

  activeBakePromise = (async () => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const total = VECTOR_BAKE_SPECS.length;
    let completed = 0;
    let bakedCount = 0;

    const batchSize = 6;
    for (let i = 0; i < total; i += batchSize) {
      const slice = VECTOR_BAKE_SPECS.slice(i, i + batchSize);
      const results = await Promise.all(slice.map((spec) => bakeSingleVectorAsset(spec)));
      for (const r of results) {
        completed += 1;
        if (r) bakedCount += 1;
      }
      if (typeof onProgress === 'function') {
        onProgress({ completed, total, bakedCount });
      }
    }

    syncBakedCssTextures();
    upgradeDomSvgImages(document);

    const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    bakeStats = {
      ready: true,
      bakedCount,
      totalCount: total,
      durationMs: Math.max(1, Math.round(endedAt - startedAt)),
    };
    return bakeStats;
  })();

  return activeBakePromise;
}

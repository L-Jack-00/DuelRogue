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

  // 상점 부스터 팩 & 전용 벡터 아레나 포털 & 앱 아이콘 (실화 .webp가 존재하는 타로/포털/NPC SVG 폴백은 제외)
  { path: 'assets/ui/pack_blue.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_red.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_purple.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_neutral.svg', width: 480, height: 720 },
  { path: 'assets/ui/pack_legend.svg', width: 480, height: 720 },
  { path: 'assets/ui/portal_arena.svg', width: 512, height: 512 },
  { path: 'assets/ui/app_icon.svg', width: 256, height: 256 },
];

const VICTORY_TROPHY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="vicGlow" cx="50%" cy="48%" r="48%">
      <stop offset="0%" stop-color="#fde047" stop-opacity="0.58"/>
      <stop offset="55%" stop-color="#facc15" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#facc15" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="vicGold" x1="20%" y1="10%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="32%" stop-color="#fde047"/>
      <stop offset="72%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#a16207"/>
    </linearGradient>
    <linearGradient id="vicBase" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#78350f"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="60" r="58" fill="url(#vicGlow)"/>
  <path d="M36 32 H20 C17 32 15 35 16 39 C18 54 27 65 40 67" fill="none" stroke="url(#vicGold)" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M92 32 H108 C111 32 113 35 112 39 C110 54 101 65 88 67" fill="none" stroke="url(#vicGold)" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M34 24 H94 V48 C94 69 80 82 64 84 C48 82 34 69 34 48 Z" fill="url(#vicGold)" stroke="#713f12" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M44 31 H60 V48 C60 60 55 70 49 74 C44 68 42 58 42 48 Z" fill="#fef9c3" opacity="0.45"/>
  <rect x="57" y="83" width="14" height="16" rx="2" fill="url(#vicGold)" stroke="#713f12" stroke-width="2.5"/>
  <path d="M42 99 H86 L90 109 H38 Z" fill="url(#vicBase)" stroke="#451a03" stroke-width="2.5" stroke-linejoin="round"/>
  <polygon points="64,38 68,48 79,48 70,54 73,65 64,58 55,65 58,54 49,48 60,48" fill="#fffbeb" opacity="0.92"/>
</svg>`;

const DEFEAT_SKULL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="defGlow" cx="50%" cy="50%" r="48%">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.48"/>
      <stop offset="60%" stop-color="#991b1b" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#991b1b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="64" cy="64" r="58" fill="url(#defGlow)"/>
  <g transform="translate(16, 16) scale(4)">
    <path d="M12 2.5C7.3 2.5 3.6 5.9 3.6 10.3c0 2.5 1.2 4.6 3.1 6v2.9a1 1 0 0 0 1 1h8.6a1 1 0 0 0 1-1v-2.9c1.9-1.4 3.1-3.5 3.1-6C20.4 5.9 16.7 2.5 12 2.5z" fill="#ffffff" stroke="#0f172a" stroke-width="1.65" stroke-linejoin="round"/>
    <circle cx="8.9" cy="10.4" r="1.85" fill="#0f172a"/>
    <circle cx="15.1" cy="10.4" r="1.85" fill="#0f172a"/>
    <polygon points="12,12.7 10.9,15 13.1,15" fill="#0f172a"/>
    <path d="M9.6 20.2v-2.7m2.4 2.7v-2.7m2.4 2.7v-2.7" stroke="#0f172a" stroke-width="1.45" stroke-linecap="round"/>
  </g>
</svg>`;

const CHANCE_HEART_FULL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M16 27.9l-1.85-1.68C7.7 20.4 3.4 16.5 3.4 11.7 3.4 7.8 6.45 4.8 10.3 4.8c2.2 0 4.35 1.04 5.7 2.66C17.35 5.84 19.5 4.8 21.7 4.8c3.85 0 6.9 3 6.9 6.9 0 4.8-4.3 8.7-10.75 14.52L16 27.9z" fill="#090d16" opacity="0.38" transform="translate(0, 1.2)"/>
  <path d="M16 27.4l-1.85-1.68C7.7 19.9 3.4 16 3.4 11.2 3.4 7.3 6.45 4.3 10.3 4.3c2.2 0 4.35 1.04 5.7 2.66C17.35 5.34 19.5 4.3 21.7 4.3c3.85 0 6.9 3 6.9 6.9 0 4.8-4.3 8.7-10.75 14.52L16 27.4z" fill="#ef4444" stroke="#7f1d1d" stroke-width="2"/>
  <path d="M8.5 9.2c.8-1.4 2.2-2.2 3.8-2.2" fill="none" stroke="#fecaca" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>
</svg>`;

const CHANCE_HEART_EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M16 27.4l-1.85-1.68C7.7 19.9 3.4 16 3.4 11.2 3.4 7.3 6.45 4.3 10.3 4.3c2.2 0 4.35 1.04 5.7 2.66C17.35 5.34 19.5 4.3 21.7 4.3c3.85 0 6.9 3 6.9 6.9 0 4.8-4.3 8.7-10.75 14.52L16 27.4z" fill="none" stroke="#94a3b8" stroke-width="2.4" opacity="0.78"/>
</svg>`;

export const VICTORY_DEFEAT_FX_SPECS = [
  { key: 'fx:victory:rays', kind: 'rays', width: 900, height: 900 },
  { key: 'fx:victory:trophy', kind: 'svg', width: 192, height: 192, thumbWidth: 96, thumbHeight: 96, svg: VICTORY_TROPHY_SVG },
  { key: 'fx:defeat:skull', kind: 'svg', width: 192, height: 192, thumbWidth: 96, thumbHeight: 96, svg: DEFEAT_SKULL_SVG },
  { key: 'fx:chance:heart_full', kind: 'svg', width: 64, height: 64, svg: CHANCE_HEART_FULL_SVG },
  { key: 'fx:chance:heart_empty', kind: 'svg', width: 64, height: 64, svg: CHANCE_HEART_EMPTY_SVG },
];

const bakedUrlMap = new Map();
const bakedThumbUrlMap = new Map();
const bakedDynamicUrlMap = new Map();
const bakedDynamicThumbUrlMap = new Map();
const bakedDynamicPendingMap = new Map();
let bakeStats = {
  ready: false,
  bakedCount: 0,
  totalCount: VECTOR_BAKE_SPECS.length,
  durationMs: 0,
};
let fxBakeStats = {
  ready: false,
  bakedCount: 0,
  totalCount: VICTORY_DEFEAT_FX_SPECS.length,
};
let activeBakePromise = null;
let activeFxBakePromise = null;

export function hasBakedDynamicAsset(cacheKey) {
  return Boolean(cacheKey && bakedDynamicUrlMap.has(cacheKey));
}

export function resolveBakedDynamicAsset(cacheKey, { compact = false } = {}) {
  if (!cacheKey) return null;
  if (compact) {
    return bakedDynamicThumbUrlMap.get(cacheKey) || bakedDynamicUrlMap.get(cacheKey) || null;
  }
  return bakedDynamicUrlMap.get(cacheKey) || null;
}

function decodeSvgMarkup(svgDataUriOrXml) {
  if (!svgDataUriOrXml || typeof svgDataUriOrXml !== 'string') return '';
  const trimmed = svgDataUriOrXml.trim();
  if (trimmed.startsWith('<svg')) return trimmed;
  if (trimmed.startsWith('data:image/svg+xml')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx === -1) return '';
    const header = trimmed.slice(0, commaIdx).toLowerCase();
    const body = trimmed.slice(commaIdx + 1);
    try {
      if (header.includes(';base64')) {
        return typeof atob === 'function' ? atob(body) : '';
      }
      return decodeURIComponent(body);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * 동적 벡터 SVG(유저 커스텀 슬리브/프리셋 슬리브 등)를 일반 래스터 PNG Blob(풀사이즈 + 축소 밉맵)으로 굽습니다.
 * 헤드리스 환경에서는 안전하게 null을 반환합니다.
 */
export async function bakeDynamicSvgAsset(
  cacheKey,
  svgDataUriOrXml,
  { width = 640, height = 896, thumbWidth = 240, thumbHeight = 336, revokePrefix = null } = {}
) {
  if (!cacheKey || !svgDataUriOrXml) return null;
  if (bakedDynamicUrlMap.has(cacheKey)) {
    return bakedDynamicUrlMap.get(cacheKey);
  }
  if (bakedDynamicPendingMap.has(cacheKey)) {
    return bakedDynamicPendingMap.get(cacheKey);
  }
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }

  const job = (async () => {
    let tempSvgUrl = null;
    try {
      const rawSvg = decodeSvgMarkup(svgDataUriOrXml);
      let sourceForImg = svgDataUriOrXml;
      if (rawSvg) {
        const sizedSvg = injectSvgPixelDimensions(rawSvg, width, height);
        const svgBlob = new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' });
        tempSvgUrl = URL.createObjectURL(svgBlob);
        sourceForImg = tempSvgUrl;
      }

      const img = await loadHtmlImage(sourceForImg);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const pngBlob = await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      });
      if (!pngBlob) return null;

      const pngUrl = URL.createObjectURL(pngBlob);
      let thumbUrl = null;
      if (thumbWidth && thumbHeight && (thumbWidth < width || thumbHeight < height)) {
        const thumbCanvas = stepDownMipmapCanvas(canvas, thumbWidth, thumbHeight);
        const thumbBlob = await new Promise((resolve) => {
          thumbCanvas.toBlob((blob) => resolve(blob), 'image/png');
        });
        if (thumbBlob) {
          thumbUrl = URL.createObjectURL(thumbBlob);
        }
      }

      if (revokePrefix) {
        for (const [oldKey, oldUrl] of Array.from(bakedDynamicUrlMap.entries())) {
          if (oldKey.startsWith(revokePrefix) && oldKey !== cacheKey) {
            try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
            bakedDynamicUrlMap.delete(oldKey);
          }
        }
        for (const [oldKey, oldThumbUrl] of Array.from(bakedDynamicThumbUrlMap.entries())) {
          if (oldKey.startsWith(revokePrefix) && oldKey !== cacheKey) {
            try { URL.revokeObjectURL(oldThumbUrl); } catch { /* ignore */ }
            bakedDynamicThumbUrlMap.delete(oldKey);
          }
        }
      }

      bakedDynamicUrlMap.set(cacheKey, pngUrl);
      if (thumbUrl) bakedDynamicThumbUrlMap.set(cacheKey, thumbUrl);
      return pngUrl;
    } catch {
      return null;
    } finally {
      bakedDynamicPendingMap.delete(cacheKey);
      if (tempSvgUrl) {
        try {
          URL.revokeObjectURL(tempSvgUrl);
        } catch {
          // 무시
        }
      }
    }
  })();

  bakedDynamicPendingMap.set(cacheKey, job);
  return job;
}

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

/** 승리/패배 연출 PNG 베이킹 상태 통계를 반환한다 */
export function getVictoryDefeatBakeStats() {
  return { ...fxBakeStats };
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
  const rootStyle = document.documentElement.style;
  const bakedCardBack = bakedUrlMap.get('assets/ui/card_back.svg');
  if (bakedCardBack) {
    rootStyle.setProperty('--baked-card-back-url', `url("${bakedCardBack}")`);
  }
  const bakedVictoryRays = bakedDynamicUrlMap.get('fx:victory:rays');
  if (bakedVictoryRays) {
    rootStyle.setProperty('--baked-victory-rays-url', `url("${bakedVictoryRays}")`);
  }
  const bakedVictoryTrophy = bakedDynamicUrlMap.get('fx:victory:trophy');
  if (bakedVictoryTrophy) {
    rootStyle.setProperty('--baked-victory-trophy-url', `url("${bakedVictoryTrophy}")`);
  }
  const bakedDefeatSkull = bakedDynamicUrlMap.get('fx:defeat:skull');
  if (bakedDefeatSkull) {
    rootStyle.setProperty('--baked-defeat-skull-url', `url("${bakedDefeatSkull}")`);
  }
}

async function bakeVictoryRaysPng(cacheKey, width = 900, height = 900) {
  if (bakedDynamicUrlMap.has(cacheKey)) return bakedDynamicUrlMap.get(cacheKey);
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = width * 0.5;
    const cy = height * 0.5;
    const radius = Math.min(cx, cy);
    const stepDeg = 26;
    const wedgeDeg = 10;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.24)';
    for (let deg = 0; deg < 360; deg += stepDeg) {
      const a0 = ((deg - 90) * Math.PI) / 180;
      const a1 = ((deg + wedgeDeg - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(cx, cy, radius * 0.14, cx, cy, radius * 0.64);
    mask.addColorStop(0, 'rgba(0, 0, 0, 0.94)');
    mask.addColorStop(0.55, 'rgba(0, 0, 0, 0.55)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';

    const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    bakedDynamicUrlMap.set(cacheKey, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * 승리/패배 연출에 쓰이는 벡터 이펙트(빛줄기 · 트로피 · 해골 · 기회 하트)를
 * 게임 시작 시 PNG Blob 텍스처로 사전 베이킹한다.
 */
export async function bakeVictoryDefeatEffectAssets() {
  if (activeFxBakePromise) return activeFxBakePromise;
  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    fxBakeStats = { ready: true, bakedCount: 0, totalCount: VICTORY_DEFEAT_FX_SPECS.length };
    return fxBakeStats;
  }

  activeFxBakePromise = (async () => {
    const results = await Promise.all(
      VICTORY_DEFEAT_FX_SPECS.map((spec) => {
        if (spec.kind === 'rays') {
          return bakeVictoryRaysPng(spec.key, spec.width, spec.height);
        }
        return bakeDynamicSvgAsset(spec.key, spec.svg, {
          width: spec.width,
          height: spec.height,
          thumbWidth: spec.thumbWidth || null,
          thumbHeight: spec.thumbHeight || null,
        });
      })
    );
    const bakedCount = results.filter(Boolean).length;
    fxBakeStats = {
      ready: true,
      bakedCount,
      totalCount: VICTORY_DEFEAT_FX_SPECS.length,
    };
    syncBakedCssTextures();
    upgradeVictoryDefeatDomAssets(document);
    return fxBakeStats;
  })();

  return activeFxBakePromise;
}

/** 승리/패배 오버레이 DOM 요소를 베이킹된 PNG 텍스처로 교체한다 */
export function upgradeVictoryDefeatDomAssets(root = document) {
  if (typeof document === 'undefined' || !root?.querySelector) return 0;
  let upgraded = 0;

  const raysUrl = bakedDynamicUrlMap.get('fx:victory:rays');
  if (raysUrl) {
    const raysEl = root.querySelector('.victory-rays');
    if (raysEl && !raysEl.classList.contains('is-baked')) {
      raysEl.classList.add('is-baked');
      upgraded += 1;
    }
  }

  const trophyUrl = bakedDynamicUrlMap.get('fx:victory:trophy');
  if (trophyUrl) {
    const trophyHost = root.querySelector('#duel-victory-overlay .victory-trophy-icon');
    if (trophyHost && !trophyHost.classList.contains('is-baked')) {
      trophyHost.classList.add('is-baked');
      trophyHost.innerHTML = `<img src="${trophyUrl}" class="fx-baked-emblem-img" alt="" draggable="false" />`;
      upgraded += 1;
    }
  }

  const skullUrl = bakedDynamicUrlMap.get('fx:defeat:skull');
  if (skullUrl) {
    const skullHost = root.querySelector('#duel-defeat-overlay .defeat-skull-icon');
    if (skullHost && !skullHost.classList.contains('is-baked')) {
      skullHost.classList.add('is-baked');
      skullHost.innerHTML = `<img src="${skullUrl}" class="fx-baked-emblem-img" alt="" draggable="false" />`;
      upgraded += 1;
    }
  }

  return upgraded;
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
    fxBakeStats = { ready: true, bakedCount: 0, totalCount: VICTORY_DEFEAT_FX_SPECS.length };
    return bakeStats;
  }

  activeBakePromise = (async () => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const total = VECTOR_BAKE_SPECS.length;
    let completed = 0;
    let bakedCount = 0;

    const fxBakePromise = bakeVictoryDefeatEffectAssets();

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

    await fxBakePromise;
    syncBakedCssTextures();
    upgradeDomSvgImages(document);
    upgradeVictoryDefeatDomAssets(document);

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

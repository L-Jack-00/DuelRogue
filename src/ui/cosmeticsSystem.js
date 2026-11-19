/**
 * src/ui/cosmeticsSystem.js
 * 플레이어 카드 슬리브(카드 뒷면 · 프리셋 & 4-색조 다이얼 커스텀 슬리브 빌더) 및
 * 내 필드 플레이매트(기본 회색 단색 · 개발자 에셋 슬롯 `assets/mats/`) 설정 시스템
 * - 권장 매트 이미지 크기: 920 × 146 px (@2x 고해상도 권장: 1840 × 292 px)
 */

export const COSMETICS_STORAGE_KEY = 'duel_rogue_cosmetics_v1';

export const MAT_RECOMMENDED_SIZE = Object.freeze({
  width: 920,
  height: 146,
  retinaWidth: 1840,
  retinaHeight: 292,
});

export const SLEEVE_PRESETS = Object.freeze({
  DEFAULT: {
    id: 'DEFAULT',
    label: '아케인 네이비 (기본 벡터)',
    bg0: '#192552',
    bg1: '#0d132e',
    bg2: '#050814',
    accent0: '#fef08a',
    accent1: '#eab308',
    accent2: '#9a6704',
    orb0: '#e0f2fe',
    orb1: '#38bdf8',
    orb2: '#1d4ed8',
  },
  ROYAL_BLUE: {
    id: 'ROYAL_BLUE',
    label: '정의 로열 블루',
    bg0: '#2563eb',
    bg1: '#1e3a8a',
    bg2: '#0a1636',
    accent0: '#f8fafc',
    accent1: '#cbd5e1',
    accent2: '#64748b',
    orb0: '#fef9c3',
    orb1: '#facc15',
    orb2: '#b45309',
  },
  CRIMSON_RED: {
    id: 'CRIMSON_RED',
    label: '열의 크림슨 레드',
    bg0: '#b91c1c',
    bg1: '#7f1d1d',
    bg2: '#2d0609',
    accent0: '#fef08a',
    accent1: '#eab308',
    accent2: '#854d0e',
    orb0: '#fed7aa',
    orb1: '#f97316',
    orb2: '#c2410c',
  },
  OCCULT_PURPLE: {
    id: 'OCCULT_PURPLE',
    label: '혼돈 오컬트 바이올렛',
    bg0: '#6d28d9',
    bg1: '#4c1d95',
    bg2: '#1a0936',
    accent0: '#fef08a',
    accent1: '#eab308',
    accent2: '#9a6704',
    orb0: '#f5d0fe',
    orb1: '#c084fc',
    orb2: '#7e22ce',
  },
  MONO_GRAY: {
    id: 'MONO_GRAY',
    label: 'Win2k 티타늄 그레이',
    bg0: '#64748b',
    bg1: '#334155',
    bg2: '#0f172a',
    accent0: '#ffffff',
    accent1: '#cbd5e1',
    accent2: '#475569',
    orb0: '#dbeafe',
    orb1: '#60a5fa',
    orb2: '#1d4ed8',
  },
  CUSTOM: {
    id: 'CUSTOM',
    label: '커스텀',
  },
});

export const CUSTOM_SLEEVE_OPTIONS = Object.freeze({
  bgPattern: [
    { id: 'RADIAL', label: '방사형 그라데이션' },
    { id: 'DIAMOND', label: '다이아 격자 패턴' },
    { id: 'RINGS', label: '동심원 룬 파동' },
    { id: 'STRIPES', label: '수직 스트라이프' },
    { id: 'GRID', label: '벡터 회로 격자' },
  ],
  borderStyle: [
    { id: 'ARCANE', label: '아케인 이중 프레임' },
    { id: 'DOUBLE', label: '클래식 이중 직선' },
    { id: 'CORNER_RUNES', label: '모서리 다이아 룬' },
    { id: 'W2K_BEVEL', label: 'Win2k 입체 베벨' },
    { id: 'BOLD', label: '굵은 단선 프레임' },
  ],
  emblem1: [
    { id: 'CIRCLE_DOUBLE', label: '이중 마법진 서클' },
    { id: 'COMPASS_8', label: '8각 나침반 별' },
    { id: 'HEX_RING', label: '육각 룬 링' },
    { id: 'ARCANE_DOTS', label: '오컬트 성좌 점선' },
    { id: 'NONE', label: '문양 1 없음' },
  ],
  emblem2: [
    { id: 'HEXAGRAM_EYE', label: '육망성 · 사파이어 눈' },
    { id: 'CROWN_SEAL', label: '왕관 인장' },
    { id: 'CROSSED_SWORDS', label: '교차 쌍검' },
    { id: 'AEGIS_SHIELD', label: '수호 방패' },
    { id: 'CRESCENT_MOON', label: '초승달 오컬트' },
    { id: 'FOUR_STAR', label: '4각 성광 코어' },
    { id: 'NONE', label: '문양 2 없음' },
  ],
});

export const DEFAULT_CUSTOM_SLEEVE = Object.freeze({
  bgPattern: 'RADIAL',
  borderStyle: 'ARCANE',
  emblem1: 'CIRCLE_DOUBLE',
  emblem2: 'HEXAGRAM_EYE',
  c1: { h: 228, s: 58, l: 18 }, // 배경
  c2: { h: 45, s: 90, l: 52 },  // 테두리
  c3: { h: 48, s: 92, l: 58 },  // 문양 1
  c4: { h: 199, s: 92, l: 58 }, // 문양 2
});

/**
 * 개발 중 매트 이미지를 추가하려면 `assets/mats/<파일>.webp`를 배치한 뒤
 * 아래 `MAT_PRESETS`에 `{ id, label, image: 'assets/mats/<파일>.webp', ... }` 항목을 등록하세요.
 */
export const MAT_PRESETS = Object.freeze({
  GRAY_SOLID: {
    id: 'GRAY_SOLID',
    label: '기본 회색 단색',
    color: '#c8c4bc',
    borderTop: '#ffffff',
    borderBottom: '#404040',
    image: null,
  },
  W2K_SILVER: {
    id: 'W2K_SILVER',
    label: 'Win2k 클래식 실버',
    color: '#d4d0c8',
    borderTop: '#ffffff',
    borderBottom: '#404040',
    image: null,
  },
  NAVY_SLATE: {
    id: 'NAVY_SLATE',
    label: '아케인 다크 슬레이트',
    color: '#253147',
    borderTop: '#60a5fa',
    borderBottom: '#0f172a',
    image: null,
  },
  JUSTICE_BLUE: {
    id: 'JUSTICE_BLUE',
    label: '정의 스카이 블루',
    color: '#bfdbfe',
    borderTop: '#eff6ff',
    borderBottom: '#1d4ed8',
    image: null,
  },
  ZEAL_RED: {
    id: 'ZEAL_RED',
    label: '열의 블러드 틴트',
    color: '#fecaca',
    borderTop: '#fef2f2',
    borderBottom: '#b91c1c',
    image: null,
  },
  CHAOS_PURPLE: {
    id: 'CHAOS_PURPLE',
    label: '혼돈 바이올렛 틴트',
    color: '#ddd6fe',
    borderTop: '#f5f3ff',
    borderBottom: '#6d28d9',
    image: null,
  },
});

function cloneDefaultCustomSleeve() {
  return {
    bgPattern: DEFAULT_CUSTOM_SLEEVE.bgPattern,
    borderStyle: DEFAULT_CUSTOM_SLEEVE.borderStyle,
    emblem1: DEFAULT_CUSTOM_SLEEVE.emblem1,
    emblem2: DEFAULT_CUSTOM_SLEEVE.emblem2,
    c1: { ...DEFAULT_CUSTOM_SLEEVE.c1 },
    c2: { ...DEFAULT_CUSTOM_SLEEVE.c2 },
    c3: { ...DEFAULT_CUSTOM_SLEEVE.c3 },
    c4: { ...DEFAULT_CUSTOM_SLEEVE.c4 },
  };
}

function normalizeDialColor(raw, fallback) {
  const h = Number.isFinite(Number(raw?.h)) ? ((Math.round(Number(raw.h)) % 360) + 360) % 360 : fallback.h;
  const s = Number.isFinite(Number(raw?.s)) ? Math.max(0, Math.min(100, Math.round(Number(raw.s)))) : fallback.s;
  const l = Number.isFinite(Number(raw?.l)) ? Math.max(8, Math.min(92, Math.round(Number(raw.l)))) : fallback.l;
  return { h, s, l };
}

export function normalizeCustomSleeve(raw) {
  const def = cloneDefaultCustomSleeve();
  if (!raw || typeof raw !== 'object') return def;
  const hasOption = (key, val) => CUSTOM_SLEEVE_OPTIONS[key].some((o) => o.id === val);
  return {
    bgPattern: hasOption('bgPattern', raw.bgPattern) ? raw.bgPattern : def.bgPattern,
    borderStyle: hasOption('borderStyle', raw.borderStyle) ? raw.borderStyle : def.borderStyle,
    emblem1: hasOption('emblem1', raw.emblem1) ? raw.emblem1 : def.emblem1,
    emblem2: hasOption('emblem2', raw.emblem2) ? raw.emblem2 : def.emblem2,
    c1: normalizeDialColor(raw.c1, def.c1),
    c2: normalizeDialColor(raw.c2, def.c2),
    c3: normalizeDialColor(raw.c3, def.c3),
    c4: normalizeDialColor(raw.c4, def.c4),
  };
}

const DEFAULT_COSMETICS_CONFIG = {
  sleevePreset: 'DEFAULT',
  customSleeve: cloneDefaultCustomSleeve(),
  matPreset: 'GRAY_SOLID',
};

function getSafeStorage(storageOverride = null) {
  if (storageOverride) return storageOverride;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function loadCosmeticsConfig(storageOverride = null) {
  const store = getSafeStorage(storageOverride);
  if (!store) {
    return {
      sleevePreset: 'DEFAULT',
      customSleeve: cloneDefaultCustomSleeve(),
      matPreset: 'GRAY_SOLID',
    };
  }
  try {
    const raw = store.getItem(COSMETICS_STORAGE_KEY);
    if (!raw) {
      return {
        sleevePreset: 'DEFAULT',
        customSleeve: cloneDefaultCustomSleeve(),
        matPreset: 'GRAY_SOLID',
      };
    }
    const parsed = JSON.parse(raw);
    const sleevePreset = SLEEVE_PRESETS[parsed?.sleevePreset] ? parsed.sleevePreset : 'DEFAULT';
    const matPreset = MAT_PRESETS[parsed?.matPreset] ? parsed.matPreset : 'GRAY_SOLID';
    return {
      sleevePreset,
      customSleeve: normalizeCustomSleeve(parsed?.customSleeve),
      matPreset,
    };
  } catch {
    return {
      sleevePreset: 'DEFAULT',
      customSleeve: cloneDefaultCustomSleeve(),
      matPreset: 'GRAY_SOLID',
    };
  }
}

export function saveCosmeticsConfig(config, storageOverride = null) {
  const store = getSafeStorage(storageOverride);
  if (!store) return false;
  try {
    store.setItem(COSMETICS_STORAGE_KEY, JSON.stringify({
      sleevePreset: SLEEVE_PRESETS[config?.sleevePreset] ? config.sleevePreset : 'DEFAULT',
      customSleeve: normalizeCustomSleeve(config?.customSleeve),
      matPreset: MAT_PRESETS[config?.matPreset] ? config.matPreset : 'GRAY_SOLID',
    }));
    return true;
  } catch {
    return false;
  }
}

export function dialColorToCss(dial, lDelta = 0, sScale = 1) {
  const h = ((Math.round(dial?.h ?? 0) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, Math.round((dial?.s ?? 75) * sScale)));
  const l = Math.max(4, Math.min(96, Math.round((dial?.l ?? 50) + lDelta)));
  return `hsl(${h}, ${s}%, ${l}%)`;
}

const sleeveUriCache = new Map();

export function buildVectorSleeveSvgDataUri(presetId = 'DEFAULT') {
  if (presetId === 'DEFAULT' || !SLEEVE_PRESETS[presetId] || presetId === 'CUSTOM') {
    return 'assets/ui/card_back.svg';
  }
  if (sleeveUriCache.has(presetId)) return sleeveUriCache.get(presetId);
  const p = SLEEVE_PRESETS[presetId];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 448" width="100%" height="100%">
  <defs>
    <radialGradient id="cbBg" cx="50%" cy="48%" r="68%">
      <stop offset="0%" stop-color="${p.bg0}"/>
      <stop offset="58%" stop-color="${p.bg1}"/>
      <stop offset="100%" stop-color="${p.bg2}"/>
    </radialGradient>
    <linearGradient id="cbGold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.accent0}"/>
      <stop offset="48%" stop-color="${p.accent1}"/>
      <stop offset="100%" stop-color="${p.accent2}"/>
    </linearGradient>
    <radialGradient id="cbOrb" cx="42%" cy="38%" r="55%">
      <stop offset="0%" stop-color="${p.orb0}"/>
      <stop offset="42%" stop-color="${p.orb1}"/>
      <stop offset="82%" stop-color="${p.orb2}"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </radialGradient>
  </defs>
  <rect x="8" y="8" width="304" height="432" rx="18" fill="url(#cbBg)" stroke="url(#cbGold)" stroke-width="12"/>
  <rect x="24" y="24" width="272" height="400" rx="10" fill="none" stroke="url(#cbGold)" stroke-width="4" opacity="0.72"/>
  <g fill="url(#cbGold)">
    <polygon points="40,32 48,40 40,48 32,40"/>
    <polygon points="280,32 288,40 280,48 272,40"/>
    <polygon points="40,400 48,408 40,416 32,408"/>
    <polygon points="280,400 288,408 280,416 272,408"/>
  </g>
  <circle cx="160" cy="224" r="98" fill="${p.bg0}" fill-opacity="0.22" stroke="url(#cbGold)" stroke-width="7"/>
  <circle cx="160" cy="224" r="80" fill="none" stroke="url(#cbGold)" stroke-width="3" opacity="0.78"/>
  <g stroke="url(#cbGold)" stroke-width="8.5" stroke-linejoin="round" fill="none">
    <polygon points="160,130 241,271 79,271"/>
    <polygon points="160,318 79,177 241,177"/>
  </g>
  <circle cx="160" cy="224" r="42" fill="${p.bg2}" stroke="url(#cbGold)" stroke-width="5"/>
  <path d="M 122,224 Q 160,188 198,224 Q 160,260 122,224 Z" fill="${p.bg2}" stroke="url(#cbGold)" stroke-width="4.5" stroke-linejoin="round"/>
  <circle cx="160" cy="224" r="17" fill="url(#cbOrb)" stroke="${p.orb0}" stroke-width="2"/>
  <circle cx="160" cy="224" r="7" fill="${p.bg2}"/>
  <path d="M 160,211 L 163,221 L 173,224 L 163,227 L 160,237 L 157,227 L 147,224 L 157,221 Z" fill="${p.accent0}"/>
</svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  sleeveUriCache.set(presetId, uri);
  return uri;
}

export function buildCustomSleeveSvg(rawSpec) {
  const s = normalizeCustomSleeve(rawSpec);
  const bgBright = dialColorToCss(s.c1, 14);
  const bgMid = dialColorToCss(s.c1, 0);
  const bgDark = dialColorToCss(s.c1, -12);

  const bdHi = dialColorToCss(s.c2, 18);
  const bdMain = dialColorToCss(s.c2, 0);
  const bdDark = dialColorToCss(s.c2, -18);

  const e1Main = dialColorToCss(s.c3, 0);
  const e1Soft = dialColorToCss(s.c3, 18);

  const e2Main = dialColorToCss(s.c4, 0);
  const e2Hi = dialColorToCss(s.c4, 24);
  const e2Dark = dialColorToCss(s.c4, -22);

  let patternDefs = '';
  let patternOverlay = '';
  if (s.bgPattern === 'DIAMOND') {
    patternDefs = `<pattern id="csPat" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M16 2 L30 16 L16 30 L2 16 Z" fill="none" stroke="${bgBright}" stroke-width="2.2" opacity="0.45"/></pattern>`;
    patternOverlay = `<rect x="18" y="18" width="284" height="412" rx="12" fill="url(#csPat)"/>`;
  } else if (s.bgPattern === 'RINGS') {
    patternOverlay = `
      <circle cx="160" cy="224" r="140" fill="none" stroke="${bgBright}" stroke-width="4" opacity="0.3"/>
      <circle cx="160" cy="224" r="185" fill="none" stroke="${bgBright}" stroke-width="4" opacity="0.22"/>
      <circle cx="160" cy="224" r="230" fill="none" stroke="${bgBright}" stroke-width="4" opacity="0.16"/>
    `;
  } else if (s.bgPattern === 'STRIPES') {
    patternDefs = `<pattern id="csPat" width="24" height="24" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="10" height="24" fill="${bgBright}" opacity="0.25"/></pattern>`;
    patternOverlay = `<rect x="18" y="18" width="284" height="412" rx="12" fill="url(#csPat)"/>`;
  } else if (s.bgPattern === 'GRID') {
    patternDefs = `<pattern id="csPat" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0 H0 V28" fill="none" stroke="${bgBright}" stroke-width="2" opacity="0.36"/></pattern>`;
    patternOverlay = `<rect x="18" y="18" width="284" height="412" rx="12" fill="url(#csPat)"/>`;
  }

  let borderMarkup = '';
  if (s.borderStyle === 'DOUBLE') {
    borderMarkup = `
      <rect x="8" y="8" width="304" height="432" rx="18" fill="none" stroke="${bdMain}" stroke-width="12"/>
      <rect x="24" y="24" width="272" height="400" rx="10" fill="none" stroke="${bdHi}" stroke-width="5"/>
    `;
  } else if (s.borderStyle === 'CORNER_RUNES') {
    borderMarkup = `
      <rect x="8" y="8" width="304" height="432" rx="16" fill="none" stroke="${bdMain}" stroke-width="11"/>
      <g fill="${bdHi}" stroke="${bdDark}" stroke-width="2">
        <polygon points="44,24 60,40 44,56 28,40"/>
        <polygon points="276,24 292,40 276,56 260,40"/>
        <polygon points="44,392 60,408 44,424 28,408"/>
        <polygon points="276,392 292,408 276,424 260,408"/>
      </g>
    `;
  } else if (s.borderStyle === 'W2K_BEVEL') {
    borderMarkup = `
      <rect x="6" y="6" width="308" height="436" rx="4" fill="none" stroke="${bdDark}" stroke-width="10"/>
      <polyline points="12,436 12,12 308,12" fill="none" stroke="${bdHi}" stroke-width="6"/>
      <rect x="22" y="22" width="276" height="404" rx="2" fill="none" stroke="${bdMain}" stroke-width="4"/>
    `;
  } else if (s.borderStyle === 'BOLD') {
    borderMarkup = `
      <rect x="10" y="10" width="300" height="428" rx="18" fill="none" stroke="${bdMain}" stroke-width="16"/>
    `;
  } else {
    // ARCANE default
    borderMarkup = `
      <rect x="8" y="8" width="304" height="432" rx="18" fill="none" stroke="url(#csBorder)" stroke-width="12"/>
      <rect x="24" y="24" width="272" height="400" rx="10" fill="none" stroke="${bdHi}" stroke-width="3.5" opacity="0.78"/>
      <g fill="${bdHi}">
        <polygon points="40,32 48,40 40,48 32,40"/>
        <polygon points="280,32 288,40 280,48 272,40"/>
        <polygon points="40,400 48,408 40,416 32,408"/>
        <polygon points="280,400 288,408 280,416 272,408"/>
      </g>
    `;
  }

  let emblem1Markup = '';
  if (s.emblem1 === 'CIRCLE_DOUBLE') {
    emblem1Markup = `
      <circle cx="160" cy="224" r="98" fill="${e1Main}" fill-opacity="0.12" stroke="${e1Main}" stroke-width="7"/>
      <circle cx="160" cy="224" r="80" fill="none" stroke="${e1Soft}" stroke-width="3.5" opacity="0.86"/>
    `;
  } else if (s.emblem1 === 'COMPASS_8') {
    emblem1Markup = `
      <circle cx="160" cy="224" r="96" fill="none" stroke="${e1Main}" stroke-width="6"/>
      <polygon points="160,104 178,206 280,224 178,242 160,344 142,242 40,224 142,206" fill="${e1Main}" fill-opacity="0.22" stroke="${e1Soft}" stroke-width="4" stroke-linejoin="round"/>
    `;
  } else if (s.emblem1 === 'HEX_RING') {
    emblem1Markup = `
      <circle cx="160" cy="224" r="98" fill="none" stroke="${e1Main}" stroke-width="6"/>
      <polygon points="160,126 245,175 245,273 160,322 75,273 75,175" fill="${e1Main}" fill-opacity="0.14" stroke="${e1Soft}" stroke-width="5.5" stroke-linejoin="round"/>
    `;
  } else if (s.emblem1 === 'ARCANE_DOTS') {
    emblem1Markup = `
      <circle cx="160" cy="224" r="98" fill="none" stroke="${e1Main}" stroke-width="6" stroke-dasharray="14 9"/>
      <circle cx="160" cy="224" r="78" fill="none" stroke="${e1Soft}" stroke-width="4"/>
      <g fill="${e1Soft}">
        <circle cx="160" cy="126" r="6"/><circle cx="160" cy="322" r="6"/>
        <circle cx="62" cy="224" r="6"/><circle cx="258" cy="224" r="6"/>
      </g>
    `;
  }

  let emblem2Markup = '';
  if (s.emblem2 === 'HEXAGRAM_EYE') {
    emblem2Markup = `
      <g stroke="${e2Main}" stroke-width="8" stroke-linejoin="round" fill="none">
        <polygon points="160,136 236,268 84,268"/>
        <polygon points="160,312 84,180 236,180"/>
      </g>
      <circle cx="160" cy="224" r="38" fill="${bgDark}" stroke="${e2Hi}" stroke-width="4.5"/>
      <path d="M126,224 Q160,192 194,224 Q160,256 126,224 Z" fill="${e2Dark}" stroke="${e2Hi}" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="160" cy="224" r="14" fill="${e2Main}" stroke="${e2Hi}" stroke-width="2"/>
      <circle cx="160" cy="224" r="6" fill="${bgDark}"/>
    `;
  } else if (s.emblem2 === 'CROWN_SEAL') {
    emblem2Markup = `
      <path d="M96,268 L84,184 L128,216 L160,156 L192,216 L236,184 L224,268 Z" fill="${e2Main}" fill-opacity="0.34" stroke="${e2Hi}" stroke-width="7" stroke-linejoin="round"/>
      <rect x="96" y="276" width="128" height="14" rx="4" fill="${e2Hi}"/>
      <circle cx="160" cy="232" r="12" fill="${e2Hi}"/>
    `;
  } else if (s.emblem2 === 'CROSSED_SWORDS') {
    emblem2Markup = `
      <g stroke="${e2Hi}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="104" y1="168" x2="216" y2="280"/>
        <line x1="216" y1="168" x2="104" y2="280"/>
        <line x1="96" y1="262" x2="122" y2="288"/>
        <line x1="224" y1="262" x2="198" y2="288"/>
      </g>
      <polygon points="160,196 184,224 160,252 136,224" fill="${e2Main}" stroke="${e2Hi}" stroke-width="4"/>
    `;
  } else if (s.emblem2 === 'AEGIS_SHIELD') {
    emblem2Markup = `
      <path d="M160,154 L222,180 V234 C222,272 194,300 160,316 C126,300 98,272 98,234 V180 Z" fill="${e2Main}" fill-opacity="0.32" stroke="${e2Hi}" stroke-width="7.5" stroke-linejoin="round"/>
      <path d="M160,178 V290 M120,226 H200" stroke="${e2Hi}" stroke-width="6" stroke-linecap="round"/>
    `;
  } else if (s.emblem2 === 'CRESCENT_MOON') {
    emblem2Markup = `
      <path d="M188,158 A68,68 0 1,0 188,290 A52,58 0 1,1 188,158 Z" fill="${e2Main}" stroke="${e2Hi}" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="196,204 204,220 220,224 204,228 196,244 188,228 172,224 188,220" fill="${e2Hi}"/>
    `;
  } else if (s.emblem2 === 'FOUR_STAR') {
    emblem2Markup = `
      <polygon points="160,136 184,200 248,224 184,248 160,312 136,248 72,224 136,200" fill="${e2Main}" fill-opacity="0.36" stroke="${e2Hi}" stroke-width="6.5" stroke-linejoin="round"/>
      <circle cx="160" cy="224" r="18" fill="${e2Hi}"/>
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 448" width="100%" height="100%">
  <defs>
    <radialGradient id="csBg" cx="50%" cy="48%" r="68%">
      <stop offset="0%" stop-color="${bgBright}"/>
      <stop offset="58%" stop-color="${bgMid}"/>
      <stop offset="100%" stop-color="${bgDark}"/>
    </radialGradient>
    <linearGradient id="csBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bdHi}"/>
      <stop offset="50%" stop-color="${bdMain}"/>
      <stop offset="100%" stop-color="${bdDark}"/>
    </linearGradient>
    ${patternDefs}
  </defs>
  <rect x="8" y="8" width="304" height="432" rx="18" fill="url(#csBg)"/>
  ${patternOverlay}
  ${borderMarkup}
  ${emblem1Markup}
  ${emblem2Markup}
</svg>`;
}

export function buildCustomSleeveSvgDataUri(rawSpec) {
  const svg = buildCustomSleeveSvg(rawSpec);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function resolvePlayerSleeveSpec(config) {
  const cfg = config || DEFAULT_COSMETICS_CONFIG;
  if (cfg.sleevePreset === 'CUSTOM') {
    return {
      preset: 'CUSTOM',
      src: buildCustomSleeveSvgDataUri(cfg.customSleeve),
      isCustom: true,
    };
  }
  const preset = SLEEVE_PRESETS[cfg.sleevePreset] ? cfg.sleevePreset : 'DEFAULT';
  return {
    preset,
    src: buildVectorSleeveSvgDataUri(preset),
    isCustom: false,
  };
}

export function applyDuelCosmetics(config, rootDoc = typeof document !== 'undefined' ? document : null) {
  if (!rootDoc) return;
  const cfg = config || DEFAULT_COSMETICS_CONFIG;
  const mat = MAT_PRESETS[cfg.matPreset] || MAT_PRESETS.GRAY_SOLID;
  const playerBoard = rootDoc.getElementById('player-board');

  if (playerBoard) {
    const matColor = mat.color || '#c8c4bc';
    playerBoard.style.setProperty('--player-mat-bg', matColor);
    playerBoard.style.setProperty('--player-mat-img', mat.image ? `url("${mat.image}")` : 'none');
    playerBoard.style.setProperty('--player-mat-border-top', mat.borderTop || '#ffffff');
    playerBoard.style.setProperty('--player-mat-border-bottom', mat.borderBottom || '#404040');
    playerBoard.dataset.matPreset = mat.id;
  }
}

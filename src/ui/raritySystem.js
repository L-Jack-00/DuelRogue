/**
 * @file src/ui/raritySystem.js
 * @description 카드 레어도별 시각 효과 프리셋·설정 관리 및 CSS 변수 동기화 모듈
 */

export const RARITY_TIERS = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

export const RARITY_LABELS_KO = {
  COMMON: '노말',
  UNCOMMON: '레어',
  RARE: '에픽',
  EPIC: '유니크',
  LEGENDARY: '레전드',
};

export const RARITY_PRESET_INFO = {
  NONE: { label: '효과 없음 (기본 무광)', artFx: 0, glow: 0, nameGlow: 0 },
  NAME_ONLY: { label: '이름 색상 & 각인만 적용', artFx: 0, glow: 0.2, nameGlow: 0.5 },
  METALLIC: { label: '은은한 금속 테두리 광택', artFx: 0.5, glow: 0.5, nameGlow: 0.4 },
  ARCANE_SHIMMER: { label: '비전 룬 광채 & 일러스트 쉬머', artFx: 0.9, glow: 0.9, nameGlow: 0.8 },
  CRYSTAL_AURORA: { label: '프리즘 스캔 & 일러스트 글로우', artFx: 1.2, glow: 1.2, nameGlow: 1.1 },
  MYTHIC_PRISM: { label: '레전드 프리즘 홀로그램 + 금빛 입자', artFx: 1.4, glow: 1.5, nameGlow: 1.5 },
};

export const DEFAULT_CARD_NAME_FONT_SETTINGS = {
  fontPreset: 'NOTO_SANS',
  fontWeight: '400',
  customFont: '',
};

export const CARD_NAME_FONT_PRESETS = {
  NOTO_SANS: {
    label: 'Noto Sans / 맑은 고딕 (기본 고딕)',
    stack: "'Noto Sans KR', 'Malgun Gothic', sans-serif",
  },
  DUNGGEUNMO: {
    label: '둥근모꼴 (내장 레트로 픽셀체)',
    stack: "'DuelRogueRetroKR', 'DungGeunMo', monospace",
  },
  GOWUN_BATANG: {
    label: '고운 바탕 (부드러운 서적 명조)',
    stack: "'Gowun Batang', 'HCR Batang', 'Batang', serif",
  },
  HAHMLET: {
    label: '함렛 (단단한 현대 세리프)',
    stack: "'Hahmlet', 'HCR Batang', 'Batang', serif",
  },
  NOTO_SERIF: {
    label: 'Noto Serif KR (정통 명조)',
    stack: "'Noto Serif KR', 'Batang', serif",
  },
  HCR_BATANG: {
    label: '함초롬바탕 (깔끔한 로컬 바탕)',
    stack: "'HCR Batang', 'Batang', serif",
  },
  BATANG: {
    label: '바탕 (Windows 클래식 명조)',
    stack: "'Batang', serif",
  },
  GUNGSUH: {
    label: '궁서 (고전 붓글씨·판타지)',
    stack: "'Gungsuh', 'Batang', serif",
  },
  GULIM: {
    label: '굴림 (레트로 둥근 산세리프)',
    stack: "'Gulim', sans-serif",
  },
  HCR_DOTUM: {
    label: '함초롬돋움 (고전 돋움)',
    stack: "'HCR Dotum', 'Dotum', sans-serif",
  },
  CUSTOM: {
    label: '직접 입력 (PC 설치 글꼴명)',
    stack: "'Noto Sans KR', 'Malgun Gothic', sans-serif",
  },
};

export function resolveCardNameFontStack(fontSettings = DEFAULT_CARD_NAME_FONT_SETTINGS) {
  const fs = fontSettings || DEFAULT_CARD_NAME_FONT_SETTINGS;
  if (fs.fontPreset === 'CUSTOM') {
    const raw = String(fs.customFont || '').trim().replace(/['";{}]/g, '');
    if (raw) {
      return `'${raw}', 'Noto Sans KR', 'Malgun Gothic', sans-serif`;
    }
  }
  return CARD_NAME_FONT_PRESETS[fs.fontPreset]?.stack || CARD_NAME_FONT_PRESETS.NOTO_SANS.stack;
}

export const DEFAULT_RARITY_CONFIG = {
  COMMON: {
    preset: 'NONE',
    nameColor: '#1a0f05',
    artFx: 0.0,
    glow: 0.0,
    nameGlow: 0.0,
    accentColor: '#94a3b8',
  },
  UNCOMMON: {
    preset: 'METALLIC',
    nameColor: '#0f766e',
    artFx: 0.6,
    glow: 0.6,
    nameGlow: 0.5,
    accentColor: '#34d399',
  },
  RARE: {
    preset: 'ARCANE_SHIMMER',
    nameColor: '#0369a1',
    artFx: 1.0,
    glow: 0.9,
    nameGlow: 0.8,
    accentColor: '#38bdf8',
  },
  EPIC: {
    preset: 'CRYSTAL_AURORA',
    nameColor: '#7e22ce',
    artFx: 1.2,
    glow: 1.2,
    nameGlow: 1.1,
    accentColor: '#c084fc',
  },
  LEGENDARY: {
    preset: 'MYTHIC_PRISM',
    nameColor: '#d97706',
    artFx: 1.4,
    glow: 1.5,
    nameGlow: 1.4,
    accentColor: '#fbbf24',
  },
  fontSettings: { ...DEFAULT_CARD_NAME_FONT_SETTINGS },
};

const STORAGE_KEY = 'duel_rogue_rarity_settings_v1';

export function cloneDefaultRarityConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_RARITY_CONFIG));
}

export function loadRarityConfig() {
  const base = cloneDefaultRarityConfig();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    for (const tier of RARITY_TIERS) {
      if (parsed && parsed[tier] && typeof parsed[tier] === 'object') {
        base[tier] = { ...base[tier], ...parsed[tier] };
      }
    }
    if (parsed && parsed.fontSettings && typeof parsed.fontSettings === 'object') {
      base.fontSettings = { ...DEFAULT_CARD_NAME_FONT_SETTINGS, ...parsed.fontSettings };
    }
  } catch (_e) {
    /* ignore malformed storage */
  }
  return base;
}

export function saveRarityConfig(cfg) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }
  } catch (_e) {
    /* ignore quota errors */
  }
}

export function normalizeRarityKey(raw) {
  const key = String(raw || 'COMMON').toUpperCase();
  return RARITY_TIERS.includes(key) ? key : 'COMMON';
}

export function applyRarityConfigToRoot(cfg, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.documentElement) return;
  const rootStyle = doc.documentElement.style;
  for (const tier of RARITY_TIERS) {
    const t = cfg[tier] || DEFAULT_RARITY_CONFIG[tier];
    const k = tier.toLowerCase();
    rootStyle.setProperty(`--rarity-${k}-name-color`, t.nameColor || '#1a0f05');
    rootStyle.setProperty(`--rarity-${k}-accent`, t.accentColor || '#94a3b8');
    rootStyle.setProperty(`--rarity-${k}-art-fx`, String(Number(t.artFx ?? 0)));
    rootStyle.setProperty(`--rarity-${k}-glow`, String(Number(t.glow ?? 0)));
    rootStyle.setProperty(`--rarity-${k}-name-glow`, String(Number(t.nameGlow ?? 0)));
  }

  const fontCfg = cfg?.fontSettings || DEFAULT_CARD_NAME_FONT_SETTINGS;
  rootStyle.setProperty('--card-name-font-stack', resolveCardNameFontStack(fontCfg));
  rootStyle.setProperty('--card-name-font-weight', String(fontCfg.fontWeight || '400'));

  // 기존 렌더링된 카드들의 프리셋 속성 즉시 동기화
  if (typeof doc.querySelectorAll === 'function') {
    doc.querySelectorAll('.card-composite-wrapper[data-rarity]').forEach((el) => {
      const rKey = normalizeRarityKey(el.getAttribute('data-rarity'));
      const t = cfg[rKey] || DEFAULT_RARITY_CONFIG[rKey];
      el.setAttribute('data-rarity-preset', t.preset || 'NONE');
    });
  }
}

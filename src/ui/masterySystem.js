/**
 * 카드 숙련도 비주얼 커스터마이징 시스템 (UI FX 전용)
 * - 바인더에서 숙련도 티어(미숙련 / 숙련 / 마스터)별 기본 비주얼 이펙트 프리셋을 설정
 * - 덱 편집실에서는 카드 ID별 개별 오버라이드 이펙트 프리셋을 지정
 * - 순수 시각 효과(프리즘/글로우/광채)만 제어하며 게임플레이 수치에는 관여하지 않는다.
 */

export const MASTERY_STORAGE_KEY = 'duel_rogue_mastery_fx_v1';

export const MASTERY_TIERS = ['UNMASTERED', 'ADEPT', 'MASTERED'];

export const MASTERY_TIER_META = {
  UNMASTERED: { label: '미숙련 (0~49 pt)', shortLabel: '미숙련', color: '#94a3b8' },
  ADEPT: { label: '숙련 진행 (50~99 pt)', shortLabel: '숙련', color: '#38bdf8' },
  MASTERED: { label: '숙련 마스터 (100+ pt)', shortLabel: '마스터', color: '#facc15' },
};

export const MASTERY_FX_PRESETS = {
  NONE: { label: '효과 없음', glow: 0.0, foil: 0.0, tint: '#94a3b8' },
  SUBTLE_EDGE: { label: '스틸 글로우', glow: 0.65, foil: 0.45, tint: '#38bdf8' },
  ARCANE_SPARK: { label: '비전 펄스', glow: 1.0, foil: 0.85, tint: '#c084fc' },
  HOLO_FOIL: { label: '마스터 홀로그램', glow: 1.25, foil: 1.15, tint: '#facc15' },
  GOLDEN_CROWN: { label: '황금 오라', glow: 1.45, foil: 1.35, tint: '#fbbf24' },
};

export const DEFAULT_MASTERY_FX_CONFIG = {
  tierDefaults: {
    UNMASTERED: { preset: 'NONE', glow: 0.0, foil: 0.0, tint: '#94a3b8' },
    ADEPT: { preset: 'SUBTLE_EDGE', glow: 0.65, foil: 0.45, tint: '#38bdf8' },
    MASTERED: { preset: 'HOLO_FOIL', glow: 1.25, foil: 1.15, tint: '#facc15' },
  },
  cardOverrides: {},
};

function cloneDefaults() {
  return {
    tierDefaults: {
      UNMASTERED: { ...DEFAULT_MASTERY_FX_CONFIG.tierDefaults.UNMASTERED },
      ADEPT: { ...DEFAULT_MASTERY_FX_CONFIG.tierDefaults.ADEPT },
      MASTERED: { ...DEFAULT_MASTERY_FX_CONFIG.tierDefaults.MASTERED },
    },
    cardOverrides: {},
  };
}

export function loadMasteryFxConfig(storageObj = typeof localStorage !== 'undefined' ? localStorage : null) {
  const base = cloneDefaults();
  if (!storageObj) return base;
  try {
    const raw = storageObj.getItem(MASTERY_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.tierDefaults) {
      for (const tier of MASTERY_TIERS) {
        if (parsed.tierDefaults[tier] && typeof parsed.tierDefaults[tier] === 'object') {
          base.tierDefaults[tier] = { ...base.tierDefaults[tier], ...parsed.tierDefaults[tier] };
        }
      }
    }
    if (parsed && parsed.cardOverrides && typeof parsed.cardOverrides === 'object') {
      base.cardOverrides = { ...parsed.cardOverrides };
    }
  } catch {
    // 무시하고 기본값 반환
  }
  return base;
}

export function saveMasteryFxConfig(cfg, storageObj = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storageObj) return;
  try {
    storageObj.setItem(MASTERY_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // 저장 실패 무시
  }
}

export function getMasteryTierFromPoints(points = 0, cardState = 0) {
  if (cardState === 3 || points >= 100) return 'MASTERED';
  if (points >= 50) return 'ADEPT';
  return 'UNMASTERED';
}

export function resolveCardMasteryVisual(cardId, points = 0, cardState = 0, cfg = null) {
  const activeCfg = cfg || loadMasteryFxConfig();
  const tier = getMasteryTierFromPoints(points, cardState);
  const tierCfg = activeCfg.tierDefaults?.[tier] || DEFAULT_MASTERY_FX_CONFIG.tierDefaults[tier];
  const override = cardId ? activeCfg.cardOverrides?.[cardId] : null;
  const chosen = override && override.preset ? override : tierCfg;

  const preset = MASTERY_FX_PRESETS[chosen.preset] ? chosen.preset : 'NONE';
  const presetInfo = MASTERY_FX_PRESETS[preset];
  const glow = Number.isFinite(Number(chosen.glow)) ? Number(chosen.glow) : presetInfo.glow;
  const foil = Number.isFinite(Number(chosen.foil)) ? Number(chosen.foil) : presetInfo.foil;
  const tint = chosen.tint || presetInfo.tint;

  return {
    tier,
    tierLabel: MASTERY_TIER_META[tier]?.shortLabel || tier,
    preset,
    glow,
    foil,
    tint,
    isOverridden: Boolean(override && override.preset),
  };
}

export function getMasteryAttrAndStyle(resolved) {
  if (!resolved || resolved.preset === 'NONE') {
    return { attrs: 'data-mastery-preset="NONE"', style: '' };
  }
  const attrs = `data-mastery-tier="${resolved.tier}" data-mastery-preset="${resolved.preset}"${resolved.isOverridden ? ' data-mastery-override="true"' : ''}`;
  const style = `--mastery-glow:${resolved.glow};--mastery-foil:${resolved.foil};--mastery-tint:${resolved.tint};`;
  return { attrs, style };
}

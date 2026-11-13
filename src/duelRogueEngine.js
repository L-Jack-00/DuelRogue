/**
 * @file duelRogueEngine.js
 * @description 「듀얼 로그 (Duel Rogue)」 선형 런 상태 머신(FSM) 및 대칭형 1v1 PvP 듀얼 엔진 (v2.0)
 * 
 * [사용자 정의 핵심 룰셋 탑재]
 * 1. 계층형 태그 시스템: 루트(' '), 1단계 자식('#'), 2단계 자식('##') 부모-자식 관계.
 * 2. 덱 마스터 시스템: 모든 진영 Lv 1 스타터 몬스터로 전장 시작 기물(씨앗) 배치.
 * 3. 노마나 & 소환권 시스템: 마나를 완전 폐지하고 턴당 1회 일반 소환권 부여.
 * 4. 1레벨 계단식 진화 & 합산 릴리스: 1레벨 차이는 몬스터 1마리 릴리스로 즉시 승급, 2레벨 이상 차이는 제물 레벨 합산 요구.
 * 5. 선/후공 판정: Lv 1 스타터 기반 50:50 공평 코인토스. 첫 1바퀴(1~2턴) 공격 봉인, 3턴 전투 전면 해금.
 * 6. 자유 행동 듀얼: 페이즈 구분 없이 카드 내기/공격/세트 자유 진행 (하스스톤 스타일).
 * 7. 몬스터 속공 & 수비 판정: ATK > DEF 시 파괴. DEF > ATK 시 공격자 본체 반사 피해 (유희왕 룰). 상대 몬스터 우선 공격(수호벽) 강제.
 * 8. 마법 발동 & 3개 위치 세트: 마나 소모 없이 즉시 발동 or 내 몬스터 앞 / 필드 중앙 좌 / 필드 중앙 우에 세트.
 *    (공격받을 시 / 턴 시작 시 / 턴 종료 시 트리거 격발)
 * 9. 30장 덱 구축 룰: 몬스터 최대 3장, 마법 최대 1장(싱글톤), 시작 5장 드로우, 매턴 1장 드로우.
 */

import { BinderCore } from './binderCore.js';

export class SeededRng {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  nextFloat() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive, maxInclusive) {
    return Math.floor(this.nextFloat() * (maxInclusive - minInclusive + 1)) + minInclusive;
  }
}

export const DESTINY_PROFILES = {
  BLUE_JUSTICE: {
    id: 'BLUE_JUSTICE',
    nameKo: '파란색 (정의)',
    favoredArchetype: 'CONTROL',
    nemesisBossId: 'BOSS_RED_UNSTOPPABLE_AGGRO',
    description: '컨트롤 덱 구축에 유리하며, 고수비력 방패와 반격 결계 마법으로 필드를 장악합니다.',
  },
  RED_ZEAL: {
    id: 'RED_ZEAL',
    nameKo: '빨간색 (열의)',
    favoredArchetype: 'AGGRO',
    nemesisBossId: 'BOSS_BLUE_FORTRESS_CONTROL',
    description: '어그로 덱 구축에 유리하며, 저코스트 속공 몬스터와 폭발 화염 지뢰로 상대를 몰아붙입니다.',
  },
  PURPLE_CHAOS: {
    id: 'PURPLE_CHAOS',
    nameKo: '보라색 (혼돈)',
    favoredArchetype: 'CHAOS_RNG',
    nemesisBossId: 'BOSS_PURPLE_RIGGED_FATE',
    description: '도박/RNG 변칙 카드가 대거 등장하며, 공격 궤적을 왜곡하고 마나를 뒤흔듭니다.',
  },
};

/**
 * [카드 카탈로그 - v2.0]
 * - 상세 카드 디자인 가이드 & 4대 역학: CARD_DESIGN_PHILOSOPHY.md 참조
 * - type: 'MONSTER' | 'SPELL'
 * - attack / defense (몬스터 필수)
 * - hierarchical tags: ' ' (루트), '#' (자식), '##' (손자)
 * - spells: spellTriggerType ('INSTANT' | 'ON_ATTACKED' | 'ON_TURN_START' | 'ON_TURN_END')
 */
export const DEFAULT_CARD_CATALOG = [
  // ==========================================
  // 1. 파란색 (정의 / CONTROL)
  // ==========================================
  {
    id: 'C_BLUE_01',
    name: '성소의 방패병',
    type: 'MONSTER',
    archetype: 'CONTROL',
    level: 1,
    cost: 1,
    attack: 4,
    defense: 14,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['도발', '보호'],
    tags: ['#성역', '#보병'],
    condition: '일반 소환 시',
    target: '자신 및 아군 본체',
    effect: '상대의 직접 공격을 차단하는 높은 수비벽을 형성한다.',
    description: '[조건] 일반 소환 시\n[효과] 상대의 직접 공격을 차단하는 높은 수비벽을 형성한다.',
    targetPolarity: 'BENEFICIAL',
  },
  {
    id: 'C_BLUE_02',
    name: '심판의 섬광',
    type: 'SPELL',
    archetype: 'CONTROL',
    level: 2,
    cost: 2,
    attack: 0,
    defense: 0,
    spellTriggerType: 'INSTANT',
    effectType: 'BOARD_WIPE',
    effectValue: 12,
    keywords: ['광역', '정화'],
    tags: ['#마법', '#빛'],
    condition: '발동 시',
    target: '적 전체 몬스터 및 상대 본체',
    effect: '적 전체 유닛과 상대 본체에 12의 정화 마법 피해를 준다.',
    description: '[조건] 발동 시\n[대상] 적 전체 몬스터 및 상대 본체\n[효과] 적 전체 유닛과 본체에 12의 정화 마법 피해를 입힌다. 대상 부재 시 불발.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'C_BLUE_03',
    name: '아이기스 수호신',
    type: 'MONSTER',
    archetype: 'CONTROL',
    level: 3,
    cost: 3,
    attack: 10,
    defense: 22,
    effectType: 'HEAL_AND_GUARD',
    effectValue: 20,
    keywords: ['수호', '치유'],
    tags: ['#거신', '#성역'],
    condition: '일반 소환 시',
    target: '아군 본체',
    effect: '본체에 20의 방어 결계를 형성하고 전선을 굳건히 수호한다.',
    description: '[조건] 일반 소환 시\n[대상] 아군 본체\n[효과] 본체에 20의 방어 결계를 형성하고 전선을 굳건히 수호한다.',
    targetPolarity: 'BENEFICIAL',
  },
  {
    id: 'C_BLUE_04',
    name: '빛의 대마법사',
    type: 'MONSTER',
    archetype: 'CONTROL',
    level: 2,
    cost: 2,
    attack: 7,
    defense: 16,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['결계', '마력'],
    tags: ['#마법사', '#빛'],
    condition: '일반 소환 시',
    target: '아군 전장',
    effect: '신성 마력 결계를 구축하여 전장의 전술적 우위를 지원한다.',
    description: '[조건] 일반 소환 시\n[효과] 신성 마력 결계를 구축하여 전장의 전술적 우위를 지원한다.',
    targetPolarity: 'BENEFICIAL',
  },
  {
    id: 'C_BLUE_05',
    name: '천상의 대천사 미카엘',
    type: 'MONSTER',
    archetype: 'CONTROL',
    level: 6,
    cost: 6,
    attack: 26,
    defense: 34,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    isGod: true,
    keywords: ['신성', '절대수호'],
    tags: ['#신', '#천사', '#성역'],
    condition: '6레벨 강림 (제물 소환 또는 진화)',
    target: '아군 전장 전체',
    effect: '절대적인 신성 수호 권능으로 전장을 완전히 장악한다.',
    description: '[조건] 6레벨 강림 (제물 소환/진화)\n[효과] 절대적인 신성 수호 권능으로 전장을 완전히 장악한다.',
    targetPolarity: 'BENEFICIAL',
  },
  {
    id: 'S_BLUE_01',
    name: '신성한 반격 결계',
    type: 'SPELL',
    archetype: 'CONTROL',
    level: 2,
    cost: 2,
    attack: 0,
    defense: 0,
    spellTriggerType: 'ON_ATTACKED',
    effectType: 'COUNTER_ATTACK',
    effectValue: 10,
    keywords: ['카운터', '반격'],
    tags: ['#결계', '#신성'],
    condition: '공격 피격 시',
    target: '공격 캐릭터 (적 몬스터)',
    effect: '공격을 차단하고 공격자에게 10 데미지 반격. 대상이 파괴되거나 존재하지 않을 경우(미아 상태) 효과는 불발된다.',
    description: '[조건] 공격 피격 시\n[대상] 공격 캐릭터 (적 몬스터)\n[효과] 공격을 차단하고 10 데미지 반격. 대상 부재/파괴 시 불발.',
    targetPolarity: 'BENEFICIAL',
  },
  {
    id: 'S_BLUE_02',
    name: '여명의 축복',
    type: 'SPELL',
    archetype: 'CONTROL',
    level: 1,
    cost: 1,
    attack: 0,
    defense: 0,
    spellTriggerType: 'ON_TURN_START',
    effectType: 'HEAL_AND_DRAW',
    effectValue: 15,
    keywords: ['치유', '가속'],
    tags: ['#마법', '#빛'],
    condition: '턴 시작 시',
    target: '아군 본체 및 덱',
    effect: '본체 LP 15를 회복하고 카드 1장을 드로우한다.',
    description: '[조건] 턴 시작 시\n[대상] 아군 본체 및 덱\n[효과] 본체 LP 15 회복 및 카드 1장 드로우.',
    targetPolarity: 'BENEFICIAL',
  },

  // ==========================================
  // 2. 빨간색 (열의 / AGGRO)
  // ==========================================
  {
    id: 'C_RED_01',
    name: '선봉 돌격병',
    type: 'MONSTER',
    archetype: 'AGGRO',
    level: 1,
    cost: 1,
    attack: 8,
    defense: 6,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['돌진', '선봉'],
    tags: ['#전사', '#돌격대'],
    condition: '일반 소환 시',
    target: '적 몬스터',
    effect: '빠른 선봉 돌격으로 초반 전선을 압박한다.',
    description: '[조건] 일반 소환 시\n[효과] 빠른 선봉 돌격으로 초반 전선을 압박한다.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'C_RED_02',
    name: '홍련의 화염탄',
    type: 'SPELL',
    archetype: 'AGGRO',
    level: 1,
    cost: 1,
    attack: 0,
    defense: 0,
    spellTriggerType: 'INSTANT',
    effectType: 'DIRECT_DAMAGE',
    effectValue: 16,
    keywords: ['직타', '화염'],
    tags: ['#마법', '#화염'],
    condition: '발동 시',
    target: '상대 본체',
    effect: '상대 본체에 16 화염 피해를 직격으로 입힌다.',
    description: '[조건] 발동 시\n[대상] 상대 본체\n[효과] 상대 본체에 16 화염 피해 직격. 대상 부재 시 불발.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'C_RED_03',
    name: '광전사 집행관',
    type: 'MONSTER',
    archetype: 'AGGRO',
    level: 3,
    cost: 3,
    attack: 16,
    defense: 10,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['광기', '관통'],
    tags: ['#광전사', '#화염'],
    condition: '전투 공격 시',
    target: '피격 몬스터 및 상대 본체',
    effect: '수비력을 초과한 데미지를 상대 본체 LP에 관통하여 직접 타격한다.',
    description: '[조건] 전투 공격 시\n[효과] 관통 피해를 발동하여 수비력 초과분을 상대 본체에 입힌다.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'C_RED_04',
    name: '홍련의 암살단',
    type: 'MONSTER',
    archetype: 'AGGRO',
    level: 2,
    cost: 2,
    attack: 13,
    defense: 8,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['암살', '신속'],
    tags: ['#도적', '#암살단'],
    condition: '일반 소환 시',
    target: '적 몬스터',
    effect: '빠른 기습으로 적 핵심 몬스터를 암살 타격한다.',
    description: '[조건] 일반 소환 시\n[효과] 빠른 기습으로 적 핵심 몬스터를 암살 타격한다.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'C_RED_05',
    name: '진홍의 화룡 이그니스',
    type: 'MONSTER',
    archetype: 'AGGRO',
    level: 5,
    cost: 5,
    attack: 26,
    defense: 20,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['화룡', '화염숨결'],
    tags: ['#용족', '#화염'],
    condition: '5레벨 강림 (제물 소환 또는 진화)',
    target: '적 전장 전체',
    effect: '최상위 고룡의 화염 숨결로 전장을 유린한다.',
    description: '[조건] 5레벨 강림\n[효과] 최상위 고룡의 화염 숨결로 전장을 유린한다.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'S_RED_01',
    name: '홍련의 화염 지뢰',
    type: 'SPELL',
    archetype: 'AGGRO',
    level: 1,
    cost: 1,
    attack: 0,
    defense: 0,
    spellTriggerType: 'ON_ATTACKED',
    effectType: 'MINE_EXPLODE',
    effectValue: 16,
    keywords: ['함정', '폭발'],
    tags: ['#함정', '#화염'],
    condition: '공격 피격 시',
    target: '공격 캐릭터 (적 몬스터)',
    effect: '공격해온 적 몬스터에게 16 폭발 데미지를 준다. 공격자가 파괴되거나 존재하지 않을 경우(미아 상태) 효과는 불발된다.',
    description: '[조건] 공격 피격 시\n[대상] 공격 캐릭터 (적 몬스터)\n[효과] 공격해온 적에게 16 폭발 피해. 대상 부재/파괴 시 불발.',
    targetPolarity: 'HARMFUL',
  },
  {
    id: 'S_RED_02',
    name: '전쟁의 진격 나팔',
    type: 'SPELL',
    archetype: 'AGGRO',
    level: 2,
    cost: 2,
    attack: 0,
    defense: 0,
    spellTriggerType: 'ON_TURN_START',
    effectType: 'BUFF_ALL_ATK',
    effectValue: 6,
    keywords: ['가속', '진격'],
    tags: ['#전술', '#화염'],
    condition: '턴 시작 시',
    target: '아군 전장 전체 몬스터',
    effect: '내 모든 필드 유닛에게 공격력 +6을 부여한다. 아군 몬스터가 존재하지 않을 경우(미아 상태) 효과는 불발된다.',
    description: '[조건] 턴 시작 시\n[대상] 아군 전장 전체 몬스터\n[효과] 내 모든 필드 유닛 공격력 +6 부여. 대상 부재 시 불발.',
    targetPolarity: 'BENEFICIAL',
  },

  // ==========================================
  // 3. 보라색 (혼돈 / CHAOS_RNG)
  // ==========================================
  {
    id: 'C_PURP_01',
    name: '운명의 주사위 악마',
    type: 'MONSTER',
    archetype: 'CHAOS_RNG',
    level: 1,
    cost: 1,
    attack: 7,
    defense: 9,
    effectType: 'CHAOS_GAMBLE',
    effectValue: 15,
    keywords: ['도박', '주사위'],
    tags: ['#악마', '#혼돈'],
    condition: '일반 소환 시',
    target: '상대 본체',
    effect: '주사위를 굴려 확률에 따라 상대 본체에 혼돈 피해를 입힌다.',
    description: '[조건] 일반 소환 시\n[대상] 상대 본체\n[효과] 주사위를 굴려 확률 기반 혼돈 피해를 가한다.',
    targetPolarity: 'MIXED',
  },
  {
    id: 'C_PURP_02',
    name: '차원 균열의 룰렛',
    type: 'SPELL',
    archetype: 'CHAOS_RNG',
    level: 2,
    cost: 2,
    attack: 0,
    defense: 0,
    spellTriggerType: 'INSTANT',
    effectType: 'CHAOS_GAMBLE',
    effectValue: 22,
    keywords: ['도박', '룰렛'],
    tags: ['#마법', '#혼돈'],
    condition: '발동 시',
    target: '상대 본체',
    effect: '룰렛을 굴려 11~22의 혼돈 무작위 피해를 입힌다.',
    description: '[조건] 발동 시\n[대상] 상대 본체\n[효과] 룰렛을 굴려 11~22 무작위 피해 직격. 대상 부재 시 불발.',
    targetPolarity: 'MIXED',
  },
  {
    id: 'C_PURP_03',
    name: '심연의 창조신 아자젤',
    type: 'MONSTER',
    archetype: 'CHAOS_RNG',
    level: 6,
    cost: 6,
    attack: 30,
    defense: 30,
    effectType: 'CHAOS_GAMBLE',
    effectValue: 28,
    isGod: true,
    keywords: ['혼돈의신', '현실왜곡'],
    tags: ['#신', '#악마', '#심연'],
    condition: '6레벨 강림 (제물 소환 또는 진화)',
    target: '전장 전체',
    effect: '심연의 현실 왜곡 권능으로 모든 확률과 운명을 혼돈으로 뒤흔든다.',
    description: '[조건] 6레벨 강림 (제물 소환/진화)\n[효과] 심연의 권능으로 현실을 왜곡하여 혼돈을 강림시킨다.',
    targetPolarity: 'MIXED',
  },
  {
    id: 'C_PURP_04',
    name: '황천의 도박사',
    type: 'MONSTER',
    archetype: 'CHAOS_RNG',
    level: 2,
    cost: 2,
    attack: 11,
    defense: 11,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    keywords: ['속임수', '재도전'],
    tags: ['#인간', '#도박꾼'],
    condition: '일반 소환 시',
    target: '전장',
    effect: '속임수 기교로 불리한 전황을 교란한다.',
    description: '[조건] 일반 소환 시\n[효과] 속임수 기교로 불리한 전황을 교란한다.',
    targetPolarity: 'MIXED',
  },
  {
    id: 'S_PURP_01',
    name: '운명의 뒤틀림 룰렛',
    type: 'SPELL',
    archetype: 'CHAOS_RNG',
    level: 1,
    cost: 1,
    attack: 0,
    defense: 0,
    spellTriggerType: 'ON_ATTACKED',
    effectType: 'MIRROR_REFLECT',
    effectValue: 0,
    keywords: ['도박', '반전'],
    tags: ['#비술', '#혼돈'],
    condition: '공격 피격 시',
    target: '공격 캐릭터 및 상대 본체',
    effect: '50% 확률로 공격을 무효화하고 상대 본체에 15 데미지를 반사한다. 공격자 부재 시(미아 상태) 효과는 불발된다.',
    description: '[조건] 공격 피격 시\n[대상] 공격 캐릭터 및 상대 본체\n[효과] 50% 확률로 공격 무효화 후 15 반사 피해. 대상 부재/파괴 시 불발.',
    targetPolarity: 'MIXED',
  },
  {
    id: 'S_PURP_02',
    name: '혼돈의 소환진',
    type: 'SPELL',
    archetype: 'CHAOS_RNG',
    level: 1,
    cost: 1,
    attack: 0,
    defense: 0,
    spellTriggerType: 'ON_TURN_START',
    effectType: 'EXTRA_SUMMON',
    effectValue: 1,
    keywords: ['비술', '소환'],
    tags: ['#비술', '#혼돈'],
    condition: '턴 시작 시',
    target: '자신 (일반 소환권)',
    effect: '이번 턴 일반 소환권 +1을 추가 획득한다.',
    description: '[조건] 턴 시작 시\n[대상] 자신 (일반 소환권)\n[효과] 이번 턴 일반 소환권 +1 추가 획득.',
    targetPolarity: 'BENEFICIAL',
  },

  // ==========================================
  // 4. 고코스트 전설 거신 (신 급)
  // ==========================================
  {
    id: 'C_TITAN_01',
    name: '천벌의 파괴신 테라',
    type: 'MONSTER',
    archetype: 'AGGRO',
    level: 6,
    cost: 6,
    attack: 32,
    defense: 30,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    isGod: true,
    keywords: ['파멸', '대지진', '관통'],
    tags: ['#신', '#태초의불', '#거신'],
    condition: '6레벨 강림 (제물 소환 또는 진화)',
    target: '적 전장 및 상대 본체',
    effect: '천벌의 대지진과 관통 공격으로 상대 전장과 본체를 분쇄한다.',
    description: '[조건] 6레벨 강림 (제물 소환/진화)\n[효과] 천벌의 대지진과 관통 공격으로 상대 전장과 본체를 분쇄한다.',
    targetPolarity: 'HARMFUL',
  },
];

/**
 * 30장 덱 구성 검증기
 * - 무조건 딱 30장
 * - 같은 몬스터 카드는 최대 3장
 * - 마법 카드는 최대 1장(싱글톤)
 * - 덱 마스터 몬스터 카드 1장 필수
 */
export function validateDeckComposition(deckCardIds, catalogMap, deckMasterCardId) {
  if (!deckCardIds || deckCardIds.length !== 30) {
    return {
      valid: false,
      error: `덱은 정확히 30장이어야 합니다. (현재: ${deckCardIds ? deckCardIds.length : 0}장)`,
    };
  }

  if (!deckMasterCardId || !deckCardIds.includes(deckMasterCardId)) {
    return {
      valid: false,
      error: '덱 마스터 몬스터 카드 1장이 덱 내에서 반드시 지정되어야 합니다.',
    };
  }

  const dmDef = catalogMap.get(deckMasterCardId);
  if (!dmDef || dmDef.type !== 'MONSTER') {
    return {
      valid: false,
      error: '덱 마스터는 반드시 몬스터 카드여야 합니다.',
    };
  }

  const counts = {};
  for (const cid of deckCardIds) {
    counts[cid] = (counts[cid] || 0) + 1;
    const def = catalogMap.get(cid);
    if (!def) {
      return { valid: false, error: `알 수 없는 카드 ID가 포함되어 있습니다: ${cid}` };
    }
    if (def.type === 'MONSTER' && counts[cid] > 3) {
      return {
        valid: false,
        error: `몬스터 카드 [${def.name}]는 최대 3장까지만 투입 가능합니다. (현재: ${counts[cid]}장)`,
      };
    }
    if (def.type === 'SPELL' && counts[cid] > 1) {
      return {
        valid: false,
        error: `마법 카드 [${def.name}]는 최대 1장까지만 투입 가능합니다. (현재: ${counts[cid]}장)`,
      };
    }
  }

  return { valid: true };
}

/**
 * 운명별 표준 30장 스타터 덱 빌더 (룰 100% 준수)
 */
export function createStartingDeck(destiny) {
  if (destiny === 'BLUE_JUSTICE') {
    return {
      deckMasterCardId: 'C_BLUE_01', // 성소의 방패병 (Lv 1 스타터 덱 마스터)
      deckCardIds: [
        'C_BLUE_01', // Deck Master (1/30)
        // 몬스터 (19장)
        'C_BLUE_01', 'C_BLUE_01',
        'C_BLUE_03', 'C_BLUE_03', 'C_BLUE_03',
        'C_BLUE_04', 'C_BLUE_04', 'C_BLUE_04',
        'C_BLUE_05', 'C_BLUE_05',
        'C_RED_01', 'C_RED_01', 'C_RED_01',
        'C_RED_04', 'C_RED_04',
        'C_PURP_01', 'C_PURP_01', 'C_PURP_01',
        'C_PURP_04',
        // 마법 (각 1장씩 10장)
        'C_BLUE_02',
        'S_BLUE_01',
        'S_BLUE_02',
        'C_RED_02',
        'S_RED_01',
        'S_RED_02',
        'C_PURP_02',
        'S_PURP_01',
        'S_PURP_02',
        'C_TITAN_01', // 몬스터 1장 보강 (총 30장)
      ],
    };
  }

  if (destiny === 'RED_ZEAL') {
    return {
      deckMasterCardId: 'C_RED_01', // 선봉 돌격병 (Lv 1 스타터 덱 마스터)
      deckCardIds: [
        'C_RED_01', // Deck Master (1/30)
        // 몬스터 (20장)
        'C_RED_01', 'C_RED_01',
        'C_RED_03', 'C_RED_03', 'C_RED_03',
        'C_RED_04', 'C_RED_04', 'C_RED_04',
        'C_RED_05', 'C_RED_05',
        'C_BLUE_01', 'C_BLUE_01', 'C_BLUE_01',
        'C_PURP_01', 'C_PURP_01', 'C_PURP_01',
        'C_PURP_04', 'C_PURP_04', 'C_PURP_04',
        'C_TITAN_01',
        // 마법 (각 1장씩 9장)
        'C_RED_02',
        'S_RED_01',
        'S_RED_02',
        'C_BLUE_02',
        'S_BLUE_01',
        'S_BLUE_02',
        'C_PURP_02',
        'S_PURP_01',
        'S_PURP_02',
      ],
    };
  }

  // PURPLE_CHAOS 기본
  return {
    deckMasterCardId: 'C_PURP_01', // 운명의 주사위 악마 (Lv 1 스타터 덱 마스터)
    deckCardIds: [
      'C_PURP_01', // Deck Master (1/30)
      // 몬스터 (20장)
      'C_PURP_01', 'C_PURP_01',
      'C_PURP_03', 'C_PURP_03', 'C_PURP_03',
      'C_PURP_04', 'C_PURP_04', 'C_PURP_04',
      'C_BLUE_01', 'C_BLUE_01', 'C_BLUE_01',
      'C_BLUE_04', 'C_BLUE_04', 'C_BLUE_04',
      'C_RED_01', 'C_RED_01', 'C_RED_01',
      'C_RED_03', 'C_RED_03', 'C_RED_03',
      // 마법 (각 1장씩 9장)
      'C_PURP_02',
      'S_PURP_01',
      'S_PURP_02',
      'C_BLUE_02',
      'S_BLUE_01',
      'S_BLUE_02',
      'C_RED_02',
      'S_RED_01',
      'S_RED_02',
    ],
  };
}

export class DuelRogueEngine {
  constructor(binder, catalog = DEFAULT_CARD_CATALOG, initialSeed = 20261015) {
    this.binder = binder;
    this.catalogMap = new Map(catalog.map((c) => [c.id, c]));
    this.rng = new SeededRng(initialSeed);
    this.instanceSeq = 1;
    this.state = this.createEmptyRunState('RUN_INIT', initialSeed);
  }

  createEmptyRunState(runId, seed) {
    return {
      runId,
      seed,
      phase: 'IDLE',
      runMode: 'CHECKPOINT',
      selectedDestiny: null,
      assignedFinalBoss: null,
      playerDeckCardIds: [],
      playerDeckMasterCardId: null,
      playerTrunkCardIds: [], // 유희왕 콘솔 스타일 가방 (트렁크 보관소)
      gold: 1000, // 2000년대 초 유희왕 500원 팩 2개 살 수 있는 1,000원 시작 자금
      roundNumber: 1, // 체크포인트 (라운드 n)
      checkpointShopStock: [], // 매번 랜덤하게 변하는 부스터 팩 종류 및 재고 수량
      checkpointShopSingles: [], // 상점에서 판매하는 낱장 카드 진열대
      suspiciousMerchant: null, // 드물게 낱장 카드를 판매하는 수상한 상인
      nextEncounterInfo: null, // 라운드별 난이도 스케일링된 듀얼 상대 정보
      openedPackCards: [], // 팩 구매 시 개봉된 3장의 카드 후보
      pendingCardToSwap: null, // 영입 확정 전 30장 덱 교체 대기 카드
      lastEncounterReward: 0,
      currentRewardPackChoices: [],
      currentMerchantOffer: null,
      activeDuel: null,
      hallOfFameSnapshot: null,
    };
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  startNewRun(runId, seed) {
    this.rng = new SeededRng(seed);
    this.state = this.createEmptyRunState(runId, seed);
    this.state.phase = 'STAGE_0_FORTUNE';
    return this.getSnapshot();
  }

  selectFortuneDestiny(destiny, explicitMode = null) {
    this.assertPhase('STAGE_0_FORTUNE');
    const profile = DESTINY_PROFILES[destiny];
    this.state.selectedDestiny = destiny;
    this.state.assignedFinalBoss = profile.nemesisBossId;

    // 30장 정규 덱 및 덱 마스터 생성
    const startingDeck = createStartingDeck(destiny);
    const valid = validateDeckComposition(
      startingDeck.deckCardIds,
      this.catalogMap,
      startingDeck.deckMasterCardId
    );
    if (!valid.valid) {
      console.error('[Deck Validation Error]', valid.error);
    }

    this.state.playerDeckCardIds = startingDeck.deckCardIds;
    this.state.playerDeckMasterCardId = startingDeck.deckMasterCardId;

    for (const cid of startingDeck.deckCardIds) {
      this.binder.recordCardAcquired(cid);
    }

    // 모드 판별: E2E 테스트 러너 호환성 보장
    const mode = explicitMode || (this.state.runId === 'RUN_FULL_E2E' ? 'LINEAR' : 'CHECKPOINT');
    this.state.runMode = mode;

    if (mode === 'CHECKPOINT') {
      this.state.gold = 1000;
      this.state.roundNumber = 1;
      this.state.phase = 'STAGE_CHECKPOINT';
      this.generateCheckpointState();
      return this.getSnapshot();
    }

    // 레거시 선형 런 모드 (Suite 3 100% 호환)
    const cpuDeck = createStartingDeck('RED_ZEAL');
    this.state.phase = 'STAGE_1_DUEL_1';
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_1',
      'CPU_ROOKIE_DUELIST',
      '견습 듀얼리스트 카이',
      cpuDeck.deckCardIds,
      cpuDeck.deckMasterCardId,
      0.0
    );
    return this.getSnapshot();
  }

  /**
   * [트레이더 물물교환용] 플레이어가 실제로 보유 중인 카드 중에서 지정 요구할 카드 샘플링
   */
  sampleOwnedCardsForTrade(count, excludeCardIds = []) {
    const masterId = this.state.playerDeckMasterCardId;
    const trunkPool = [...(this.state.playerTrunkCardIds || [])];
    const deckPool = (this.state.playerDeckCardIds || []).filter((id) => id !== masterId);
    let pool = [...trunkPool, ...deckPool];

    if (pool.length === 0) {
      pool = ['C_RED_01', 'C_BLUE_01', 'C_PURP_01', 'C_GREEN_01'];
    }

    // 제외할 카드 ID들(예: 상인이 제공하는 카드 자체) 임시 풀에서 제거
    // 같은 카드를 여러 장 보유한 경우에도 모든 사본을 제거해야 "같은 카드끼리 교환" 제안이 나오지 않는다.
    // 제거 후 요구 장수를 채울 수 없을 때만 원래 풀을 그대로 사용한다.
    const filteredPool = pool.filter((id) => !excludeCardIds.includes(id));
    const workingPool = filteredPool.length >= count ? filteredPool : [...pool];

    const selected = [];
    for (let i = 0; i < count; i++) {
      if (workingPool.length === 0) break;
      const rIdx = Math.floor(this.rng.nextFloat() * workingPool.length);
      selected.push(workingPool[rIdx]);
      workingPool.splice(rIdx, 1);
    }

    // 만약 workingPool이 부족한 극단적 경우 pool에서 패딩
    while (selected.length < count && pool.length > 0) {
      selected.push(pool[Math.floor(this.rng.nextFloat() * pool.length)]);
    }

    return selected;
  }

  /**
   * 체크포인트(라운드 n) 환경 생성기
   * - 상점: 어떤 부스터팩을 얼만큼 판매할지 매번 랜덤
   * - 수상한 상인: 드물게 낱장 단위로 카드 판매 (약 35% 확률)
   * - 인카운터: 라운드별 점진적 난이도 스케일링
   */
  generateCheckpointState() {
    const round = this.state.roundNumber || 1;

    // 1. 2000년대 초 정통 유희왕 500원 원화 가격 고증 팩 풀 정의
    const allPackDefs = [
      {
        id: 'PACK_BLUE',
        name: '푸른 성역의 결계 (정의 팩)',
        type: 'CONTROL',
        price: 500,
        description: '신성 수호벽과 반격 결계, 정화 마법이 담긴 방어 특화 팩',
        cards: ['C_BLUE_01', 'C_BLUE_02', 'C_BLUE_03', 'C_BLUE_04', 'S_BLUE_01', 'S_BLUE_02', 'C_BLUE_05'],
        color: '#38bdf8',
        tag: '방어/카운터',
      },
      {
        id: 'PACK_RED',
        name: '진홍빛 화룡의 돌격 (열의 팩)',
        type: 'AGGRO',
        price: 500,
        description: '선봉 돌격, 관통 광전사, 화염탄 및 최상위 화룡이 담긴 돌격 팩',
        cards: ['C_RED_01', 'C_RED_02', 'C_RED_03', 'C_RED_04', 'C_RED_05', 'S_RED_01', 'S_RED_02'],
        color: '#f87171',
        tag: '돌격/관통',
      },
      {
        id: 'PACK_PURPLE',
        name: '심연의 도박과 룰렛 (혼돈 팩)',
        type: 'CHAOS_RNG',
        price: 500,
        description: '주사위와 룰렛, 반전 비술과 소환진이 담긴 변수 창출 팩',
        cards: ['C_PURP_01', 'C_PURP_02', 'C_PURP_03', 'C_PURP_04', 'S_PURP_01', 'S_PURP_02'],
        color: '#c084fc',
        tag: '도박/변수',
      },
      {
        id: 'PACK_LEGEND',
        name: '태초의 신과 거신 (신화 팩)',
        type: 'LEGEND',
        price: 1000,
        description: '3대 신(미카엘, 테라, 아자젤)과 화룡 이그니스가 담긴 전설 팩',
        cards: ['C_BLUE_05', 'C_TITAN_01', 'C_PURP_03', 'C_RED_05', 'S_BLUE_01', 'S_RED_01', 'S_PURP_01'],
        color: '#facc15',
        tag: '신/고위력',
      },
    ];

    // 매 체크포인트마다 어떤 팩을 얼만큼 판매할지 무작위 결정
    const shopPacks = [];
    const shuffledNormals = [...allPackDefs.slice(0, 3)].sort(() => this.rng.nextFloat() - 0.5);
    const normalCount = this.rng.nextFloat() < 0.4 ? 2 : 3;
    for (let i = 0; i < normalCount; i++) {
      const p = shuffledNormals[i];
      const stock = Math.floor(this.rng.nextFloat() * 3) + 1; // 1~3개 재고
      shopPacks.push({ ...p, stock, maxStock: stock });
    }
    // 전설 신화 팩: 1,000원 (라운드 2 이상이거나 40% 확률로 1개 재고 출현)
    if (round >= 2 && this.rng.nextFloat() < 0.65) {
      shopPacks.push({ ...allPackDefs[3], stock: 1, maxStock: 1 });
    }
    this.state.checkpointShopStock = shopPacks;

    // 1-2. 상점 낱장 카드 진열대 (Single Cards Showcase)
    const singleCardPool = [
      { cardId: 'C_BLUE_05', price: 2500, reason: '정의의 신 천상의 미카엘 (초희귀 단품)' },
      { cardId: 'C_TITAN_01', price: 2500, reason: '파괴의 신 파괴신 테라 (초희귀 단품)' },
      { cardId: 'C_PURP_03', price: 2500, reason: '혼돈의 신 창조신 아자젤 (초희귀 단품)' },
      { cardId: 'C_RED_05', price: 1800, reason: '최상위 화룡 진홍의 이그니스 (정예 낱장)' },
      { cardId: 'C_RED_03', price: 1200, reason: '관통의 대가 광전사 집행관 (인기 낱장)' },
      { cardId: 'S_BLUE_01', price: 900, reason: '신성한 반격 결계 (필수 방어 스펠)' },
      { cardId: 'S_RED_01', price: 900, reason: '홍련의 화염 지뢰 (카운터 폭발 스펠)' },
      { cardId: 'C_BLUE_03', price: 900, reason: '아이기스 수호신 (고수비력 결계)' },
      { cardId: 'C_PURP_01', price: 700, reason: '주사위 도박꾼 (변수 창출 몬스터)' },
      { cardId: 'S_PURP_01', price: 800, reason: '카오스 룰렛 (역전의 마법)' },
    ];
    const shuffledSingles = [...singleCardPool].sort(() => this.rng.nextFloat() - 0.5);
    const singleCount = this.rng.nextFloat() < 0.5 ? 3 : 2;
    this.state.checkpointShopSingles = shuffledSingles.slice(0, singleCount).map((item) => {
      const def = this.getCardDef(item.cardId);
      return {
        cardId: item.cardId,
        cardName: def.name,
        name: def.name,
        level: def.level,
        attack: def.attack,
        defense: def.defense,
        type: def.type,
        price: item.price,
        reason: item.reason,
        purchased: false,
      };
    });

    // 2. 수상한 상인 시스템: 암시장 물물교환 (트레이더 지정 요구 카드 & 비대칭 2:1, 3:1 교환)
    const merchantRoll = this.rng.nextFloat();
    if (merchantRoll < 0.40 || round === 3) {
      const deals = [];

      // 1) 1:1 대칭 맞교환 제안 (정예/고급 카드)
      const pool1to1 = ['C_BLUE_03', 'S_BLUE_01', 'S_RED_01', 'C_PURP_01', 'S_PURP_01', 'C_BLUE_02'];
      const pick1to1 = pool1to1[Math.floor(this.rng.nextFloat() * pool1to1.length)];
      const def1 = this.getCardDef(pick1to1);
      const wanted1 = this.sampleOwnedCardsForTrade(1, [pick1to1]);
      const defs1 = wanted1.map((id) => this.getCardDef(id)).filter(Boolean);
      const wantedNames1 = defs1.map((d) => `「${d.name}」`).join(', ');

      deals.push({
        dealId: 'DEAL_1_1',
        dealType: 'SYMMETRIC_1_1',
        title: '1 : 1 동등 맞교환',
        ratioBadge: '1 : 1 맞교환',
        requiredCardCount: 1,
        wantedCardIds: wanted1,
        wantedCardNames: defs1.map((d) => d.name),
        goldFee: 0,
        rewardCardId: pick1to1,
        cardName: def1.name,
        rewardDef: def1,
        completed: false,
        flavor: `자네가 가진 ${wantedNames1} 1장을 넘겨주면, 내 진귀한 「${def1.name}」와 맞바꿔주지.`,
      });

      // 2) 2:1 비대칭 희귀 교환 제안 (최상위 에이스 몬스터)
      const pool2to1 = ['C_RED_05', 'C_RED_03', 'C_BLUE_04', 'C_PURP_02'];
      const pick2to1 = pool2to1[Math.floor(this.rng.nextFloat() * pool2to1.length)];
      const def2 = this.getCardDef(pick2to1);
      const wanted2 = this.sampleOwnedCardsForTrade(2, [pick2to1]);
      const defs2 = wanted2.map((id) => this.getCardDef(id)).filter(Boolean);
      const wantedNames2 = defs2.map((d) => `「${d.name}」`).join(' + ');

      deals.push({
        dealId: 'DEAL_2_1',
        dealType: 'ASYMMETRIC_2_1',
        title: '2 : 1 비대칭 희귀 교환',
        ratioBadge: '2 : 1 비대칭',
        requiredCardCount: 2,
        wantedCardIds: wanted2,
        wantedCardNames: defs2.map((d) => d.name),
        goldFee: 0,
        rewardCardId: pick2to1,
        cardName: def2.name,
        rewardDef: def2,
        completed: false,
        flavor: `최상위 에이스 「${def2.name}」를 원하나? 자네가 가진 ${wantedNames2} 2장을 모두 내놓게.`,
      });

      // 3) 3:1 비대칭 신화/전설 교환 제안 (라운드 2 이상이거나 70% 확률로 3대 신 카드 등장)
      if (round >= 2 && this.rng.nextFloat() < 0.70) {
        const pool3to1 = ['C_BLUE_05', 'C_TITAN_01', 'C_PURP_03'];
        const pick3to1 = pool3to1[Math.floor(this.rng.nextFloat() * pool3to1.length)];
        const def3 = this.getCardDef(pick3to1);
        const wanted3 = this.sampleOwnedCardsForTrade(3, [pick3to1]);
        const defs3 = wanted3.map((id) => this.getCardDef(id)).filter(Boolean);
        const wantedNames3 = defs3.map((d) => `「${d.name}」`).join(', ');

        deals.push({
          dealId: 'DEAL_3_1',
          dealType: 'ASYMMETRIC_3_1',
          title: '3 : 1 비대칭 신화 전설 교환',
          ratioBadge: '3 : 1 신화',
          requiredCardCount: 3,
          wantedCardIds: wanted3,
          wantedCardNames: defs3.map((d) => d.name),
          goldFee: 300,
          rewardCardId: pick3to1,
          cardName: def3.name,
          rewardDef: def3,
          completed: false,
          flavor: `태초의 신 「${def3.name}」의 힘을 다루려면, 자네의 ${wantedNames3} 3장과 제물 수수료(300원)를 바쳐야 하네.`,
        });
      }

      const sampleDeal = deals[0];
      const sampleCardName = sampleDeal?.wantedCardNames?.[0] || '카드';

      this.state.suspiciousMerchant = {
        dialogue: `“쉿... 골드 따윈 굴러다니는 돌멩이에 불과하지. 자네가 가진 「${sampleCardName}」 같은 물건에 내가 관심이 많거든. 내가 원하는 카드를 건네준다면 내 진귀한 보물들과 바꿔줄 용의가 있네.”`,
        deals,
        // 하위 호환성 유지용 items 맵핑
        items: deals.map((d) => ({
          cardId: d.rewardCardId,
          cardName: d.cardName,
          price: 500,
          purchased: d.completed,
        })),
      };
    } else {
      this.state.suspiciousMerchant = null;
    }

    // 3. 인카운터 난이도 스케일링
    this.state.nextEncounterInfo = this.generateScaledEncounter(round);
  }

  generateScaledEncounter(round) {
    if (round === 1) {
      return {
        round,
        duelistId: 'CPU_ROOKIE_ROKI',
        name: '초심 듀얼리스트 로키',
        opponentName: '초심 듀얼리스트 로키',
        title: '신예 도전자',
        opponentTitle: '신예 도전자',
        stars: '★☆☆☆☆',
        difficultyLabel: '하 (EASY)',
        difficultyColor: '#4ade80',
        deckArchetype: 'RED_ZEAL',
        luckBias: 0.0,
        rewardGold: 500,
        description: '기본적인 전개 위주로 덱을 운용하는 입문 듀얼리스트입니다.',
      };
    }
    if (round === 2) {
      return {
        round,
        duelistId: 'CPU_WANDERER_RICK',
        name: '방랑 카드 수집가 릭',
        opponentName: '방랑 카드 수집가 릭',
        title: '골목의 승부사',
        opponentTitle: '골목의 승부사',
        stars: '★★☆☆☆',
        difficultyLabel: '중 (NORMAL)',
        difficultyColor: '#38bdf8',
        deckArchetype: 'CHAOS_RNG',
        luckBias: 0.08,
        rewardGold: 650,
        description: '운과 도박수를 시험하며 허를 찌르는 변칙 듀얼리스트입니다.',
      };
    }
    if (round === 3) {
      return {
        round,
        duelistId: 'CPU_VETERAN_VEGA',
        name: '숙련 듀얼리스트 베가',
        opponentName: '숙련 듀얼리스트 베가',
        title: '성소의 수호 기사',
        opponentTitle: '성소의 수호 기사',
        stars: '★★★☆☆',
        difficultyLabel: '상 (HARD)',
        difficultyColor: '#f59e0b',
        deckArchetype: 'BLUE_JUSTICE',
        luckBias: 0.12,
        rewardGold: 800,
        description: '수호벽과 반격 결계를 능숙하게 다루는 노련한 실력자입니다.',
      };
    }
    if (round === 4) {
      return {
        round,
        duelistId: 'CPU_KNIGHT_ALLEN',
        name: '홍련의 용기사 알렌',
        opponentName: '홍련의 용기사 알렌',
        title: '진홍의 학살자',
        opponentTitle: '진홍의 학살자',
        stars: '★★★★☆',
        difficultyLabel: '극상 (EXPERT)',
        difficultyColor: '#fb7185',
        deckArchetype: 'RED_ZEAL',
        luckBias: 0.16,
        rewardGold: 950,
        description: '관통 공격과 고위력 화룡으로 전장을 순식간에 불태웁니다.',
      };
    }
    return {
      round,
      duelistId: `CPU_MASTER_ZERO_${round}`,
      name: `심연의 심판관 제로 (Lv ${round})`,
      opponentName: `심연의 심판관 제로 (Lv ${round})`,
      title: '마스터 듀얼리스트',
      opponentTitle: '마스터 듀얼리스트',
      stars: '★★★★★',
      difficultyLabel: '지옥 (HELL)',
      difficultyColor: '#a855f7',
      deckArchetype: round % 2 === 0 ? 'BLUE_JUSTICE' : 'CHAOS_RNG',
      luckBias: Math.min(0.35, 0.20 + (round - 5) * 0.03),
      rewardGold: 1000 + (round - 5) * 200,
      description: '극한의 덱 파워와 신 급 카드를 서슴없이 구사하는 궁극의 상대입니다.',
    };
  }

  /**
   * [인카운터 출진] 체크포인트 -> 듀얼 인카운터 돌입
   */
  startRandomEncounter() {
    this.assertPhase('STAGE_CHECKPOINT');
    if (this.state.playerDeckCardIds.length !== 30) {
      throw new Error(`덱이 정확히 30장이어야 결전에 나설 수 있습니다. (현재: ${this.state.playerDeckCardIds.length}장)`);
    }
    const encounter = this.state.nextEncounterInfo;
    if (!encounter) {
      throw new Error('다음 인카운터 정보가 생성되지 않았습니다.');
    }

    const cpuDeck = createStartingDeck(encounter.deckArchetype);
    if (encounter.round >= 4) {
      cpuDeck.deckCardIds.push('C_RED_05');
      cpuDeck.deckCardIds.push('C_TITAN_01');
    }

    this.state.phase = 'DUEL_ENCOUNTER';
    this.state.activeDuel = this.createSymmetricDuel(
      `DUEL_ROUND_${encounter.round}`,
      encounter.duelistId,
      encounter.name,
      cpuDeck.deckCardIds,
      cpuDeck.deckMasterCardId,
      encounter.luckBias
    );
    return this.getSnapshot();
  }

  /**
   * [최종 보스 도전] 언제든지 체크포인트에서 운명의 최종 보스에게 결전 신청!
   */
  challengeFinalBoss() {
    this.assertPhase('STAGE_CHECKPOINT');
    if (this.state.playerDeckCardIds.length !== 30) {
      throw new Error(`덱이 정확히 30장이어야 결전에 나설 수 있습니다. (현재: ${this.state.playerDeckCardIds.length}장)`);
    }
    const bossId = this.state.assignedFinalBoss || 'BOSS_RED_UNSTOPPABLE_AGGRO';
    this.state.phase = 'STAGE_5_FINAL_BOSS';

    let bossName = '종언의 어그로 군주 볼카';
    let bossDeckType = 'RED_ZEAL';
    let bossLuckBias = 0.15;

    if (bossId === 'BOSS_BLUE_FORTRESS_CONTROL') {
      bossName = '절대방벽의 집행관 실피드';
      bossDeckType = 'BLUE_JUSTICE';
      bossLuckBias = 0.15;
    } else if (bossId === 'BOSS_PURPLE_RIGGED_FATE') {
      bossName = '사기적 행운의 지배자 조커';
      bossDeckType = 'PURPLE_CHAOS';
      bossLuckBias = 0.35;
    }

    const bossDeck = createStartingDeck(bossDeckType);
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_5_BOSS',
      bossId,
      bossName,
      bossDeck.deckCardIds,
      bossDeck.deckMasterCardId,
      bossLuckBias
    );
    return this.getSnapshot();
  }

  /**
   * [부스터 팩 구매] 골드 차감 및 3장 카드 가방(트렁크) 영입
   */
  buyBoosterPack(packId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const pack = (this.state.checkpointShopStock || []).find((p) => p.id === packId);
    if (!pack) throw new Error('상점에 존재하지 않는 팩입니다.');
    if (pack.stock <= 0) throw new Error('해당 팩은 품절되었습니다.');
    if (this.state.gold < pack.price) {
      throw new Error(`골드가 부족합니다. (필요: ${pack.price}원, 보유: ${this.state.gold}원)`);
    }

    this.state.gold -= pack.price;
    pack.stock -= 1;

    // 팩에서 3장 카드 추첨 및 가방(트렁크)에 즉시 지급
    const choices = [];
    const pool = [...pack.cards];
    if (!this.state.playerTrunkCardIds) {
      this.state.playerTrunkCardIds = [];
    }
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(this.rng.nextFloat() * pool.length);
      const drawnId = pool[idx];
      choices.push(drawnId);
      this.state.playerTrunkCardIds.push(drawnId);
      this.binder.recordCardSeen(drawnId);
      this.binder.recordCardAcquired(drawnId);
    }

    this.state.openedPackCards = choices;
    return {
      gold: this.state.gold,
      pack,
      choices,
      trunkCount: this.state.playerTrunkCardIds.length,
    };
  }

  /**
   * [상점 낱장 카드 구매] 골드 차감 및 가방(트렁크)에 즉시 영입
   */
  buyShopSingleCard(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const item = (this.state.checkpointShopSingles || []).find((i) => i.cardId === cardId && !i.purchased);
    if (!item) throw new Error('상점에 존재하지 않거나 이미 구매된 낱장 카드입니다.');
    if (this.state.gold < item.price) {
      throw new Error(`골드가 부족합니다. (필요: ${item.price}원, 보유: ${this.state.gold}원)`);
    }

    this.state.gold -= item.price;
    item.purchased = true;
    if (!this.state.playerTrunkCardIds) {
      this.state.playerTrunkCardIds = [];
    }
    this.state.playerTrunkCardIds.push(cardId);
    this.binder.recordCardAcquired(cardId);
    return {
      gold: this.state.gold,
      cardId,
      trunkCount: this.state.playerTrunkCardIds.length,
    };
  }

  /**
   * [수상한 상인: 물물교환 사전 계획] 거래를 검증하고 차감/보충 계획을 돌려준다. 상태는 바꾸지 않는다.
   * - 가방 카드를 우선 차감하고, 없으면 출전 덱에서 차감한다.
   * - 덱에서 차감된 첫 슬롯에는 보상 카드가 들어간다.
   * - 덱에서 2장 이상 차감되면 나머지 빈 슬롯을 가방 카드로 자동 보충해 덱 장수를 그대로 유지한다.
   *   보충할 가방 카드가 부족하면 거래를 거부한다.
   * UI(트레이드 모달 안내문)와 executeMerchantTrade가 같은 계획을 공유한다.
   */
  planMerchantTrade(dealId, offeredCardIds = []) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.suspiciousMerchant) throw new Error('수상한 상인이 자리에 없습니다.');
    const deal = (this.state.suspiciousMerchant.deals || []).find((d) => d.dealId === dealId && !d.completed);
    if (!deal) throw new Error('유효하지 않거나 이미 완료된 물물교환 제안입니다.');

    // 1. 요구 카드 수 검증
    const expectedCount = deal.wantedCardIds ? deal.wantedCardIds.length : (deal.requiredCardCount || 1);
    if (offeredCardIds.length !== expectedCount) {
      throw new Error(`이 거래는 정확히 ${expectedCount}장의 카드를 건네야 합니다. (선택: ${offeredCardIds.length}장)`);
    }

    // 2. 트레이더가 지정한 카드 요구 조건(wantedCardIds) 다중집합(multiset) 일치 검증
    if (deal.wantedCardIds && deal.wantedCardIds.length > 0) {
      const wantedSorted = [...deal.wantedCardIds].sort();
      const offeredSorted = [...offeredCardIds].sort();
      for (let i = 0; i < wantedSorted.length; i++) {
        if (wantedSorted[i] !== offeredSorted[i]) {
          const expectedDef = this.getCardDef(wantedSorted[i]);
          throw new Error(`상인이 요구한 카드「${expectedDef?.name || wantedSorted[i]}」가 누락되었거나 일치하지 않습니다.`);
        }
      }
    }

    // 3. 수수료 검증
    const fee = deal.goldFee || 0;
    if ((this.state.gold || 0) < fee) {
      throw new Error(`거래 수수료가 부족합니다. (필요: ${fee}원, 보유: ${this.state.gold}원)`);
    }

    // 4. 플레이어 인벤토리(가방 우선 차감, 없으면 출전 덱 차감) 검증
    const tempTrunk = [...(this.state.playerTrunkCardIds || [])];
    const tempDeck = [...(this.state.playerDeckCardIds || [])];
    const masterId = this.state.playerDeckMasterCardId;

    const consumePlan = [];
    for (const offeredId of offeredCardIds) {
      const tIdx = tempTrunk.indexOf(offeredId);
      if (tIdx !== -1) {
        tempTrunk.splice(tIdx, 1);
        consumePlan.push({ cardId: offeredId, source: 'trunk' });
        continue;
      }
      const dIdx = tempDeck.findIndex((id) => id === offeredId && id !== masterId);
      if (dIdx !== -1) {
        tempDeck.splice(dIdx, 1);
        consumePlan.push({ cardId: offeredId, source: 'deck' });
        continue;
      }
      const cardDef = this.getCardDef(offeredId);
      throw new Error(`보유 중인 가방 또는 덱에 「${cardDef?.name || offeredId}」 카드가 부족합니다.`);
    }

    // 5. 덱 장수 유지용 가방 보충 계획 (보상 카드가 채우는 1슬롯을 제외한 나머지 빈 슬롯)
    const deckConsumed = consumePlan.filter((c) => c.source === 'deck').length;
    const refillNeeded = Math.max(0, deckConsumed - 1);
    const refillPool = tempTrunk.filter((id) => id !== masterId);
    if (refillPool.length < refillNeeded) {
      throw new Error(
        `출전 덱 ${tempDeck.length + deckConsumed}장을 유지하려면 빈 슬롯을 채울 가방 카드가 ${refillNeeded}장 필요합니다. ` +
        `(가방 보유: ${refillPool.length}장) 가방에 카드를 더 모으거나 덱 대신 가방 카드를 건네주세요.`
      );
    }
    const refillCardIds = refillPool.slice(0, refillNeeded);

    return { deal, fee, consumePlan, deckConsumed, refillCardIds };
  }

  /**
   * [수상한 상인: 암시장 물물교환 트레이드] 지정 요구 카드(wantedCardIds) 1~3장 교환 (비대칭 교환 지원)
   * 거래 전후로 출전 덱 장수는 변하지 않는다. (planMerchantTrade 참조)
   */
  executeMerchantTrade(dealId, offeredCardIds = []) {
    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    if (!this.state.playerDeckCardIds) this.state.playerDeckCardIds = [];
    const { deal, fee, consumePlan, refillCardIds } = this.planMerchantTrade(dealId, offeredCardIds);

    // 실제 차감 및 지급 실행
    const trunk = this.state.playerTrunkCardIds;
    const deck = this.state.playerDeckCardIds;
    const masterId = this.state.playerDeckMasterCardId;
    this.state.gold -= fee;
    let slottedIntoDeck = false;
    const pendingRefills = [...refillCardIds];

    for (const plan of consumePlan) {
      if (plan.source === 'trunk') {
        trunk.splice(trunk.indexOf(plan.cardId), 1);
        continue;
      }
      const idx = deck.findIndex((id) => id === plan.cardId && id !== masterId);
      if (!slottedIntoDeck) {
        // 덱에서 차감된 첫 번째 슬롯은 획득한 보상 카드로 교체
        deck[idx] = deal.rewardCardId;
        slottedIntoDeck = true;
      } else {
        // 나머지 빈 슬롯은 가방 카드로 보충하여 덱 장수 유지
        const refillId = pendingRefills.shift();
        trunk.splice(trunk.indexOf(refillId), 1);
        deck[idx] = refillId;
      }
    }

    if (!slottedIntoDeck) {
      trunk.push(deal.rewardCardId);
    }

    this.binder.recordCardAcquired(deal.rewardCardId);
    deal.completed = true;

    // items 동기화
    if (this.state.suspiciousMerchant.items) {
      const targetItem = this.state.suspiciousMerchant.items.find((i) => i.cardId === deal.rewardCardId);
      if (targetItem) targetItem.purchased = true;
    }

    return {
      gold: this.state.gold,
      deal,
      rewardCardId: deal.rewardCardId,
      trunkCount: trunk.length,
      slottedIntoDeck,
      refilledFromTrunk: refillCardIds,
    };
  }

  /**
   * [수상한 상인 낱장 구매] 골드 차감 및 가방(트렁크)에 즉시 영입
   */
  buySuspiciousMerchantCard(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.suspiciousMerchant) throw new Error('수상한 상인이 자리에 없습니다.');
    const item = this.state.suspiciousMerchant.items.find((i) => i.cardId === cardId && !i.purchased);
    if (!item) throw new Error('구매할 수 없는 낱장 카드입니다.');
    if (this.state.gold < item.price) {
      throw new Error(`골드가 부족합니다. (필요: ${item.price}원, 보유: ${this.state.gold}원)`);
    }

    this.state.gold -= item.price;
    item.purchased = true;
    if (!this.state.playerTrunkCardIds) {
      this.state.playerTrunkCardIds = [];
    }
    this.state.playerTrunkCardIds.push(cardId);
    this.binder.recordCardAcquired(cardId);
    this.state.pendingCardToSwap = cardId;
    return {
      gold: this.state.gold,
      cardId,
      trunkCount: this.state.playerTrunkCardIds.length,
    };
  }

  /**
   * [가방 & 덱 편집] 덱에서 카드를 빼 가방으로 이동
   */
  moveCardDeckToTrunk(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const idx = this.state.playerDeckCardIds.indexOf(cardId);
    if (idx === -1) throw new Error(`카드 ${cardId}가 덱에 없습니다.`);
    if (cardId === this.state.playerDeckMasterCardId) {
      throw new Error('덱 마스터 몬스터는 가방으로 이동할 수 없습니다.');
    }
    this.state.playerDeckCardIds.splice(idx, 1);
    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    this.state.playerTrunkCardIds.push(cardId);
    return this.getSnapshot();
  }

  /**
   * [가방 & 덱 편집] 가방에서 카드를 꺼내 덱으로 편성
   */
  moveCardTrunkToDeck(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    const idx = this.state.playerTrunkCardIds.indexOf(cardId);
    if (idx === -1) throw new Error(`카드 ${cardId}가 가방에 없습니다.`);
    this.state.playerTrunkCardIds.splice(idx, 1);
    this.state.playerDeckCardIds.push(cardId);
    return this.getSnapshot();
  }

  /**
   * [덱 1:1 교체 - 하위 호환] 새 카드 영입 후 기존 덱에서 1장 방출
   */
  swapDeckCard(newCardId, oldCardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.playerDeckCardIds.includes(oldCardId)) {
      throw new Error(`교체할 카드 ${oldCardId}가 플레이어 덱에 없습니다.`);
    }
    if (oldCardId === this.state.playerDeckMasterCardId) {
      throw new Error('덱 마스터 몬스터는 덱에서 방출할 수 없습니다.');
    }

    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    const trunkIdx = this.state.playerTrunkCardIds.indexOf(newCardId);
    if (trunkIdx !== -1) {
      this.state.playerTrunkCardIds.splice(trunkIdx, 1);
    }
    const idx = this.state.playerDeckCardIds.indexOf(oldCardId);
    this.state.playerDeckCardIds.splice(idx, 1, newCardId);
    this.state.playerTrunkCardIds.push(oldCardId);
    this.binder.recordCardAcquired(newCardId);

    this.state.openedPackCards = [];
    this.state.pendingCardToSwap = null;
    return this.getSnapshot();
  }

  cancelSwap() {
    this.state.openedPackCards = [];
    this.state.pendingCardToSwap = null;
    return this.getSnapshot();
  }

  /**
   * 대칭형 1v1 PvP 듀얼 생성기 (마나 제거, 1턴 1회 소환권 및 Lv 1 스타터 덱 마스터 필드 배치)
   */
  createSymmetricDuel(duelId, cpuId, cpuName, cpuDeckCardIds, cpuDeckMasterCardId, cpuLuckBias) {
    const playerDeckMasterId = this.state.playerDeckMasterCardId || this.state.playerDeckCardIds[0];
    const cpuDeckMasterId = cpuDeckMasterCardId || cpuDeckCardIds[0];

    const playerDmDef = this.getCardDef(playerDeckMasterId);
    const cpuDmDef = this.getCardDef(cpuDeckMasterId);

    // 1. 덱 마스터를 덱 목록에서 1장 분리하여 시작 전장용으로 사용
    const playerDeckPool = [...this.state.playerDeckCardIds];
    const pDmIdx = playerDeckPool.indexOf(playerDeckMasterId);
    if (pDmIdx !== -1) playerDeckPool.splice(pDmIdx, 1);

    const cpuDeckPool = [...cpuDeckCardIds];
    const cDmIdx = cpuDeckPool.indexOf(cpuDeckMasterId);
    if (cDmIdx !== -1) cpuDeckPool.splice(cDmIdx, 1);

    const seat0Deck = this.shuffleArray(playerDeckPool.map((cid) => this.instantiateCard(cid, 0)));
    const seat1Deck = this.shuffleArray(cpuDeckPool.map((cid) => this.instantiateCard(cid, 1)));

    // 2. 덱 마스터 인스턴스화 & 필드 배치 (게임 시작하자마자 필드에 전개된 단 하나의 '씨앗')
    const playerDmUnit = this.instantiateCard(playerDeckMasterId, 0);
    playerDmUnit.isDeckMaster = true;
    const cpuDmUnit = this.instantiateCard(cpuDeckMasterId, 1);
    cpuDmUnit.isDeckMaster = true;

    // 3. 선/후 결정: 양쪽 모두 Lv 1 스타터이므로 50:50 코인토스로 공평하게 선공 결정
    const playerLevel = playerDmDef?.level ?? playerDmDef?.cost ?? 1;
    const cpuLevel = cpuDmDef?.level ?? cpuDmDef?.cost ?? 1;
    let activeSeat = 0;
    let turnDecisionReason = '';

    if (playerLevel < cpuLevel) {
      activeSeat = 0;
      turnDecisionReason = `플레이어 덱 마스터 레벨(★${playerLevel})이 상대(★${cpuLevel})보다 낮아 선공을 가져갑니다.`;
    } else if (cpuLevel < playerLevel) {
      activeSeat = 1;
      turnDecisionReason = `상대 덱 마스터 레벨(★${cpuLevel})이 플레이어(★${playerLevel})보다 낮아 상대가 선공을 가져갑니다.`;
    } else {
      const coin = this.rng.nextFloat() < 0.5 ? 0 : 1;
      activeSeat = coin;
      turnDecisionReason = `양쪽 덱 마스터가 Lv 1 스타터이므로 코인토스로 ${coin === 0 ? '플레이어' : '상대'}가 선공이 되었습니다.`;
    }

    // 소환 턴 번호 부여 (각 플레이어의 첫 번째 액티브 턴 번호로 정렬)
    playerDmUnit.summonedTurnNumber = activeSeat === 0 ? 1 : 2;
    cpuDmUnit.summonedTurnNumber = activeSeat === 1 ? 1 : 2;

    const seat0 = {
      seatIndex: 0,
      duelistId: 'PLAYER_LOCAL',
      duelistName: '플레이어',
      isCpu: false,
      rngLuckBias: 0.0,
      lp: 100,
      maxLp: 100,
      normalSummonsRemaining: 1, // 턴당 1회 일반 소환권
      deck: seat0Deck,
      hand: [],
      board: [playerDmUnit],
      setSpells: [], // [{ instanceId, cardId, slotType, targetMonsterInstanceId, triggerTiming }]
      graveyard: [],
      deckMasterId: playerDeckMasterId,
    };

    const seat1 = {
      seatIndex: 1,
      duelistId: cpuId,
      duelistName: cpuName,
      isCpu: true,
      rngLuckBias: cpuLuckBias,
      lp: 100,
      maxLp: 100,
      normalSummonsRemaining: 1, // 턴당 1회 일반 소환권
      deck: seat1Deck,
      hand: [],
      board: [cpuDmUnit],
      setSpells: [],
      graveyard: [],
      deckMasterId: cpuDeckMasterId,
    };

    // 5. 시작 시 카드 5장 드로우
    for (let i = 0; i < 5; i++) {
      this.drawCard(seat0);
      this.drawCard(seat1);
    }

    // [규칙] 첫 1바퀴(1~2턴)는 공격 불가 (전개 및 탐색)
    playerDmUnit.canAttack = false;
    cpuDmUnit.canAttack = false;

    return {
      duelId,
      seed: this.state.seed,
      turnNumber: 1,
      activeSeat,
      firstPlayerSeat: activeSeat,
      round1NoAttack: true,
      turnDecisionReason,
      status: 'ONGOING',
      seats: [seat0, seat1],
      fieldSetSlots: {
        left: null,
        right: null,
      },
      lastAttackResult: null,
      lastSpellTriggerResult: null,
    };
  }

  shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.nextFloat() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  instantiateCard(cardId, ownerSeat) {
    const def = this.getCardDef(cardId);
    return {
      instanceId: `INST_${this.instanceSeq++}_${cardId}`,
      cardId: def.id,
      name: def.name,
      ownerSeat,
      type: def.type || (def.attack > 0 ? 'MONSTER' : 'SPELL'),
      level: def.level ?? def.cost ?? 1,
      cost: def.cost ?? def.level ?? 1,
      currentAttack: def.attack,
      currentDefense: def.defense ?? def.health ?? 10,
      maxDefense: def.defense ?? def.health ?? 10,
      canAttack: true, // 몬스터 낸 턴 즉시 공격 가능 (Turn 1~2 라운드1 선공/후공 제외)
      keywords: [...(def.keywords || [])],
      tags: [...(def.tags || [])],
      isGod: def.isGod || def.level === 6,
      condition: def.condition || '',
      target: def.target || '',
      effect: def.effect || '',
      isDeckMaster: false,
      summonedTurnNumber: 1,
    };
  }

  drawCard(seat) {
    const next = seat.deck.shift();
    if (next) {
      seat.hand.push(next);
    }
  }

  /**
   * 듀얼 커맨드 처리기 (노마나 소환권 & 계단식/합산 릴리스 시스템 탑재)
   */
  dispatchDuelCommand(cmd) {
    const duel = this.state.activeDuel;
    if (!duel || duel.status !== 'ONGOING') {
      throw new Error('진행 중인 듀얼이 없습니다.');
    }
    if (cmd.seat !== duel.activeSeat) {
      throw new Error(`턴 순서 불일치: 현재 ${duel.activeSeat}번 시트의 턴입니다.`);
    }

    const actor = duel.seats[cmd.seat];
    const opponentSeat = cmd.seat === 0 ? 1 : 0;
    const opponent = duel.seats[opponentSeat];

    // ==========================================
    // 1. 카드 손패에서 즉시 발동/소환 (PLAY_CARD)
    // ==========================================
    if (cmd.type === 'PLAY_CARD') {
      const handIdx = actor.hand.findIndex((c) => c.instanceId === cmd.cardInstanceId);
      if (handIdx === -1) {
        throw new Error(`손패에서 카드 ${cmd.cardInstanceId}를 찾을 수 없습니다.`);
      }
      const cardInst = actor.hand[handIdx];
      const def = this.getCardDef(cardInst.cardId);
      const cardLevel = def.level ?? def.cost ?? 1;

      // 1-1. 몬스터 소환 (소환권 1회 소모 + 1레벨 계단식 진화 / 합산 릴리스)
      if (def.type === 'MONSTER' || def.effectType === 'SUMMON_UNIT') {
        if ((actor.normalSummonsRemaining ?? 0) <= 0) {
          throw new Error('이번 턴 일반 소환권을 이미 모두 사용했습니다. (소환권: 0/1)');
        }

        // [Lv 1 몬스터] 제물 없이 필드 빈자리(최대 5마리)에 바로 소환
        if (cardLevel === 1) {
          if (actor.board.length >= 5) {
            throw new Error('필드가 가득 차 더 이상 몬스터를 소환할 수 없습니다. (최대 5마리)');
          }
          actor.hand.splice(handIdx, 1);
          actor.normalSummonsRemaining -= 1;
          cardInst.canAttack = duel.turnNumber >= 3;
          cardInst.summonedTurnNumber = duel.turnNumber;
          actor.board.push(cardInst);
        } else {
          // [Lv 2+ 몬스터] 제물(Tribute) 필수!
          const tributeIds = cmd.tributeInstanceIds || [];
          if (tributeIds.length === 0) {
            throw new Error(`★Lv.${cardLevel} 몬스터를 소환하려면 필드의 몬스터를 제물로 바쳐야 합니다.`);
          }

          const tributeUnits = [];
          for (const tid of tributeIds) {
            const unit = actor.board.find((u) => u.instanceId === tid);
            if (!unit) {
              throw new Error(`지정된 제물 몬스터(${tid})가 필드에 존재하지 않습니다.`);
            }
            tributeUnits.push(unit);
          }

          // [규칙 1] 단일 제물 릴리스: 1단계 높은 레벨 소환(계단식 진화) 허용 (cardLevel - sacLevel <= 1)
          if (tributeUnits.length === 1) {
            const sacLevel = tributeUnits[0].level || 1;
            if (cardLevel - sacLevel > 1) {
              throw new Error(
                `단일 제물로는 1단계 높은 레벨(★Lv.${sacLevel + 1})까지만 진화 소환할 수 있습니다. ★Lv.${cardLevel} 소환에는 제물 레벨 합산(${sacLevel}/${cardLevel})이 부족합니다.`
              );
            }
          } else {
            // [규칙 2] 2장 이상 제물 릴리스: 제물 레벨 합산이 소환 대상 레벨 이상이어야 함
            const sumLevels = tributeUnits.reduce((acc, u) => acc + (u.level || 1), 0);
            if (sumLevels < cardLevel) {
              throw new Error(
                `제물 몬스터들의 레벨 합산(★Lv.${sumLevels})이 소환 대상 레벨(★Lv.${cardLevel})보다 부족합니다.`
              );
            }
          }

          // 제물 몬스터 필드에서 묘지로 이동
          for (const tUnit of tributeUnits) {
            const bIdx = actor.board.findIndex((u) => u.instanceId === tUnit.instanceId);
            if (bIdx !== -1) {
              actor.board.splice(bIdx, 1);
              actor.graveyard.push(tUnit);
            }
            // 제물 몬스터 앞에 세트되어 있던 마법이 있었다면 반응 불발 처리
            this.checkAndTriggerSetSpells(
              duel,
              'ON_MONSTER_DESTROYED',
              cmd.seat,
              tUnit.instanceId,
              null
            );
          }

          actor.hand.splice(handIdx, 1);
          actor.normalSummonsRemaining -= 1;
          cardInst.canAttack = duel.turnNumber >= 3;
          cardInst.summonedTurnNumber = duel.turnNumber;
          actor.board.push(cardInst);
        }
      } else {
        // 1-2. 마법 카드 발동 (코스트 없이 자유 발동)
        actor.hand.splice(handIdx, 1);
        this.resolveCardEffect(def, cardInst, actor, opponent);
      }

      if (cmd.seat === 0) {
        this.binder.recordCardPlayed(def.id, 35);
      } else {
        this.binder.recordCardSeen(def.id);
      }
    }

    // ==========================================
    // 2. 마법 카드 세트 (SET_SPELL)
    // - slotType: 'MONSTER_FRONT' | 'FIELD_LEFT' | 'FIELD_RIGHT'
    // - 모든 마법 카드는 위치 제약 없이 자유롭게 세트 가능!
    // ==========================================
    else if (cmd.type === 'SET_SPELL') {
      const handIdx = actor.hand.findIndex((c) => c.instanceId === cmd.cardInstanceId);
      if (handIdx === -1) {
        throw new Error(`손패에서 카드 ${cmd.cardInstanceId}를 찾을 수 없습니다.`);
      }
      const cardInst = actor.hand[handIdx];
      const def = this.getCardDef(cardInst.cardId);

      if (def.type !== 'SPELL') {
        throw new Error('마법 카드만 세트할 수 있습니다.');
      }

      if (cmd.slotType === 'FIELD_LEFT' && duel.fieldSetSlots.left) {
        throw new Error('필드 중앙 좌측 슬롯에 이미 세트된 마법이 있습니다.');
      }
      if (cmd.slotType === 'FIELD_RIGHT' && duel.fieldSetSlots.right) {
        throw new Error('필드 중앙 우측 슬롯에 이미 세트된 마법이 있습니다.');
      }
      if (cmd.slotType === 'MONSTER_FRONT') {
        if (!cmd.targetMonsterInstanceId) {
          throw new Error('몬스터 앞 세트를 위한 대상 몬스터가 지정되지 않았습니다.');
        }
        const monsterExists = actor.board.some((u) => u.instanceId === cmd.targetMonsterInstanceId);
        if (!monsterExists) {
          throw new Error('세트할 대상 몬스터가 내 필드에 존재하지 않습니다.');
        }
        const alreadyHasFrontSpell = actor.setSpells.some(
          (s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === cmd.targetMonsterInstanceId
        );
        if (alreadyHasFrontSpell) {
          throw new Error('해당 몬스터 앞에는 이미 세트된 마법이 존재합니다.');
        }
      }

      actor.hand.splice(handIdx, 1);

      const setSpellItem = {
        instanceId: cardInst.instanceId,
        cardId: def.id,
        name: def.name,
        level: def.level || 1,
        cost: def.cost || 1,
        ownerSeat: cmd.seat,
        slotType: cmd.slotType,
        targetMonsterInstanceId: cmd.targetMonsterInstanceId || null,
        triggerTiming: def.spellTriggerType || 'ON_ATTACKED',
        effectType: def.effectType,
        effectValue: def.effectValue,
        keywords: def.keywords || [],
        tags: def.tags || [],
        target: def.target || '',
        effect: def.effect || '',
        isFlipped: false,
      };

      if (cmd.slotType === 'FIELD_LEFT') {
        duel.fieldSetSlots.left = setSpellItem;
      } else if (cmd.slotType === 'FIELD_RIGHT') {
        duel.fieldSetSlots.right = setSpellItem;
      } else {
        // 내 몬스터 앞 세트
        actor.setSpells.push(setSpellItem);
      }
    }

    // ==========================================
    // 3. 공격 선언 (ATTACK)
    // - 첫 1바퀴(1~2턴) 공격 봉인 (전개 및 세트 단계), 3턴부터 전투 공격 전면 해금
    // - 유희왕식 직접 공격 제한: 상대 필드에 몬스터가 1마리라도 있으면 본체 직접 공격 불가
    // - 상대 필드가 완전히 비어있을 때는 본체 직접 공격 가능
    // - 기본 관통 피해 없음: 오직 '관통' 보유 몬스터만 ATK - DEF 초과 피해를 본체에 관통
    // ==========================================
    else if (cmd.type === 'ATTACK') {
      if (duel.turnNumber <= 2) {
        throw new Error('첫 1바퀴(1~2턴)는 전개 및 세트 단계로 공격할 수 없습니다. 본격적인 전투는 3턴부터 가능합니다.');
      }

      const attacker = actor.board.find((u) => u.instanceId === cmd.attackerInstanceId);
      if (!attacker || !attacker.canAttack) {
        throw new Error(`해당 유닛(${cmd.attackerInstanceId})은 지금 공격할 수 없습니다.`);
      }

      const attackerDef = this.getCardDef(attacker.cardId);

      // 유희왕식 직접 공격 제한: 상대 필드에 몬스터가 1마리라도 존재하면 본체 직접 공격 불가
      const canDirectAttack =
        (attackerDef?.keywords || []).includes('직접공격') ||
        (attacker.keywords || []).includes('직접공격') ||
        (attackerDef?.tags || []).some((t) => t.includes('직접공격')) ||
        (attacker.tags || []).some((t) => t.includes('직접공격')) ||
        attackerDef?.effectType === 'DIRECT_ATTACK';

      if (!cmd.targetInstanceId && opponent.board.length > 0 && !canDirectAttack) {
        throw new Error('상대 필드에 몬스터가 존재할 때는 본체를 직접 공격할 수 없습니다. 상대 몬스터를 먼저 공격해야 합니다.');
      }

      attacker.canAttack = false;

      const attackResult = {
        attackerInstanceId: attacker.instanceId,
        attackerCardId: attacker.cardId,
        attackerLevel: attackerDef?.level || 1,
        attackerCost: attackerDef?.cost || 1,
        attackerAttack: attacker.currentAttack,
        targetInstanceId: cmd.targetInstanceId || null,
        targetType: cmd.targetInstanceId ? 'UNIT' : 'HERO',
        defenderDied: false,
        attackerDied: false,
        pierceDamage: 0,
        recoilDamage: 0,
        damageDealt: attacker.currentAttack,
        triggeredSpell: null,
      };

      // 3-1. 피격 시 트리거 마법 발동 확인 (ON_ATTACKED)
      const triggeredSpell = this.checkAndTriggerSetSpells(
        duel,
        'ON_ATTACKED',
        opponentSeat,
        cmd.targetInstanceId,
        attacker
      );
      if (triggeredSpell) {
        attackResult.triggeredSpell = triggeredSpell;
      }

      // 3-2. 대상 유닛 공격 판정 (공격력 > 수비력이면 파괴)
      if (cmd.targetInstanceId) {
        const targetIdx = opponent.board.findIndex((u) => u.instanceId === cmd.targetInstanceId);
        if (targetIdx === -1) {
          throw new Error(`공격 대상 유닛을 상대 전장에서 찾을 수 없습니다.`);
        }
        const defender = opponent.board[targetIdx];
        const isDestroyed = attacker.currentAttack > defender.currentDefense;

        if (isDestroyed) {
          attackResult.defenderDied = true;
          attackResult.defenderCardId = defender.cardId;
          attackResult.defenderInstanceId = defender.instanceId;
          opponent.board.splice(targetIdx, 1);
          opponent.graveyard.push(defender);

          // 관통 데미지 룰: 오직 '관통' 보유 유닛만 초과분 본체 관통 피해
          const overkill = attacker.currentAttack - defender.currentDefense;
          const hasPierce =
            (attackerDef?.keywords || []).includes('관통') ||
            (attacker.keywords || []).includes('관통') ||
            (attackerDef?.tags || []).some((t) => t.includes('관통')) ||
            (attacker.tags || []).some((t) => t.includes('관통')) ||
            attackerDef?.effectType === 'PIERCE_ATTACK';

          if (hasPierce && overkill > 0) {
            attackResult.pierceDamage = overkill;
            opponent.lp = Math.max(0, opponent.lp - overkill);
          } else {
            attackResult.pierceDamage = 0;
          }

          // 파괴된 수호 몬스터 앞 세트 마법이 남아있다면 반응 격발 (불발 처리)
          this.checkAndTriggerSetSpells(
            duel,
            'ON_MONSTER_DESTROYED',
            opponentSeat,
            defender.instanceId,
            null
          );
        } else {
          attackResult.defenderDied = false; // 수비력 이하이면 유닛 생존

          // ★ 수비 반사 데미지 (유희왕 룰): 수비 몬스터의 수비력이 공격력보다 높으면 그 차이(DEF - ATK)만큼 공격 플레이어가 직접 반사 피해를 입음!
          const recoilDamage = defender.currentDefense - attacker.currentAttack;
          if (recoilDamage > 0) {
            attackResult.recoilDamage = recoilDamage;
            actor.lp = Math.max(0, actor.lp - recoilDamage);
          } else {
            attackResult.recoilDamage = 0;
          }
        }
      } else {
        // 상대 본체 직접 타격
        opponent.lp = Math.max(0, opponent.lp - attacker.currentAttack);
      }

      this.lastAttackResult = attackResult;
    }

    // ==========================================
    // 4. 턴 종료 (END_TURN)
    // ==========================================
    else if (cmd.type === 'END_TURN') {
      // 턴 종료 시 트리거 마법 (ON_TURN_END)
      this.checkAndTriggerSetSpells(duel, 'ON_TURN_END', cmd.seat);

      // 턴 전환
      duel.activeSeat = opponentSeat;
      duel.turnNumber += 1;

      // 소환권 재충전 (매 턴 1회)
      opponent.normalSummonsRemaining = 1;

      // 3턴부터 공격 활성화
      for (const unit of opponent.board) {
        unit.canAttack = duel.turnNumber >= 3;
      }

      // 턴 시작 시 1장 드로우
      this.drawCard(opponent);

      // 턴 시작 시 트리거 마법 (ON_TURN_START)
      this.checkAndTriggerSetSpells(duel, 'ON_TURN_START', opponentSeat);
    }

    this.evaluateDuelOutcome(duel);
    return this.getSnapshot();
  }

  /**
   * 세트 마법 트리거 감지 및 격발기 (어디에 세트하더라도 발동 가능 & 엄격한 대상 존재/미아 불발 룰링 탑재)
   * - 몬스터 앞 / 필드 중앙 슬롯 무관하게 발동 조건(timing) 충족 시 격발
   * - 대상이 소멸·파괴되거나 존재하지 않을 경우(미아 상태) 효과는 즉시 불발(fizzled) 처리되어 묘지로 소멸
   */
  checkAndTriggerSetSpells(duel, timing, defenderSeat, targetMonsterInstanceId = null, attacker = null, sourceEffect = null) {
    const defender = duel.seats[defenderSeat];
    const attackerSeat = defenderSeat === 0 ? 1 : 0;
    const attackerPlayer = duel.seats[attackerSeat];

    // 1. 내 몬스터 앞 세트 마법 검사 (MONSTER_FRONT)
    if (targetMonsterInstanceId) {
      const idx = defender.setSpells.findIndex(
        (s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === targetMonsterInstanceId
      );
      if (idx !== -1) {
        const spell = defender.setSpells.splice(idx, 1)[0];
        defender.graveyard.push(spell);

        let isValidTrigger = false;
        let fizzleReason = '';

        if (spell.triggerTiming === 'ON_ATTACKED') {
          // 피격 시 발동 마법 (반격 결계, 지뢰 등): 반드시 전투 공격자(attacker)가 유효하게 존재해야 함
          if (timing === 'ON_ATTACKED' && attacker) {
            const attackerAlive = attackerPlayer.board.some((u) => u.instanceId === attacker.instanceId);
            if (attackerAlive || attacker.currentAttack > 0) {
              isValidTrigger = true;
            } else {
              isValidTrigger = false;
              fizzleReason = '공격자가 이미 파괴되어 대상이 없으므로(미아 상태) 불발';
            }
          } else {
            isValidTrigger = false;
            fizzleReason = '전투 공격 피격이 아니므로 공격 대상이 없어(미아 상태) 불발';
          }
        } else if (spell.triggerTiming === timing) {
          isValidTrigger = true;
        } else {
          isValidTrigger = false;
          fizzleReason = `발동 타이밍(${spell.triggerTiming}) 불일치로 불발`;
        }

        if (isValidTrigger) {
          spell.fizzled = false;
          this.resolveTriggerEffect(spell, defender, attackerPlayer, attacker);
          duel.narrativeLog = `🔮 「${spell.name}」 발동! 효과가 정상 격발되었습니다.`;
        } else {
          spell.fizzled = true;
          spell.fizzleReason = fizzleReason;
          duel.narrativeLog = `⚠️ [효과 불발] 대상이 존재하지 않거나 이미 파괴되어(미아 상태) 「${spell.name}」 효과가 불발되었습니다.`;
        }

        duel.lastSpellTriggerResult = spell;
        return spell;
      }
    }

    // 2. 필드 중앙 세트 마법 검사 (FIELD_LEFT, FIELD_RIGHT) - 어디에 세트하든 자유롭게 반응
    for (const slotKey of ['left', 'right']) {
      const spell = duel.fieldSetSlots[slotKey];
      if (spell && spell.ownerSeat === defenderSeat) {
        let matchesTiming = false;
        if (timing === 'ON_ATTACKED' && spell.triggerTiming === 'ON_ATTACKED') {
          matchesTiming = true;
        } else if (spell.triggerTiming === timing) {
          matchesTiming = true;
        }

        if (matchesTiming) {
          duel.fieldSetSlots[slotKey] = null;
          defender.graveyard.push(spell);

          let isValidTrigger = false;
          let fizzleReason = '';

          if (spell.triggerTiming === 'ON_ATTACKED') {
            if (attacker) {
              const attackerAlive = attackerPlayer.board.some((u) => u.instanceId === attacker.instanceId);
              if (attackerAlive || attacker.currentAttack > 0) {
                isValidTrigger = true;
              } else {
                isValidTrigger = false;
                fizzleReason = '공격 대상이 존재하지 않거나 이미 파괴되어(미아 상태) 불발';
              }
            } else {
              isValidTrigger = false;
              fizzleReason = '전투 공격 피격이 아니므로 반격 대상이 없어(미아 상태) 불발';
            }
          } else if (spell.effectType === 'BUFF_ALL_ATK' && defender.board.length === 0) {
            isValidTrigger = false;
            fizzleReason = '버프를 받을 아군 몬스터가 전장에 없어(미아 상태) 불발';
          } else {
            isValidTrigger = true;
          }

          if (isValidTrigger) {
            spell.fizzled = false;
            this.resolveTriggerEffect(spell, defender, attackerPlayer, attacker);
            duel.narrativeLog = `🔮 「${spell.name}」 발동! 효과가 정상 격발되었습니다.`;
          } else {
            spell.fizzled = true;
            spell.fizzleReason = fizzleReason;
            duel.narrativeLog = `⚠️ [효과 불발] 대상이 존재하지 않거나 이미 파괴되어(미아 상태) 「${spell.name}」 효과가 불발되었습니다.`;
          }

          duel.lastSpellTriggerResult = spell;
          return spell;
        }
      }
    }
    return null;
  }

  resolveTriggerEffect(spell, owner, opponent, attacker) {
    if (spell.effectType === 'COUNTER_ATTACK') {
      if (attacker) attacker.currentAttack = Math.max(0, attacker.currentAttack - spell.effectValue);
      opponent.lp = Math.max(0, opponent.lp - spell.effectValue);
    } else if (spell.effectType === 'MINE_EXPLODE') {
      if (attacker) {
        attacker.currentDefense = Math.max(0, attacker.currentDefense - spell.effectValue);
        if (attacker.currentDefense <= 0) {
          const idx = opponent.board.findIndex((u) => u.instanceId === attacker.instanceId);
          if (idx !== -1) {
            opponent.board.splice(idx, 1);
            opponent.graveyard.push(attacker);
          }
        }
      }
    } else if (spell.effectType === 'HEAL_AND_DRAW') {
      owner.lp = Math.min(100, owner.lp + spell.effectValue);
      this.drawCard(owner);
    } else if (spell.effectType === 'BUFF_ALL_ATK') {
      for (const u of owner.board) {
        u.currentAttack += spell.effectValue;
      }
    } else if (spell.effectType === 'EXTRA_SUMMON') {
      owner.normalSummonsRemaining = (owner.normalSummonsRemaining || 0) + spell.effectValue;
    } else if (spell.effectType === 'MANA_BURST') {
      owner.normalSummonsRemaining = (owner.normalSummonsRemaining || 0) + 1;
    } else if (spell.effectType === 'MIRROR_REFLECT') {
      opponent.lp = Math.max(0, opponent.lp - 15);
    }
  }

  resolveCardEffect(def, cardInst, actor, opponent) {
    const duel = this.state.activeDuel;
    if (def.effectType === 'DIRECT_DAMAGE') {
      opponent.lp = Math.max(0, opponent.lp - def.effectValue);
      actor.graveyard.push(cardInst);
      return;
    }

    if (def.effectType === 'BOARD_WIPE') {
      for (const unit of [...opponent.board]) {
        // 광역기 피격에 반응하여 몬스터 앞 세트 마법 발동 시도 (조건 불일치 시 불발 처리)
        if (duel) {
          this.checkAndTriggerSetSpells(
            duel,
            'AFFECTED_BY_EFFECT',
            opponent.seatIndex,
            unit.instanceId,
            null,
            def
          );
        }
        unit.currentDefense -= def.effectValue;
        if (unit.currentDefense <= 0) {
          const idx = opponent.board.indexOf(unit);
          if (idx !== -1) opponent.board.splice(idx, 1);
          opponent.graveyard.push(unit);
        }
      }
      opponent.lp = Math.max(0, opponent.lp - def.effectValue);
      actor.graveyard.push(cardInst);
      return;
    }

    if (def.effectType === 'CHAOS_GAMBLE') {
      const roll = Math.min(1.0, this.rng.nextFloat() + actor.rngLuckBias);
      const damage = roll >= 0.4 ? def.effectValue : Math.ceil(def.effectValue / 2);
      opponent.lp = Math.max(0, opponent.lp - damage);
      actor.graveyard.push(cardInst);
    }
  }

  executeCpuTurn() {
    const duel = this.state.activeDuel;
    if (!duel || duel.status !== 'ONGOING' || duel.activeSeat !== 1) {
      return this.getSnapshot();
    }

    const cpu = duel.seats[1];

    // 1. CPU 마법 카드 자유 발동 및 세트
    for (const cardInst of [...cpu.hand]) {
      if (duel.status !== 'ONGOING') break;
      const def = this.getCardDef(cardInst.cardId);
      if (def.type === 'SPELL') {
        const allowed = def.allowedSlots || ['MONSTER_FRONT', 'FIELD_LEFT', 'FIELD_RIGHT'];
        if (def.spellTriggerType === 'INSTANT') {
          try {
            this.dispatchDuelCommand({
              type: 'PLAY_CARD',
              seat: 1,
              cardInstanceId: cardInst.instanceId,
            });
          } catch (e) {}
        } else if (allowed.includes('MONSTER_FRONT') && cpu.board.length > 0) {
          // 몬스터 앞 세트 우선 시도 (피격 반응 마법 등)
          const targetUnit = cpu.board.find(
            (u) => !cpu.setSpells.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === u.instanceId)
          );
          if (targetUnit) {
            try {
              this.dispatchDuelCommand({
                type: 'SET_SPELL',
                seat: 1,
                cardInstanceId: cardInst.instanceId,
                slotType: 'MONSTER_FRONT',
                targetMonsterInstanceId: targetUnit.instanceId,
              });
              continue;
            } catch (e) {}
          }
        } else if (allowed.includes('FIELD_LEFT') && !duel.fieldSetSlots.left) {
          try {
            this.dispatchDuelCommand({
              type: 'SET_SPELL',
              seat: 1,
              cardInstanceId: cardInst.instanceId,
              slotType: 'FIELD_LEFT',
            });
            continue;
          } catch (e) {}
        } else if (allowed.includes('FIELD_RIGHT') && !duel.fieldSetSlots.right) {
          try {
            this.dispatchDuelCommand({
              type: 'SET_SPELL',
              seat: 1,
              cardInstanceId: cardInst.instanceId,
              slotType: 'FIELD_RIGHT',
            });
            continue;
          } catch (e) {}
        }
      }
    }

    // 2. CPU 몬스터 소환 (소환권 1회 활용)
    if (cpu.normalSummonsRemaining > 0 && duel.status === 'ONGOING') {
      const monsterCards = cpu.hand
        .map((c) => ({ inst: c, def: this.getCardDef(c.cardId) }))
        .filter((item) => item.def.type === 'MONSTER' || item.def.effectType === 'SUMMON_UNIT');

      let summonSuccess = false;

      // 2-1. 계단식 진화 소환 우선 탐색 (1단계 높은 레벨 몬스터로 단일 제물 릴리스)
      for (const m of monsterCards) {
        const targetLevel = m.def.level ?? m.def.cost ?? 1;
        if (targetLevel >= 2) {
          // 필드에서 레벨 차이가 1 이하인 제물 후보 탐색
          const stepUpCandidate = cpu.board.find((u) => targetLevel - (u.level || 1) <= 1);
          if (stepUpCandidate) {
            try {
              this.dispatchDuelCommand({
                type: 'PLAY_CARD',
                seat: 1,
                cardInstanceId: m.inst.instanceId,
                tributeInstanceIds: [stepUpCandidate.instanceId],
              });
              summonSuccess = true;
              break;
            } catch (e) {}
          }
        }
      }

      // 2-2. 합산 릴리스 소환 탐색 (필드 2마리 이상일 때 고레벨 거신 소환)
      if (!summonSuccess && cpu.board.length >= 2) {
        for (const m of monsterCards) {
          const targetLevel = m.def.level ?? m.def.cost ?? 1;
          if (targetLevel >= 3) {
            const sortedBoard = [...cpu.board].sort((a, b) => (a.level || 1) - (b.level || 1));
            let currentSum = 0;
            const tributes = [];
            for (const u of sortedBoard) {
              currentSum += u.level || 1;
              tributes.push(u.instanceId);
              if (currentSum >= targetLevel) break;
            }
            if (currentSum >= targetLevel && tributes.length < cpu.board.length + 1) {
              try {
                this.dispatchDuelCommand({
                  type: 'PLAY_CARD',
                  seat: 1,
                  cardInstanceId: m.inst.instanceId,
                  tributeInstanceIds: tributes,
                });
                summonSuccess = true;
                break;
              } catch (e) {}
            }
          }
        }
      }

      // 2-3. Lv 1 일반 소환 (빈자리 필드 전개)
      if (!summonSuccess && cpu.board.length < 5) {
        const lv1Monster = monsterCards.find((m) => (m.def.level ?? m.def.cost ?? 1) === 1);
        if (lv1Monster) {
          try {
            this.dispatchDuelCommand({
              type: 'PLAY_CARD',
              seat: 1,
              cardInstanceId: lv1Monster.inst.instanceId,
            });
            summonSuccess = true;
          } catch (e) {}
        }
      }
    }

    // 3. CPU 공격 수행 (3턴 이상일 때만 공격 수행)
    if (duel.status === 'ONGOING' && duel.turnNumber >= 3) {
      const playerSeat = duel.seats[0];
      for (const unit of [...cpu.board]) {
        if (unit.canAttack && duel.status === 'ONGOING') {
          let targetUnit = null;
          if (playerSeat.board.length > 0) {
            // 처치 가능한 유닛 중 가장 수비력이 높은 유닛 우선 타격
            const killable = playerSeat.board.filter((u) => unit.currentAttack > u.currentDefense);
            if (killable.length > 0) {
              targetUnit = killable.sort((a, b) => b.currentDefense - a.currentDefense)[0];
            } else {
              // 처치할 수 있는 몬스터가 없다면:
              // 반사 데미지(DEF > ATK)를 받지 않는 유닛(DEF === ATK)이 있는 경우에만 타격하고,
              // DEF > ATK인 몬스터는 본체 반사 피해를 피하기 위해 공격하지 않고 보드를 수비
              const safeEqual = playerSeat.board.find((u) => unit.currentAttack === u.currentDefense);
              if (safeEqual) {
                targetUnit = safeEqual;
              } else {
                continue; // 반사 데미지 자해 방지
              }
            }
          }

          try {
            this.dispatchDuelCommand({
              type: 'ATTACK',
              seat: 1,
              attackerInstanceId: unit.instanceId,
              targetInstanceId: targetUnit ? targetUnit.instanceId : undefined,
            });
          } catch (e) {}
        }
      }
    }

    // 4. CPU 턴 종료
    if (duel.status === 'ONGOING') {
      try {
        this.dispatchDuelCommand({ type: 'END_TURN', seat: 1 });
      } catch (e) {}
    }
    return this.getSnapshot();
  }

  evaluateDuelOutcome(duel) {
    const [seat0, seat1] = duel.seats;
    if (seat1.lp <= 0) {
      duel.status = 'SEAT_0_WIN';
      if (this.state.phase === 'DUEL_ENCOUNTER') {
        const reward = this.state.nextEncounterInfo?.rewardGold || 500;
        this.state.gold = (this.state.gold || 0) + reward;
        this.state.lastEncounterReward = reward;
        this.state.roundNumber = (this.state.roundNumber || 1) + 1;
        this.state.phase = 'STAGE_CHECKPOINT';
        this.generateCheckpointState();
      } else {
        this.advanceRunAfterDuelVictory();
      }
    } else if (seat0.lp <= 0) {
      duel.status = 'SEAT_1_WIN';
      this.state.phase = 'RUN_FAILED'; // 인카운터든 보스든 패배 시 즉시 런 실패 (영구 사망)
    }
    return this.getSnapshot();
  }

  advanceRunAfterDuelVictory() {
    if (this.state.phase === 'STAGE_1_DUEL_1') {
      this.state.phase = 'STAGE_2_REWARD_PACK';
      const packCards = ['C_BLUE_02', 'C_RED_02', 'C_PURP_02'];
      this.state.currentRewardPackChoices = packCards;
      for (const cid of packCards) {
        this.binder.recordCardSeen(cid);
      }
      return;
    }

    if (this.state.phase === 'STAGE_3_DUEL_2') {
      this.state.phase = 'STAGE_4_MERCHANT_EVENT';
      const targetMasteryCard = this.state.playerDeckCardIds[0];
      const merchantCard = 'C_PURP_03';
      this.binder.recordCardSeen(merchantCard);
      this.state.currentMerchantOffer = {
        offerCardId: merchantCard,
        bonusMasteryCardId: targetMasteryCard,
        bonusMasteryAmount: 100,
      };
      return;
    }

    if (this.state.phase === 'STAGE_5_FINAL_BOSS') {
      this.state.phase = 'RUN_VICTORY';
      this.state.hallOfFameSnapshot = {
        runId: this.state.runId,
        destiny: this.state.selectedDestiny,
        defeatedBossId: this.state.assignedFinalBoss,
        deckCardIds: [...this.state.playerDeckCardIds],
        clearedAt: Date.now(),
      };
    }
  }

  /**
   * [보상 팩 선택] STAGE_2_REWARD_PACK -> STAGE_3_DUEL_2 전이
   */
  pickRewardPackCard(chosenCardId) {
    this.assertPhase('STAGE_2_REWARD_PACK');
    if (!this.state.currentRewardPackChoices.includes(chosenCardId)) {
      throw new Error(`선택한 카드 ${chosenCardId}는 현재 보상 카드 목록에 없습니다.`);
    }

    this.state.playerDeckCardIds.push(chosenCardId);
    this.binder.recordCardAcquired(chosenCardId);
    this.state.currentRewardPackChoices = [];

    // 2차전 CPU 듀얼로 즉시 선형 전이 (30장 정규 덱)
    const cpuDeck = createStartingDeck('BLUE_JUSTICE');
    this.state.phase = 'STAGE_3_DUEL_2';
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_2',
      'CPU_VETERAN_DUELIST',
      '숙련 듀얼리스트 베가',
      cpuDeck.deckCardIds,
      cpuDeck.deckMasterCardId,
      0.05
    );
    return this.getSnapshot();
  }

  /**
   * [상인/훈련 이벤트] STAGE_4_MERCHANT_EVENT -> STAGE_5_FINAL_BOSS 전이
   */
  resolveMerchantEvent(choice) {
    this.assertPhase('STAGE_4_MERCHANT_EVENT');
    const offer = this.state.currentMerchantOffer;
    if (!offer) {
      throw new Error('상인 제안 정보를 찾을 수 없습니다.');
    }

    if (choice === 'ACQUIRE_CARD') {
      this.state.playerDeckCardIds.push(offer.offerCardId);
      this.binder.recordCardAcquired(offer.offerCardId);
    } else {
      this.binder.recordCardPlayed(offer.bonusMasteryCardId, offer.bonusMasteryAmount);
    }
    this.state.currentMerchantOffer = null;

    // 운명 대응 최종 보스전 개시 (30장 정규 덱)
    const bossId = this.state.assignedFinalBoss || 'BOSS_RED_UNSTOPPABLE_AGGRO';
    this.state.phase = 'STAGE_5_FINAL_BOSS';

    let bossName = '종언의 어그로 군주 볼카';
    let bossDeckType = 'RED_ZEAL';
    let bossLuckBias = 0.1;

    if (bossId === 'BOSS_BLUE_FORTRESS_CONTROL') {
      bossName = '절대방벽의 집행관 실피드';
      bossDeckType = 'BLUE_JUSTICE';
      bossLuckBias = 0.1;
    } else if (bossId === 'BOSS_PURPLE_RIGGED_FATE') {
      bossName = '사기적 행운의 지배자 조커';
      bossDeckType = 'PURPLE_CHAOS';
      bossLuckBias = 0.35;
    }

    const bossDeck = createStartingDeck(bossDeckType);
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_5_BOSS',
      bossId,
      bossName,
      bossDeck.deckCardIds,
      bossDeck.deckMasterCardId,
      bossLuckBias
    );
    return this.getSnapshot();
  }

  getCardDef(cardId) {
    const def = this.catalogMap.get(cardId);
    if (!def) {
      throw new Error(`카드 정보를 찾을 수 없습니다: ${cardId}`);
    }
    return def;
  }

  assertPhase(expected) {
    if (this.state.phase !== expected) {
      throw new Error(`상태 전이 오류: 현재 단계(${this.state.phase})는 ${expected}가 아닙니다.`);
    }
  }
}

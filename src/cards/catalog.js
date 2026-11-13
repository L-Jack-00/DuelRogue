/**
 * 카드 카탈로그.
 *
 * - CORE_CARDS: 초기부터 있던 기본 카드 (ID 유지, 스타터 덱·테스트가 참조)
 * - GENERATED_CARDS: tools/build_cards.js가 만든 확장 카드 (generatedCards.js)
 * - TOKENS: 효과로만 등장하는 토큰 몬스터 (덱에 넣을 수 없음)
 *
 * 원본 데이터에는 규칙에 필요한 값(kw, abilities, 스탯)만 적고, 화면용 설명문
 * (description / condition / target / effect / keywords 이름)은 finalizeCard()가 만든다.
 */
import { t } from '../i18n/strings.js';
import { keywordName } from '../duel/keywords.js';
import { describeAbility, describeTargets, abilityCost, keywordsCost } from '../duel/effects.js';
import { GENERATED_CARDS } from './generatedCards.js';
import { TOKENS, tokenStatSumOf } from './tokens.js';

export { TOKENS, tokenStatSumOf };



/** 기본 카드 21종. 스탯·ID는 초기 디자인을 유지하고 효과를 실제 규칙으로 옮겼다. */
export const CORE_CARDS = [
  // ---- 정의 (BLUE) ----
  { id: 'C_BLUE_01', name: '성소의 방패병', type: 'MONSTER', faction: 'BLUE', level: 1, attack: 4, defense: 14, rarity: 'COMMON',
    kw: ['TAUNT'], tags: ['#성역', '#보병'], abilities: [] },
  { id: 'C_BLUE_02', name: '심판의 섬광', type: 'SPELL', faction: 'BLUE', level: 2, rarity: 'RARE', spellTriggerType: 'INSTANT',
    kw: [], tags: ['#마법', '#빛'],
    abilities: [{ trigger: 'INSTANT', effects: [{ op: 'DAMAGE_UNIT', target: 'ENEMY_ALL', value: 12 }, { op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 12 }] }] },
  { id: 'C_BLUE_03', name: '아이기스 수호신', type: 'MONSTER', faction: 'BLUE', level: 3, attack: 10, defense: 22, rarity: 'RARE',
    kw: ['TAUNT'], tags: ['#거신', '#성역'],
    abilities: [{ trigger: 'ON_SUMMON', effects: [{ op: 'SHIELD_HERO', value: 12 }] }] },
  { id: 'C_BLUE_04', name: '빛의 대마법사', type: 'MONSTER', faction: 'BLUE', level: 2, attack: 7, defense: 16, rarity: 'UNCOMMON',
    kw: [], tags: ['#마법사', '#빛'],
    abilities: [{ trigger: 'ON_SUMMON', effects: [{ op: 'DAMAGE_UNIT', target: 'ENEMY_WEAKEST', value: 5 }] }] },
  { id: 'C_BLUE_05', name: '천상의 대천사 미카엘', type: 'MONSTER', faction: 'BLUE', level: 6, attack: 26, defense: 34, rarity: 'LEGENDARY', isGod: true,
    kw: ['DIVINE', 'TAUNT'], tags: ['#신', '#천사', '#성역'],
    abilities: [{ trigger: 'ON_SUMMON', effects: [{ op: 'HEAL_HERO', target: 'ALLY_HERO', value: 20 }] }] },
  { id: 'S_BLUE_01', name: '신성한 반격 결계', type: 'SPELL', faction: 'BLUE', level: 2, rarity: 'UNCOMMON', spellTriggerType: 'ON_ATTACKED',
    kw: [], tags: ['#결계', '#신성'],
    abilities: [{ trigger: 'ON_ATTACKED', effects: [{ op: 'DEBUFF', target: 'ATTACKER', atk: 10 }, { op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 10 }] }] },
  { id: 'S_BLUE_02', name: '여명의 축복', type: 'SPELL', faction: 'BLUE', level: 1, rarity: 'COMMON', spellTriggerType: 'ON_TURN_START',
    kw: [], tags: ['#마법', '#빛'],
    abilities: [{ trigger: 'ON_TURN_START', effects: [{ op: 'HEAL_HERO', target: 'ALLY_HERO', value: 15 }, { op: 'DRAW', value: 1 }] }] },

  // ---- 열의 (RED) ----
  { id: 'C_RED_01', name: '선봉 돌격병', type: 'MONSTER', faction: 'RED', level: 1, attack: 8, defense: 6, rarity: 'COMMON',
    kw: [], tags: ['#전사', '#돌격대'],
    abilities: [{ trigger: 'ON_KILL', effects: [{ op: 'BUFF', target: 'SELF', atk: 2 }] }] },
  { id: 'C_RED_02', name: '홍련의 화염탄', type: 'SPELL', faction: 'RED', level: 1, rarity: 'COMMON', spellTriggerType: 'INSTANT',
    kw: [], tags: ['#마법', '#화염'],
    abilities: [{ trigger: 'INSTANT', effects: [{ op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 16 }] }] },
  { id: 'C_RED_03', name: '광전사 집행관', type: 'MONSTER', faction: 'RED', level: 3, attack: 16, defense: 10, rarity: 'RARE',
    kw: ['PIERCE'], tags: ['#광전사', '#화염'],
    abilities: [{ trigger: 'ON_KILL', effects: [{ op: 'BUFF', target: 'SELF', atk: 3 }] }] },
  { id: 'C_RED_04', name: '홍련의 암살단', type: 'MONSTER', faction: 'RED', level: 2, attack: 13, defense: 8, rarity: 'UNCOMMON',
    kw: ['STEALTH'], tags: ['#도적', '#암살단'], abilities: [] },
  { id: 'C_RED_05', name: '진홍의 화룡 이그니스', type: 'MONSTER', faction: 'RED', level: 5, attack: 26, defense: 20, rarity: 'EPIC',
    kw: ['PIERCE'], tags: ['#용족', '#화염'],
    abilities: [{ trigger: 'ON_SUMMON', effects: [{ op: 'DAMAGE_UNIT', target: 'ENEMY_ALL', value: 6 }] }] },
  { id: 'S_RED_01', name: '홍련의 화염 지뢰', type: 'SPELL', faction: 'RED', level: 1, rarity: 'COMMON', spellTriggerType: 'ON_ATTACKED',
    kw: [], tags: ['#함정', '#화염'],
    abilities: [{ trigger: 'ON_ATTACKED', effects: [{ op: 'DAMAGE_UNIT', target: 'ATTACKER', value: 16 }] }] },
  { id: 'S_RED_02', name: '전쟁의 진격 나팔', type: 'SPELL', faction: 'RED', level: 2, rarity: 'UNCOMMON', spellTriggerType: 'ON_TURN_START',
    kw: [], tags: ['#전술', '#화염'],
    abilities: [{ trigger: 'ON_TURN_START', effects: [{ op: 'BUFF', target: 'ALLY_ALL', atk: 6 }] }] },

  // ---- 혼돈 (PURPLE) ----
  { id: 'C_PURP_01', name: '운명의 주사위 악마', type: 'MONSTER', faction: 'PURPLE', level: 1, attack: 7, defense: 9, rarity: 'COMMON',
    kw: [], tags: ['#악마', '#혼돈'],
    abilities: [{ trigger: 'ON_SUMMON', chance: 0.5, effects: [{ op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 10 }] }] },
  { id: 'C_PURP_02', name: '차원 균열의 룰렛', type: 'SPELL', faction: 'PURPLE', level: 2, rarity: 'UNCOMMON', spellTriggerType: 'INSTANT',
    kw: [], tags: ['#마법', '#혼돈'],
    abilities: [{ trigger: 'INSTANT', chance: 0.6, effects: [{ op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 22 }], elseEffects: [{ op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 11 }] }] },
  { id: 'C_PURP_03', name: '심연의 창조신 아자젤', type: 'MONSTER', faction: 'PURPLE', level: 6, attack: 30, defense: 30, rarity: 'LEGENDARY', isGod: true,
    kw: ['LIFESTEAL'], tags: ['#신', '#악마', '#심연'],
    abilities: [{ trigger: 'ON_SUMMON', chance: 0.5, effects: [{ op: 'DESTROY_UNIT', target: 'ENEMY_STRONGEST' }], elseEffects: [{ op: 'DAMAGE_UNIT', target: 'ENEMY_ALL', value: 8 }] }] },
  { id: 'C_PURP_04', name: '황천의 도박사', type: 'MONSTER', faction: 'PURPLE', level: 2, attack: 11, defense: 11, rarity: 'UNCOMMON',
    kw: [], tags: ['#인간', '#도박꾼'],
    abilities: [{ trigger: 'ON_DESTROYED', chance: 0.5, effects: [{ op: 'DRAW', value: 1 }] }] },
  { id: 'S_PURP_01', name: '운명의 뒤틀림 룰렛', type: 'SPELL', faction: 'PURPLE', level: 1, rarity: 'COMMON', spellTriggerType: 'ON_ATTACKED',
    kw: [], tags: ['#비술', '#혼돈'],
    abilities: [{ trigger: 'ON_ATTACKED', chance: 0.6, effects: [{ op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value: 15 }], elseEffects: [{ op: 'DAMAGE_HERO', target: 'ALLY_HERO', value: 5 }] }] },
  { id: 'S_PURP_02', name: '혼돈의 소환진', type: 'SPELL', faction: 'PURPLE', level: 1, rarity: 'UNCOMMON', spellTriggerType: 'ON_TURN_START',
    kw: [], tags: ['#비술', '#혼돈'],
    abilities: [{ trigger: 'ON_TURN_START', effects: [{ op: 'EXTRA_SUMMON', value: 1 }] }] },

  // ---- 파괴의 신 ----
  { id: 'C_TITAN_01', name: '천벌의 파괴신 테라', type: 'MONSTER', faction: 'RED', level: 6, attack: 32, defense: 30, rarity: 'LEGENDARY', isGod: true,
    kw: ['PIERCE'], tags: ['#신', '#태초의불', '#거신'],
    abilities: [{ trigger: 'ON_SUMMON', effects: [{ op: 'DAMAGE_UNIT', target: 'ENEMY_ALL', value: 10 }] }] },
];

const FACTION_TO_ARCHETYPE = { BLUE: 'CONTROL', RED: 'AGGRO', PURPLE: 'CHAOS_RNG', NEUTRAL: 'NEUTRAL' };
const tokenMap = new Map(TOKENS.map((c) => [c.id, c]));
const tokenNameOf = (id) => tokenMap.get(id)?.name || id;

/** 대표 효과 타입 (구버전 UI·테스트 호환용) */
function legacyEffectType(card) {
  if (card.type === 'MONSTER') return 'SUMMON_UNIT';
  const op = card.abilities?.[0]?.effects?.[0]?.op;
  return op || 'NONE';
}

/** 원본 카드 데이터에 화면용 필드를 채운다. */
export function finalizeCard(raw) {
  const card = { ...raw };
  card.kw = card.kw || [];
  card.tags = card.tags || [];
  card.abilities = card.abilities || [];
  card.archetype = FACTION_TO_ARCHETYPE[card.faction] || 'NEUTRAL';
  card.cost = card.level;
  card.keywords = card.kw.map(keywordName);
  card.effectType = legacyEffectType(card);
  card.effectValue = card.abilities?.[0]?.effects?.[0]?.value ?? 0;
  if (card.type === 'SPELL') {
    card.attack = 0;
    card.defense = 0;
    card.spellTriggerType = card.spellTriggerType || card.abilities?.[0]?.trigger || 'INSTANT';
  }
  if (card.collectible === undefined) card.collectible = !card.isToken;

  const described = card.abilities.map((ab) => describeAbility(ab, card.type, tokenNameOf));
  card.condition = described.map((d) => d.conditionText).join(' / ');
  card.target = describeTargets(card.abilities);
  card.effect = described.map((d) => d.effectText).join(' ');
  const lines = [];
  if (card.kw.length > 0) {
    lines.push(`${t('label.keyword')} ${card.kw.map((id) => `${keywordName(id)} — ${t(`kw.${id}.desc`)}`).join(' / ')}`);
  }
  for (const d of described) {
    lines.push(`${t('label.condition')} ${d.conditionText}`);
    lines.push(`${t('label.effect')} ${d.effectText}`);
  }
  if (lines.length === 0) lines.push(t('label.noEffect'));
  card.description = lines.join('\n');
  card.targetPolarity = card.abilities.some((ab) => (ab.effects || []).some((e) => String(e.target || '').startsWith('ENEMY') || e.target === 'ATTACKER'))
    ? 'HARMFUL'
    : 'BENEFICIAL';
  card.powerCost = card.abilities.reduce((a, ab) => a + abilityCost(ab, card.type, tokenStatSumOf), 0) + keywordsCost(card.kw);
  return card;
}

export const CARD_CATALOG = [...CORE_CARDS, ...GENERATED_CARDS, ...TOKENS].map(finalizeCard);
export const CARD_MAP = new Map(CARD_CATALOG.map((c) => [c.id, c]));
export const COLLECTIBLE_CARDS = CARD_CATALOG.filter((c) => c.collectible);

export function getCardDef(cardId) {
  return CARD_MAP.get(cardId) || null;
}

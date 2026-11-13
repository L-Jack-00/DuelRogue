/**
 * 카드 능력(ability) 데이터의 설명문 생성과 가치(스탯 환산 비용) 계산.
 *
 * 능력 데이터 형식:
 *   {
 *     trigger: 'ON_SUMMON' | 'ON_DESTROYED' | 'ON_ATTACK' | 'ON_KILL' | 'ON_TURN_START' | 'ON_TURN_END'   (몬스터)
 *            | 'INSTANT' | 'ON_ATTACKED' | 'ON_TURN_START' | 'ON_TURN_END' | 'ON_ENEMY_SUMMON'          (마법)
 *     condition?: { type: 'selfLpBelow' | 'enemyLpBelow' | 'enemyBoardAtLeast' | 'allyBoardAtLeast'
 *                         | 'handAtMost' | 'allyTagAtLeast' | 'behindOnBoard', value?, tag? },
 *     chance?: 0~1,          // 확률 판정. 실패하면 elseEffects 실행
 *     effects: [effect],
 *     elseEffects?: [effect],
 *   }
 *   effect = { op, target?, value?, atk?, def?, maxLevel?, keyword?, token? }
 *
 * 실제 효과 처리는 duelCore.js가 담당한다. 이 파일은 상태를 바꾸지 않는다.
 */
import { t } from '../i18n/strings.js';
import { KEYWORDS, keywordName } from './keywords.js';

/** 대상이 몬스터인 효과의 대상 선택자 */
export const UNIT_TARGETS_ENEMY = ['ENEMY_ALL', 'ENEMY_RANDOM', 'ENEMY_STRONGEST', 'ENEMY_WEAKEST', 'ENEMY_HIGHEST_LEVEL', 'ATTACKER', 'SUMMONED'];
export const UNIT_TARGETS_ALLY = ['SELF', 'ALLY_ALL', 'ALLY_OTHERS', 'ALLY_RANDOM', 'ALLY_WEAKEST'];

const MULTI_TARGETS = new Set(['ENEMY_ALL', 'ALLY_ALL', 'ALLY_OTHERS']);

export function isUnitTarget(target) {
  return UNIT_TARGETS_ENEMY.includes(target) || UNIT_TARGETS_ALLY.includes(target);
}

// --------------------------------------------------------------------------
// 설명문
// --------------------------------------------------------------------------

function statsText(effect, isDebuff) {
  const parts = [];
  if (effect.atk) parts.push(t(isDebuff ? 'stat.atkDown' : 'stat.atkUp', { value: effect.atk }));
  if (effect.def) parts.push(t(isDebuff ? 'stat.defDown' : 'stat.defUp', { value: effect.def }));
  return parts.join(t('stat.join'));
}

export function describeEffect(effect, tokenNameOf = (id) => id) {
  const target = effect.target ? t(`target.${effect.target}`) : '';
  switch (effect.op) {
    case 'BUFF':
      return t('op.BUFF', { target, stats: statsText(effect, false) });
    case 'DEBUFF':
      return t('op.DEBUFF', { target, stats: statsText(effect, true) });
    case 'DESTROY_UNIT':
      return effect.maxLevel ? t('op.DESTROY_UNIT.maxLevel', { target, maxLevel: effect.maxLevel }) : t('op.DESTROY_UNIT', { target });
    case 'RETURN_TO_HAND':
      return effect.maxLevel ? t('op.RETURN_TO_HAND.maxLevel', { target, maxLevel: effect.maxLevel }) : t('op.RETURN_TO_HAND', { target });
    case 'GRANT_KEYWORD':
      return t('op.GRANT_KEYWORD', { target, keyword: keywordName(effect.keyword) });
    case 'SUMMON_TOKEN':
      return t('op.SUMMON_TOKEN', { token: tokenNameOf(effect.token), value: effect.value || 1 });
    default:
      return t(`op.${effect.op}`, { target, value: effect.value ?? 0, maxLevel: effect.maxLevel ?? 0 });
  }
}

function sentence(effects, tokenNameOf) {
  return effects.map((e) => describeEffect(e, tokenNameOf)).join('. ');
}

export function describeCondition(condition) {
  if (!condition) return '';
  return t(`cond.${condition.type}`, { value: condition.value ?? '', tag: condition.tag ?? '' });
}

export function triggerLabel(trigger, cardType) {
  if (cardType === 'SPELL') {
    if (trigger === 'ON_TURN_START') return t('trigger.SET_TURN_START');
    if (trigger === 'ON_TURN_END') return t('trigger.SET_TURN_END');
  }
  return t(`trigger.${trigger}`);
}

/** 능력 1개의 [조건]과 [효과] 문장 */
export function describeAbility(ability, cardType, tokenNameOf) {
  const conditionText = [triggerLabel(ability.trigger, cardType), describeCondition(ability.condition)]
    .filter(Boolean)
    .join(', ');
  let effectText = sentence(ability.effects || [], tokenNameOf);
  if (ability.chance != null && ability.chance < 1) {
    effectText = `${t('chance', { value: Math.round(ability.chance * 100) })} ${effectText}.`;
    if (ability.elseEffects && ability.elseEffects.length > 0) {
      effectText += ` ${t('chance.else')} ${sentence(ability.elseEffects, tokenNameOf)}.`;
    }
  } else {
    effectText += '.';
  }
  return { conditionText, effectText };
}

/** 대상 문구: 능력에 등장하는 대상들을 중복 없이 나열 */
export function describeTargets(abilities) {
  const seen = [];
  for (const ab of abilities || []) {
    for (const e of [...(ab.effects || []), ...(ab.elseEffects || [])]) {
      if (e.target && !seen.includes(e.target)) seen.push(e.target);
    }
  }
  return seen.map((tg) => t(`target.${tg}`)).join(', ');
}

// --------------------------------------------------------------------------
// 가치 계산 (공+수 합계 포인트 단위)
// --------------------------------------------------------------------------

function targetMultiplier(target) {
  switch (target) {
    case 'ENEMY_ALL':
      return 2.0;
    case 'ALLY_ALL':
      return 2.2;
    case 'ALLY_OTHERS':
      return 1.8;
    default:
      return 1.0;
  }
}

export function effectCost(effect, tokenStatSumOf = () => 14) {
  const v = effect.value || 0;
  switch (effect.op) {
    case 'DAMAGE_HERO':
      if (effect.target === 'BOTH_HEROES') return -v * 0.1;
      if (effect.target === 'ALLY_HERO') return -v * 0.2; // 자해는 단점이므로 가치를 깎는다
      return v * 0.25;
    case 'DAMAGE_BOTH_HEROES':
      return -v * 0.1;
    case 'HEAL_HERO':
      return v * 0.42;
    case 'DAMAGE_UNIT':
      return v * (effect.target === 'ENEMY_ALL' ? 1.4 : 0.45);
    case 'DESTROY_UNIT':
      if (effect.target === 'ENEMY_ALL') return 30;
      return effect.maxLevel ? 3 + 2.5 * effect.maxLevel : 16;
    case 'BUFF':
      return ((effect.atk || 0) * 0.9 + (effect.def || 0) * 0.6) * targetMultiplier(effect.target);
    case 'DEBUFF':
      return ((effect.atk || 0) * 0.8 + (effect.def || 0) * 0.6) * targetMultiplier(effect.target);
    case 'SHIELD_HERO':
      return v * 0.4;
    case 'DRAW':
      return v * 6;
    case 'EXTRA_SUMMON':
      return v * 2;
    case 'SUMMON_TOKEN':
      return (effect.value || 1) * tokenStatSumOf(effect.token) * 0.5;
    case 'FREEZE':
      return effect.target === 'ENEMY_ALL' ? 3 : 0.8;
    case 'SILENCE':
      return effect.target === 'ENEMY_ALL' ? 9 : 3.5;
    case 'RETURN_TO_HAND':
      return effect.maxLevel ? 3 + 2 * effect.maxLevel : 15;
    case 'GRANT_KEYWORD':
      return (KEYWORDS[effect.keyword]?.cost || 3) * 0.8 * targetMultiplier(effect.target);
    case 'DISCARD_RANDOM':
      return v * 2.5;
    case 'REVIVE':
      return 2 + 2 * (effect.maxLevel || 1);
    case 'SWAP_STATS':
      return 0.5;
    default:
      return 0;
  }
}

const TRIGGER_MULTIPLIER = {
  ON_SUMMON: 1.0,
  INSTANT: 1.0,
  ON_DESTROYED: 0.9,
  ON_ATTACK: 1.4,
  ON_KILL: 0.6,
  ON_TURN_START: 1.8,
  ON_TURN_END: 1.8,
  ON_ATTACKED: 1.0,
  ON_ENEMY_SUMMON: 1.0,
};

export function abilityCost(ability, cardType = 'MONSTER', tokenStatSumOf) {
  const sum = (list) => (list || []).reduce((acc, e) => acc + effectCost(e, tokenStatSumOf), 0);
  let base;
  if (ability.chance != null && ability.chance < 1) {
    // 확률 효과는 운이 좋을 때 판을 뒤집는 폭발력이 있어 기댓값보다 조금 더 비싸게 본다
    base = ability.chance * sum(ability.effects) * 1.3 + (1 - ability.chance) * sum(ability.elseEffects);
  } else {
    base = sum(ability.effects);
  }
  // 마법의 턴 시작/종료 세트 효과는 1회성이므로 반복 배율을 적용하지 않는다.
  const repeating = cardType === 'MONSTER';
  let mult = TRIGGER_MULTIPLIER[ability.trigger] ?? 1.0;
  if (!repeating && (ability.trigger === 'ON_TURN_START' || ability.trigger === 'ON_TURN_END')) mult = 1.0;
  if (ability.condition) mult *= 0.7;
  return base * mult;
}

export function keywordsCost(kwIds = []) {
  return kwIds.reduce((acc, id) => acc + (KEYWORDS[id]?.cost || 0), 0);
}

export { MULTI_TARGETS };

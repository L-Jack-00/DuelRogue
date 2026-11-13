/**
 * 상대 듀얼리스트 AI.
 *
 * 방식: 지금 할 수 있는 행동마다 듀얼 상태를 복제해 실제 규칙으로 적용해 보고,
 * 성향 가중치로 결과를 평가해 가장 좋은 행동을 하나 고른다. 더 나아지는 행동이 없으면 턴을 마친다.
 *
 * 공정성
 * - 복제본에서는 상대의 세트 마법을 '정체 불명'으로 처리해 발동시키지 않는다. 대신 성향의
 *   caution 값만큼 덮인 카드가 있는 곳을 공격하는 행동에 감점을 준다.
 * - 복제본의 난수를 새로 뽑아 확률 효과의 실제 결과를 미리 알 수 없게 한다.
 *   확률 효과는 여러 번 시뮬레이션해 평균(낙관적 성향은 좋은 결과 쪽)으로 본다.
 * - 상대의 손패와 덱 순서는 평가에 쓰지 않는다.
 *
 * 성향 변화: 매 턴 시작에 LP·필드 상황을 보고 확률적으로 성향이 바뀐다. (shiftMood)
 */
import { cloneDuel, legalActions, applyCommand, rand, hasKw } from '../duel/duelCore.js';
import { PERSONALITIES, BASE_PERSONALITY_IDS } from './personalities.js';
import { t } from '../i18n/strings.js';

const MAX_STEPS_PER_TURN = 24;

// --------------------------------------------------------------------------
// 평가
// --------------------------------------------------------------------------

const KW_VALUE = { TAUNT: 2, PIERCE: 3, DIRECT: 4, STEALTH: 2, LIFESTEAL: 2, UNDYING: 3, DIVINE: 2, RETALIATE: 2, BULWARK: 1 };

export function unitValue(u) {
  let v = u.currentAttack * 1.0 + Math.max(0, u.currentDefense) * 0.7 + u.level * 2;
  for (const k of u.kw) v += k === 'DOUBLE' ? u.currentAttack * 0.8 : KW_VALUE[k] || 0;
  if (u.frozenUntilTurn) v -= 2;
  return v;
}

function threatTo(duel, seatIndex) {
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];
  let dmg = 0;
  for (const u of opp.board) {
    const hits = hasKw(u, 'DOUBLE') ? 2 : 1;
    if (me.board.length === 0 || hasKw(u, 'DIRECT')) dmg += u.currentAttack * hits;
    else dmg += u.currentAttack * 0.15 * hits;
  }
  return Math.max(0, dmg - me.barrier);
}

function attackPotential(duel, seatIndex) {
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];
  if (opp.board.length > 0) return me.board.filter((u) => hasKw(u, 'DIRECT')).reduce((a, u) => a + u.currentAttack, 0);
  return me.board.reduce((a, u) => a + u.currentAttack * (hasKw(u, 'DOUBLE') ? 2 : 1), 0);
}

export function evaluate(duel, seatIndex, personality) {
  const w = personality.weights;
  if (duel.status === (seatIndex === 0 ? 'SEAT_0_WIN' : 'SEAT_1_WIN')) return 1e6;
  if (duel.status !== 'ONGOING') return -1e6;
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];

  let score = 0;
  score += w.myLp * (me.lp + me.barrier * 0.6) * 0.55;
  score -= w.oppLp * (opp.lp + opp.barrier * 0.6) * 0.65;
  score += w.myBoard * me.board.reduce((a, u) => a + unitValue(u), 0);
  score -= w.oppBoard * opp.board.reduce((a, u) => a + unitValue(u), 0);
  score += w.hand * me.hand.length * 3.2;
  const mySets = me.setSpells.length + ['left', 'right'].filter((k) => duel.fieldSetSlots[k]?.ownerSeat === seatIndex).length;
  // 세트한 마법은 손패 1장 가치에 '깔아 둔' 가치를 더한다. (세트가 손해로 계산되지 않도록)
  score += mySets * (w.hand * 3.2 + w.setSpell * 2.5);
  score += me.normalSummonsRemaining > 0 ? 0 : 0.5;

  const threat = threatTo(duel, seatIndex);
  score -= w.threat * threat * (1 + 40 / Math.max(10, me.lp));
  if (threat >= me.lp) score -= w.threat * 60;
  if (attackPotential(duel, seatIndex) >= opp.lp) score += w.oppLp * 25;
  return score;
}

// --------------------------------------------------------------------------
// 행동 선택
// --------------------------------------------------------------------------

function hiddenSpellsGuarding(duel, attackerSeat, targetInstanceId) {
  const defSeat = 1 - attackerSeat;
  const def = duel.seats[defSeat];
  let n = ['left', 'right'].filter((k) => duel.fieldSetSlots[k]?.ownerSeat === defSeat).length;
  if (targetInstanceId) n += def.setSpells.filter((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === targetInstanceId).length;
  return n;
}

function actionUsesChance(duel, action, getDef) {
  if (action.type !== 'PLAY_CARD') return false;
  const card = duel.seats[action.seat].hand.find((c) => c.instanceId === action.cardInstanceId);
  if (!card) return false;
  const def = getDef(card.cardId);
  return (def.abilities || []).some((a) => a.chance != null && a.chance < 1);
}

function simulate(duel, action, seatIndex, personality, seed) {
  const sim = cloneDuel(duel, { hideSeat: 1 - seatIndex, reseed: seed });
  try {
    applyCommand(sim, action);
  } catch {
    return null;
  }
  return evaluate(sim, seatIndex, personality);
}

/**
 * 다음 행동 1개를 고른다.
 * @param {object} duel
 * @param {number} seatIndex
 * @param {object} personality PERSONALITIES 항목
 * @param {(id:string)=>object} getDef
 * @returns {object} 듀얼 명령 ({ type: 'END_TURN', ... } 포함)
 */
export function chooseAction(duel, seatIndex, personality, getDef) {
  const actions = legalActions(duel, seatIndex);
  const endAction = actions.find((a) => a.type === 'END_TURN');
  const base = evaluate(duel, seatIndex, personality);
  let best = endAction;
  let bestScore = base + 0.5;

  for (const action of actions) {
    if (action.type === 'END_TURN') continue;
    const samples = actionUsesChance(duel, action, getDef) ? 4 : 1;
    const results = [];
    for (let i = 0; i < samples; i++) {
      const r = simulate(duel, action, seatIndex, personality, Math.floor(rand(duel) * 4294967295));
      if (r != null) results.push(r);
    }
    if (results.length === 0) continue;
    results.sort((a, b) => b - a);
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    let score = mean + (results[0] - mean) * personality.optimism;

    if (action.type === 'ATTACK') {
      const guards = hiddenSpellsGuarding(duel, seatIndex, action.targetInstanceId);
      score -= guards * personality.caution * 9;
    }
    if (personality.noise > 0) score += (rand(duel) - 0.5) * personality.noise * 30;

    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// 성향 변화
// --------------------------------------------------------------------------

/** CPU 정신 상태 초기화 */
export function createMind(profile = {}) {
  const base = profile.personality && PERSONALITIES[profile.personality] ? profile.personality : 'CALCULATING';
  return {
    base,
    current: base,
    turnsInMood: 0,
    volatility: profile.volatility ?? 0.5,
    lastShiftTurn: 0,
    line: '',
    history: [base],
  };
}

function boardPower(duel, seatIndex) {
  return duel.seats[seatIndex].board.reduce((a, u) => a + unitValue(u), 0);
}

function pickLine(id, duel) {
  const lines = t(`mood.${id}.line`).split('|');
  return lines[Math.floor(rand(duel) * lines.length)];
}

/**
 * 턴 시작 시 상황을 보고 성향을 바꿀지 정한다.
 * @returns {{changed: boolean, from: string, to: string, line: string}}
 */
export function shiftMood(duel, seatIndex, mind) {
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];
  const vol = mind.volatility;
  const diff = boardPower(duel, seatIndex) - boardPower(duel, 1 - seatIndex);
  const from = mind.current;
  let to = from;
  const roll = () => rand(duel);

  if (me.lp <= 30 && from !== 'BERSERK' && from !== 'PANIC') {
    if (roll() < 0.55 * vol + 0.15) to = roll() < 0.65 ? 'BERSERK' : 'PANIC';
  } else if ((opp.lp <= 35 || diff > 28) && from !== 'AGGRESSIVE' && from !== 'BERSERK') {
    if (roll() < 0.45 * vol + 0.1) to = 'AGGRESSIVE';
  } else if (diff < -22 && from !== 'DEFENSIVE' && from !== 'TRICKSTER' && from !== 'PANIC') {
    if (roll() < 0.45 * vol + 0.05) to = roll() < 0.5 ? 'DEFENSIVE' : 'TRICKSTER';
  } else if (from !== mind.base && mind.turnsInMood >= 3 && me.lp > 30) {
    if (roll() < 0.35) to = mind.base;
  } else if (roll() < 0.1 * vol) {
    const options = BASE_PERSONALITY_IDS.filter((id) => id !== from);
    to = options[Math.floor(roll() * options.length)];
  }

  if (to !== from) {
    mind.current = to;
    mind.turnsInMood = 0;
    mind.lastShiftTurn = duel.turnNumber;
    mind.line = pickLine(to, duel);
    mind.history.push(to);
    return { changed: true, from, to, line: mind.line };
  }
  mind.turnsInMood += 1;
  return { changed: false, from, to, line: '' };
}

export { MAX_STEPS_PER_TURN, PERSONALITIES };

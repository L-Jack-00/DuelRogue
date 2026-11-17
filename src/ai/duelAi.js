/**
 * 상대 듀얼리스트 AI (룰 기반 전술 AI).
 *
 * 방식: 특정 카드 ID에 의존하지 않고 듀얼 코어 규칙(제물 경제, 3턴 전투 해금,
 * 공격/반사/키워드 판정, 3종 세트 슬롯 타이밍, 불발 회피)만을 바탕으로
 * 상태를 복제·시뮬레이션하여 최적의 수순을 고른다.
 *
 * 공정성
 * - 복제본에서는 상대의 세트 마법을 '정체 불명'으로 처리해 발동시키지 않는다. 대신 성향의
 *   caution 값만큼 덮인 카드가 있는 곳을 공격하는 행동에 감점을 준다.
 * - 복제본의 난수를 새로 뽑아 확률 효과의 실제 결과를 미리 알 수 없게 한다.
 * - 상대의 손패와 덱 순서는 평가에 쓰지 않는다.
 */
import { cloneDuel, legalActions, applyCommand, rand, hasKw, previewAttack } from '../duel/duelCore.js';
import { PERSONALITIES, BASE_PERSONALITY_IDS } from './personalities.js';
import { t } from '../i18n/strings.js';

const MAX_STEPS_PER_TURN = 24;

// --------------------------------------------------------------------------
// 룰 기반 보드 & 키워드 평가
// --------------------------------------------------------------------------

const KW_VALUE = {
  TAUNT: 2.2,
  PIERCE: 3.0,
  DIRECT: 4.0,
  STEALTH: 2.2,
  LIFESTEAL: 2.4,
  UNDYING: 3.4,
  DIVINE: 2.5,
  RETALIATE: 2.2,
  BULWARK: 1.5,
};

export function unitValue(u) {
  let v = u.currentAttack * 1.05 + Math.max(0, u.currentDefense) * 0.72 + u.level * 2.1;
  for (const k of u.kw) {
    if (k === 'DOUBLE') v += u.currentAttack * 0.85;
    else if (k === 'UNDYING') v += u.undyingUsed ? 0 : KW_VALUE.UNDYING;
    else if (k === 'BULWARK') v += KW_VALUE.BULWARK + Math.max(0, u.currentDefense) * 0.14;
    else if (k === 'RETALIATE') v += KW_VALUE.RETALIATE + u.currentAttack * 0.18;
    else if (k === 'LIFESTEAL') v += KW_VALUE.LIFESTEAL + u.currentAttack * 0.15;
    else v += KW_VALUE[k] || 0;
  }
  if (u.frozenUntilTurn) v -= 2.2;
  return v;
}

function threatTo(duel, seatIndex) {
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];
  const iHaveTaunt = me.board.some((u) => hasKw(u, 'TAUNT'));
  let dmg = 0;
  for (const u of opp.board) {
    if (u.frozenUntilTurn && u.frozenUntilTurn >= duel.turnNumber + 1) continue;
    const hits = hasKw(u, 'DOUBLE') ? 2 : 1;
    if (me.board.length === 0 || (hasKw(u, 'DIRECT') && !iHaveTaunt)) dmg += u.currentAttack * hits;
    else dmg += u.currentAttack * 0.16 * hits;
  }
  return Math.max(0, dmg - me.barrier);
}

function attackPotential(duel, seatIndex) {
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];
  if (duel.turnNumber <= 2) return 0;
  if (opp.board.length > 0) {
    return me.board
      .filter((u) => u.canAttack && u.attacksLeft > 0 && hasKw(u, 'DIRECT'))
      .reduce((a, u) => a + u.currentAttack * u.attacksLeft, 0);
  }
  return me.board
    .filter((u) => u.canAttack && u.attacksLeft > 0)
    .reduce((a, u) => a + u.currentAttack * u.attacksLeft, 0);
}

export function evaluate(duel, seatIndex, personality) {
  const w = personality.weights;
  if (duel.status === (seatIndex === 0 ? 'SEAT_0_WIN' : 'SEAT_1_WIN')) return 1e6;
  if (duel.status !== 'ONGOING') return -1e6;
  const me = duel.seats[seatIndex];
  const opp = duel.seats[1 - seatIndex];
  const lateRamp = duel.turnNumber >= 34 ? 1 + (duel.turnNumber - 33) * 0.06 : 1;

  let score = 0;
  score += w.myLp * (me.lp + me.barrier * 0.65) * 0.55;
  score -= w.oppLp * (opp.lp + opp.barrier * 0.65) * 0.65 * lateRamp;
  score += w.myBoard * me.board.reduce((a, u) => a + unitValue(u), 0);
  score -= w.oppBoard * opp.board.reduce((a, u) => a + unitValue(u), 0);

  // 손패 가치 (탈진 직전 덱 고갈 위험이 있으면 손패 초과 가치 완화)
  const handScale = me.deck.length <= 2 ? 2.4 : 3.2;
  score += w.hand * me.hand.length * handScale;

  // 세트 마법 가치: 손패 1장 가치 + 필드에 깔아 둔 압박/타이밍 가치
  const mySets = me.setSpells.length + ['left', 'right'].filter((k) => duel.fieldSetSlots[k]?.ownerSeat === seatIndex).length;
  score += mySets * (w.hand * 3.15 + w.setSpell * 2.5);

  // 소환권/이월 소환권 가치 (1~2턴 준비 단계 및 다음 턴 전개 고려)
  score += me.normalSummonsRemaining > 0 ? 0 : 0.45;
  score += (me.bonusNormalSummons || 0) * 3.6;

  // 공격권 잠재력(남은 공격 횟수가 높은 유닛이 필드에 남아있을 때)
  if (duel.turnNumber >= 3 && duel.activeSeat === seatIndex) {
    const readyPower = me.board
      .filter((u) => u.canAttack && u.attacksLeft > 0)
      .reduce((acc, u) => acc + u.currentAttack * 0.08 * u.attacksLeft, 0);
    score += readyPower;
  }

  const threat = threatTo(duel, seatIndex);
  score -= w.threat * threat * (1 + 40 / Math.max(10, me.lp));
  if (threat >= me.lp) score -= w.threat * 60;
  if (attackPotential(duel, seatIndex) >= opp.lp + opp.barrier) score += w.oppLp * 28;
  return score;
}

// --------------------------------------------------------------------------
// 룰 기반 세트 슬롯 판정 & 행동 평가
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

function collectSpellProfile(def) {
  const effects = (def?.abilities || []).flatMap((a) => [...(a.effects || []), ...(a.elseEffects || [])]);
  const ops = new Set(effects.map((e) => e.op));
  const targets = new Set(effects.map((e) => e.target).filter(Boolean));
  return { ops, targets };
}

function setSlotBonus(duel, action, getDef) {
  if (action.type !== 'SET_SPELL') return 0;
  const seat = duel.seats[action.seat];
  const opp = duel.seats[1 - action.seat];
  const card = seat?.hand.find((c) => c.instanceId === action.cardInstanceId);
  const def = card ? getDef(card.cardId) : null;
  const { ops, targets } = collectSpellProfile(def);

  const isDisruptive =
    ops.has('FREEZE') || ops.has('DAMAGE_UNIT') || ops.has('DESTROY') || ops.has('DEBUFF') || ops.has('SILENCE') || ops.has('DAMAGE_HERO');
  const isCarryover =
    ops.has('EXTRA_SUMMON') || ops.has('DRAW') || ops.has('BUFF') || ops.has('HEAL_HERO') || ops.has('REVIVE') || ops.has('SUMMON_TOKEN');

  if (action.slotType === 'MONSTER_FRONT') {
    const u = seat?.board.find((x) => x.instanceId === action.targetMonsterInstanceId);
    const hasTaunt = u && hasKw(u, 'TAUNT');
    const isHighValue = u && (u.isDeckMaster || u.currentAttack >= 10 || u.level >= 3);
    const attackTriggerBonus = targets.has('ATTACKER') || targets.has('SUMMONED') ? 0.55 : isDisruptive ? 0.35 : 0.08;
    const combatImminent = duel.turnNumber >= 2 && opp.board.length > 0 ? 0.25 : -0.15;
    return attackTriggerBonus + (hasTaunt ? 0.45 : isHighValue ? 0.2 : 0) + combatImminent;
  }

  if (action.slotType === 'FIELD_LEFT') {
    // 상대 턴 시작 시 발동: 상대 공격 전 선제 제압·동결·방벽·토큰 전개에 최적
    let bonus = 0.25;
    if (ops.has('FREEZE') || ops.has('SILENCE')) bonus += 0.55;
    if (isDisruptive) bonus += opp.board.length > 0 ? 0.45 : 0.15;
    if (ops.has('BARRIER') || ops.has('SUMMON_TOKEN')) bonus += 0.35;
    if (duel.turnNumber >= 2 && opp.board.length > 0) bonus += 0.2;
    return bonus;
  }

  // FIELD_RIGHT: 상대 턴 종료 시 발동 -> 바로 내 턴 시작으로 연결됨
  let bonus = 0.3;
  if (ops.has('EXTRA_SUMMON')) bonus += 0.75; // 이월 소환권은 내 턴에 바로 사용 가능
  if (isCarryover) bonus += 0.45;
  if (duel.turnNumber <= 2) bonus += 0.15;
  return bonus;
}

function simulateStep(duel, action, seatIndex, personality, seed) {
  const sim = cloneDuel(duel, { hideSeat: 1 - seatIndex, reseed: seed });
  try {
    applyCommand(sim, action);
  } catch {
    return null;
  }
  const fizzled = sim.events.some((e) => e.kind === 'fizzle');
  let score = evaluate(sim, seatIndex, personality);
  if (fizzled && action.type === 'PLAY_CARD') {
    // 불발되는 즉시 마법 발동은 크게 감점해 세트 또는 대기로 유도
    score -= 12;
  }
  return { sim, score };
}

/**
 * 이번 턴 안에 상대 LP <= 0을 만들 수 있는 즉각 킬 수순(Lethal)의 첫 행동을 탐색한다.
 * (상대 세트 카드는 정체 불명으로 숨겨 공정성 유지)
 */
function findLethalAction(duel, seatIndex) {
  if (duel.turnNumber <= 2 || duel.status !== 'ONGOING') return null;
  const winStatus = seatIndex === 0 ? 'SEAT_0_WIN' : 'SEAT_1_WIN';
  let visited = 0;
  const MAX_NODES = 56;

  function dfs(state, depth, nonAttacksLeft) {
    if (visited++ >= MAX_NODES) return null;
    if (state.status === winStatus) return [];
    if (state.status !== 'ONGOING' || state.activeSeat !== seatIndex || depth >= 5) return null;

    const actions = legalActions(state, seatIndex).filter((a) => a.type !== 'END_TURN');
    // 킬각 후보 우선 정렬: 본체 직공 > 적 처치/관통 공격 > 공격용 마법/소환
    const prioritized = [];
    for (const a of actions) {
      if (a.type === 'ATTACK') {
        const attacker = state.seats[seatIndex].board.find((u) => u.instanceId === a.attackerInstanceId);
        const defender = a.targetInstanceId ? state.seats[1 - seatIndex].board.find((u) => u.instanceId === a.targetInstanceId) : null;
        const prev = previewAttack(state, attacker, defender);
        if (!prev.canAttack) continue;
        if (prev.isLethal) return [a]; // 즉각 킬!
        const prio = a.targetInstanceId === null ? 100 + prev.heroDamage : prev.canKill ? 50 + prev.pierceDamage : 10;
        prioritized.push({ a, prio });
      } else if (a.type === 'PLAY_CARD' && nonAttacksLeft > 0) {
        prioritized.push({ a, prio: 25 });
      }
    }
    prioritized.sort((x, y) => y.prio - x.prio);

    for (const { a } of prioritized.slice(0, 6)) {
      const next = cloneDuel(state, { hideSeat: 1 - seatIndex, reseed: (state.rngState + visited * 7919) >>> 0 });
      try {
        applyCommand(next, a);
      } catch {
        continue;
      }
      if (next.status === winStatus) return [a];
      const sub = dfs(next, depth + 1, a.type === 'ATTACK' ? nonAttacksLeft : nonAttacksLeft - 1);
      if (sub) return [a, ...sub];
    }
    return null;
  }

  const seq = dfs(duel, 0, 2);
  return seq && seq.length > 0 ? seq[0] : null;
}

/**
 * 1수 진행 후 다음 행동 1개까지 추가로 내다보는 2-ply 전술 보정 (카드 ID 비의존).
 * 예: 공격 후 제물 소환, 마법 약화 후 공격, 불굴 1타 벗기기 후 마무리 처치 등
 */
function bestSecondPlyScore(simState, seatIndex, personality, getDef, baseSeed) {
  if (simState.status !== 'ONGOING' || simState.activeSeat !== seatIndex) {
    return evaluate(simState, seatIndex, personality);
  }
  const nextActions = legalActions(simState, seatIndex).filter((a) => a.type !== 'END_TURN');
  if (nextActions.length === 0) return evaluate(simState, seatIndex, personality);

  let best = evaluate(simState, seatIndex, personality);
  const limit = Math.min(nextActions.length, 10);
  for (let i = 0; i < limit; i++) {
    const a2 = nextActions[i];
    const r2 = simulateStep(simState, a2, seatIndex, personality, (baseSeed + i * 97 + 13) >>> 0);
    if (!r2) continue;
    let s2 = r2.score;
    if (a2.type === 'ATTACK') {
      s2 -= hiddenSpellsGuarding(simState, seatIndex, a2.targetInstanceId) * personality.caution * 9;
    } else if (a2.type === 'SET_SPELL') {
      s2 += setSlotBonus(simState, a2, getDef);
    }
    if (s2 > best) best = s2;
  }
  return best;
}

/**
 * 다음 행동 1개를 고른다.
 * @param {object} duel
 * @param {number} seatIndex
 * @param {object} personality PERSONALITIES 항목
 * @param {(id:string)=>object} getDef
 * @param {object} [opts] { beginner?: boolean }
 * @returns {object} 듀얼 명령 ({ type: 'END_TURN', ... } 포함)
 */
export function chooseAction(duel, seatIndex, personality, getDef, opts = {}) {
  const isBeginner = Boolean(opts.beginner);
  if (!isBeginner && duel.turnNumber >= 3) {
    const lethal = findLethalAction(duel, seatIndex);
    if (lethal) return lethal;
  }

  const actions = legalActions(duel, seatIndex);
  const endAction = actions.find((a) => a.type === 'END_TURN');
  const base = evaluate(duel, seatIndex, personality);

  if (isBeginner) {
    // 1라운드 입문자 AI: 2-ply/킬각 탐색을 끄고, 필드를 과도하게 꽉 채우지 않으며 완만한 템포로 플레이
    const myBoardCount = duel.seats[seatIndex].board.length;
    let best = endAction;
    let bestScore = base + 4.2;
    for (const action of actions) {
      if (action.type === 'END_TURN') continue;
      const r = simulateStep(duel, action, seatIndex, personality, Math.floor(rand(duel) * 4294967295));
      if (!r) continue;
      let score = r.score + (rand(duel) - 0.5) * 20;
      if (action.type === 'PLAY_CARD' && myBoardCount >= 2) {
        score -= 4.5; // 필드에 이미 2마리 이상 있으면 전개 속도를 늦춰 뉴비에게 반격 여지 제공
      }
      if (action.type === 'ATTACK') {
        score -= hiddenSpellsGuarding(duel, seatIndex, action.targetInstanceId) * personality.caution * 9;
      }
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }

  const evaluated = [];
  for (const action of actions) {
    if (action.type === 'END_TURN') continue;
    const isChance = actionUsesChance(duel, action, getDef);
    const samples = isChance ? 4 : 1;
    const scores = [];
    let repSim = null;
    for (let i = 0; i < samples; i++) {
      const r = simulateStep(duel, action, seatIndex, personality, Math.floor(rand(duel) * 4294967295));
      if (r) {
        scores.push(r.score);
        if (!repSim || r.score >= scores[0]) repSim = r.sim;
      }
    }
    if (scores.length === 0) continue;
    scores.sort((a, b) => b - a);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    let score = mean + (scores[0] - mean) * personality.optimism;

    if (action.type === 'ATTACK') {
      const guards = hiddenSpellsGuarding(duel, seatIndex, action.targetInstanceId);
      score -= guards * personality.caution * 9;
      // 전투 결과 프리뷰로 유리한/무의미한 자폭 방지
      const attacker = duel.seats[seatIndex].board.find((u) => u.instanceId === action.attackerInstanceId);
      const defender = action.targetInstanceId
        ? duel.seats[1 - seatIndex].board.find((u) => u.instanceId === action.targetInstanceId)
        : null;
      const prev = previewAttack(duel, attacker, defender);
      if (prev.canAttack && defender && !prev.canKill && !prev.survivesUndying && prev.recoilDamage > 0) {
        // 적도 못 죽이고 반사 피해만 입는 공격은 2-ply로 이어지지 않는 한 감점
        score -= prev.recoilDamage * 0.35;
      }
    } else if (action.type === 'SET_SPELL') {
      score += setSlotBonus(duel, action, getDef);
    }
    evaluated.push({ action, score1: score, sim: repSim, isChance });
  }

  // 2-ply 전술 탐색: 상위 공격 2개 + 상위 플레이(소환/마법) 2개 + 전체 상위 4개 합집합에 대해 1수 추가 시뮬레이션
  const topAttack = evaluated.filter((x) => x.action.type === 'ATTACK').sort((a, b) => b.score1 - a.score1).slice(0, 2);
  const topPlay = evaluated.filter((x) => x.action.type === 'PLAY_CARD').sort((a, b) => b.score1 - a.score1).slice(0, 2);
  const topAll = [...evaluated].sort((a, b) => b.score1 - a.score1).slice(0, 4);
  const refineSet = new Set([...topAll, ...topAttack, ...topPlay]);

  let best = endAction;
  let bestScore = base + 0.45;
  for (const cand of evaluated) {
    let finalScore = cand.score1;
    if (refineSet.has(cand) && cand.sim && !cand.isChance && cand.action.type !== 'SET_SPELL') {
      const lookScore = bestSecondPlyScore(cand.sim, seatIndex, personality, getDef, Math.floor(rand(duel) * 1e9));
      finalScore = Math.max(cand.score1, lookScore * 0.995 + cand.score1 * 0.005);
    }
    if (personality.noise > 0) finalScore += (rand(duel) - 0.5) * personality.noise * 24;
    if (finalScore > bestScore) {
      bestScore = finalScore;
      best = cand.action;
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
    isBeginner: Boolean(profile.isBeginner),
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
  if (mind.isBeginner) {
    return { changed: false, from: mind.current, to: mind.current, line: '' };
  }
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

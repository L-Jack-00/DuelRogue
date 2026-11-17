/**
 * 듀얼 규칙 코어.
 *
 * 듀얼 상태(duel 객체)를 받아 규칙대로 바꾸는 함수 모음이다. DOM·오디오·런 진행과 무관하며,
 * 난수도 duel.rngState 하나로만 만든다. 그래서 같은 상태를 복제(cloneDuel)하면 AI가 미래를
 * 시뮬레이션하거나 헤드리스 테스트가 결정론적으로 재현할 수 있다.
 *
 * 핵심 규칙 (CARD_DESIGN_PHILOSOPHY.md)
 * - 마나 없음. 턴당 일반 소환권 1회. Lv1은 제물 없이, Lv2 이상은 제물 필요
 *   (제물 1장: 레벨 차이 1 이하 / 제물 2장 이상: 레벨 합 ≥ 소환 레벨)
 * - 1~2턴은 공격 불가, 3턴부터 전투
 * - 공격력 > 수비력이면 파괴, 수비력 > 공격력이면 차이만큼 공격자 본체가 반사 피해
 * - 상대 필드에 몬스터가 있으면 본체 직접 공격 불가 (직접공격 키워드 예외)
 * - 효과 피해는 수비력을 깎고, 0 이하가 되면 파괴
 * - 마법은 즉시 발동(INSTANT)하거나 세트해 두고 조건이 맞을 때 발동. 대상이 없으면 불발
 *
 * 화면이 소비하는 이벤트는 duel.events에 { key, params, kind, seat } 형태로 쌓인다.
 * 문구는 key로 i18n 사전에서 만든다.
 */
import { t } from '../i18n/strings.js';
import { keywordName } from './keywords.js';
import { isUnitTarget, isManualTarget, UNIT_TARGETS_ENEMY } from './effects.js';

export const MAX_BOARD = 5;
export const MAX_LP = 100;
export const INITIAL_DRAW = 4;
export const DEFAULT_MAX_TURNS = 80;
export const SUDDEN_DEATH_TURN = 40;
const MAX_TRIGGER_DEPTH = 8;

// --------------------------------------------------------------------------
// 난수 (mulberry32, duel 상태 안에 보관)
// --------------------------------------------------------------------------

export function rand(duel) {
  let s = (duel.rngState = (duel.rngState + 0x6d2b79f5) >>> 0);
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
}

function pick(duel, list) {
  if (list.length === 0) return null;
  return list[Math.floor(rand(duel) * list.length)];
}

function shuffle(duel, arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand(duel) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --------------------------------------------------------------------------
// 카드 조회 (듀얼마다 카탈로그 조회 함수를 주입)
// --------------------------------------------------------------------------

const catalogRegistry = { getDef: null };

/** 카드 정의 조회 함수를 등록한다. (duel 객체에 함수를 넣으면 복제가 느려지므로 전역 등록) */
export function registerCatalog(getDef) {
  catalogRegistry.getDef = getDef;
}

function getDef(cardId) {
  const def = catalogRegistry.getDef ? catalogRegistry.getDef(cardId) : null;
  if (!def) throw new Error(`알 수 없는 카드 ID: ${cardId}`);
  return def;
}

// --------------------------------------------------------------------------
// 생성
// --------------------------------------------------------------------------

export function instantiateCard(duel, cardId, ownerSeat) {
  const def = getDef(cardId);
  const kw = [...(def.kw || [])];
  return {
    instanceId: `INST_${duel.instanceSeq++}_${cardId}`,
    cardId: def.id,
    name: def.name,
    ownerSeat,
    type: def.type,
    level: def.level ?? 1,
    cost: def.level ?? 1,
    currentAttack: def.attack ?? 0,
    currentDefense: def.defense ?? 0,
    maxDefense: def.defense ?? 0,
    canAttack: false,
    attacksLeft: 0,
    kw,
    keywords: kw.map(keywordName),
    tags: [...(def.tags || [])],
    silenced: false,
    isGod: !!def.isGod,
    isToken: !!def.isToken,
    isDeckMaster: false,
    summonedTurnNumber: 0,
    frozenUntilTurn: 0,
    condition: def.condition || '',
    target: def.target || '',
    effect: def.effect || '',
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.duelId
 * @param {number} cfg.seed
 * @param {Array<{duelistId, duelistName, isCpu, deckCardIds, deckMasterCardId, luckBias?}>} cfg.seats
 * @param {number} [cfg.maxTurns]
 */
export function createDuel(cfg) {
  const duel = {
    duelId: cfg.duelId,
    seed: cfg.seed,
    rngState: (cfg.seed >>> 0) || 1,
    instanceSeq: 1,
    turnNumber: 1,
    activeSeat: 0,
    firstPlayerSeat: 0,
    round1NoAttack: true,
    turnDecisionReason: '',
    status: 'ONGOING',
    seats: [],
    fieldSetSlots: { left: null, right: null },
    lastAttackResult: null,
    lastSpellTriggerResult: null,
    narrativeLog: '',
    events: [],
    maxTurns: cfg.maxTurns || DEFAULT_MAX_TURNS,
    stats: { summons: 0, stepUps: 0, sumTributes: 0, spells: 0, kills: 0, heroHits: 0 },
  };

  cfg.seats.forEach((s, seatIndex) => {
    const masterId = s.deckMasterCardId || s.deckCardIds[0];
    const pool = [...s.deckCardIds];
    const mIdx = pool.indexOf(masterId);
    if (mIdx !== -1) pool.splice(mIdx, 1);
    const master = instantiateCard(duel, masterId, seatIndex);
    master.isDeckMaster = true;
    const startLp = s.startingLp ?? MAX_LP;
    duel.seats.push({
      seatIndex,
      duelistId: s.duelistId,
      duelistName: s.duelistName,
      isCpu: !!s.isCpu,
      rngLuckBias: s.luckBias || 0,
      lp: startLp,
      maxLp: startLp,
      barrier: 0,
      normalSummonsRemaining: 1,
      bonusNormalSummons: 0,
      deck: shuffle(duel, pool.map((cid) => instantiateCard(duel, cid, seatIndex))),
      hand: [],
      board: [master],
      setSpells: [],
      graveyard: [],
      deckMasterId: masterId,
      fatigue: 0,
    });
  });

  const coin = rand(duel) < 0.5 ? 0 : 1;
  duel.activeSeat = coin;
  duel.firstPlayerSeat = coin;
  duel.turnDecisionReason = `선공 결정 — ${coin === 0 ? '플레이어' : '상대'}가 먼저 시작합니다.`;
  duel.seats[0].board[0].summonedTurnNumber = coin === 0 ? 1 : 2;
  duel.seats[1].board[0].summonedTurnNumber = coin === 1 ? 1 : 2;

  const initialDraw = cfg.initialDraw ?? INITIAL_DRAW;
  for (let i = 0; i < initialDraw; i++) {
    drawCard(duel, duel.seats[0], false);
    drawCard(duel, duel.seats[1], false);
  }
  // 후공 보정: 선공의 템포 이점을 상쇄하도록 후공은 1장 더 들고 시작한다
  if (cfg.secondPlayerBonus !== false) drawCard(duel, duel.seats[1 - coin], false);
  return duel;
}

// --------------------------------------------------------------------------
// 복제 (AI 시뮬레이션용)
// --------------------------------------------------------------------------

function cloneUnit(u) {
  return { ...u, kw: [...u.kw], keywords: [...u.keywords], tags: u.tags };
}

/**
 * 듀얼 상태를 빠르게 복제한다.
 * @param {object} [opts]
 * @param {number} [opts.hideSeat] 이 좌석의 세트 마법을 '정체 불명'으로 바꿔 발동하지 않게 한다. (AI가 상대의 덮인 카드를 엿보지 않도록)
 * @param {number} [opts.reseed] 복제본의 난수를 이 값으로 바꾼다. (확률 효과의 실제 결과를 미리 알지 못하도록)
 */
export function cloneDuel(duel, opts = {}) {
  const copy = {
    ...duel,
    seats: duel.seats.map((s) => ({
      ...s,
      deck: [...s.deck],
      hand: s.hand.map((c) => ({ ...c })),
      board: s.board.map(cloneUnit),
      setSpells: s.setSpells.map((sp) => ({ ...sp })),
      graveyard: [...s.graveyard],
    })),
    fieldSetSlots: {
      left: duel.fieldSetSlots.left ? { ...duel.fieldSetSlots.left } : null,
      right: duel.fieldSetSlots.right ? { ...duel.fieldSetSlots.right } : null,
    },
    events: [],
    stats: { ...duel.stats },
    simulated: true,
  };
  if (opts.hideSeat != null) {
    for (const sp of copy.seats[opts.hideSeat].setSpells) sp.hidden = true;
    for (const k of ['left', 'right']) {
      const sp = copy.fieldSetSlots[k];
      if (sp && sp.ownerSeat === opts.hideSeat) sp.hidden = true;
    }
  }
  if (opts.reseed != null) copy.rngState = opts.reseed >>> 0 || 1;
  return copy;
}

// --------------------------------------------------------------------------
// 공용 도우미
// --------------------------------------------------------------------------

export function hasKw(unit, id) {
  return !unit.silenced && unit.kw.includes(id);
}

function abilitiesOf(unitOrDef) {
  if (unitOrDef.silenced) return [];
  const def = unitOrDef.cardId ? getDef(unitOrDef.cardId) : unitOrDef;
  return def.abilities || [];
}

function other(seatIndex) {
  return seatIndex === 0 ? 1 : 0;
}

function emit(duel, key, params = {}, kind = 'info', seat = null) {
  if (duel.simulated) return;
  duel.events.push({ key, params, kind, seat });
  duel.narrativeLog = t(key, params);
}

function whoName(duel, seatIndex) {
  return duel.seats[seatIndex].duelistName;
}

function findUnit(duel, instanceId) {
  for (const seat of duel.seats) {
    const u = seat.board.find((x) => x.instanceId === instanceId);
    if (u) return { seat, unit: u };
  }
  return null;
}

function isOnBoard(seat, unit) {
  return seat.board.some((u) => u.instanceId === unit.instanceId);
}

export function drawCard(duel, seat, withFatigue = true) {
  let next = seat.deck.shift();
  if (next) {
    // 시뮬레이션 복제본은 덱 카드 객체를 원본과 공유하므로, 뽑을 때 사본을 만들어 원본이 바뀌지 않게 한다
    if (duel.simulated) next = { ...next };
    seat.hand.push(next);
    return next;
  }
  if (withFatigue) {
    seat.fatigue += 1;
    const dmg = seat.fatigue * 5;
    emit(duel, 'event.fatigue', { who: whoName(duel, seat.seatIndex), value: dmg }, 'damage', seat.seatIndex);
    damageHero(duel, seat.seatIndex, dmg, null);
  }
  return null;
}

/** 본체 피해. 보호막이 먼저 흡수한다. 실제로 깎인 LP를 돌려준다. */
export function damageHero(duel, seatIndex, amount, sourceUnit) {
  if (amount <= 0) return 0;
  const seat = duel.seats[seatIndex];
  let remaining = amount;
  if (seat.barrier > 0) {
    const absorbed = Math.min(seat.barrier, remaining);
    seat.barrier -= absorbed;
    remaining -= absorbed;
    emit(duel, 'event.shieldAbsorb', { who: whoName(duel, seatIndex), value: absorbed }, 'shield', seatIndex);
  }
  if (remaining <= 0) return 0;
  const before = seat.lp;
  seat.lp = Math.max(0, seat.lp - remaining);
  const dealt = before - seat.lp;
  emit(duel, 'event.heroDamage', { who: whoName(duel, seatIndex), value: dealt }, 'damage', seatIndex);
  if (sourceUnit && hasKw(sourceUnit, 'LIFESTEAL') && dealt > 0) {
    healHero(duel, sourceUnit.ownerSeat, dealt);
  }
  return dealt;
}

export function healHero(duel, seatIndex, amount) {
  const seat = duel.seats[seatIndex];
  const before = seat.lp;
  seat.lp = Math.min(seat.maxLp, seat.lp + amount);
  if (seat.lp > before) emit(duel, 'event.heroHeal', { who: whoName(duel, seatIndex), value: seat.lp - before }, 'heal', seatIndex);
}

/**
 * 몬스터 파괴. 불굴이면 한 번 버틴다.
 * @returns {boolean} 실제로 필드에서 사라졌는지
 */
export function destroyUnit(duel, unit, depth = 0) {
  const found = findUnit(duel, unit.instanceId);
  if (!found) return false;
  const { seat } = found;
  if (hasKw(unit, 'UNDYING') && !unit.undyingUsed) {
    unit.undyingUsed = true;
    unit.kw = unit.kw.filter((k) => k !== 'UNDYING');
    unit.keywords = unit.kw.map(keywordName);
    unit.currentDefense = 1;
    emit(duel, 'event.undying', { card: unit.name }, 'buff', seat.seatIndex);
    return false;
  }
  seat.board = seat.board.filter((u) => u.instanceId !== unit.instanceId);
  if (!unit.isToken) seat.graveyard.push(unit);
  emit(duel, 'event.destroyed', { card: unit.name }, 'destroy', seat.seatIndex);

  // 몬스터 앞에 세트돼 있던 마법은 대상이 사라져 불발
  const orphaned = seat.setSpells.filter((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === unit.instanceId);
  if (orphaned.length > 0) {
    seat.setSpells = seat.setSpells.filter((s) => !orphaned.includes(s));
    for (const sp of orphaned) {
      sp.fizzled = true;
      sp.fizzleReason = '보호하던 몬스터가 사라져 불발';
      seat.graveyard.push(sp);
      duel.lastSpellTriggerResult = sp;
      emit(duel, 'event.fizzle', { card: sp.name }, 'fizzle', seat.seatIndex);
    }
  }

  runAbilities(duel, unit, seat.seatIndex, 'ON_DESTROYED', { depth: depth + 1 });
  return true;
}

/** 효과 피해(수비력 감소). 신성 몬스터는 상대 효과에 면역 */
function damageUnitByEffect(duel, unit, amount, sourceSeat, depth) {
  if (amount <= 0) return;
  if (unit.ownerSeat !== sourceSeat && hasKw(unit, 'DIVINE')) return;
  unit.currentDefense -= amount;
  if (unit.currentDefense <= 0) destroyUnit(duel, unit, depth);
}

// --------------------------------------------------------------------------
// 조건 / 대상 선택
// --------------------------------------------------------------------------

function checkCondition(duel, condition, ownerSeat, sourceUnit) {
  if (!condition) return true;
  const me = duel.seats[ownerSeat];
  const opp = duel.seats[other(ownerSeat)];
  const v = condition.value ?? 0;
  switch (condition.type) {
    case 'selfLpBelow':
      return me.lp <= v;
    case 'enemyLpBelow':
      return opp.lp <= v;
    case 'enemyBoardAtLeast':
      return opp.board.length >= v;
    case 'allyBoardAtLeast':
      return me.board.length >= v;
    case 'handAtMost':
      return me.hand.length <= v;
    case 'allyTagAtLeast':
      return me.board.filter((u) => u !== sourceUnit && u.instanceId !== sourceUnit?.instanceId && u.tags.includes(condition.tag)).length >= v;
    case 'behindOnBoard':
      return opp.board.length > me.board.length;
    default:
      return true;
  }
}

/** 효과 대상 몬스터 목록. 상대 신성 몬스터는 제외 */
function resolveUnitTargets(duel, target, ownerSeat, ctx) {
  const me = duel.seats[ownerSeat];
  const opp = duel.seats[other(ownerSeat)];
  const enemies = opp.board.filter((u) => !hasKw(u, 'DIVINE'));
  switch (target) {
    case 'SELF':
      return ctx.source && isOnBoard(me, ctx.source) ? [ctx.source] : [];
    case 'ALLY_ALL':
      return [...me.board];
    case 'ALLY_OTHERS':
      return me.board.filter((u) => u.instanceId !== ctx.source?.instanceId);
    case 'ALLY_RANDOM': {
      const u = pick(duel, me.board);
      return u ? [u] : [];
    }
    case 'ALLY_WEAKEST': {
      const sorted = [...me.board].sort((a, b) => a.currentDefense - b.currentDefense);
      return sorted.length ? [sorted[0]] : [];
    }
    case 'ENEMY_ALL':
      return enemies;
    case 'ENEMY_RANDOM': {
      const u = pick(duel, enemies);
      return u ? [u] : [];
    }
    case 'ENEMY_STRONGEST': {
      const sorted = [...enemies].sort((a, b) => b.currentAttack - a.currentAttack || b.level - a.level);
      return sorted.length ? [sorted[0]] : [];
    }
    case 'ENEMY_WEAKEST': {
      const sorted = [...enemies].sort((a, b) => a.currentDefense - b.currentDefense);
      return sorted.length ? [sorted[0]] : [];
    }
    case 'ENEMY_HIGHEST_LEVEL': {
      const sorted = [...enemies].sort((a, b) => b.level - a.level || b.currentAttack - a.currentAttack);
      return sorted.length ? [sorted[0]] : [];
    }
    case 'ATTACKER':
    case 'SUMMONED': {
      // 반응 발동(MONSTER_FRONT / FIELD_RIGHT)이면 해당 유발 유닛을 지목하고,
      // 즉시 발동 또는 턴 시작(FIELD_LEFT)처럼 유발 유닛이 없을 때는 가장 강한 적을 지목한다.
      const primary = target === 'ATTACKER' ? ctx.attacker : ctx.summoned;
      const secondary = target === 'ATTACKER' ? ctx.summoned : ctx.attacker;
      const triggerUnit = primary || secondary;
      if (triggerUnit) {
        const f = findUnit(duel, triggerUnit.instanceId);
        if (!f || f.seat.seatIndex === ownerSeat) return [];
        return hasKw(triggerUnit, 'DIVINE') ? [] : [f.unit];
      }
      const sorted = [...enemies].sort((a, b) => b.currentAttack - a.currentAttack || b.level - a.level);
      return sorted.length ? [sorted[0]] : [];
    }
    case 'CHOSEN_ENEMY':
    case 'CHOSEN_ALLY':
    case 'CHOSEN_UNIT':
    case 'CHOSEN_ANY': {
      const ct = ctx.chosenTarget;
      const targetId = typeof ct === 'string' ? ct : ct?.type === 'UNIT' ? ct.instanceId : null;
      if (targetId) {
        const f = findUnit(duel, targetId);
        if (!f) return [];
        const isAlly = f.seat.seatIndex === ownerSeat;
        if (target === 'CHOSEN_ALLY' && !isAlly) return [];
        if (target === 'CHOSEN_ENEMY' && isAlly) return [];
        if (!isAlly && hasKw(f.unit, 'DIVINE')) return [];
        return [f.unit];
      }
      if (ct?.type === 'HERO') return [];
      // 세트 마법 자동 발동 등 수동 지정 없이 발동된 경우 규칙상 기본 폴백
      if (target === 'CHOSEN_ALLY') {
        const sorted = [...me.board].sort((a, b) => a.currentDefense - b.currentDefense);
        return sorted.length ? [sorted[0]] : [];
      }
      const trig = ctx.attacker || ctx.summoned;
      if (trig) {
        const f = findUnit(duel, trig.instanceId);
        if (f && f.seat.seatIndex !== ownerSeat && !hasKw(f.unit, 'DIVINE')) return [f.unit];
      }
      const sorted = [...enemies].sort((a, b) => b.currentAttack - a.currentAttack || b.level - a.level);
      return sorted.length ? [sorted[0]] : [];
    }
    default:
      return [];
  }
}

/** 효과가 지금 대상을 가질 수 있는지 (불발 판정용) */
function effectHasTarget(duel, effect, ownerSeat, ctx) {
  if (effect.op === 'REVIVE') {
    const me = duel.seats[ownerSeat];
    return me.board.length < MAX_BOARD && me.graveyard.some((c) => c.type === 'MONSTER' && (c.level ?? 1) <= (effect.maxLevel || 1));
  }
  if (effect.op === 'SUMMON_TOKEN') return duel.seats[ownerSeat].board.length < MAX_BOARD;
  if (effect.op === 'DISCARD_RANDOM') return duel.seats[other(ownerSeat)].hand.length > 0;
  if (effect.target === 'CHOSEN_ANY' && ctx.chosenTarget?.type === 'HERO') {
    return effect.op === 'DAMAGE_UNIT' || effect.op === 'DAMAGE_HERO' || effect.op === 'HEAL_HERO';
  }
  if (!effect.target || !isUnitTarget(effect.target)) return true;
  let units = resolveUnitTargetsPreview(duel, effect.target, ownerSeat, ctx);
  if (effect.maxLevel) units = units.filter((u) => u.level <= effect.maxLevel);
  if (effect.op === 'RETURN_TO_HAND' && isManualTarget(effect.target)) {
    units = units.filter((u) => !u.isDeckMaster);
  }
  return units.length > 0;
}

/** 난수를 소비하지 않는 대상 존재 확인 */
function resolveUnitTargetsPreview(duel, target, ownerSeat, ctx) {
  if (target === 'ALLY_RANDOM') return [...duel.seats[ownerSeat].board];
  if (target === 'ENEMY_RANDOM') return duel.seats[other(ownerSeat)].board.filter((u) => !hasKw(u, 'DIVINE'));
  return resolveUnitTargets(duel, target, ownerSeat, ctx);
}

/**
 * 카드가 필드에 낸 뒤 수동으로 대상을 고르는 카드인지 판단하고,
 * 선택 가능한 합법 대상(유닛 ID 목록 / 본체 시트 목록)을 돌려준다.
 */
export function getManualTargetSpec(duel, defOrUnit, ownerSeat, excludeInstanceIds = []) {
  if (!duel || !defOrUnit) return null;
  const def = defOrUnit.cardId ? getDef(defOrUnit.cardId) : defOrUnit;
  const isMonster = def.type === 'MONSTER';
  const relevantAbilities = (def.abilities || []).filter((ab) => !isMonster || ab.trigger === 'ON_SUMMON');

  let primaryEffect = null;
  for (const ab of relevantAbilities) {
    for (const ef of [...(ab.effects || []), ...(ab.elseEffects || [])]) {
      if (isManualTarget(ef.target)) {
        primaryEffect = ef;
        break;
      }
    }
    if (primaryEffect) break;
  }
  if (!primaryEffect) return null;

  const me = duel.seats[ownerSeat];
  const oppSeat = other(ownerSeat);
  const opp = duel.seats[oppSeat];
  const excluded = new Set(excludeInstanceIds || []);
  const filterUnit = (u, isEnemy) => {
    if (excluded.has(u.instanceId)) return false;
    if (isEnemy && hasKw(u, 'DIVINE')) return false;
    if (primaryEffect.maxLevel && u.level > primaryEffect.maxLevel) return false;
    if (primaryEffect.op === 'RETURN_TO_HAND' && u.isDeckMaster) return false;
    return true;
  };

  const selector = primaryEffect.target;
  const unitIds = [];
  if (selector === 'CHOSEN_ALLY' || selector === 'CHOSEN_UNIT' || selector === 'CHOSEN_ANY') {
    for (const u of me.board) if (filterUnit(u, false)) unitIds.push(u.instanceId);
  }
  if (selector === 'CHOSEN_ENEMY' || selector === 'CHOSEN_UNIT' || selector === 'CHOSEN_ANY') {
    for (const u of opp.board) if (filterUnit(u, true)) unitIds.push(u.instanceId);
  }

  const heroSeats = [];
  if (selector === 'CHOSEN_ANY' && (primaryEffect.op === 'DAMAGE_UNIT' || primaryEffect.op === 'DAMAGE_HERO' || primaryEffect.op === 'HEAL_HERO')) {
    heroSeats.push(oppSeat, ownerSeat);
  }

  const polarity =
    selector === 'CHOSEN_ALLY' ? 'GREEN' : selector === 'CHOSEN_ENEMY' ? 'RED' : 'PURPLE';

  return {
    selector,
    op: primaryEffect.op,
    maxLevel: primaryEffect.maxLevel || null,
    allowHero: heroSeats.length > 0,
    unitIds,
    heroSeats,
    polarity,
  };
}

// --------------------------------------------------------------------------
// 효과 실행
// --------------------------------------------------------------------------

function applyEffect(duel, effect, ownerSeat, ctx) {
  const opp = other(ownerSeat);
  const depth = ctx.depth || 0;
  const v = effect.value || 0;
  switch (effect.op) {
    case 'DAMAGE_HERO':
      if (effect.target === 'ALLY_HERO') damageHero(duel, ownerSeat, v, null);
      else if (effect.target === 'BOTH_HEROES') {
        damageHero(duel, ownerSeat, v, null);
        damageHero(duel, opp, v, null);
      } else if (effect.target === 'CHOSEN_ANY' && ctx.chosenTarget?.type === 'HERO') {
        damageHero(duel, ctx.chosenTarget.seat, v, ctx.source && ctx.source.type === 'MONSTER' ? ctx.source : null);
      } else damageHero(duel, opp, v, ctx.source && ctx.source.type === 'MONSTER' ? ctx.source : null);
      break;
    case 'DAMAGE_BOTH_HEROES':
      damageHero(duel, ownerSeat, v, null);
      damageHero(duel, opp, v, null);
      break;
    case 'HEAL_HERO':
      healHero(duel, effect.target === 'CHOSEN_ANY' && ctx.chosenTarget?.type === 'HERO' ? ctx.chosenTarget.seat : ownerSeat, v);
      break;
    case 'SHIELD_HERO':
      duel.seats[ownerSeat].barrier += v;
      break;
    case 'DAMAGE_UNIT':
      if (effect.target === 'CHOSEN_ANY' && ctx.chosenTarget?.type === 'HERO') {
        damageHero(duel, ctx.chosenTarget.seat, v, ctx.source && ctx.source.type === 'MONSTER' ? ctx.source : null);
      } else {
        for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) damageUnitByEffect(duel, u, v, ownerSeat, depth);
      }
      break;
    case 'DESTROY_UNIT': {
      let units = resolveUnitTargets(duel, effect.target, ownerSeat, ctx);
      if (effect.maxLevel) {
        if (isManualTarget(effect.target)) {
          units = units.filter((u) => u.level <= effect.maxLevel);
        } else {
          units = duel.seats[opp].board.filter((u) => !hasKw(u, 'DIVINE') && u.level <= effect.maxLevel);
          units.sort((a, b) => b.level - a.level || b.currentAttack - a.currentAttack);
          units = units.slice(0, 1);
        }
      }
      for (const u of units) destroyUnit(duel, u, depth);
      break;
    }
    case 'BUFF':
      for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) {
        u.currentAttack += effect.atk || 0;
        u.currentDefense += effect.def || 0;
        u.maxDefense += effect.def || 0;
      }
      break;
    case 'DEBUFF':
      for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) {
        u.currentAttack = Math.max(0, u.currentAttack - (effect.atk || 0));
        if (effect.def) damageUnitByEffect(duel, u, effect.def, ownerSeat, depth);
      }
      break;
    case 'DRAW':
      for (let i = 0; i < v; i++) drawCard(duel, duel.seats[ownerSeat]);
      break;
    case 'EXTRA_SUMMON': {
      const amount = v || 1;
      if (duel.activeSeat === ownerSeat) {
        duel.seats[ownerSeat].normalSummonsRemaining += amount;
      } else {
        // 상대 턴 중 발동(피격·중앙 세트)한 추가 소환권은 소유자의 다음 턴 시작 시 반영
        duel.seats[ownerSeat].bonusNormalSummons = (duel.seats[ownerSeat].bonusNormalSummons || 0) + amount;
      }
      break;
    }
    case 'SUMMON_TOKEN': {
      const me = duel.seats[ownerSeat];
      for (let i = 0; i < (v || 1) && me.board.length < MAX_BOARD; i++) {
        const tok = instantiateCard(duel, effect.token, ownerSeat);
        tok.summonedTurnNumber = duel.turnNumber;
        tok.canAttack = false;
        tok.attacksLeft = 0;
        me.board.push(tok);
        emit(duel, 'event.summon', { who: whoName(duel, ownerSeat), card: tok.name }, 'summon', ownerSeat);
      }
      break;
    }
    case 'FREEZE':
      for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) {
        // 상대의 다음 턴까지 공격 불가
        u.frozenUntilTurn = duel.turnNumber + (duel.activeSeat === u.ownerSeat ? 2 : 1);
        if (duel.activeSeat === u.ownerSeat) {
          u.canAttack = false;
          u.attacksLeft = 0;
        }
      }
      break;
    case 'SILENCE':
      for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) {
        u.silenced = true;
        u.kw = [];
        u.keywords = [];
      }
      break;
    case 'RETURN_TO_HAND': {
      let units = resolveUnitTargets(duel, effect.target, ownerSeat, ctx);
      if (effect.maxLevel) {
        if (isManualTarget(effect.target)) {
          units = units.filter((u) => u.level <= effect.maxLevel && !u.isDeckMaster);
        } else {
          units = duel.seats[opp].board.filter((u) => !hasKw(u, 'DIVINE') && u.level <= effect.maxLevel && !u.isDeckMaster);
          units.sort((a, b) => b.level - a.level);
          units = units.slice(0, 1);
        }
      } else if (isManualTarget(effect.target)) {
        units = units.filter((u) => !u.isDeckMaster);
      }
      for (const u of units) {
        const f = findUnit(duel, u.instanceId);
        if (!f) continue;
        f.seat.board = f.seat.board.filter((x) => x.instanceId !== u.instanceId);
        if (u.isToken) continue;
        const fresh = instantiateCard(duel, u.cardId, f.seat.seatIndex);
        if (f.seat.hand.length < 10) f.seat.hand.push(fresh);
        else f.seat.graveyard.push(fresh);
      }
      break;
    }
    case 'GRANT_KEYWORD':
      for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) {
        if (!u.kw.includes(effect.keyword)) {
          u.kw.push(effect.keyword);
          u.keywords = u.kw.map(keywordName);
          if (effect.keyword === 'DOUBLE' && u.canAttack) u.attacksLeft += 1;
        }
      }
      break;
    case 'DISCARD_RANDOM': {
      const target = duel.seats[opp];
      for (let i = 0; i < v && target.hand.length > 0; i++) {
        const idx = Math.floor(rand(duel) * target.hand.length);
        target.graveyard.push(target.hand.splice(idx, 1)[0]);
      }
      break;
    }
    case 'REVIVE': {
      const me = duel.seats[ownerSeat];
      const options = me.graveyard.filter((c) => c.type === 'MONSTER' && (c.level ?? 1) <= (effect.maxLevel || 1));
      const chosen = pick(duel, options);
      if (chosen && me.board.length < MAX_BOARD) {
        me.graveyard.splice(me.graveyard.indexOf(chosen), 1);
        const fresh = instantiateCard(duel, chosen.cardId, ownerSeat);
        fresh.summonedTurnNumber = duel.turnNumber;
        me.board.push(fresh);
        emit(duel, 'event.summon', { who: whoName(duel, ownerSeat), card: fresh.name }, 'summon', ownerSeat);
      }
      break;
    }
    case 'SWAP_STATS':
      for (const u of resolveUnitTargets(duel, effect.target, ownerSeat, ctx)) {
        const a = u.currentAttack;
        u.currentAttack = Math.max(0, u.currentDefense);
        u.currentDefense = a;
        u.maxDefense = Math.max(u.maxDefense, a);
        if (u.currentDefense <= 0) destroyUnit(duel, u, depth);
      }
      break;
    default:
      break;
  }
}

/**
 * 능력 1개를 실행한다.
 * @returns {'resolved' | 'fizzled' | 'skipped'}
 */
function resolveAbility(duel, ability, ownerSeat, ctx, cardName) {
  if ((ctx.depth || 0) > MAX_TRIGGER_DEPTH) return 'skipped';
  if (!checkCondition(duel, ability.condition, ownerSeat, ctx.source)) return 'skipped';

  let effects = ability.effects || [];
  if (ability.chance != null && ability.chance < 1) {
    const luck = duel.seats[ownerSeat].rngLuckBias || 0;
    const success = rand(duel) < Math.min(0.97, ability.chance + luck);
    effects = success ? ability.effects || [] : ability.elseEffects || [];
    emit(duel, success ? 'event.chanceWin' : 'event.chanceFail', { card: cardName }, success ? 'buff' : 'fizzle', ownerSeat);
    if (effects.length === 0) return 'resolved';
  }

  const anyTarget = effects.some((e) => effectHasTarget(duel, e, ownerSeat, ctx));
  if (!anyTarget) return 'fizzled';
  for (const e of effects) {
    if (duel.status !== 'ONGOING' && !duel.simulated) break;
    applyEffect(duel, e, ownerSeat, ctx);
  }
  return 'resolved';
}

/** 몬스터의 특정 트리거 능력을 모두 실행 */
function runAbilities(duel, unit, ownerSeat, trigger, ctx = {}) {
  const abilities = abilitiesOf(unit).filter((a) => a.trigger === trigger);
  for (const ab of abilities) {
    const result = resolveAbility(duel, ab, ownerSeat, { ...ctx, source: unit }, unit.name);
    if (result === 'resolved') emit(duel, 'event.trigger', { card: unit.name }, 'trigger', ownerSeat);
    checkWinner(duel);
  }
}

// --------------------------------------------------------------------------
// 세트 마법 (장소 기반 발동 타이밍)
// --------------------------------------------------------------------------

/** 세트 슬롯별 고정 발동 타이밍 */
export const SET_SLOT_TIMINGS = {
  MONSTER_FRONT: 'ON_ATTACKED',
  FIELD_LEFT: 'ON_OPPONENT_TURN_START',
  FIELD_RIGHT: 'ON_OPPONENT_TURN_END',
};

/**
 * 세트 장소의 타이밍에 맞는 세트 마법 1장을 발동한다.
 * - MONSTER_FRONT: 해당 몬스터가 공격받을 때(ON_ATTACKED)
 * - FIELD_LEFT: 상대의 턴 시작 시(ON_OPPONENT_TURN_START)
 * - FIELD_RIGHT: 상대의 턴 종료 시(ON_OPPONENT_TURN_END)
 */
export function triggerSetSpell(duel, timing, ownerSeat, ctx = {}) {
  const owner = duel.seats[ownerSeat];
  let spell = null;
  let removeFn = null;

  if (timing === 'ON_ATTACKED' && ctx.targetUnit) {
    const idx = owner.setSpells.findIndex(
      (s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === ctx.targetUnit.instanceId && !s.hidden
    );
    if (idx !== -1) {
      spell = owner.setSpells[idx];
      removeFn = () => owner.setSpells.splice(owner.setSpells.indexOf(spell), 1);
    }
  } else if (timing === 'ON_OPPONENT_TURN_START') {
    const s = duel.fieldSetSlots.left;
    if (s && s.ownerSeat === ownerSeat && !s.hidden) {
      spell = s;
      removeFn = () => {
        duel.fieldSetSlots.left = null;
      };
    }
  } else if (timing === 'ON_OPPONENT_TURN_END') {
    const s = duel.fieldSetSlots.right;
    if (s && s.ownerSeat === ownerSeat && !s.hidden) {
      spell = s;
      removeFn = () => {
        duel.fieldSetSlots.right = null;
      };
    }
  }
  if (!spell) return null;

  removeFn();
  owner.graveyard.push(spell);
  const def = getDef(spell.cardId);
  let result = 'fizzled';
  for (const ab of def.abilities || []) {
    const r = resolveAbility(duel, ab, ownerSeat, { ...ctx, depth: (ctx.depth || 0) + 1 }, spell.name);
    if (r === 'resolved') result = 'resolved';
    checkWinner(duel);
  }
  spell.isFlipped = true;
  spell.fizzled = result !== 'resolved';
  spell.fizzleReason = spell.fizzled ? '대상이 존재하지 않아 불발' : '';
  duel.lastSpellTriggerResult = spell;
  emit(duel, spell.fizzled ? 'event.fizzle' : 'event.trigger', { card: spell.name }, spell.fizzled ? 'fizzle' : 'trigger', ownerSeat);
  duel.stats.spells += 1;
  return spell;
}

// --------------------------------------------------------------------------
// 승패
// --------------------------------------------------------------------------

export function checkWinner(duel) {
  if (duel.status !== 'ONGOING') return duel.status;
  const [a, b] = duel.seats;
  if (b.lp <= 0 && a.lp <= 0) {
    duel.status = duel.activeSeat === 0 ? 'SEAT_1_WIN' : 'SEAT_0_WIN';
  } else if (b.lp <= 0) duel.status = 'SEAT_0_WIN';
  else if (a.lp <= 0) duel.status = 'SEAT_1_WIN';
  return duel.status;
}

// --------------------------------------------------------------------------
// 공격 대상 규칙
// --------------------------------------------------------------------------

/** 공격 대상으로 지정할 수 있는 상대 몬스터 */
export function attackableTargets(duel, attackerSeat) {
  const opp = duel.seats[other(attackerSeat)];
  const allStealth = opp.board.length > 0 && opp.board.every((u) => hasKw(u, 'STEALTH'));
  const visible = opp.board.filter((u) => !hasKw(u, 'STEALTH') || allStealth);
  const taunts = visible.filter((u) => hasKw(u, 'TAUNT'));
  return taunts.length > 0 ? taunts : visible;
}

export function canAttackHero(duel, attacker) {
  const opp = duel.seats[other(attacker.ownerSeat)];
  return opp.board.length === 0 || hasKw(attacker, 'DIRECT');
}

/**
 * 공격 전 예상 전투 결과를 규칙 그대로 계산한다. (화면 공격 프리뷰 · AI 공용)
 * @param {object} duel
 * @param {object} attacker
 * @param {object|null} defender null이면 상대 본체 직접 공격
 */
export function previewAttack(duel, attacker, defender = null) {
  if (!duel || duel.status !== 'ONGOING') return { canAttack: false, reason: '진행 중인 듀얼이 없습니다.' };
  if (duel.turnNumber <= 2) return { canAttack: false, reason: '1~2턴은 준비 단계입니다. 3턴부터 공격할 수 있습니다.' };
  if (!attacker || !attacker.canAttack || attacker.attacksLeft <= 0) {
    return { canAttack: false, reason: '이 몬스터는 지금 공격할 수 없습니다.' };
  }

  const oppSeat = other(attacker.ownerSeat);
  const opp = duel.seats[oppSeat];
  if (!defender) {
    if (!canAttackHero(duel, attacker)) {
      return { canAttack: false, reason: '상대 필드에 몬스터가 있어 본체를 직접 공격할 수 없습니다.' };
    }
    const heroDamage = attacker.currentAttack;
    const effectiveHp = opp.lp + (opp.barrier || 0);
    return {
      canAttack: true,
      targetType: 'HERO',
      canKill: heroDamage >= effectiveHp,
      isLethal: heroDamage >= effectiveHp,
      heroDamage,
      recoilDamage: 0,
      pierceDamage: 0,
      retaliateDamage: 0,
      survivesUndying: false,
      attackerDies: false,
    };
  }

  const legal = attackableTargets(duel, attacker.ownerSeat);
  if (!legal.some((u) => u.instanceId === defender.instanceId)) {
    const reason = legal.some((u) => hasKw(u, 'TAUNT'))
      ? '상대의 도발 몬스터부터 공격해야 합니다.'
      : '은신한 몬스터는 공격 대상으로 지정할 수 없습니다.';
    return { canAttack: false, targetType: 'UNIT', reason };
  }

  const atk = attacker.currentAttack;
  const def = defender.currentDefense;
  if (atk > def) {
    const undying = hasKw(defender, 'UNDYING') && !defender.undyingUsed;
    const overkill = atk - def;
    const pierceDamage = !undying && hasKw(attacker, 'PIERCE') && overkill > 0 ? overkill : 0;
    const effectiveHp = opp.lp + (opp.barrier || 0);
    return {
      canAttack: true,
      targetType: 'UNIT',
      canKill: !undying,
      survivesUndying: undying,
      overkill,
      pierceDamage,
      heroDamage: pierceDamage,
      isLethal: pierceDamage >= effectiveHp,
      recoilDamage: 0,
      retaliateDamage: 0,
      attackerDies: false,
    };
  }

  let recoil = def - atk;
  if (recoil > 0 && hasKw(defender, 'BULWARK')) recoil *= 2;
  const retaliateDamage = hasKw(defender, 'RETALIATE') && defender.currentAttack > 0 ? defender.currentAttack : 0;
  const attackerDies = retaliateDamage > 0 && attacker.currentDefense - retaliateDamage <= 0 && !(hasKw(attacker, 'UNDYING') && !attacker.undyingUsed);
  return {
    canAttack: true,
    targetType: 'UNIT',
    canKill: false,
    survivesUndying: false,
    overkill: 0,
    pierceDamage: 0,
    heroDamage: 0,
    isLethal: false,
    recoilDamage: recoil,
    retaliateDamage,
    attackerDies,
  };
}

// --------------------------------------------------------------------------
// 명령 처리
// --------------------------------------------------------------------------

function assertActive(duel, seat) {
  if (duel.status !== 'ONGOING') throw new Error('진행 중인 듀얼이 없습니다.');
  if (seat !== duel.activeSeat) throw new Error(`턴 순서 불일치: 현재 ${duel.activeSeat}번 시트의 턴입니다.`);
}

export function summonMonster(duel, seatIndex, cardInstanceId, tributeInstanceIds = [], chosenTarget = null) {
  assertActive(duel, seatIndex);
  const actor = duel.seats[seatIndex];
  const handIdx = actor.hand.findIndex((c) => c.instanceId === cardInstanceId);
  if (handIdx === -1) throw new Error(`손패에서 카드 ${cardInstanceId}를 찾을 수 없습니다.`);
  const card = actor.hand[handIdx];
  if (card.type !== 'MONSTER') throw new Error('몬스터 카드만 소환할 수 있습니다.');
  if (actor.normalSummonsRemaining <= 0) throw new Error('이번 턴 일반 소환권을 이미 모두 사용했습니다. (소환권: 0/1)');

  const level = card.level;
  let tributes = [];
  if (level === 1) {
    if (actor.board.length >= MAX_BOARD) throw new Error('필드가 가득 차 더 이상 몬스터를 소환할 수 없습니다. (최대 5마리)');
  } else {
    if (!tributeInstanceIds || tributeInstanceIds.length === 0) {
      throw new Error(`★Lv.${level} 몬스터를 소환하려면 필드의 몬스터를 제물로 바쳐야 합니다.`);
    }
    for (const tid of tributeInstanceIds) {
      const u = actor.board.find((x) => x.instanceId === tid);
      if (!u) throw new Error(`지정된 제물 몬스터(${tid})가 필드에 존재하지 않습니다.`);
      if (!tributes.includes(u)) tributes.push(u);
    }
    if (tributes.length === 1) {
      const sac = tributes[0].level;
      if (level - sac > 1) {
        throw new Error(
          `단일 제물로는 1단계 높은 레벨(★Lv.${sac + 1})까지만 진화 소환할 수 있습니다. ★Lv.${level} 소환에는 제물 레벨 합산(${sac}/${level})이 부족합니다.`
        );
      }
      duel.stats.stepUps += 1;
    } else {
      const sum = tributes.reduce((a, u) => a + u.level, 0);
      if (sum < level) throw new Error(`제물 몬스터들의 레벨 합산(★Lv.${sum})이 소환 대상 레벨(★Lv.${level})보다 부족합니다.`);
      duel.stats.sumTributes += 1;
    }
  }

  actor.hand.splice(handIdx, 1);
  actor.normalSummonsRemaining -= 1;
  if (tributes.length > 0) {
    emit(duel, 'event.tribute', { who: whoName(duel, seatIndex), cards: tributes.map((u) => u.name).join(', ') }, 'tribute', seatIndex);
    for (const u of tributes) {
      actor.board = actor.board.filter((x) => x.instanceId !== u.instanceId);
      if (!u.isToken) actor.graveyard.push(u);
      const orphaned = actor.setSpells.filter((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === u.instanceId);
      for (const sp of orphaned) {
        actor.setSpells.splice(actor.setSpells.indexOf(sp), 1);
        sp.fizzled = true;
        sp.fizzleReason = '보호하던 몬스터가 제물로 바쳐져 불발';
        actor.graveyard.push(sp);
        duel.lastSpellTriggerResult = sp;
      }
    }
  }

  card.summonedTurnNumber = duel.turnNumber;
  card.canAttack = duel.turnNumber >= 3;
  card.attacksLeft = card.canAttack ? (hasKw(card, 'DOUBLE') ? 2 : 1) : 0;
  actor.board.push(card);
  duel.stats.summons += 1;
  emit(duel, 'event.summon', { who: whoName(duel, seatIndex), card: card.name }, 'summon', seatIndex);

  runAbilities(duel, card, seatIndex, 'ON_SUMMON', { chosenTarget });
  checkWinner(duel);
  return card;
}

export function playSpell(duel, seatIndex, cardInstanceId, chosenTarget = null) {
  assertActive(duel, seatIndex);
  const actor = duel.seats[seatIndex];
  const handIdx = actor.hand.findIndex((c) => c.instanceId === cardInstanceId);
  if (handIdx === -1) throw new Error(`손패에서 카드 ${cardInstanceId}를 찾을 수 없습니다.`);
  const card = actor.hand[handIdx];
  const def = getDef(card.cardId);
  if (def.type !== 'SPELL') throw new Error('마법 카드만 발동할 수 있습니다.');

  actor.hand.splice(handIdx, 1);
  actor.graveyard.push(card);
  emit(duel, 'event.spell', { who: whoName(duel, seatIndex), card: def.name }, 'spell', seatIndex);
  let resolved = false;
  for (const ab of def.abilities || []) {
    if (resolveAbility(duel, ab, seatIndex, { depth: 0, chosenTarget }, def.name) === 'resolved') resolved = true;
    checkWinner(duel);
  }
  if (!resolved) emit(duel, 'event.fizzle', { card: def.name }, 'fizzle', seatIndex);
  duel.stats.spells += 1;
  return { resolved };
}

export function setSpell(duel, seatIndex, cardInstanceId, slotType, targetMonsterInstanceId = null) {
  assertActive(duel, seatIndex);
  const actor = duel.seats[seatIndex];
  const handIdx = actor.hand.findIndex((c) => c.instanceId === cardInstanceId);
  if (handIdx === -1) throw new Error(`손패에서 카드 ${cardInstanceId}를 찾을 수 없습니다.`);
  const card = actor.hand[handIdx];
  const def = getDef(card.cardId);
  if (def.type !== 'SPELL') throw new Error('마법 카드만 세트할 수 있습니다.');
  if (slotType === 'FIELD_LEFT' && duel.fieldSetSlots.left) throw new Error('필드 중앙 좌측 슬롯에 이미 세트된 마법이 있습니다.');
  if (slotType === 'FIELD_RIGHT' && duel.fieldSetSlots.right) throw new Error('필드 중앙 우측 슬롯에 이미 세트된 마법이 있습니다.');
  if (slotType === 'MONSTER_FRONT') {
    if (!targetMonsterInstanceId) throw new Error('몬스터 앞 세트를 위한 대상 몬스터가 지정되지 않았습니다.');
    if (!actor.board.some((u) => u.instanceId === targetMonsterInstanceId)) throw new Error('세트할 대상 몬스터가 내 필드에 존재하지 않습니다.');
    if (actor.setSpells.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === targetMonsterInstanceId)) {
      throw new Error('해당 몬스터 앞에는 이미 세트된 마법이 존재합니다.');
    }
  }
  const triggerTiming = SET_SLOT_TIMINGS[slotType];
  if (!triggerTiming) throw new Error('알 수 없는 세트 위치입니다.');

  actor.hand.splice(handIdx, 1);
  const item = {
    instanceId: card.instanceId,
    cardId: def.id,
    name: def.name,
    type: 'SPELL',
    level: def.level || 1,
    cost: def.level || 1,
    ownerSeat: seatIndex,
    slotType,
    targetMonsterInstanceId: slotType === 'MONSTER_FRONT' ? targetMonsterInstanceId : null,
    triggerTiming,
    effectType: def.effectType,
    effectValue: def.effectValue,
    keywords: def.keywords || [],
    tags: def.tags || [],
    target: def.target || '',
    effect: def.effect || '',
    isFlipped: false,
    setTurnNumber: duel.turnNumber,
  };
  if (slotType === 'FIELD_LEFT') duel.fieldSetSlots.left = item;
  else if (slotType === 'FIELD_RIGHT') duel.fieldSetSlots.right = item;
  else actor.setSpells.push(item);
  emit(duel, 'event.set', { who: whoName(duel, seatIndex) }, 'set', seatIndex);
  return item;
}

export function attack(duel, seatIndex, attackerInstanceId, targetInstanceId = null) {
  assertActive(duel, seatIndex);
  if (duel.turnNumber <= 2) {
    throw new Error('1~2턴은 준비 단계입니다. 3턴부터 공격할 수 있습니다.');
  }
  const actor = duel.seats[seatIndex];
  const oppSeat = other(seatIndex);
  const opp = duel.seats[oppSeat];
  const attacker = actor.board.find((u) => u.instanceId === attackerInstanceId);
  if (!attacker || !attacker.canAttack || attacker.attacksLeft <= 0) {
    throw new Error(`해당 유닛(${attackerInstanceId})은 지금 공격할 수 없습니다.`);
  }

  let defender = null;
  if (targetInstanceId) {
    defender = opp.board.find((u) => u.instanceId === targetInstanceId);
    if (!defender) throw new Error('공격 대상 유닛을 상대 전장에서 찾을 수 없습니다.');
    const legal = attackableTargets(duel, seatIndex);
    if (!legal.some((u) => u.instanceId === targetInstanceId)) {
      if (legal.some((u) => hasKw(u, 'TAUNT'))) throw new Error('상대 필드에 도발 몬스터가 있어 그 몬스터부터 공격해야 합니다.');
      throw new Error('은신한 몬스터는 공격 대상으로 지정할 수 없습니다.');
    }
  } else if (!canAttackHero(duel, attacker)) {
    throw new Error('상대 필드에 몬스터가 존재할 때는 본체를 직접 공격할 수 없습니다. 상대 몬스터를 먼저 공격해야 합니다.');
  }

  attacker.attacksLeft -= 1;
  attacker.canAttack = attacker.attacksLeft > 0;
  if (hasKw(attacker, 'STEALTH')) {
    attacker.kw = attacker.kw.filter((k) => k !== 'STEALTH');
    attacker.keywords = attacker.kw.map(keywordName);
  }

  const result = {
    attackerInstanceId: attacker.instanceId,
    attackerCardId: attacker.cardId,
    attackerLevel: attacker.level,
    attackerCost: attacker.level,
    attackerAttack: attacker.currentAttack,
    targetInstanceId: defender ? defender.instanceId : null,
    targetType: defender ? 'UNIT' : 'HERO',
    defenderDied: false,
    attackerDied: false,
    pierceDamage: 0,
    recoilDamage: 0,
    damageDealt: attacker.currentAttack,
    triggeredSpell: null,
  };
  duel.lastAttackResult = result;
  emit(duel, 'event.attack', { attacker: attacker.name, target: defender ? `「${defender.name}」` : whoName(duel, oppSeat) }, 'attack', seatIndex);

  // 1) 공격 선언 시 능력
  runAbilities(duel, attacker, seatIndex, 'ON_ATTACK', { targetUnit: defender });
  if (duel.status !== 'ONGOING') return result;

  // 2) 공격받는 쪽의 반응 마법
  const trap = triggerSetSpell(duel, 'ON_ATTACKED', oppSeat, { attacker, targetUnit: defender });
  if (trap) result.triggeredSpell = trap;
  if (duel.status !== 'ONGOING') return result;

  if (!isOnBoard(actor, attacker)) {
    result.attackerDied = true;
    return result;
  }
  if (defender && !isOnBoard(opp, defender)) {
    result.defenderDied = true;
    return result;
  }
  result.attackerAttack = attacker.currentAttack;
  result.damageDealt = attacker.currentAttack;

  // 3) 전투 판정
  if (!defender) {
    damageHero(duel, oppSeat, attacker.currentAttack, attacker);
    duel.stats.heroHits += 1;
  } else if (attacker.currentAttack > defender.currentDefense) {
    const overkill = attacker.currentAttack - defender.currentDefense;
    const gone = destroyUnit(duel, defender);
    result.defenderDied = gone;
    result.defenderCardId = defender.cardId;
    result.defenderInstanceId = defender.instanceId;
    if (gone) {
      duel.stats.kills += 1;
      if (hasKw(attacker, 'PIERCE') && overkill > 0) {
        result.pierceDamage = overkill;
        emit(duel, 'event.pierce', { value: overkill }, 'damage', oppSeat);
        damageHero(duel, oppSeat, overkill, attacker);
      }
      if (isOnBoard(actor, attacker)) runAbilities(duel, attacker, seatIndex, 'ON_KILL', {});
    }
  } else {
    let recoil = defender.currentDefense - attacker.currentAttack;
    if (recoil > 0 && hasKw(defender, 'BULWARK')) recoil *= 2;
    if (recoil > 0) {
      result.recoilDamage = recoil;
      emit(duel, 'event.recoil', { who: whoName(duel, seatIndex), value: recoil }, 'damage', seatIndex);
      damageHero(duel, seatIndex, recoil, null);
    }
    if (hasKw(defender, 'RETALIATE') && defender.currentAttack > 0 && isOnBoard(actor, attacker)) {
      attacker.currentDefense -= defender.currentAttack;
      if (attacker.currentDefense <= 0) result.attackerDied = destroyUnit(duel, attacker);
    }
  }
  checkWinner(duel);
  return result;
}

/** 턴 시작 처리 (activeSeat 기준) */
function beginTurn(duel) {
  const seat = duel.seats[duel.activeSeat];
  seat.normalSummonsRemaining = 1 + (seat.bonusNormalSummons || 0);
  seat.bonusNormalSummons = 0;
  for (const u of seat.board) {
    const frozen = u.frozenUntilTurn && u.frozenUntilTurn >= duel.turnNumber;
    u.canAttack = duel.turnNumber >= 3 && !frozen;
    u.attacksLeft = u.canAttack ? (hasKw(u, 'DOUBLE') ? 2 : 1) : 0;
  }
  drawCard(duel, seat, true);
  // 결전의 시간: 교착을 막기 위해 SUDDEN_DEATH_TURN부터 턴 시작마다 점점 커지는 피해를 받는다
  if (duel.turnNumber >= SUDDEN_DEATH_TURN) {
    const dmg = 2 * (Math.floor((duel.turnNumber - SUDDEN_DEATH_TURN) / 2) + 1);
    emit(duel, 'event.suddenDeath', { who: whoName(duel, duel.activeSeat), value: dmg }, 'damage', duel.activeSeat);
    damageHero(duel, duel.activeSeat, dmg, null);
  }
  checkWinner(duel);
  if (duel.status !== 'ONGOING') return;
  for (const u of [...seat.board]) {
    if (duel.status !== 'ONGOING') return;
    if (isOnBoard(seat, u)) runAbilities(duel, u, duel.activeSeat, 'ON_TURN_START', {});
  }
  if (duel.status === 'ONGOING') {
    triggerSetSpell(duel, 'ON_OPPONENT_TURN_START', other(duel.activeSeat), {});
    checkWinner(duel);
  }
}

export function endTurn(duel, seatIndex) {
  assertActive(duel, seatIndex);
  const seat = duel.seats[seatIndex];
  for (const u of [...seat.board]) {
    if (duel.status !== 'ONGOING') return;
    if (isOnBoard(seat, u)) runAbilities(duel, u, seatIndex, 'ON_TURN_END', {});
  }
  if (duel.status === 'ONGOING') triggerSetSpell(duel, 'ON_OPPONENT_TURN_END', other(seatIndex), {});
  if (checkWinner(duel) !== 'ONGOING') return;

  duel.activeSeat = other(seatIndex);
  duel.turnNumber += 1;

  if (duel.turnNumber > duel.maxTurns) {
    const [a, b] = duel.seats;
    duel.status = a.lp >= b.lp ? 'SEAT_0_WIN' : 'SEAT_1_WIN';
    emit(duel, 'event.turnLimit', {}, 'info', null);
    return;
  }
  beginTurn(duel);
}

/** 구버전 커맨드 형식({type, seat, ...}) 처리 */
export function applyCommand(duel, cmd) {
  switch (cmd.type) {
    case 'PLAY_CARD': {
      const card = duel.seats[cmd.seat]?.hand.find((c) => c.instanceId === cmd.cardInstanceId);
      if (!card) {
        assertActive(duel, cmd.seat);
        throw new Error(`손패에서 카드 ${cmd.cardInstanceId}를 찾을 수 없습니다.`);
      }
      if (card.type === 'MONSTER') {
        return summonMonster(duel, cmd.seat, cmd.cardInstanceId, cmd.tributeInstanceIds || [], cmd.chosenTarget || null);
      }
      return playSpell(duel, cmd.seat, cmd.cardInstanceId, cmd.chosenTarget || null);
    }
    case 'SET_SPELL':
      return setSpell(duel, cmd.seat, cmd.cardInstanceId, cmd.slotType, cmd.targetMonsterInstanceId);
    case 'ATTACK':
      return attack(duel, cmd.seat, cmd.attackerInstanceId, cmd.targetInstanceId || null);
    case 'END_TURN':
      return endTurn(duel, cmd.seat);
    default:
      throw new Error(`알 수 없는 듀얼 명령: ${cmd.type}`);
  }
}

// --------------------------------------------------------------------------
// 합법 행동 나열 (AI / 화면 힌트)
// --------------------------------------------------------------------------

/** 레벨 L 몬스터 소환에 쓸 수 있는 제물 조합 (가치가 낮은 순, 최대 limit개) */
export function tributeOptions(board, level, limit = 4) {
  if (level <= 1) return [[]];
  const value = (u) => u.currentAttack + u.currentDefense + u.level * 3 + (u.isDeckMaster ? 2 : 0);
  const options = [];
  for (const u of board) if (level - u.level <= 1) options.push([u]);
  const n = board.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset = board.filter((_, i) => mask & (1 << i));
    if (subset.length < 2) continue;
    const sum = subset.reduce((a, u) => a + u.level, 0);
    if (sum < level) continue;
    // 최소 조합만 (하나라도 빼면 부족해야 함)
    if (subset.some((u) => sum - u.level >= level)) continue;
    options.push(subset);
  }
  options.sort((a, b) => a.reduce((s, u) => s + value(u), 0) - b.reduce((s, u) => s + value(u), 0));
  return options.slice(0, limit).map((opt) => opt.map((u) => u.instanceId));
}

export function legalActions(duel, seatIndex) {
  if (duel.status !== 'ONGOING' || duel.activeSeat !== seatIndex) return [];
  const me = duel.seats[seatIndex];
  const actions = [];

  const pushTargetedPlay = (baseAction, def, excludeIds = []) => {
    const spec = getManualTargetSpec(duel, def, seatIndex, excludeIds);
    if (!spec) {
      actions.push(baseAction);
      return;
    }
    const targetChoices = [
      ...spec.unitIds.map((instanceId) => ({ type: 'UNIT', instanceId })),
      ...spec.heroSeats.map((seat) => ({ type: 'HERO', seat })),
    ];
    if (targetChoices.length === 0) {
      if (def.type === 'MONSTER') actions.push({ ...baseAction, chosenTarget: null });
      return;
    }
    for (const chosenTarget of targetChoices) {
      actions.push({ ...baseAction, chosenTarget });
    }
  };

  for (const card of me.hand) {
    const def = getDef(card.cardId);
    if (card.type === 'MONSTER') {
      if (me.normalSummonsRemaining <= 0) continue;
      if (card.level === 1) {
        if (me.board.length < MAX_BOARD) {
          pushTargetedPlay({ type: 'PLAY_CARD', seat: seatIndex, cardInstanceId: card.instanceId, tributeInstanceIds: [] }, def);
        }
      } else {
        for (const opt of tributeOptions(me.board, card.level)) {
          pushTargetedPlay({ type: 'PLAY_CARD', seat: seatIndex, cardInstanceId: card.instanceId, tributeInstanceIds: opt }, def, opt);
        }
      }
    } else {
      pushTargetedPlay({ type: 'PLAY_CARD', seat: seatIndex, cardInstanceId: card.instanceId }, def);
      if (!duel.fieldSetSlots.left) actions.push({ type: 'SET_SPELL', seat: seatIndex, cardInstanceId: card.instanceId, slotType: 'FIELD_LEFT' });
      if (!duel.fieldSetSlots.right) actions.push({ type: 'SET_SPELL', seat: seatIndex, cardInstanceId: card.instanceId, slotType: 'FIELD_RIGHT' });
      for (const u of me.board) {
        if (!me.setSpells.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === u.instanceId)) {
          actions.push({ type: 'SET_SPELL', seat: seatIndex, cardInstanceId: card.instanceId, slotType: 'MONSTER_FRONT', targetMonsterInstanceId: u.instanceId });
        }
      }
    }
  }

  if (duel.turnNumber >= 3) {
    const targets = attackableTargets(duel, seatIndex);
    for (const u of me.board) {
      if (!u.canAttack || u.attacksLeft <= 0) continue;
      for (const tgt of targets) actions.push({ type: 'ATTACK', seat: seatIndex, attackerInstanceId: u.instanceId, targetInstanceId: tgt.instanceId });
      if (canAttackHero(duel, u)) actions.push({ type: 'ATTACK', seat: seatIndex, attackerInstanceId: u.instanceId, targetInstanceId: null });
    }
  }
  actions.push({ type: 'END_TURN', seat: seatIndex });
  return actions;
}

export { UNIT_TARGETS_ENEMY };

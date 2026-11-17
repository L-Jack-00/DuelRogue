/**
 * 듀얼 규칙 코어·AI·카드 데이터 회귀 테스트.
 * 실행: deno test --no-check tests/test_duel_core.ts
 */
// @ts-nocheck
import { getCardDef, CARD_CATALOG, COLLECTIBLE_CARDS, TOKENS } from '../src/cards/catalog.js';
import {
  registerCatalog,
  createDuel,
  instantiateCard,
  applyCommand,
  cloneDuel,
  legalActions,
  attackableTargets,
  previewAttack,
  getManualTargetSpec,
  SUDDEN_DEATH_TURN,
} from '../src/duel/duelCore.js';
import { chooseAction, createMind, shiftMood, PERSONALITIES } from '../src/ai/duelAi.js';
import { buildDeck, createStarterDeck, rollEncounter } from '../src/run/content.js';
import { validateDeckComposition, SeededRng } from '../src/duelRogueEngine.js';
import { runDuel, randomDeck } from './sim_lib.js';

registerCatalog(getCardDef);

function assert(cond, msg) {
  if (!cond) throw new Error(`[ASSERTION FAILED] ${msg}`);
}

const FILLER = Array(30).fill('C_BLUE_01');

/** 덱 30장짜리 기본 듀얼을 만들고, 0번 좌석 선공 · 지정 턴으로 맞춘다 */
function setup({ turn = 3, seed = 7 } = {}) {
  const duel = createDuel({
    duelId: 'T',
    seed,
    seats: [
      { duelistId: 'A', duelistName: 'A', deckCardIds: FILLER, deckMasterCardId: 'C_BLUE_01' },
      { duelistId: 'B', duelistName: 'B', deckCardIds: FILLER, deckMasterCardId: 'C_BLUE_01' },
    ],
  });
  duel.activeSeat = 0;
  duel.firstPlayerSeat = 0;
  duel.turnNumber = turn;
  for (const s of duel.seats) {
    s.board = [];
    s.hand = [];
  }
  return duel;
}

function place(duel, seat, cardId, patch = {}) {
  const u = instantiateCard(duel, cardId, seat);
  u.canAttack = duel.turnNumber >= 3;
  u.attacksLeft = u.canAttack ? (u.kw.includes('DOUBLE') ? 2 : 1) : 0;
  Object.assign(u, patch);
  duel.seats[seat].board.push(u);
  return u;
}

function give(duel, seat, cardId) {
  const c = instantiateCard(duel, cardId, seat);
  duel.seats[seat].hand.push(c);
  return c;
}

/** 키워드만 덧입힌 테스트용 몬스터 */
function withKw(u, ...kws) {
  u.kw = [...u.kw, ...kws];
  return u;
}

// --------------------------------------------------------------------------
// 소환
// --------------------------------------------------------------------------
Deno.test('소환: Lv1은 제물 없이, Lv2는 제물 필요, 단일 제물은 레벨 차 1까지, 합산 제물은 레벨 합 이상', () => {
  const duel = setup();
  const lv1 = give(duel, 0, 'C_RED_01');
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: lv1.instanceId });
  assert(duel.seats[0].board.length === 1, 'Lv1 소환');

  let threw = false;
  try {
    applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: give(duel, 0, 'C_RED_01').instanceId });
  } catch {
    threw = true;
  }
  assert(threw, '소환권은 턴당 1회');

  duel.seats[0].normalSummonsRemaining = 1;
  const lv3 = give(duel, 0, 'C_RED_03');
  threw = false;
  try {
    applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: lv3.instanceId, tributeInstanceIds: [lv1.instanceId] });
  } catch {
    threw = true;
  }
  assert(threw, 'Lv1 제물 1장으로 Lv3 소환 불가');

  const lv1b = place(duel, 0, 'C_RED_01');
  const lv1c = place(duel, 0, 'C_RED_01');
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: lv3.instanceId, tributeInstanceIds: [lv1.instanceId, lv1b.instanceId, lv1c.instanceId] });
  assert(duel.seats[0].board.some((u) => u.cardId === 'C_RED_03'), 'Lv1×3 합산으로 Lv3 소환');
  assert(duel.seats[0].graveyard.length === 3, '제물 3장은 묘지로');
});

Deno.test('공격: 1~2턴은 공격 불가, 3턴부터 가능', () => {
  const duel = setup({ turn: 2 });
  const a = place(duel, 0, 'C_RED_01');
  a.canAttack = true;
  a.attacksLeft = 1;
  let threw = false;
  try {
    applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: a.instanceId });
  } catch {
    threw = true;
  }
  assert(threw, '2턴 공격 불가');
});

// --------------------------------------------------------------------------
// 전투 · 키워드
// --------------------------------------------------------------------------
Deno.test('전투: ATK>DEF 파괴, DEF>ATK 반사 피해, 철벽은 반사 2배', () => {
  const duel = setup();
  const atk = place(duel, 0, 'C_RED_01'); // 8/6
  const wall = place(duel, 1, 'C_BLUE_01'); // 4/14 도발
  applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: atk.instanceId, targetInstanceId: wall.instanceId });
  assert(duel.seats[0].lp === 94, `반사 피해 6 (실제 LP ${duel.seats[0].lp})`);

  const atk2 = place(duel, 0, 'C_RED_01');
  withKw(wall, 'BULWARK');
  applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: atk2.instanceId, targetInstanceId: wall.instanceId });
  assert(duel.seats[0].lp === 82, `철벽 반사 12 (실제 LP ${duel.seats[0].lp})`);

  const big = place(duel, 0, 'C_RED_03'); // 16/10 관통
  applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: big.instanceId, targetInstanceId: wall.instanceId });
  assert(!duel.seats[1].board.some((u) => u.instanceId === wall.instanceId), '16 > 14 파괴');
  assert(duel.seats[1].lp === 98, `관통 2 (실제 LP ${duel.seats[1].lp})`);
});

Deno.test('도발: 도발 몬스터부터 공격해야 하며, 필드에 몬스터가 있으면 본체 공격 불가', () => {
  const duel = setup();
  const a = place(duel, 0, 'C_RED_03');
  const taunt = place(duel, 1, 'C_BLUE_01');
  const other = place(duel, 1, 'C_RED_01');
  const targets = attackableTargets(duel, 0).map((u) => u.instanceId);
  assert(targets.length === 1 && targets[0] === taunt.instanceId, '도발만 대상');
  let threw = false;
  try {
    applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: a.instanceId, targetInstanceId: other.instanceId });
  } catch {
    threw = true;
  }
  assert(threw, '도발 무시 공격 거부');
  threw = false;
  try {
    applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: a.instanceId });
  } catch {
    threw = true;
  }
  assert(threw, '본체 공격 거부');
});

Deno.test('은신: 다른 아군이 있으면 대상 불가, 혼자면 대상 가능, 공격하면 은신 해제', () => {
  const duel = setup();
  const sneaky = place(duel, 1, 'C_RED_04'); // 은신
  const buddy = place(duel, 1, 'C_RED_01');
  let ids = attackableTargets(duel, 0).map((u) => u.instanceId);
  assert(!ids.includes(sneaky.instanceId) && ids.includes(buddy.instanceId), '은신 보호');
  duel.seats[1].board = [sneaky];
  ids = attackableTargets(duel, 0).map((u) => u.instanceId);
  assert(ids.includes(sneaky.instanceId), '혼자 남은 은신은 대상 가능');

  const d2 = setup();
  const s2 = place(d2, 0, 'C_RED_04');
  applyCommand(d2, { type: 'ATTACK', seat: 0, attackerInstanceId: s2.instanceId });
  assert(!s2.kw.includes('STEALTH'), '공격 후 은신 해제');
});

Deno.test('직접공격·연속공격·흡혈', () => {
  const duel = setup();
  const d = withKw(place(duel, 0, 'C_RED_01'), 'DIRECT', 'DOUBLE', 'LIFESTEAL');
  d.attacksLeft = 2;
  duel.seats[0].lp = 50;
  place(duel, 1, 'C_BLUE_01');
  applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: d.instanceId });
  applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: d.instanceId });
  assert(duel.seats[1].lp === 84, `직접공격 8×2 (실제 ${duel.seats[1].lp})`);
  assert(duel.seats[0].lp === 66, `흡혈 16 회복 (실제 ${duel.seats[0].lp})`);
  let threw = false;
  try {
    applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: d.instanceId });
  } catch {
    threw = true;
  }
  assert(threw, '세 번째 공격 불가');
});

Deno.test('불굴은 한 번 버티고, 반격은 공격자의 수비력을 깎는다', () => {
  const duel = setup();
  const undying = withKw(place(duel, 1, 'C_RED_01'), 'UNDYING'); // 8/6
  const a = place(duel, 0, 'C_RED_03'); // 16/10
  applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: a.instanceId, targetInstanceId: undying.instanceId });
  assert(duel.seats[1].board.length === 1 && undying.currentDefense === 1, '불굴로 수비력 1 생존');
  assert(!undying.kw.includes('UNDYING'), '불굴 소모');

  const d2 = setup();
  const ret = withKw(place(d2, 1, 'C_BLUE_01'), 'RETALIATE'); // 4/14
  const att = place(d2, 0, 'C_RED_01'); // 8/6
  applyCommand(d2, { type: 'ATTACK', seat: 0, attackerInstanceId: att.instanceId, targetInstanceId: ret.instanceId });
  assert(att.currentDefense === 2, `반격 4 (수비력 ${att.currentDefense})`);
});

Deno.test('신성: 상대 광역 효과 피해를 받지 않는다', () => {
  const duel = setup();
  const holy = withKw(place(duel, 1, 'C_RED_01'), 'DIVINE');
  const plain = place(duel, 1, 'C_RED_01');
  const flash = give(duel, 0, 'C_BLUE_02'); // 전체 12
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: flash.instanceId });
  assert(duel.seats[1].board.some((u) => u.instanceId === holy.instanceId), '신성 생존');
  assert(!duel.seats[1].board.some((u) => u.instanceId === plain.instanceId), '일반 몬스터 파괴');
});

// --------------------------------------------------------------------------
// 능력 · 마법
// --------------------------------------------------------------------------
Deno.test('소환 시 능력이 발동한다 (빛의 대마법사: 가장 약한 적에 5 피해)', () => {
  const duel = setup();
  const weak = place(duel, 1, 'C_RED_01'); // DEF 6
  place(duel, 1, 'C_BLUE_01'); // DEF 14
  const tribute = place(duel, 0, 'C_BLUE_01');
  const mage = give(duel, 0, 'C_BLUE_04');
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: mage.instanceId, tributeInstanceIds: [tribute.instanceId] });
  assert(weak.currentDefense === 1, `가장 약한 적 DEF 6→1 (실제 ${weak.currentDefense})`);
});

Deno.test('세트 마법: 공격받으면 지뢰가 발동해 공격자를 파괴하고 공격은 무산된다', () => {
  const duel = setup();
  duel.activeSeat = 1;
  const guard = place(duel, 1, 'C_BLUE_01');
  const mine = give(duel, 1, 'S_RED_01'); // 공격자에 16
  applyCommand(duel, { type: 'SET_SPELL', seat: 1, cardInstanceId: mine.instanceId, slotType: 'MONSTER_FRONT', targetMonsterInstanceId: guard.instanceId });
  duel.activeSeat = 0;
  const a = place(duel, 0, 'C_RED_03');
  const res = applyCommand(duel, { type: 'ATTACK', seat: 0, attackerInstanceId: a.instanceId, targetInstanceId: guard.instanceId });
  assert(res.attackerDied && !duel.seats[0].board.length, '지뢰로 공격자 파괴');
  assert(duel.seats[1].board.length === 1, '수비 몬스터 생존');
});

Deno.test('모든 마법은 즉시 발동 가능하며, 대상이 없을 때만 불발된다', () => {
  const duel = setup();
  const flash = give(duel, 0, 'C_BLUE_02');
  duel.seats[1].lp = 100;
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: flash.instanceId });
  assert(duel.seats[1].lp === 88, '몬스터가 없어도 본체 피해 효과는 적용');

  // 대상 없는 단일 유닛 피해 마법은 불발
  const sniper = COLLECTIBLE_CARDS.find((c) => c.type === 'SPELL' && c.abilities[0].effects.length === 1 && c.abilities[0].effects[0].op === 'DAMAGE_UNIT' && c.abilities[0].effects[0].target === 'ENEMY_STRONGEST' && !c.abilities[0].chance);
  const s = give(duel, 0, sniper.id);
  const r = applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: s.instanceId });
  assert(r.resolved === false, '대상 없는 단일 피해 마법은 불발');

  // 기존 세트 전용이던 마법(지뢰, 축복 등)도 손패에서 즉시 발동 가능
  const mineEmpty = give(duel, 0, 'S_RED_01');
  const rMineEmpty = applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: mineEmpty.instanceId });
  assert(rMineEmpty.resolved === false, '적이 없으면 지뢰 즉시 발동도 불발');

  const enemy = place(duel, 1, 'C_BLUE_01'); // DEF 14
  const mineHit = give(duel, 0, 'S_RED_01'); // 16 dmg -> strongest enemy
  const rMineHit = applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: mineHit.instanceId });
  assert(rMineHit.resolved === true && duel.seats[1].board.length === 0, `지뢰 즉시 발동으로 적(${enemy.name}) 파괴`);

  duel.seats[0].lp = 70;
  const blessing = give(duel, 0, 'S_BLUE_02');
  const rBless = applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: blessing.instanceId });
  assert(rBless.resolved === true && duel.seats[0].lp === 85, '기존 턴 시작 마법도 즉시 발동 가능');
});

Deno.test('세트 장소별 발동 타이밍: FIELD_LEFT=상대 턴 시작, FIELD_RIGHT=상대 턴 종료, MONSTER_FRONT=피격', () => {
  // 1) FIELD_LEFT: 내 턴이나 상대 턴 종료에는 미발동, 상대 턴 시작 시 발동
  const d1 = setup();
  d1.activeSeat = 1;
  const leftBolt = give(d1, 1, 'C_RED_02'); // 상대 본체에 16 피해
  applyCommand(d1, { type: 'SET_SPELL', seat: 1, cardInstanceId: leftBolt.instanceId, slotType: 'FIELD_LEFT' });
  applyCommand(d1, { type: 'END_TURN', seat: 1 });
  // Seat 0 턴 시작 시점(=Seat 1 기준 상대 턴 시작)에 즉시 FIELD_LEFT 발동!
  assert(d1.fieldSetSlots.left === null && d1.seats[0].lp === 84, `FIELD_LEFT는 상대 턴 시작 시 발동 (상대 LP ${d1.seats[0].lp})`);

  // 역방향 검증: Seat 0가 세트한 뒤 Seat 0 본인 턴 종료 시에는 미발동, Seat 1 턴 시작 시 발동
  const d1b = setup();
  const s0Left = give(d1b, 0, 'C_RED_02');
  applyCommand(d1b, { type: 'SET_SPELL', seat: 0, cardInstanceId: s0Left.instanceId, slotType: 'FIELD_LEFT' });
  assert(d1b.fieldSetSlots.left !== null && d1b.seats[1].lp === 100, 'FIELD_LEFT 세트 직후 미발동');
  applyCommand(d1b, { type: 'END_TURN', seat: 0 }); // Seat 0 종료 -> Seat 1(=상대) 턴 시작
  assert(d1b.fieldSetSlots.left === null && d1b.seats[1].lp === 84, 'Seat 0의 FIELD_LEFT는 Seat 1 턴 시작 시 발동');

  // 2) FIELD_RIGHT: 내 턴 종료 및 상대 턴 시작에는 미발동, 상대 턴 종료 시 발동 + EXTRA_SUMMON 다음 턴 이월 검증
  const d2 = setup();
  d2.activeSeat = 1;
  const rightSpell = give(d2, 1, 'S_PURP_02'); // 1드로우 + 일반 소환권 +1
  const handBefore = d2.seats[1].hand.length;
  applyCommand(d2, { type: 'SET_SPELL', seat: 1, cardInstanceId: rightSpell.instanceId, slotType: 'FIELD_RIGHT' });
  assert(d2.fieldSetSlots.right !== null, 'FIELD_RIGHT 세트 완료');
  applyCommand(d2, { type: 'END_TURN', seat: 1 }); // Seat 1 본인 턴 종료 + Seat 0 턴 시작: 아직 미발동!
  assert(d2.fieldSetSlots.right !== null, 'FIELD_RIGHT는 본인 턴 종료 및 상대 턴 시작에 미발동');
  const p0 = give(d2, 0, 'C_RED_01');
  applyCommand(d2, { type: 'PLAY_CARD', seat: 0, cardInstanceId: p0.instanceId });
  assert(d2.fieldSetSlots.right !== null, 'FIELD_RIGHT는 상대 소환 시에도 미발동');
  applyCommand(d2, { type: 'END_TURN', seat: 0 }); // Seat 0(=상대) 턴 종료 -> FIELD_RIGHT 발동 후 Seat 1 턴 시작!
  assert(d2.fieldSetSlots.right === null, 'FIELD_RIGHT는 상대 턴 종료 시 소모·발동');
  assert(d2.seats[1].normalSummonsRemaining === 2, `상대 턴 종료 시 발동한 EXTRA_SUMMON이 내 턴 소환권(${d2.seats[1].normalSummonsRemaining})에 이월`);
  // 세트 시 패 -1, Seat 1 턴 시작 드로우 +1 => handBefore 유지
  assert(d2.seats[1].hand.length === handBefore, `FIELD_RIGHT 발동 후 다음 턴 시작 드로우 반영 (패 ${d2.seats[1].hand.length}장)`);

  // 3) MONSTER_FRONT: 지정 몬스터가 공격받을 때만 발동 (턴 시작·종료·다른 대상 공격에는 미발동)
  const d3 = setup();
  d3.activeSeat = 1;
  const g1 = place(d3, 1, 'C_BLUE_01');
  const g2 = place(d3, 1, 'C_RED_01');
  const frontBolt = give(d3, 1, 'C_RED_02'); // 기존 즉시 마법 -> 16 피해
  applyCommand(d3, { type: 'SET_SPELL', seat: 1, cardInstanceId: frontBolt.instanceId, slotType: 'MONSTER_FRONT', targetMonsterInstanceId: g1.instanceId });
  applyCommand(d3, { type: 'END_TURN', seat: 1 }); // Seat 0 턴
  applyCommand(d3, { type: 'END_TURN', seat: 0 }); // Seat 0 종료 / Seat 1 시작: MONSTER_FRONT 미발동!
  assert(d3.seats[1].setSpells.length === 1 && d3.seats[0].lp === 100, 'MONSTER_FRONT는 턴 시작·종료에 미발동');
  applyCommand(d3, { type: 'END_TURN', seat: 1 }); // Seat 0 턴: g2 공격 -> g1 앞 마법 미발동 (g1 도발 해제 후 테스트)
  g1.kw = [];
  const a0 = place(d3, 0, 'C_RED_03');
  applyCommand(d3, { type: 'ATTACK', seat: 0, attackerInstanceId: a0.instanceId, targetInstanceId: g2.instanceId });
  assert(d3.seats[1].setSpells.length === 1 && d3.seats[0].lp === 100, '다른 몬스터 공격 시 MONSTER_FRONT 미발동');
  a0.canAttack = true;
  a0.attacksLeft = 1;
  applyCommand(d3, { type: 'ATTACK', seat: 0, attackerInstanceId: a0.instanceId, targetInstanceId: g1.instanceId });
  assert(d3.seats[1].setSpells.length === 0 && d3.seats[0].lp === 84, '보호 대상 몬스터 피격 시 MONSTER_FRONT 발동');
});

// --------------------------------------------------------------------------
// 턴 진행
// --------------------------------------------------------------------------
Deno.test('후공은 1장 더 들고 시작하고, 덱이 비면 탈진, 결전의 시간에는 턴마다 피해', () => {
  const duel = createDuel({
    duelId: 'H',
    seed: 99,
    seats: [
      { duelistId: 'A', duelistName: 'A', deckCardIds: FILLER, deckMasterCardId: 'C_BLUE_01' },
      { duelistId: 'B', duelistName: 'B', deckCardIds: FILLER, deckMasterCardId: 'C_BLUE_01' },
    ],
  });
  const first = duel.firstPlayerSeat;
  assert(duel.seats[first].hand.length === 4 && duel.seats[1 - first].hand.length === 5, '선공 4장 · 후공 5장');

  const d = setup();
  d.seats[1].deck = [];
  applyCommand(d, { type: 'END_TURN', seat: 0 });
  assert(d.seats[1].lp === 95, `탈진 5 (실제 ${d.seats[1].lp})`);

  const s = setup({ turn: SUDDEN_DEATH_TURN - 1 });
  applyCommand(s, { type: 'END_TURN', seat: 0 });
  assert(s.seats[1].lp === 98, `결전의 시간 2 (실제 ${s.seats[1].lp})`);
});

// --------------------------------------------------------------------------
// AI
// --------------------------------------------------------------------------
Deno.test('AI: 고른 행동은 항상 합법이고, 복제본은 원본을 바꾸지 않으며 상대 세트 마법을 엿보지 않는다', () => {
  const duel = setup();
  duel.activeSeat = 1;
  place(duel, 1, 'C_RED_03');
  place(duel, 0, 'C_BLUE_01');
  give(duel, 1, 'C_RED_02');
  give(duel, 1, 'C_RED_01');
  const trap = give(duel, 0, 'S_RED_01');
  duel.seats[0].hand = [];
  duel.fieldSetSlots.left = { ...trap, ownerSeat: 0, slotType: 'FIELD_LEFT', triggerTiming: 'ON_ATTACKED', name: trap.name };

  const before = JSON.stringify(duel.seats);
  const action = chooseAction(duel, 1, PERSONALITIES.CALCULATING, getCardDef);
  assert(JSON.stringify(duel.seats) === before, '평가 중 원본 불변');
  const legal = legalActions(duel, 1).map((a) => JSON.stringify(a));
  assert(legal.includes(JSON.stringify(action)), '합법 행동');

  const sim = cloneDuel(duel, { hideSeat: 0 });
  assert(sim.fieldSetSlots.left.hidden === true, '복제본에서 상대 세트 마법 숨김');
  assert(!duel.fieldSetSlots.left.hidden, '원본은 그대로');
});

Deno.test('AI: 확실한 승리 수가 있으면 둔다 (상대 LP 10, 빈 필드, 공격력 16)', () => {
  const duel = setup();
  duel.activeSeat = 1;
  duel.seats[0].lp = 10;
  place(duel, 1, 'C_RED_03');
  for (const p of Object.values(PERSONALITIES)) {
    const a = chooseAction(duel, 1, p, getCardDef);
    assert(a.type === 'ATTACK', `${p.id}: 결정타 공격 (실제 ${a.type})`);
  }
});

Deno.test('AI 성향 변화: LP가 낮으면 광폭/동요로, 크게 앞서면 맹공으로 바뀔 수 있다', () => {
  let berserk = 0;
  let aggressive = 0;
  for (let i = 0; i < 200; i++) {
    const duel = setup({ seed: i + 1 });
    duel.seats[1].lp = 20;
    const mind = createMind({ personality: 'CALCULATING', volatility: 0.6 });
    const r = shiftMood(duel, 1, mind);
    if (r.to === 'BERSERK' || r.to === 'PANIC') berserk++;
    const d2 = setup({ seed: i + 1000 });
    d2.seats[0].lp = 20;
    const m2 = createMind({ personality: 'DEFENSIVE', volatility: 0.6 });
    if (shiftMood(d2, 1, m2).to === 'AGGRESSIVE') aggressive++;
  }
  assert(berserk > 40 && berserk < 160, `위기 시 성향 변화 빈도 (${berserk}/200)`);
  assert(aggressive > 30 && aggressive < 150, `우세 시 맹공 전환 빈도 (${aggressive}/200)`);
});

Deno.test('AI 대전 100판이 모두 승패로 끝난다', () => {
  const F = ['BLUE', 'RED', 'PURPLE'];
  for (let i = 0; i < 100; i++) {
    const r = runDuel(
      { deck: randomDeck(F[i % 3], 1 + (i % 5), i * 3 + 1), personality: 'AGGRESSIVE' },
      { deck: randomDeck(F[(i + 1) % 3], 1 + (i % 5), i * 3 + 2), personality: 'GAMBLER' },
      i + 1
    );
    assert(r.winner === 0 || r.winner === 1, `판 ${i} 결과 ${r.winner}`);
  }
});

Deno.test('공격 결과 프리뷰(previewAttack): 처치/관통/불굴/반사2배/도발차단 정확 판정', () => {
  const duel = setup();
  const atk = place(duel, 0, 'C_TITAN_01', { currentAttack: 32, kw: ['PIERCE'] });
  const weak = place(duel, 1, 'C_RED_01', { currentDefense: 10 });
  const undy = place(duel, 1, 'C_BLUE_01', { currentDefense: 10, kw: ['UNDYING'] });
  const prevKill = previewAttack(duel, atk, weak);
  assert(prevKill.canAttack && prevKill.canKill && prevKill.pierceDamage === 22, '처치 + 관통 피해 예측');
  const prevUndy = previewAttack(duel, atk, undy);
  assert(prevUndy.canAttack && !prevUndy.canKill && prevUndy.survivesUndying, '불굴 생존 예측');

  const d2 = setup();
  const lowAtk = place(d2, 0, 'C_RED_01', { currentAttack: 5 });
  const wall = place(d2, 1, 'C_BLUE_01', { currentDefense: 11, kw: ['BULWARK'] });
  const prevWall = previewAttack(d2, lowAtk, wall);
  assert(prevWall.canAttack && !prevWall.canKill && prevWall.recoilDamage === 12, `철벽 2배 반사 예측 (${prevWall.recoilDamage})`);
  assert(!previewAttack(d2, lowAtk, null).canAttack, '수호벽으로 직공 차단 예측');
});

Deno.test('AI 룰 고도화: 불발 마법 회피, 공격 후 제물 소환, 킬각 콤보 및 1라운드 입문자 설정', () => {
  // 1) 상대 보드가 비어 있으면 적 타겟 마법을 즉시 발동해 불발시키지 않고 세트·대기 선택
  const d1 = setup();
  d1.activeSeat = 1;
  give(d1, 1, 'S_RED_01');
  const act1 = chooseAction(d1, 1, PERSONALITIES.CALCULATING, getCardDef);
  assert(act1.type === 'SET_SPELL', `대상이 없어 불발될 마법은 즉시 발동 대신 세트 (${act1.type})`);

  // 2) 공격 가능 Lv1으로 때린 뒤 Lv2로 제물 진화하면 상대 LP를 0으로 만들 수 있는 경우: 먼저 ATTACK 선택!
  const d2 = setup();
  d2.activeSeat = 1;
  d2.seats[0].lp = 10;
  place(d2, 1, 'C_RED_01', { currentAttack: 10, canAttack: true, attacksLeft: 1 });
  give(d2, 1, 'C_RED_02');
  const act2 = chooseAction(d2, 1, PERSONALITIES.CALCULATING, getCardDef);
  assert(act2.type === 'ATTACK', `제물 소환 전 킬각 공격 우선 (${act2.type})`);

  // 3) 1라운드 입문자 인카운터 설정 검증
  const enc1 = rollEncounter(1, new SeededRng(42));
  assert(enc1.tier === 1 && enc1.isBeginner === true && enc1.cpuLp === 40 && enc1.deckTierOverride === 0, '1라운드 입문자 인카운터 설정');
});

Deno.test('수동 대상 지정(CHOSEN_*): 전투의 함성, 단일 표적 마법, 신성 제외, 빈 보드 소환 허용 및 AI 선택', () => {
  const TEST_DEFS = {
    TEST_CHOSEN_UNIT_M: {
      id: 'TEST_CHOSEN_UNIT_M',
      name: '테스트 저격수',
      type: 'MONSTER',
      faction: 'RED',
      level: 1,
      attack: 6,
      defense: 5,
      kw: [],
      tags: [],
      abilities: [{ trigger: 'ON_SUMMON', effects: [{ op: 'DAMAGE_UNIT', target: 'CHOSEN_ENEMY', value: 6 }] }],
    },
    TEST_CHOSEN_BUFF_S: {
      id: 'TEST_CHOSEN_BUFF_S',
      name: '테스트 성별축복',
      type: 'SPELL',
      faction: 'BLUE',
      level: 1,
      kw: [],
      tags: [],
      abilities: [{ trigger: 'UNIVERSAL', effects: [{ op: 'BUFF', target: 'CHOSEN_ALLY', atk: 5, def: 5 }] }],
    },
    TEST_CHOSEN_ANY_S: {
      id: 'TEST_CHOSEN_ANY_S',
      name: '테스트 마력탄',
      type: 'SPELL',
      faction: 'PURPLE',
      level: 1,
      kw: [],
      tags: [],
      abilities: [{ trigger: 'UNIVERSAL', effects: [{ op: 'DAMAGE_UNIT', target: 'CHOSEN_ANY', value: 8 }] }],
    },
  };
  const getTestDef = (id) => TEST_DEFS[id] || getCardDef(id);
  registerCatalog(getTestDef);
  try {
    // 1) 적이 2마리(일반 vs 신성) 있을 때 getManualTargetSpec는 신성 제외 + 지정된 적만 피해
    const d1 = setup();
    const sniper = instantiateCard(d1, 'TEST_CHOSEN_UNIT_M', 0);
    d1.seats[0].hand.push(sniper);
    const enemyWeak = place(d1, 1, 'C_RED_01', { currentDefense: 6 });
    const enemyDiv = place(d1, 1, 'C_BLUE_01', { currentDefense: 6, kw: ['DIVINE'] });
    const spec1 = getManualTargetSpec(d1, TEST_DEFS.TEST_CHOSEN_UNIT_M, 0);
    assert(spec1 && spec1.unitIds.length === 1 && spec1.unitIds[0] === enemyWeak.instanceId, 'DIVINE 적은 CHOSEN_ENEMY 대상 제외');
    applyCommand(d1, {
      type: 'PLAY_CARD',
      seat: 0,
      cardInstanceId: sniper.instanceId,
      chosenTarget: { type: 'UNIT', instanceId: enemyWeak.instanceId },
    });
    assert(d1.seats[1].board.length === 1 && d1.seats[1].board[0].instanceId === enemyDiv.instanceId, '지정한 적만 정확히 파괴');

    // 2) CHOSEN_ENEMY 전투의 함성 몬스터는 적이 비어 있어도 필드에 소환 가능 (하스스톤 룰)
    const dEmpty = setup();
    const sniper2 = instantiateCard(dEmpty, 'TEST_CHOSEN_UNIT_M', 0);
    dEmpty.seats[0].hand.push(sniper2);
    applyCommand(dEmpty, { type: 'PLAY_CARD', seat: 0, cardInstanceId: sniper2.instanceId });
    assert(dEmpty.seats[0].board.length === 1 && dEmpty.seats[0].board[0].instanceId === sniper2.instanceId, '빈 보드에서도 전투의 함성 몬스터 소환');

    // 3) CHOSEN_ALLY 주문: 지정한 아군에게 정확히 버프 적용
    const dAlly = setup();
    const a1 = place(dAlly, 0, 'C_RED_01', { currentAttack: 5, currentDefense: 5 });
    const a2 = place(dAlly, 0, 'C_BLUE_01', { currentAttack: 4, currentDefense: 14 });
    const buffSpell = instantiateCard(dAlly, 'TEST_CHOSEN_BUFF_S', 0);
    dAlly.seats[0].hand.push(buffSpell);
    applyCommand(dAlly, {
      type: 'PLAY_CARD',
      seat: 0,
      cardInstanceId: buffSpell.instanceId,
      chosenTarget: { type: 'UNIT', instanceId: a2.instanceId },
    });
    assert(a2.currentAttack === 9 && a1.currentAttack === 5, 'CHOSEN_ALLY로 지정한 아군만 버프');

    // 4) CHOSEN_ANY + AI 킬각 판단: 적 몬스터가 있어도 적 본체 LP 8이면 AI가 본체 타겟으로 킬각 실행
    const dAny = setup();
    dAny.activeSeat = 1;
    dAny.seats[0].lp = 8;
    place(dAny, 0, 'C_BLUE_01', { currentDefense: 14 });
    const bolt = instantiateCard(dAny, 'TEST_CHOSEN_ANY_S', 1);
    dAny.seats[1].hand.push(bolt);
    const aiMove = chooseAction(dAny, 1, PERSONALITIES.CALCULATING, getTestDef);
    assert(aiMove.type === 'PLAY_CARD' && aiMove.chosenTarget?.type === 'HERO' && aiMove.chosenTarget?.seat === 0, 'AI가 CHOSEN_ANY로 적 본체 킬각 선택');
  } finally {
    registerCatalog(getCardDef);
  }
});

// --------------------------------------------------------------------------
// 카드 데이터 규격
// --------------------------------------------------------------------------
Deno.test('카드 데이터: 카드 디자인 원칙을 지킨다', () => {
  const RANGE = { 1: [14, 18], 2: [20, 24], 3: [26, 32], 4: [33, 38], 5: [42, 48] };
  const ids = new Set();
  const names = new Set();
  const tokenIds = new Set(TOKENS.map((t) => t.id));
  let gods = 0;
  assert(COLLECTIBLE_CARDS.length >= 480 && COLLECTIBLE_CARDS.length <= 560, `카드 수 ${COLLECTIBLE_CARDS.length}`);
  for (const c of CARD_CATALOG) {
    assert(!ids.has(c.id), `ID 중복 ${c.id}`);
    assert(!names.has(c.name), `이름 중복 ${c.name}`);
    ids.add(c.id);
    names.add(c.name);
    assert(c.description && c.description.length > 0, `${c.id} 설명 없음`);
    assert(!/\{[a-zA-Z]+\}/.test(c.description), `${c.id} 치환되지 않은 문구: ${c.description}`);
    for (const ab of c.abilities) {
      for (const e of [...ab.effects, ...(ab.elseEffects || [])]) {
        if (e.op === 'SUMMON_TOKEN') assert(tokenIds.has(e.token), `${c.id} 없는 토큰 ${e.token}`);
        if (e.op === 'DRAW' && (e.value || 1) >= 2 && c.type === 'SPELL') assert(ab.condition || ab.chance, `${c.id} 무조건 다중 드로우 금지`);
      }
    }
    if (c.type === 'SPELL') {
      assert(!c.description.includes('세트 후 '), `${c.id} 구버전 세트 조건 문구 잔존: ${c.description}`);
    }
    if (Array.isArray(c.tags)) {
      c.tags.forEach((tg: string) => {
        assert(tg.startsWith('#') && !tg.startsWith('##'), `${c.id} 태그 단일 # 접두사 불일치: ${tg}`);
      });
    }
    if (c.type === 'MONSTER') {
      assert(Array.isArray(c.tags) && c.tags.length >= 3, `${c.id} 몬스터 태그 부족`);
    }
    if (c.type !== 'MONSTER' || c.isToken) continue;
    if (c.isGod) {
      gods++;
      assert(c.level === 6, `${c.id} 신은 Lv6`);
      continue;
    }
    assert(c.level >= 1 && c.level <= 5, `${c.id} 레벨 ${c.level}`);
    if (c.level === 1) assert(c.attack <= 8, `${c.id} Lv1 공격력 ${c.attack}`);
    if (c.level === 2) assert(c.attack <= 13, `${c.id} Lv2 공격력 ${c.attack}`);
    if (c.level < 3) assert(!c.kw.includes('PIERCE'), `${c.id} 저레벨 관통 금지`);
    const sum = c.attack + c.defense;
    if (c.id.startsWith('C_')) continue; // 기본 카드는 초기 디자인 유지
    assert(sum <= RANGE[c.level][1], `${c.id} 스탯 상한 초과 ${sum}`);
    assert(sum >= Math.round(RANGE[c.level][0] * 0.8), `${c.id} 스탯 하한 미달 ${sum}`);
  }
  assert(gods === 3, `신은 3장 (실제 ${gods})`);
});

Deno.test('덱 구성기: 모든 진영·티어의 덱과 시작 덱이 30장 규격을 지킨다', () => {
  const map = new Map(CARD_CATALOG.map((c) => [c.id, c]));
  for (const destiny of ['BLUE_JUSTICE', 'RED_ZEAL', 'PURPLE_CHAOS']) {
    const d = createStarterDeck(destiny);
    const v = validateDeckComposition(d.deckCardIds, map, d.deckMasterCardId);
    assert(v.valid, `${destiny} 시작 덱: ${v.error}`);
  }
  for (const f of ['BLUE', 'RED', 'PURPLE']) {
    for (let tier = 1; tier <= 5; tier++) {
      for (let s = 1; s <= 10; s++) {
        const d = buildDeck({ faction: f, tier, rng: new SeededRng(s * 31 + tier), godId: tier === 5 && s % 2 ? { BLUE: 'C_BLUE_05', RED: 'C_TITAN_01', PURPLE: 'C_PURP_03' }[f] : null });
        const v = validateDeckComposition(d.deckCardIds, map, d.deckMasterCardId);
        assert(v.valid, `${f} 티어${tier} #${s}: ${v.error}`);
      }
    }
  }
});

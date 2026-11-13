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
  SUDDEN_DEATH_TURN,
} from '../src/duel/duelCore.js';
import { chooseAction, createMind, shiftMood, PERSONALITIES } from '../src/ai/duelAi.js';
import { buildDeck, createStarterDeck } from '../src/run/content.js';
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

Deno.test('불발: 대상이 없으면 효과 없이 묘지로, 세트형 마법은 즉시 발동 불가', () => {
  const duel = setup();
  const flash = give(duel, 0, 'C_BLUE_02');
  duel.seats[1].lp = 100;
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: flash.instanceId });
  assert(duel.seats[1].lp === 88, '몬스터가 없어도 본체 피해 효과는 적용');
  const sniper = COLLECTIBLE_CARDS.find((c) => c.type === 'SPELL' && c.spellTriggerType === 'INSTANT' && c.abilities[0].effects.length === 1 && c.abilities[0].effects[0].op === 'DAMAGE_UNIT' && !c.abilities[0].chance);
  const s = give(duel, 0, sniper.id);
  const r = applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: s.instanceId });
  assert(r.resolved === false, '대상 없는 단일 피해 마법은 불발');
  const trap = give(duel, 0, 'S_RED_01');
  let threw = false;
  try {
    applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: trap.instanceId });
  } catch {
    threw = true;
  }
  assert(threw, '함정은 즉시 발동 불가');
});

Deno.test('상대 소환 반응 마법이 발동한다', () => {
  const ambush = COLLECTIBLE_CARDS.find((c) => c.spellTriggerType === 'ON_ENEMY_SUMMON' && c.abilities[0].effects[0].op === 'DAMAGE_UNIT');
  assert(ambush, '매복 마법 존재');
  const duel = setup();
  duel.activeSeat = 1;
  const card = give(duel, 1, ambush.id);
  applyCommand(duel, { type: 'SET_SPELL', seat: 1, cardInstanceId: card.instanceId, slotType: 'FIELD_LEFT' });
  duel.activeSeat = 0;
  const m = give(duel, 0, 'C_RED_01');
  applyCommand(duel, { type: 'PLAY_CARD', seat: 0, cardInstanceId: m.instanceId });
  assert(duel.fieldSetSlots.left === null, '세트 마법 소모');
  assert(m.currentDefense < 6 || !duel.seats[0].board.length, '소환된 몬스터가 피해를 입음');
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
  assert(duel.seats[first].hand.length === 5 && duel.seats[1 - first].hand.length === 6, '후공 6장');

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
        if (e.op === 'DRAW' && c.type === 'SPELL' && ab.trigger === 'INSTANT') assert(ab.condition || ab.chance, `${c.id} 무조건 즉시 드로우 금지`);
      }
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

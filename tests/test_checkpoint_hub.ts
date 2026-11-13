/**
 * [DUEL ROGUE] 체크포인트 허브 / 상점 / 트레이더 / 가방 덱 편집 회귀 테스트
 *
 * 하나의 런을 처음부터 끝까지 진행하므로 단계(step)들은 상태를 공유하며 순서대로 실행된다.
 * 실행: deno test --no-check tests/test_checkpoint_hub.ts
 */
import { DuelRogueEngine, DEFAULT_CARD_CATALOG } from '../src/duelRogueEngine.js';
import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[ASSERTION FAILED] ${msg}`);
}

function countOf(list: string[], id: string): number {
  return list.filter((c) => c === id).length;
}

/** 덱 + 가방에 보유한 특정 카드의 총 장수 */
function ownedCount(engine: any, id: string): number {
  return countOf(engine.state.playerDeckCardIds, id) + countOf(engine.state.playerTrunkCardIds || [], id);
}

function totalOwned(engine: any): number {
  return engine.state.playerDeckCardIds.length + (engine.state.playerTrunkCardIds || []).length;
}

/** 지정 카드가 모두 인벤토리에 있도록 보장 (부족하면 가방에 추가) */
function ensureOwned(engine: any, ids: string[]): void {
  const need = new Map<string, number>();
  for (const id of ids) need.set(id, (need.get(id) || 0) + 1);
  for (const [id, n] of need) {
    for (let i = ownedCount(engine, id); i < n; i++) engine.state.playerTrunkCardIds.push(id);
  }
}

/** 트레이드 1건을 실행하고 인벤토리 회계(차감/지급)를 검증 */
function executeTradeAndVerify(engine: any, deal: any): any {
  ensureOwned(engine, deal.wantedCardIds);
  const n = deal.wantedCardIds.length;
  const totalBefore = totalOwned(engine);
  const goldBefore = engine.state.gold;
  const rewardBefore = ownedCount(engine, deal.rewardCardId);
  const wantedBefore = new Map<string, number>(deal.wantedCardIds.map((id: string) => [id, ownedCount(engine, id)]));
  const deckBefore = [...engine.state.playerDeckCardIds];
  const trunkBefore = [...engine.state.playerTrunkCardIds];

  const res = engine.executeMerchantTrade(deal.dealId, [...deal.wantedCardIds]);

  assert(res.rewardCardId === deal.rewardCardId, `${deal.dealType}: 보상 카드를 수령해야 합니다.`);
  assert(deal.completed === true, `${deal.dealType}: 거래가 완료 처리되어야 합니다.`);
  assert(ownedCount(engine, deal.rewardCardId) === rewardBefore + 1, `${deal.dealType}: 보상 카드 보유 수가 1 증가해야 합니다.`);
  for (const [id, before] of wantedBefore) {
    const given = countOf(deal.wantedCardIds, id);
    assert(ownedCount(engine, id) === before - given, `${deal.dealType}: 건넨 카드 ${id}가 ${given}장 차감되어야 합니다.`);
  }
  assert(totalOwned(engine) === totalBefore - n + 1, `${deal.dealType}: 총 보유 카드 수는 ${n}장 차감, 1장 증가해야 합니다.`);
  assert(engine.state.gold === goldBefore - (deal.goldFee || 0), `${deal.dealType}: 수수료만큼 골드가 차감되어야 합니다.`);

  // 덱 슬롯 회계: 가방 우선 차감, 덱에서 차감된 첫 슬롯은 보상 카드, 나머지 빈 슬롯은 가방 카드로 보충된다.
  const trunkLeft = [...trunkBefore];
  let deckConsumed = 0;
  for (const id of deal.wantedCardIds) {
    const i = trunkLeft.indexOf(id);
    if (i !== -1) trunkLeft.splice(i, 1);
    else deckConsumed++;
  }
  assert(
    engine.state.playerDeckCardIds.length === deckBefore.length,
    `${deal.dealType}: 덱에서 ${deckConsumed}장을 바쳐도 덱 장수(${deckBefore.length})는 유지되어야 합니다. (실제: ${engine.state.playerDeckCardIds.length})`
  );
  assert(res.slottedIntoDeck === deckConsumed > 0, `${deal.dealType}: 덱 카드를 바친 경우에만 보상이 덱 슬롯에 장착되어야 합니다.`);
  assert(
    res.refilledFromTrunk.length === Math.max(0, deckConsumed - 1),
    `${deal.dealType}: 보상 카드가 채우지 못한 덱 빈 슬롯 수만큼 가방에서 보충되어야 합니다.`
  );
  return res;
}

Deno.test('체크포인트 허브 E2E: 상점 → 트레이더 → 덱 편집 → 인카운터 → 최종 보스', async (t) => {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
  const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 20261112);
  let snap: any = engine.startNewRun('RUN_CHECKPOINT_E2E', 20261112);
  let addedFromPack = '';

  await t.step('1. 체크포인트 라운드 1 진입 및 1,000원 초기 자금', () => {
    snap = engine.selectFortuneDestiny('BLUE_JUSTICE', 'CHECKPOINT');
    assert(snap.phase === 'STAGE_CHECKPOINT', '체크포인트 모드 선택 시 STAGE_CHECKPOINT 단계로 진입해야 합니다.');
    assert(snap.gold === 1000, '1,000원 시작 자금이 지급되어야 합니다.');
    assert(snap.roundNumber === 1, '첫 시작은 라운드 1이어야 합니다.');
    assert(snap.playerDeckCardIds.length === 30, '시작 덱은 30장이어야 합니다.');
    assert(snap.checkpointShopStock.length >= 2, '상점에 2개 이상의 부스터 팩이 진열되어야 합니다.');
    assert(snap.nextEncounterInfo !== null, '다음 인카운터 정보가 생성되어 있어야 합니다.');
  });

  await t.step('2. 부스터 팩 구매 및 3장 개봉', () => {
    const pack = snap.checkpointShopStock[0];
    const res = engine.buyBoosterPack(pack.id);
    assert(res.gold === 1000 - pack.price, '팩 구매 후 골드가 정확히 차감되어야 합니다.');
    assert(res.choices.length === 3, '팩 개봉 시 3장의 카드가 출현해야 합니다.');

    // 3단계용: 덱에 없는(또는 가장 적은) 카드를 골라 실제 교체가 검증되도록 한다.
    const deck = engine.state.playerDeckCardIds;
    addedFromPack = [...res.choices].sort((a: string, b: string) => countOf(deck, a) - countOf(deck, b))[0];
  });

  await t.step('3. 30장 덱 1:1 교체 (다른 카드끼리)', () => {
    const deck = engine.state.playerDeckCardIds;
    const removed = deck.find((c: string) => c !== snap.playerDeckMasterCardId && c !== addedFromPack);
    assert(removed, '교체 가능한 다른 카드가 덱에 있어야 합니다.');
    const addBefore = countOf(deck, addedFromPack);
    const remBefore = countOf(deck, removed);
    const trunkRemBefore = countOf(engine.state.playerTrunkCardIds || [], removed);

    snap = engine.swapDeckCard(addedFromPack, removed);
    assert(snap.playerDeckCardIds.length === 30, '교체 후에도 덱은 정확히 30장이어야 합니다.');
    assert(countOf(snap.playerDeckCardIds, addedFromPack) === addBefore + 1, '영입 카드가 덱에 1장 늘어야 합니다.');
    assert(countOf(snap.playerDeckCardIds, removed) === remBefore - 1, '방출 카드가 덱에서 1장 줄어야 합니다.');
    assert(countOf(snap.playerTrunkCardIds, removed) === trunkRemBefore + 1, '방출 카드는 가방으로 이동해야 합니다.');
  });

  await t.step('3-1. 상점 낱장 직구매 → 가방 보관', () => {
    engine.state.gold = 5000;
    const singles = engine.state.checkpointShopSingles || [];
    assert(singles.length > 0, '상점에 낱장 카드가 진열되어 있어야 합니다.');
    const single = singles[0];
    const deckBefore = [...engine.state.playerDeckCardIds];
    const trunkBefore = countOf(engine.state.playerTrunkCardIds, single.cardId);

    const res = engine.buyShopSingleCard(single.cardId);
    assert(res.cardId === single.cardId, '낱장 카드를 정상 구매할 수 있어야 합니다.');
    assert(res.gold === 5000 - single.price, '낱장 가격만큼 골드가 차감되어야 합니다.');
    assert(countOf(engine.state.playerTrunkCardIds, single.cardId) === trunkBefore + 1, '구매한 카드가 가방에 추가되어야 합니다.');
    assert(JSON.stringify(engine.state.playerDeckCardIds) === JSON.stringify(deckBefore), '낱장 구매는 30장 덱을 건드리지 않아야 합니다.');

    let rebuy = false;
    try { engine.buyShopSingleCard(single.cardId); } catch { rebuy = true; }
    assert(rebuy, '이미 구매한 낱장은 다시 구매할 수 없어야 합니다.');
  });

  await t.step('4-0. 트레이더 1:1 맞교환: 소유 카드 지목, 같은 카드 제안 금지, 오답 거부', () => {
    if (!engine.state.suspiciousMerchant) {
      // 상인은 확률적으로 등장하므로, 없으면 반드시 등장하는 라운드 3 진열을 만든 뒤 라운드를 되돌린다
      const round = engine.state.roundNumber;
      engine.state.roundNumber = 3;
      engine.generateCheckpointState();
      engine.state.roundNumber = round;
      engine.state.gold = 5000;
    }
    const merchant = engine.state.suspiciousMerchant;
    assert(merchant && merchant.deals, '수상한 상인이 등장해야 합니다.');
    const deal = merchant.deals.find((d: any) => d.dealType === 'SYMMETRIC_1_1');
    assert(deal, '1:1 맞교환 제안이 있어야 합니다.');
    assert(deal.wantedCardIds?.length === 1, '1:1 거래의 지정 카드는 1장이어야 합니다.');
    const allOwned = [...engine.state.playerTrunkCardIds, ...engine.state.playerDeckCardIds];
    assert(allOwned.includes(deal.wantedCardIds[0]), '지목 카드는 플레이어 소유 카드 중에서 골라야 합니다.');
    assert(deal.wantedCardIds[0] !== engine.state.playerDeckMasterCardId, '덱 마스터는 지목 대상이 아니어야 합니다.');
    assert(!deal.wantedCardIds.includes(deal.rewardCardId), `상인이 주는 카드(${deal.rewardCardId})를 요구 카드로 지목하면 안 됩니다.`);

    let wrongRejected = false;
    try { engine.executeMerchantTrade(deal.dealId, ['C_TITAN_01']); } catch { wrongRejected = true; }
    assert(wrongRejected, '요구하지 않은 카드를 제시하면 거래가 거부되어야 합니다.');

    let countRejected = false;
    try { engine.executeMerchantTrade(deal.dealId, [...deal.wantedCardIds, ...deal.wantedCardIds]); } catch { countRejected = true; }
    assert(countRejected, '요구 장수와 다른 장수를 제시하면 거래가 거부되어야 합니다.');

    executeTradeAndVerify(engine, deal);

    let replay = false;
    try { engine.executeMerchantTrade(deal.dealId, [...deal.wantedCardIds]); } catch { replay = true; }
    assert(replay, '완료된 거래는 다시 실행할 수 없어야 합니다.');
  });

  await t.step('4-0B. 트레이더 2:1 비대칭 교환', () => {
    const deal = engine.state.suspiciousMerchant.deals.find((d: any) => d.dealType === 'ASYMMETRIC_2_1');
    assert(deal, '2:1 비대칭 교환 제안이 있어야 합니다.');
    assert(deal.wantedCardIds?.length === 2, '2:1 교환은 지정 카드가 2장이어야 합니다.');
    assert(!deal.wantedCardIds.includes(deal.rewardCardId), '보상 카드를 요구 카드로 지목하면 안 됩니다.');
    executeTradeAndVerify(engine, deal);
  });

  await t.step('4. 상인 낱장 직거래 및 덱 배치 (하위 호환)', () => {
    assert(engine.state.playerDeckCardIds.length === 30, '트레이드를 거친 뒤에도 덱은 30장이어야 합니다.');
    engine.state.suspiciousMerchant.items.push({ cardId: 'C_RED_04', price: 500, purchased: false });
    const goldBefore = engine.state.gold;
    const res = engine.buySuspiciousMerchantCard('C_RED_04');
    assert(res.cardId === 'C_RED_04', '상인에게서 낱장 카드를 정상 구매해야 합니다.');
    assert(engine.state.gold === goldBefore - 500, '상인 낱장 가격만큼 골드가 차감되어야 합니다.');

    const deck = engine.state.playerDeckCardIds;
    const target = deck.find((c: string) => c !== engine.state.playerDeckMasterCardId && c !== 'C_RED_04');
    const before = countOf(deck, 'C_RED_04');
    snap = engine.swapDeckCard('C_RED_04', target);
    assert(countOf(snap.playerDeckCardIds, 'C_RED_04') === before + 1, '상인에게 구매한 카드가 덱에 배치되어야 합니다.');
    assert(snap.playerDeckCardIds.length === 30, '배치 후에도 덱은 30장이어야 합니다.');
  });

  await t.step('4-1. 가방(트렁크) 덱 편집 및 30장 출전 규격', () => {
    const card = snap.playerDeckCardIds.find((c: string) => c !== snap.playerDeckMasterCardId);
    snap = engine.moveCardDeckToTrunk(card);
    assert(snap.playerDeckCardIds.length === 29, '덱에서 가방으로 이동 시 덱이 29장이 되어야 합니다.');

    let blocked = false;
    try { engine.startRandomEncounter(); } catch { blocked = true; }
    assert(blocked, '덱이 30장이 아니면 인카운터에 나설 수 없어야 합니다.');

    let dmBlocked = false;
    try { engine.moveCardDeckToTrunk(snap.playerDeckMasterCardId); } catch { dmBlocked = true; }
    assert(dmBlocked, '덱 마스터는 가방으로 옮길 수 없어야 합니다.');

    snap = engine.moveCardTrunkToDeck(card);
    assert(snap.playerDeckCardIds.length === 30, '가방에서 덱으로 복귀 시 30장이 되어야 합니다.');
  });

  await t.step('5. 인카운터 승리 → 상금 획득, 라운드 2', () => {
    snap = engine.startRandomEncounter();
    assert(snap.phase === 'DUEL_ENCOUNTER', '인카운터 출진 시 DUEL_ENCOUNTER 단계로 진입해야 합니다.');
    const goldBefore = engine.state.gold;
    const reward = engine.state.nextEncounterInfo?.rewardGold || 500;
    snap.activeDuel.seats[1].lp = 0;
    snap = engine.evaluateDuelOutcome(snap.activeDuel);
    assert(snap.phase === 'STAGE_CHECKPOINT', '인카운터 승리 후 체크포인트로 복귀해야 합니다.');
    assert(snap.roundNumber === 2, '인카운터 승리 후 라운드가 2로 상승해야 합니다.');
    assert(snap.gold === goldBefore + reward, `승리 상금 ${reward}원이 정확히 지급되어야 합니다.`);
  });

  await t.step('6. 언제든지 최종 보스 도전 → 명예의 전당', () => {
    snap = engine.challengeFinalBoss();
    assert(snap.phase === 'STAGE_5_FINAL_BOSS', '체크포인트에서 즉시 최종 보스전으로 진입해야 합니다.');
    snap.activeDuel.seats[1].lp = 0;
    snap = engine.evaluateDuelOutcome(snap.activeDuel);
    assert(snap.phase === 'RUN_VICTORY', '최종 보스 격파 시 RUN_VICTORY 상태에 도달해야 합니다.');
    assert(snap.hallOfFameSnapshot !== null, '명예의 전당 등록 스냅샷이 생성되어야 합니다.');
  });
});

/** 트레이더가 막 생성된 체크포인트 엔진. deals를 직접 지정해 특정 상황을 재현한다. */
function makeTradeEngine(trunk: string[]): any {
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage: new InMemoryBinderStorage() });
  const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 7);
  engine.startNewRun('RUN_TRADE_UNIT', 7);
  engine.selectFortuneDestiny('BLUE_JUSTICE', 'CHECKPOINT');
  engine.state.gold = 1000;
  engine.state.playerTrunkCardIds = [...trunk];
  return engine;
}

/** 덱에 있고(덱 마스터 제외) 가방에는 없는 서로 다른 카드 n장 */
function deckOnlyCards(engine: any, n: number): string[] {
  const out: string[] = [];
  for (const id of engine.state.playerDeckCardIds) {
    if (id === engine.state.playerDeckMasterCardId || out.includes(id) || engine.state.playerTrunkCardIds.includes(id)) continue;
    out.push(id);
    if (out.length === n) break;
  }
  assert(out.length === n, `덱 전용 카드 ${n}장을 찾을 수 있어야 합니다.`);
  return out;
}

function setDeal(engine: any, wanted: string[], reward: string, fee = 0): any {
  const deal = { dealId: 'DEAL_TEST', dealType: `TEST_${wanted.length}_1`, wantedCardIds: wanted, rewardCardId: reward, goldFee: fee, completed: false };
  engine.state.suspiciousMerchant = { deals: [deal], items: [] };
  return deal;
}

Deno.test('트레이드: 덱 카드 2장을 바치면 빈 슬롯 1개를 가방 카드로 보충해 30장 유지', () => {
  const engine = makeTradeEngine(['S_PURP_01', 'C_RED_04']);
  const wanted = deckOnlyCards(engine, 2);
  const deal = setDeal(engine, wanted, 'C_PURP_02');

  const plan = engine.planMerchantTrade(deal.dealId, wanted);
  assert(plan.deckConsumed === 2, '두 장 모두 덱에서 차감되어야 합니다.');
  assert(plan.refillCardIds.length === 1 && plan.refillCardIds[0] === 'S_PURP_01', '가방 첫 카드가 보충 대상이어야 합니다.');
  assert(engine.state.playerTrunkCardIds.length === 2, 'planMerchantTrade는 상태를 바꾸지 않아야 합니다.');

  const res = executeTradeAndVerify(engine, deal);
  assert(engine.state.playerDeckCardIds.length === 30, '덱은 30장이어야 합니다.');
  assert(res.refilledFromTrunk[0] === 'S_PURP_01', '보충된 카드가 결과에 보고되어야 합니다.');
  assert(engine.state.playerDeckCardIds.includes('S_PURP_01'), '보충 카드가 덱에 들어가야 합니다.');
  assert(JSON.stringify(engine.state.playerTrunkCardIds) === JSON.stringify(['C_RED_04']), '가방에서는 보충 카드만 빠져야 합니다.');
});

Deno.test('트레이드: 덱 카드 3장 + 수수료, 가방 보충 2장으로 30장 유지', () => {
  const engine = makeTradeEngine(['S_PURP_01', 'C_RED_04', 'S_RED_01']);
  const wanted = deckOnlyCards(engine, 3);
  const deal = setDeal(engine, wanted, 'C_TITAN_01', 300);
  const res = executeTradeAndVerify(engine, deal);
  assert(res.refilledFromTrunk.length === 2, '가방에서 2장이 보충되어야 합니다.');
  assert(engine.state.playerDeckCardIds.length === 30, '덱은 30장이어야 합니다.');
  assert(engine.state.gold === 700, '수수료 300원이 차감되어야 합니다.');
});

Deno.test('트레이드: 가방 카드가 섞여 있으면 가방부터 차감하고 보충은 필요한 만큼만', () => {
  const engine = makeTradeEngine([]);
  const [a, b] = deckOnlyCards(engine, 2);
  engine.state.playerTrunkCardIds = [a, 'S_PURP_01'];
  const deal = setDeal(engine, [a, b], 'C_PURP_02');
  const res = executeTradeAndVerify(engine, deal);
  assert(res.refilledFromTrunk.length === 0, '덱에서 1장만 차감되므로 보충이 필요 없어야 합니다.');
  assert(engine.state.playerTrunkCardIds.includes('S_PURP_01'), '보충이 없으면 다른 가방 카드는 그대로여야 합니다.');
});

Deno.test('트레이드: 보충할 가방 카드가 부족하면 거부하고 상태를 바꾸지 않음', () => {
  const engine = makeTradeEngine([]);
  const wanted = deckOnlyCards(engine, 2);
  const deal = setDeal(engine, wanted, 'C_PURP_02');
  const before = JSON.stringify({ d: engine.state.playerDeckCardIds, t: engine.state.playerTrunkCardIds, g: engine.state.gold });

  let message = '';
  try { engine.executeMerchantTrade(deal.dealId, wanted); } catch (e) { message = (e as Error).message; }
  assert(message.includes('가방 카드가 1장 필요'), `가방 부족 사유로 거부되어야 합니다. (실제: ${message})`);
  assert(deal.completed === false, '거부된 거래는 완료 처리되지 않아야 합니다.');
  assert(
    JSON.stringify({ d: engine.state.playerDeckCardIds, t: engine.state.playerTrunkCardIds, g: engine.state.gold }) === before,
    '거부 시 덱/가방/골드가 그대로여야 합니다.'
  );
});

Deno.test('트레이드: 덱 마스터는 보충 카드로도, 제물로도 쓰이지 않음', () => {
  const engine = makeTradeEngine([]);
  const master = engine.state.playerDeckMasterCardId;
  const [a, b] = deckOnlyCards(engine, 2);
  engine.state.playerTrunkCardIds = [master];
  const deal = setDeal(engine, [a, b], 'C_PURP_02');
  let refused = false;
  try { engine.planMerchantTrade(deal.dealId, [a, b]); } catch { refused = true; }
  assert(refused, '가방에 덱 마스터만 있으면 보충할 수 없어 거부되어야 합니다.');

  const deal2 = setDeal(engine, [master], 'C_PURP_02');
  engine.state.playerTrunkCardIds = [];
  let masterRefused = false;
  try { engine.planMerchantTrade(deal2.dealId, [master]); } catch { masterRefused = true; }
  assert(masterRefused, '덱 마스터는 제물로 바칠 수 없어야 합니다.');
});

Deno.test('트레이더는 여러 장 보유한 카드라도 자기가 주는 카드를 요구하지 않는다 (시드 스윕)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage: new InMemoryBinderStorage() });
    const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, seed);
    engine.startNewRun(`RUN_SWEEP_${seed}`, seed);
    engine.selectFortuneDestiny(['BLUE_JUSTICE', 'RED_ZEAL', 'PURPLE_CHAOS'][seed % 3], 'CHECKPOINT');
    for (const deal of engine.state.suspiciousMerchant?.deals || []) {
      assert(
        !deal.wantedCardIds.includes(deal.rewardCardId),
        `seed ${seed} ${deal.dealType}: ${deal.rewardCardId}를 주면서 같은 카드를 요구합니다.`
      );
    }
  }
});

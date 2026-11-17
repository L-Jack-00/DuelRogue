/**
 * [DUEL ROGUE] 방식 B 시드 결정성 및 시드런 기록(바인더·명예의 전당) 격리 검증 테스트
 */
import {
  DuelRogueEngine,
  DEFAULT_CARD_CATALOG,
  BINDER_CATALOG,
  normalizeSeedInput,
} from '../src/duelRogueEngine.js';
import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { BinderCardState } from '../src/types.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[ASSERTION FAILED] ${msg}`);
}

Deno.test('시드 정규화: 숫자, 영숫자, 빈 문자열 처리', () => {
  const empty = normalizeSeedInput('   ');
  assert(empty.isSeeded === false && empty.numericSeed === null, '공백 시드는 일반 런으로 판별');

  const n1 = normalizeSeedInput(20261115);
  const n2 = normalizeSeedInput('20261115');
  assert(n1.isSeeded && n2.isSeeded, '숫자 시드 활성화');
  assert(n1.numericSeed === n2.numericSeed, '동일 숫자와 숫자 문자열은 같은 해시 시드');

  const a1 = normalizeSeedInput('DRAGON77');
  const a2 = normalizeSeedInput('  DRAGON77  ');
  const a3 = normalizeSeedInput('PHOENIX99');
  assert(a1.isSeeded && a1.numericSeed === a2.numericSeed && a1.seedText === 'DRAGON77', '문자열 시드 trim 정규화');
  assert(a1.numericSeed !== a3.numericSeed, '다른 문자열 시드는 다른 시드값 생성');
});

Deno.test('방식 B 시드 결정성: 상점 구매 순서가 달라도 팩·인카운터·다음 라운드가 동일', () => {
  const mkEngine = () => {
    const storage = new InMemoryBinderStorage();
    const binder = new BinderCore({ catalog: BINDER_CATALOG, storage });
    return new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG);
  };

  const parsed = normalizeSeedInput('BALATRO_STYLE_2026');
  const engA = mkEngine();
  const engB = mkEngine();

  engA.startNewRun('RUN_A', parsed.numericSeed, { isSeededRun: true, seedText: parsed.seedText });
  engB.startNewRun('RUN_B', parsed.numericSeed, { isSeededRun: true, seedText: parsed.seedText });

  const snapA1 = engA.selectFortuneDestiny('RED_ZEAL');
  const snapB1 = engB.selectFortuneDestiny('RED_ZEAL');

  assert(
    JSON.stringify(snapA1.checkpointEvent) === JSON.stringify(snapB1.checkpointEvent),
    '같은 시드의 라운드 1 돌발 이벤트가 동일해야 함',
  );
  assert(
    JSON.stringify(snapA1.checkpointShopStock) === JSON.stringify(snapB1.checkpointShopStock),
    '같은 시드의 라운드 1 상점 팩 진열이 동일해야 함',
  );
  assert(
    JSON.stringify(snapA1.nextEncounterInfo) === JSON.stringify(snapB1.nextEncounterInfo),
    '같은 시드의 라운드 1 인카운터 정보가 동일해야 함',
  );

  // Run A는 팩 구매 후 첫 번째 낱장을 사고 인카운터 진입, Run B는 인카운터에 바로 진입하지 않고 팩/낱장 순서를 바꿈
  const packsA = snapA1.checkpointShopStock;
  if (packsA.length >= 2) {
    const packFirstId = packsA[0].id;
    const packSecondId = packsA[1].id;

    // A: 0번 팩 구매 -> 1번 팩 구매
    const aBuy0 = engA.buyBoosterPack(packFirstId);
    const aBuy1 = engA.buyBoosterPack(packSecondId);

    // B: 먼저 낱장 구매 후 1번 팩 구매 -> 0번 팩 구매 (순서 역전 + 추가 소비 개입)
    if (snapB1.checkpointShopSingles.length > 0 && engB.state.gold >= snapB1.checkpointShopSingles[0].price + 1000) {
      engB.buyShopSingleCard(snapB1.checkpointShopSingles[0].cardId);
    }
    const bBuy1 = engB.buyBoosterPack(packSecondId);
    const bBuy0 = engB.buyBoosterPack(packFirstId);

    assert(
      JSON.stringify(aBuy0.choices) === JSON.stringify(bBuy0.choices),
      '구매 순서가 달라도 동일 팩의 개봉 결과는 동일해야 함 (0번 팩)',
    );
    assert(
      JSON.stringify(aBuy1.choices) === JSON.stringify(bBuy1.choices),
      '구매 순서가 달라도 동일 팩의 개봉 결과는 동일해야 함 (1번 팩)',
    );
  }

  // 인카운터 진입 후 생성되는 듀얼 시드 및 초기 패 동일 여부 검증
  const duelA = engA.startRandomEncounter().activeDuel;
  const duelB = engB.startRandomEncounter().activeDuel;
  assert(duelA.seed === duelB.seed, '상점 행동 순서와 무관하게 인카운터 듀얼 시드가 동일해야 함');
  assert(
    JSON.stringify(duelA.seats[0].hand.map((c: any) => c.cardId)) === JSON.stringify(duelB.seats[0].hand.map((c: any) => c.cardId)),
    '같은 시드/같은 덱이면 인카운터 초기 패도 동일해야 함',
  );

  // 인카운터 즉시 승리 -> 라운드 2 환경도 완전히 동일한지 확인
  duelA.seats[1].lp = 0;
  duelB.seats[1].lp = 0;
  const r2A = engA.evaluateDuelOutcome(duelA);
  const r2B = engB.evaluateDuelOutcome(duelB);
  assert(r2A.roundNumber === 2 && r2B.roundNumber === 2, '라운드 2 진입 확인');
  assert(
    JSON.stringify(r2A.checkpointShopStock) === JSON.stringify(r2B.checkpointShopStock),
    '라운드 2 상점 진열이 동일해야 함',
  );
  assert(
    JSON.stringify(r2A.nextEncounterInfo) === JSON.stringify(r2B.nextEncounterInfo),
    '라운드 2 인카운터가 동일해야 함',
  );
});

Deno.test('시드런 기록 격리: 바인더(발견/보유/숙련도) 및 명예의 전당 미반영 검증', () => {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({ catalog: BINDER_CATALOG, storage });
  const engine = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG);

  const parsed = normalizeSeedInput('ISOLATION_TEST_777');
  engine.startNewRun('RUN_SEED_ISO', parsed.numericSeed, {
    isSeededRun: true,
    seedText: parsed.seedText,
  });
  engine.selectFortuneDestiny('BLUE_JUSTICE');

  // 상점 팩 구매 & 낱장 구매
  if (engine.state.checkpointShopStock.length > 0) {
    engine.buyBoosterPack(engine.state.checkpointShopStock[0].id);
  }
  if (engine.state.checkpointShopSingles.length > 0) {
    const s = engine.state.checkpointShopSingles[0];
    if (engine.state.gold >= s.price) {
      engine.buyShopSingleCard(s.cardId);
    }
  }

  // 인카운터 카드 플레이 1회 시도 (내 손패에 1레벨 몬스터 또는 마법 있으면 플레이)
  const duelSnap = engine.startRandomEncounter();
  const playable = duelSnap.activeDuel.seats[0].hand.find((c: any) => c.type === 'MONSTER' && (c.level ?? 1) === 1);
  if (playable && duelSnap.activeDuel.activeSeat === 0) {
    engine.dispatchDuelCommand({
      type: 'PLAY_CARD',
      seat: 0,
      cardInstanceId: playable.instanceId,
    });
  }
  // 인카운터 종료 후 최종 보스 도전 및 클리어
  engine.state.activeDuel.seats[1].lp = 0;
  engine.evaluateDuelOutcome(engine.state.activeDuel);
  engine.challengeFinalBoss();
  engine.state.activeDuel.seats[1].lp = 0;
  const victorySnap = engine.evaluateDuelOutcome(engine.state.activeDuel);

  assert(victorySnap.phase === 'RUN_VICTORY', '시드 런 보스 승리 전환 확인');
  assert(victorySnap.hallOfFameSnapshot === null, '시드 런은 명예의 전당 스냅샷이 등록되지 않아야 함');

  // 바인더 모든 엔트리가 여전히 UNKNOWN / mastery 0인지 검증
  for (const [cardId, entry] of Object.entries(binder.entries)) {
    assert(
      entry.state === BinderCardState.UNKNOWN && entry.masteryPoints === 0,
      `시드 런에서는 바인더가 갱신되면 안 됩니다. (${cardId}: state=${entry.state}, mastery=${entry.masteryPoints})`,
    );
  }

  // 대조군: 일반 런은 바인더 및 명예의 전당이 정상 등록되는지 확인
  engine.startNewRun('RUN_NORMAL_VERIFY', 20261115, { isSeededRun: false });
  engine.selectFortuneDestiny('RED_ZEAL');
  const ownedCount = Object.values(binder.entries).filter((e) => e.state >= BinderCardState.OWNED).length;
  assert(ownedCount > 0, '일반 런은 바인더 보유 기록이 정상 반영되어야 함');

  engine.challengeFinalBoss();
  engine.state.activeDuel.seats[1].lp = 0;
  const normalVictory = engine.evaluateDuelOutcome(engine.state.activeDuel);
  assert(normalVictory.phase === 'RUN_VICTORY' && normalVictory.hallOfFameSnapshot !== null, '일반 런은 명예의 전당에 정상 등록되어야 함');
});

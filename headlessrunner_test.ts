/**
 * @file headlessrunner_test.ts
 * @description Headless 자체 테스트 러너 (기둥 2)
 * 실제 게임(main.js)이 사용하는 src/*.js 모듈을 대상으로 검증한다. (루트의 구버전 .ts 사본이 아님)
 * 실행: deno test --no-check headlessrunner_test.ts
 * 브라우저나 Tauri 창을 띄우지 않고 순수 메모리 어댑터 상에서:
 *  1) 3x3 바인더 상태 전이 4단계 (UNKNOWN -> DISCOVERED -> OWNED -> MASTERED) 및 역방향 강등 방지 불변식
 *  2) 점쟁이 3가지 운명 선택과 카운터 성향 최종 보스 매칭 검증
 *  3) 5단계 선형 인카운터 런 완주 (운명 선택 -> 1차전 -> 보상 팩 -> 2차전 -> 상인/이벤트 -> 최종 보스 격파)
 *  4) 카드 물리 틸트(Tilt) 수학 공식 경계값 검증
 * 을 0.2초(200ms) 이내에 전수 검증합니다.
 */

import { BinderCore, InMemoryBinderStorage } from './src/binderCore.js';
import { computeCardTiltTransform } from './src/desktopHarness.js';
import { DEFAULT_CARD_CATALOG, DuelRogueEngine } from './src/duelRogueEngine.js';
import { BinderCardState } from './src/types.js';

type DestinyColor = 'BLUE_JUSTICE' | 'RED_ZEAL' | 'PURPLE_CHAOS';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

/**
 * 테스트 1: 3x3 바인더 북 4단계 단방향 상태 전이 및 불변식 검증
 */
function testBinderFourStageTransitions(): void {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({
    catalog: DEFAULT_CARD_CATALOG,
    storage,
    masteryThreshold: 100,
  });

  const targetCardId = 'C_BLUE_01';

  // 1단계: 초기 상태 UNKNOWN (0)
  let page0 = binder.getPageView(0);
  assert(page0.slots.length === 9, '3x3 바인더 한 페이지는 정확히 9슬롯이어야 합니다.');
  assert(
    page0.slots[0].state === BinderCardState.UNKNOWN && page0.slots[0].cardName === '???',
    '미발견 카드는 UNKNOWN 상태이며 이름이 ???로 마스킹되어야 합니다.'
  );

  // 2단계: 카드 목격 -> DISCOVERED (1)
  binder.recordCardSeen(targetCardId);
  page0 = binder.getPageView(0);
  assert(
    page0.slots[0].state === BinderCardState.DISCOVERED &&
      page0.slots[0].visualMode === 'GRAYSCALE_SILHOUETTE' &&
      page0.slots[0].canInspectDetail === true,
    '목격된 카드는 DISCOVERED(흑백 실루엣) 상태이며 상세 열람이 가능해야 합니다.'
  );

  // 3단계: 카드 획득 -> OWNED (2)
  binder.recordCardAcquired(targetCardId);
  page0 = binder.getPageView(0);
  assert(
    page0.slots[0].state === BinderCardState.OWNED && page0.slots[0].visualMode === 'FULL_COLOR',
    '획득한 카드는 OWNED(정식 컬러) 상태여야 합니다.'
  );

  // 역방향 전이 방지 불변식 테스트: 이미 OWNED인 카드를 다시 목격(Seen)해도 DISCOVERED로 강등되지 않음
  binder.recordCardSeen(targetCardId);
  assert(
    binder.getEntry(targetCardId).state === BinderCardState.OWNED,
    'OWNED 상태인 카드는 recordCardSeen 호출 시 DISCOVERED로 강등되면 안 됩니다.'
  );

  // 4단계: 카드 반복 사용으로 숙련도 100 달성 -> MASTERED (3)
  binder.recordCardPlayed(targetCardId, 50);
  assert(
    binder.getEntry(targetCardId).state === BinderCardState.OWNED,
    '숙련도 50/100일 때는 아직 OWNED 상태를 유지해야 합니다.'
  );
  binder.recordCardPlayed(targetCardId, 50);
  page0 = binder.getPageView(0);
  assert(
    page0.slots[0].state === BinderCardState.MASTERED &&
      page0.slots[0].visualMode === 'HOLOGRAM_AURA' &&
      page0.slots[0].isMasteryBadgeVisible === true &&
      page0.slots[0].masteryPoints === 100,
    '숙련도 100 달성 시 MASTERED(홀로그램 오라) 상태로 승격되어야 합니다.'
  );
}

/**
 * 테스트 2: 점쟁이의 3가지 운명 선택과 최종 보스 아키타입 매칭 검증
 */
function testFortuneTellerBossMatching(): void {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
  const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 42);

  const expectedMatrix: ReadonlyArray<[DestinyColor, string]> = [
    ['BLUE_JUSTICE', 'BOSS_RED_UNSTOPPABLE_AGGRO'],
    ['RED_ZEAL', 'BOSS_BLUE_FORTRESS_CONTROL'],
    ['PURPLE_CHAOS', 'BOSS_PURPLE_RIGGED_FATE'],
  ];

  for (const [destiny, expectedBoss] of expectedMatrix) {
    engine.startNewRun(`RUN_${destiny}`, 100);
    const snap = engine.selectFortuneDestiny(destiny);
    assert(
      snap.assignedFinalBoss === expectedBoss,
      `운명 ${destiny} 선택 시 최종 보스는 ${expectedBoss}여야 합니다. (실제: ${snap.assignedFinalBoss})`
    );
  }
}

/**
 * 대칭형 듀얼 자동 승리 드라이버 (Headless 테스트용)
 * 플레이어(Seat 0)가 매 턴 마나 내에서 카드를 플레이하고 상대 LP를 0으로 만들 때까지 대칭 커맨드를 실행합니다.
 */
function playOutSymmetricDuel(engine: any): void {
  let safetyCounter = 0;
  while (engine.getSnapshot().activeDuel?.status === 'ONGOING') {
    safetyCounter += 1;
    if (safetyCounter > 60) {
      throw new Error('Duel exceeded maximum turn safety limit.');
    }

    let snap = engine.getSnapshot();
    const duel = snap.activeDuel!;

    if (duel.activeSeat === 0) {
      // 플레이어 턴: 손패에서 사용 가능한 모든 카드 사용
      let played = true;
      while (played && engine.getSnapshot().activeDuel?.status === 'ONGOING') {
        played = false;
        snap = engine.getSnapshot();
        const player = snap.activeDuel!.seats[0];
        for (const cardInst of player.hand) {
          const def = DEFAULT_CARD_CATALOG.find((c: any) => c.id === cardInst.cardId)!;
          if (
            player.mana >= def.cost &&
            (def.effectType !== 'SUMMON_UNIT' || player.board.length < 5)
          ) {
            engine.dispatchDuelCommand({
              type: 'PLAY_CARD',
              seat: 0,
              cardInstanceId: cardInst.instanceId,
            });
            played = true;
            break;
          }
        }
      }

      // 공격 가능한 모든 플레이어 유닛으로 상대 본체 직접 타격
      snap = engine.getSnapshot();
      if (snap.activeDuel?.status === 'ONGOING') {
        for (const unit of snap.activeDuel.seats[0].board) {
          if (unit.canAttack && engine.getSnapshot().activeDuel?.status === 'ONGOING') {
            engine.dispatchDuelCommand({
              type: 'ATTACK',
              seat: 0,
              attackerInstanceId: unit.instanceId,
            });
          }
        }
      }

      // 아직 듀얼이 진행 중이면 턴 종료
      if (engine.getSnapshot().activeDuel?.status === 'ONGOING') {
        engine.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
      }
    } else {
      // 상대 CPU 턴 실행
      engine.executeCpuTurn();
    }
  }
}

/**
 * 현재 진행 중인 듀얼을 플레이어 승리로 확정 (단계 전이 검증용)
 * 자동 플레이 드라이버의 승패는 덱/AI 밸런스에 좌우되므로 런 진행 검증과 분리한다.
 */
function forceDuelVictory(engine: any): void {
  const duel = engine.getSnapshot().activeDuel;
  assert(duel && duel.status === 'ONGOING', '승리 처리할 진행 중인 듀얼이 있어야 합니다.');
  duel.seats[1].lp = 0;
  engine.evaluateDuelOutcome(duel);
}

/**
 * 테스트 3: 5단계 선형 인카운터 런 완주 및 실시간 바인더 연동 통합 검증
 */
function testFullLinearRunCompletion(): void {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
  const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 20261015);

  // [Stage 0] 런 시작 및 빨간색(열의 - 어그로 특화) 운명 선택
  let snap: any = engine.startNewRun('RUN_FULL_E2E', 20261015);
  assert(snap.phase === 'STAGE_0_FORTUNE', '시작 직후 단계는 STAGE_0_FORTUNE이어야 합니다.');

  snap = engine.selectFortuneDestiny('RED_ZEAL');
  assert(snap.phase === 'STAGE_1_DUEL_1', '운명 선택 직후 1차전(STAGE_1_DUEL_1)으로 진입해야 합니다.');
  assert(
    snap.assignedFinalBoss === 'BOSS_BLUE_FORTRESS_CONTROL',
    '빨간색 운명 선택 시 파란색 요새 컨트롤 최종 보스가 배정되어야 합니다.'
  );
  assert(
    binder.getEntry('C_RED_01').state === BinderCardState.OWNED,
    '시작 덱에 포함된 카드는 즉시 바인더 OWNED 상태여야 합니다.'
  );

  // [Stage 1] 1차전 CPU 듀얼 승리 -> [Stage 2] 카드 팩 개봉 단계로 자동 전이
  forceDuelVictory(engine);
  snap = engine.getSnapshot();
  assert(
    snap.phase === 'STAGE_2_REWARD_PACK',
    '1차전 승리 후 보상 카드 팩 개봉(STAGE_2_REWARD_PACK)으로 전이되어야 합니다.'
  );
  assert(snap.currentRewardPackChoices.length === 3, '카드 팩 개봉 시 3장의 후보가 제시되어야 합니다.');

  // 팩에 제시된 카드는 선택 여부와 무관하게 최소 DISCOVERED 이상으로 기록되어야 한다.
  // (현 30장 시작 덱은 보상 팩 3장을 모두 포함하므로 OWNED일 수 있다. 미보유→DISCOVERED 전이는 Suite 1에서 검증)
  for (const cid of snap.currentRewardPackChoices) {
    assert(
      binder.getEntry(cid).state >= BinderCardState.DISCOVERED,
      `팩 개봉 시 제시된 카드 ${cid}는 바인더에 DISCOVERED 이상으로 기록되어야 합니다.`
    );
  }

  // [Stage 2 -> Stage 3] 보상 팩에서 'C_RED_02' 선택 후 2차전 CPU 듀얼 진입
  snap = engine.pickRewardPackCard('C_RED_02');
  assert(snap.phase === 'STAGE_3_DUEL_2', '보상 팩 선택 직후 2차전(STAGE_3_DUEL_2)으로 진입해야 합니다.');

  // [Stage 3 -> Stage 4] 2차전 CPU 듀얼 승리 -> 상인/이벤트 인카운터 진입
  forceDuelVictory(engine);
  snap = engine.getSnapshot();
  assert(
    snap.phase === 'STAGE_4_MERCHANT_EVENT',
    '2차전 승리 후 상인/이벤트(STAGE_4_MERCHANT_EVENT)로 전이되어야 합니다.'
  );

  // [Stage 4 -> Stage 5] 상인 이벤트에서 주력 카드 숙련도 연마 선택 -> 최종 보스전 진입
  const masteryTargetCard = snap.currentMerchantOffer.bonusMasteryCardId;
  snap = engine.resolveMerchantEvent('TRAIN_MASTERY');
  assert(
    binder.getEntry(masteryTargetCard).state === BinderCardState.MASTERED,
    '상인 숙련도 연마를 거친 주력 카드는 MASTERED 상태로 승격되어야 합니다.'
  );
  assert(
    snap.phase === 'STAGE_5_FINAL_BOSS',
    '상인 이벤트 완료 후 운명 대응 최종 보스전(STAGE_5_FINAL_BOSS)으로 진입해야 합니다.'
  );
  assert(
    snap.activeDuel?.seats[1].duelistId === 'BOSS_BLUE_FORTRESS_CONTROL',
    '최종 보스전 상대는 점쟁이 운명에 매칭된 보스여야 합니다.'
  );

  // [Stage 5 -> RUN_VICTORY] 최종 보스 격파 및 명예의 전당 스냅샷 생성 확인
  forceDuelVictory(engine);
  snap = engine.getSnapshot();
  assert(snap.phase === 'RUN_VICTORY', '최종 보스 격파 시 RUN_VICTORY 상태에 도달해야 합니다.');
  assert(
    snap.hallOfFameSnapshot !== null &&
      snap.hallOfFameSnapshot.defeatedBossId === 'BOSS_BLUE_FORTRESS_CONTROL',
    '런 완주 시 온라인 명예의 전당 등록용 덱 스냅샷이 생성되어야 합니다.'
  );
}

/**
 * 테스트 4: 데스크톱 하네스 3D 물리 틸트(Tilt) 수식 검증
 */
function testDesktopCardTiltPhysicsMath(): void {
  const cardRect = { left: 100, top: 100, width: 200, height: 300 };
  // 카드 정중앙(200, 250) 포인터 위치 시 회전각은 0도여야 함
  const centerTilt = computeCardTiltTransform(200, 250, cardRect);
  assert(
    centerTilt.rotateXDeg === 0 && centerTilt.rotateYDeg === 0,
    '카드 정중앙 포인터 위치에서 틸트 회전각은 (0, 0)이어야 합니다.'
  );

  // 창 밖으로 멀리 벗어난 극단적 포인터 좌표(5000, -5000)에서도 최대 각도(±15도)로 안전하게 클램핑되어야 함
  const extremeTilt = computeCardTiltTransform(5000, -5000, cardRect, 200, 250, 15);
  assert(
    extremeTilt.rotateXDeg === 15 && extremeTilt.rotateYDeg === 15,
    '마우스가 창 밖으로 이탈해도 틸트 회전각은 ±maxTiltDeg 범위로 클램핑되어야 합니다.'
  );
}

/**
 * 테스트 5: 자동 플레이 드라이버가 대칭 듀얼을 예외 없이 끝까지 진행 (커맨드 경로 스모크 테스트)
 * 승패는 검증하지 않는다. 듀얼이 제한 턴 안에 종료(승/패)되는지만 본다.
 */
function testSymmetricDuelPlaysToCompletion(): void {
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage: new InMemoryBinderStorage() });
  const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 20261015);
  engine.startNewRun('RUN_FULL_E2E', 20261015);
  engine.selectFortuneDestiny('RED_ZEAL');
  playOutSymmetricDuel(engine);
  const snap = engine.getSnapshot();
  assert(
    snap.activeDuel.status === 'SEAT_0_WIN' || snap.activeDuel.status === 'SEAT_1_WIN',
    `듀얼이 승패로 종료되어야 합니다. (실제: ${snap.activeDuel.status})`
  );
  assert(
    snap.phase === (snap.activeDuel.status === 'SEAT_0_WIN' ? 'STAGE_2_REWARD_PACK' : 'RUN_FAILED'),
    `듀얼 결과에 맞는 단계로 전이되어야 합니다. (실제: ${snap.phase})`
  );
}

Deno.test('Suite 1: 3x3 바인더 4단계 단방향 상태 전이', testBinderFourStageTransitions);
Deno.test('Suite 2: 점술관 3대 운명 → 최종 보스 매칭', testFortuneTellerBossMatching);
Deno.test('Suite 3: 5단계 선형 런 진행 및 바인더 연동', testFullLinearRunCompletion);
Deno.test('Suite 4: 카드 틸트 물리 클램프', testDesktopCardTiltPhysicsMath);
Deno.test('Suite 5: 자동 플레이 대칭 듀얼 완주 스모크', testSymmetricDuelPlaysToCompletion);

Deno.test('성능: Suite 1~4 전체 200ms 이내', () => {
  const start = performance.now();
  testBinderFourStageTransitions();
  testFortuneTellerBossMatching();
  testFullLinearRunCompletion();
  testDesktopCardTiltPhysicsMath();
  const elapsedMs = performance.now() - start;
  assert(elapsedMs < 200, `성능 목표(200ms 이내) 초과: ${elapsedMs.toFixed(3)}ms`);
});

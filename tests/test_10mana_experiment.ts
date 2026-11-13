/**
 * @file test_10mana_experiment.ts
 * @description 사용자 제안: "서로 마나 차감 없이 처음부터 10마나로 시작" 시뮬레이션
 */

import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { DEFAULT_CARD_CATALOG, DuelRogueEngine } from '../src/duelRogueEngine.js';

function run10ManaSim(matchCount = 1000) {
  let firstWins = 0;
  let totalTurns = 0;
  let highCostMasterWins = 0;
  let highCostMasterMatches = 0;

  for (let i = 0; i < matchCount; i++) {
    const storage = new InMemoryBinderStorage();
    const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage, masteryThreshold: 100 });
    const seed = 300000 + i * 17;
    const engine = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, seed);

    engine.startNewRun(`SIM_${i}`, seed);
    engine.selectFortuneDestiny(i % 2 === 0 ? 'BLUE_JUSTICE' : 'RED_ZEAL');

    const duel = engine.state.activeDuel;
    if (!duel) continue;

    // [실험 조건]: 선공/후공 모두 마나 차감 없이 10마나로 세팅!
    duel.seats[0].maxMana = 10;
    duel.seats[0].mana = 10;
    duel.seats[1].maxMana = 10;
    duel.seats[1].mana = 10;

    // 덱 마스터 코스트 차이 추적
    const c0 = duel.seats[0].deckMasterCardId ? (engine.getCardDef(duel.seats[0].deckMasterCardId)?.cost || 1) : 1;
    const c1 = duel.seats[1].deckMasterCardId ? (engine.getCardDef(duel.seats[1].deckMasterCardId)?.cost || 1) : 1;
    const hasCostDiff = c0 !== c1;
    if (hasCostDiff) highCostMasterMatches++;

    const maxTurns = 50;
    while (duel.status === 'ONGOING' && duel.turnNumber <= maxTurns) {
      const activeSeat = duel.activeSeat;
      const actor = duel.seats[activeSeat];
      const opponent = duel.seats[activeSeat === 0 ? 1 : 0];

      // 카드 플레이
      let played = true;
      let playLoops = 0;
      while (played && duel.status === 'ONGOING' && playLoops < 10) {
        played = false;
        playLoops++;
        for (const cardInst of [...actor.hand]) {
          const def = engine.getCardDef(cardInst.cardId);
          if (actor.mana >= def.cost) {
            if (def.type === 'MONSTER' && actor.board.length < 5) {
              try {
                engine.dispatchDuelCommand({ type: 'PLAY_CARD', seat: activeSeat, cardInstanceId: cardInst.instanceId });
                played = true;
                break;
              } catch (e) {}
            } else if (def.type === 'SPELL') {
              try {
                if (def.spellTriggerType === 'INSTANT') {
                  engine.dispatchDuelCommand({ type: 'PLAY_CARD', seat: activeSeat, cardInstanceId: cardInst.instanceId });
                  played = true;
                  break;
                } else if (actor.board.length > 0) {
                  engine.dispatchDuelCommand({
                    type: 'SET_SPELL',
                    seat: activeSeat,
                    cardInstanceId: cardInst.instanceId,
                    slotType: 'MONSTER_FRONT',
                    targetMonsterInstanceId: actor.board[0].instanceId,
                  });
                  played = true;
                  break;
                }
              } catch (e) {}
            }
          }
        }
      }

      // 공격 판정 (선공 1턴만 공격 불가)
      const isFirstTurnFirstPlayer = duel.turnNumber === 1 && duel.firstTurnNoAttack && duel.firstPlayerSeat === activeSeat;
      if (duel.status === 'ONGOING' && !isFirstTurnFirstPlayer) {
        for (const unit of [...actor.board]) {
          if (unit.canAttack && duel.status === 'ONGOING') {
            let targetUnit = null;
            if (opponent.board.length > 0) {
              const killable = opponent.board.find((u) => unit.currentAttack > (u.currentDefense ?? 10));
              targetUnit = killable || opponent.board[0];
            }

            try {
              engine.dispatchDuelCommand({
                type: 'ATTACK',
                seat: activeSeat,
                attackerInstanceId: unit.instanceId,
                targetInstanceId: targetUnit ? targetUnit.instanceId : undefined,
              });
            } catch (e) {}
          }
        }
      }

      if (duel.status === 'ONGOING') {
        try {
          engine.dispatchDuelCommand({ type: 'END_TURN', seat: activeSeat });
        } catch (e) {
          break;
        }
      }
    }

    const winnerSeat = duel.status === 'SEAT_0_WIN' ? 0 : duel.status === 'SEAT_1_WIN' ? 1 : (duel.seats[0].lp > duel.seats[1].lp ? 0 : 1);
    if (winnerSeat === duel.firstPlayerSeat) firstWins++;
    totalTurns += duel.turnNumber;

    if (hasCostDiff) {
      const highCostSeat = c0 > c1 ? 0 : 1;
      if (winnerSeat === highCostSeat) highCostMasterWins++;
    }
  }

  console.log(`[양쪽 모두 10마나 시작 (마나 차감 없음)] 결과 (총 ${matchCount}판)`);
  console.log(`  - 선공 승률: ${((firstWins / matchCount) * 100).toFixed(1)}%`);
  console.log(`  - 후공 승률: ${(((matchCount - firstWins) / matchCount) * 100).toFixed(1)}%`);
  console.log(`  - 평균 턴 수: ${(totalTurns / matchCount).toFixed(1)}턴`);
  if (highCostMasterMatches > 0) {
    console.log(`  - 덱 마스터 코스트가 더 높은 쪽 승률: ${((highCostMasterWins / highCostMasterMatches) * 100).toFixed(1)}% (${highCostMasterWins}/${highCostMasterMatches})`);
  }
}

run10ManaSim(1000);

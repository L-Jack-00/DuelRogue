/**
 * @file test_balance_solutions.ts
 * @description 선/후 50:50 밸런스를 맞추기 위한 해결책 시뮬레이션
 */

import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { DEFAULT_CARD_CATALOG, DuelRogueEngine } from '../src/duelRogueEngine.js';

interface SolutionConfig {
  name: string;
  startManaSeat0: number;
  startManaSeat1: number;
  firstPlayerFirstTurnAttack: boolean;
  secondPlayerFirstTurnAttack: boolean;
}

function testSolution(cfg: SolutionConfig, matchCount = 1000) {
  let firstWins = 0;
  let totalTurns = 0;

  for (let i = 0; i < matchCount; i++) {
    const storage = new InMemoryBinderStorage();
    const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage, masteryThreshold: 100 });
    const seed = 500000 + i * 23;
    const engine = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, seed);

    engine.startNewRun(`SIM_${i}`, seed);
    engine.selectFortuneDestiny(i % 2 === 0 ? 'BLUE_JUSTICE' : 'RED_ZEAL');

    const duel = engine.state.activeDuel;
    if (!duel) continue;

    const firstSeat = duel.firstPlayerSeat;
    const secondSeat = firstSeat === 0 ? 1 : 0;

    duel.seats[firstSeat].maxMana = cfg.startManaSeat0;
    duel.seats[firstSeat].mana = cfg.startManaSeat0;
    duel.seats[secondSeat].maxMana = cfg.startManaSeat1;
    duel.seats[secondSeat].mana = cfg.startManaSeat1;

    let turnsCount = 0;
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

      // 공격 판정
      // duel.turnNumber === 1: 선공 첫 턴
      // duel.turnNumber === 2: 후공 첫 턴
      let canAttackThisTurn = true;
      if (duel.turnNumber === 1 && !cfg.firstPlayerFirstTurnAttack) {
        canAttackThisTurn = false;
      }
      if (duel.turnNumber === 2 && !cfg.secondPlayerFirstTurnAttack) {
        canAttackThisTurn = false;
      }

      if (duel.status === 'ONGOING' && canAttackThisTurn) {
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
  }

  const fRate = ((firstWins / matchCount) * 100).toFixed(1);
  const sRate = (((matchCount - firstWins) / matchCount) * 100).toFixed(1);
  console.log(`[${cfg.name}]`);
  console.log(`  -> 선공: ${fRate}% | 후공: ${sRate}% (평균 ${(totalTurns / matchCount).toFixed(1)}턴)\n`);
}

console.log('🧪 선/후공 황금 밸런스 후보군 시뮬레이션 (각 1,000회)\n');

// 솔루션 1: 양쪽 10마나 + 선/후공 모두 첫 턴은 전개만(공격 불가), 2턴(선공 두번째 턴)부터 전면 교전
testSolution({
  name: '솔루션 1: 양쪽 10마나 + 첫 바퀴(선공 1턴 & 후공 1턴) 공격 불가 (전개 준비)',
  startManaSeat0: 10,
  startManaSeat1: 10,
  firstPlayerFirstTurnAttack: false,
  secondPlayerFirstTurnAttack: false,
}, 1000);

// 솔루션 2: 선공 10마나 vs 후공 5마나 (점진적 마나 빌드업)
testSolution({
  name: '솔루션 2: 선공 10마나(공격불가) vs 후공 6마나(공격가능)',
  startManaSeat0: 10,
  startManaSeat1: 6,
  firstPlayerFirstTurnAttack: false,
  secondPlayerFirstTurnAttack: true,
}, 1000);

// 솔루션 3: 선공 10마나(공격가능) vs 후공 10마나(공격가능) - 선공도 1턴부터 공격 가능!
testSolution({
  name: '솔루션 3: 선공도 1턴 공격 허용 (단, 1턴엔 덱마스터만 존재하므로 덱마스터 간 격돌)',
  startManaSeat0: 10,
  startManaSeat1: 10,
  firstPlayerFirstTurnAttack: true,
  secondPlayerFirstTurnAttack: true,
}, 1000);

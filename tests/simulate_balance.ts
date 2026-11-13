/**
 * @file simulate_balance.ts
 * @description 엘잭 하네스 기반 공식 듀얼 밸런스 헤드리스 시뮬레이터 (v4.0)
 * [노마나 소환권 & 계단식 진화 / 합산 릴리스 공식 적용 검증]
 * - 마나 시스템 완전 제거 & 턴당 1회 일반 소환권
 * - 1레벨 계단식 진화: 단일 제물로 1단계 높은 레벨 소환
 * - 2레벨 이상 도약: 제물 몬스터들의 레벨 합산 >= 소환 대상 레벨
 * - 덱 마스터: 양쪽 모두 Lv 1 스타터로 1턴 즉시 필드 배치, 공평 코인토스 선공 결정
 * - 마법: 코스트 없이 자유 발동 및 세트
 * - 1라운드(1~2턴) 공격 봉인, 3턴부터 전투 공격 해금
 */

import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { DEFAULT_CARD_CATALOG, DuelRogueEngine } from '../src/duelRogueEngine.js';

interface SimulationReport {
  matchCount: number;
  firstWins: number;
  secondWins: number;
  playerWins: number;
  cpuWins: number;
  destinyStats: Record<string, { matches: number; wins: number; winRate: string }>;
  avgTurns: number;
  avgKills: number;
  avgDirectAttacks: number;
  avgPierceDamage: number;
  avgRecoilDamage: number;
  stepUpEvolutions: number;
  summationTributes: number;
  lv1DirectSummons: number;
  stallMatches: number;
}

export function runOfficialSimulation(matchCount: number = 1000): SimulationReport {
  let firstWins = 0;
  let secondWins = 0;
  let playerWins = 0;
  let cpuWins = 0;
  let totalTurns = 0;
  let totalKills = 0;
  let totalDirect = 0;
  let totalPierce = 0;
  let totalRecoil = 0;
  let stepUpEvolutions = 0;
  let summationTributes = 0;
  let lv1DirectSummons = 0;
  let stallMatches = 0;

  const destinies = ['BLUE_JUSTICE', 'RED_ZEAL', 'PURPLE_CHAOS'];
  const destinyStats: Record<string, { matches: number; wins: number }> = {
    BLUE_JUSTICE: { matches: 0, wins: 0 },
    RED_ZEAL: { matches: 0, wins: 0 },
    PURPLE_CHAOS: { matches: 0, wins: 0 },
  };

  for (let i = 0; i < matchCount; i++) {
    const storage = new InMemoryBinderStorage();
    const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage, masteryThreshold: 100 });
    const seed = 20261102 + i * 23;
    const engine = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, seed);

    const destiny = destinies[i % destinies.length];
    engine.startNewRun(`RUN_${i}`, seed);
    engine.selectFortuneDestiny(destiny);

    const duel: any = engine.state.activeDuel;
    if (!duel) continue;

    let duelKills = 0;
    let duelDirect = 0;
    let duelPierce = 0;
    let duelRecoil = 0;

    const maxTurns = 60;
    while (duel.status === 'ONGOING' && duel.turnNumber <= maxTurns) {
      const activeSeat = duel.activeSeat;
      const actor = duel.seats[activeSeat];
      const opponent = duel.seats[activeSeat === 0 ? 1 : 0];

      // 1. 마법 카드 자유 발동 및 세트
      for (const cardInst of [...actor.hand]) {
        if (duel.status !== 'ONGOING') break;
        const def = engine.getCardDef(cardInst.cardId);
        if (def && def.type === 'SPELL') {
          const allowed = def.allowedSlots || ['MONSTER_FRONT', 'FIELD_LEFT', 'FIELD_RIGHT'];
          try {
            if (def.spellTriggerType === 'INSTANT') {
              engine.dispatchDuelCommand({
                type: 'PLAY_CARD',
                seat: activeSeat,
                cardInstanceId: cardInst.instanceId,
              });
            } else if (allowed.includes('MONSTER_FRONT') && actor.board.length > 0) {
              const targetUnit = actor.board.find(
                (u: any) => !actor.setSpells.some((s: any) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === u.instanceId)
              );
              if (targetUnit) {
                engine.dispatchDuelCommand({
                  type: 'SET_SPELL',
                  seat: activeSeat,
                  cardInstanceId: cardInst.instanceId,
                  slotType: 'MONSTER_FRONT',
                  targetMonsterInstanceId: targetUnit.instanceId,
                });
              }
            } else if (allowed.includes('FIELD_LEFT') && !duel.fieldSetSlots.left) {
              engine.dispatchDuelCommand({
                type: 'SET_SPELL',
                seat: activeSeat,
                cardInstanceId: cardInst.instanceId,
                slotType: 'FIELD_LEFT',
              });
            } else if (allowed.includes('FIELD_RIGHT') && !duel.fieldSetSlots.right) {
              engine.dispatchDuelCommand({
                type: 'SET_SPELL',
                seat: activeSeat,
                cardInstanceId: cardInst.instanceId,
                slotType: 'FIELD_RIGHT',
              });
            }
          } catch (e) {}
        }
      }

      // 2. 몬스터 소환 (소환권 1회 활용)
      if ((actor.normalSummonsRemaining ?? 0) > 0 && duel.status === 'ONGOING') {
        const monsterCards = actor.hand
          .map((c: any) => ({ inst: c, def: engine.getCardDef(c.cardId) }))
          .filter((item: any) => item.def && (item.def.type === 'MONSTER' || item.def.effectType === 'SUMMON_UNIT'));

        let summoned = false;

        // 2-1. 계단식 진화 소환 우선 탐색
        for (const m of monsterCards) {
          const targetLevel = m.def.level ?? m.def.cost ?? 1;
          if (targetLevel >= 2) {
            const stepUpCand = actor.board.find((u: any) => targetLevel - (u.level || 1) <= 1);
            if (stepUpCand) {
              try {
                engine.dispatchDuelCommand({
                  type: 'PLAY_CARD',
                  seat: activeSeat,
                  cardInstanceId: m.inst.instanceId,
                  tributeInstanceIds: [stepUpCand.instanceId],
                });
                stepUpEvolutions++;
                summoned = true;
                break;
              } catch (e) {}
            }
          }
        }

        // 2-2. 합산 릴리스 소환 탐색
        if (!summoned && actor.board.length >= 2) {
          for (const m of monsterCards) {
            const targetLevel = m.def.level ?? m.def.cost ?? 1;
            if (targetLevel >= 3) {
              const sortedBoard = [...actor.board].sort((a: any, b: any) => (a.level || 1) - (b.level || 1));
              let sum = 0;
              const tribs: string[] = [];
              for (const u of sortedBoard) {
                sum += u.level || 1;
                tribs.push(u.instanceId);
                if (sum >= targetLevel) break;
              }
              if (sum >= targetLevel) {
                try {
                  engine.dispatchDuelCommand({
                    type: 'PLAY_CARD',
                    seat: activeSeat,
                    cardInstanceId: m.inst.instanceId,
                    tributeInstanceIds: tribs,
                  });
                  summationTributes++;
                  summoned = true;
                  break;
                } catch (e) {}
              }
            }
          }
        }

        // 2-3. Lv 1 일반 소환
        if (!summoned && actor.board.length < 5) {
          const lv1 = monsterCards.find((m: any) => (m.def.level ?? m.def.cost ?? 1) === 1);
          if (lv1) {
            try {
              engine.dispatchDuelCommand({
                type: 'PLAY_CARD',
                seat: activeSeat,
                cardInstanceId: lv1.inst.instanceId,
              });
              lv1DirectSummons++;
              summoned = true;
            } catch (e) {}
          }
        }
      }

      // 3. 공격 단계 (3턴부터 본격 전투 공격)
      if (duel.status === 'ONGOING' && duel.turnNumber >= 3) {
        const units = [...actor.board].sort((a: any, b: any) => b.currentAttack - a.currentAttack);
        for (const unit of units) {
          if (unit.canAttack && duel.status === 'ONGOING') {
            let targetUnit: any = null;
            if (opponent.board.length > 0) {
              const killable = opponent.board.filter((u: any) => unit.currentAttack > u.currentDefense);
              if (killable.length > 0) {
                targetUnit = killable.sort((a: any, b: any) => b.currentDefense - a.currentDefense)[0];
              } else {
                // 처치 가능한 유닛이 없다면: 반사 피해(DEF > ATK)를 피하기 위해 공격 자제.
                // 단, DEF == ATK인 유닛이 있다면 반사 피해가 0이므로 공격 가능
                const safeEqual = opponent.board.find((u: any) => unit.currentAttack === u.currentDefense);
                if (safeEqual) {
                  targetUnit = safeEqual;
                } else {
                  continue; // 수비 반사 피해 회피
                }
              }
            }

            try {
              const oppBoardCountBefore = opponent.board.length;
              engine.dispatchDuelCommand({
                type: 'ATTACK',
                seat: activeSeat,
                attackerInstanceId: unit.instanceId,
                targetInstanceId: targetUnit ? targetUnit.instanceId : undefined,
              });

              if (!targetUnit) duelDirect++;
              if (opponent.board.length < oppBoardCountBefore) duelKills++;
              const pierce = engine.lastAttackResult?.pierceDamage || 0;
              if (pierce > 0) duelPierce += pierce;
              const recoil = engine.lastAttackResult?.recoilDamage || 0;
              if (recoil > 0) duelRecoil += recoil;
            } catch (e) {}
          }
        }
      }

      // 4. 턴 종료
      if (duel.status === 'ONGOING') {
        try {
          engine.dispatchDuelCommand({ type: 'END_TURN', seat: activeSeat });
        } catch (e) {
          break;
        }
      }
    }

    const winnerSeat =
      duel.status === 'SEAT_0_WIN'
        ? 0
        : duel.status === 'SEAT_1_WIN'
        ? 1
        : duel.seats[0].lp > duel.seats[1].lp
        ? 0
        : 1;

    destinyStats[destiny].matches++;
    if (winnerSeat === 0) {
      playerWins++;
      destinyStats[destiny].wins++;
    } else {
      cpuWins++;
    }

    if (winnerSeat === duel.firstPlayerSeat) firstWins++;
    else secondWins++;

    totalTurns += duel.turnNumber;
    totalKills += duelKills;
    totalDirect += duelDirect;
    totalPierce += duelPierce;
    totalRecoil += duelRecoil;
    if (duel.turnNumber >= 50) stallMatches++;
  }

  const finalDestinyStats: Record<string, { matches: number; wins: number; winRate: string }> = {};
  for (const k of Object.keys(destinyStats)) {
    const s = destinyStats[k];
    finalDestinyStats[k] = {
      matches: s.matches,
      wins: s.wins,
      winRate: s.matches > 0 ? `${((s.wins / s.matches) * 100).toFixed(1)}%` : '0%',
    };
  }

  const report: SimulationReport = {
    matchCount,
    firstWins,
    secondWins,
    playerWins,
    cpuWins,
    destinyStats: finalDestinyStats,
    avgTurns: +(totalTurns / matchCount).toFixed(1),
    avgKills: +(totalKills / matchCount).toFixed(1),
    avgDirectAttacks: +(totalDirect / matchCount).toFixed(1),
    avgPierceDamage: +(totalPierce / matchCount).toFixed(1),
    avgRecoilDamage: +(totalRecoil / matchCount).toFixed(1),
    stepUpEvolutions,
    summationTributes,
    lv1DirectSummons,
    stallMatches,
  };

  return report;
}

console.log('⚔️ [노마나 소환권 & 계단식 진화 / 합산 릴리스 1,000회 대규모 시뮬레이션 개시]\n');
const report = runOfficialSimulation(1000);

console.log(`================================================================`);
console.log(`🎯 [공식 룰 검증 결과 (총 ${report.matchCount}전)]`);
console.log(`  - 선공(Turn 1) 승리: ${report.firstWins}승 (${((report.firstWins / report.matchCount) * 100).toFixed(1)}%)`);
console.log(`  - 후공(Turn 2) 승리: ${report.secondWins}승 (${((report.secondWins / report.matchCount) * 100).toFixed(1)}%)`);
console.log(`  --------------------------------------------------------------`);
console.log(`  - 플레이어 전체 승률: ${((report.playerWins / report.matchCount) * 100).toFixed(1)}% | CPU 승률: ${((report.cpuWins / report.matchCount) * 100).toFixed(1)}%`);
console.log(`  - 아키타입별 승률:`);
for (const [k, v] of Object.entries(report.destinyStats)) {
  console.log(`    * [${k}]: ${v.wins}승 / ${v.matches}전 (${v.winRate})`);
}
console.log(`  --------------------------------------------------------------`);
console.log(`  - 1레벨 계단식 진화 횟수: ${report.stepUpEvolutions}회 (매치당 ${(report.stepUpEvolutions / report.matchCount).toFixed(1)}회)`);
console.log(`  - 합산 릴리스 소환 횟수: ${report.summationTributes}회 (매치당 ${(report.summationTributes / report.matchCount).toFixed(1)}회)`);
console.log(`  - Lv 1 일반 소환 횟수: ${report.lv1DirectSummons}회 (매치당 ${(report.lv1DirectSummons / report.matchCount).toFixed(1)}회)`);
console.log(`  - 평균 듀얼 진행 턴수: ${report.avgTurns}턴`);
console.log(`  - 듀얼당 평균 유닛 격파: ${report.avgKills}마리`);
console.log(`  - 듀얼당 평균 본체 직타: ${report.avgDirectAttacks}회`);
console.log(`  - 듀얼당 평균 관통 피해량: ${report.avgPierceDamage}`);
console.log(`  - 듀얼당 평균 수비 반사 피해량: ${report.avgRecoilDamage}`);
console.log(`  - 장기전(50턴 이상) 발생률: ${((report.stallMatches / report.matchCount) * 100).toFixed(1)}%`);
console.log(`================================================================\n`);

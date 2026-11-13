/**
 * @file test_no_rush_experiments.ts
 * @description 속공 제거(No Rush) 및 후공 3대 어드밴티지 시뮬레이션 검증
 *
 * [공통 조건]
 * - 속공 없음: 소환된 턴에는 절대 공격 불가 (summonedTurnNumber < duel.turnNumber 인 유닛만 공격 가능)
 * - 서로 패 5장 시작
 *
 * [실험군]
 * 0. Control: 속공 없음 + 어드밴티지 없음 (순수 No Rush)
 * 1. Scenario 1: 선공 첫 턴 드로우 스킵 (선공 5장 vs 후공 6장)
 * 2. Scenario 2: 선공 첫 턴 일반소환권 박탈 (선공 1턴 소환 불가)
 * 3. Scenario 3: 후공 1레벨 0/0 토큰 보유 시작 (진화/제물/방어용 토큰)
 */

import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { DEFAULT_CARD_CATALOG, DuelRogueEngine } from '../src/duelRogueEngine.js';

interface ExpResult {
  name: string;
  matchCount: number;
  firstWins: number;
  secondWins: number;
  firstWinRate: string;
  secondWinRate: string;
  avgTurns: number;
  avgKills: number;
  avgDirectAttacks: number;
  stepUpEvolutions: number;
  stallMatches: number;
}

function runExperiment(
  scenarioType: 'CONTROL' | 'SKIP_DRAW' | 'NO_SUMMON_TURN1' | 'TOKEN_START',
  matchCount = 1000
): ExpResult {
  let firstWins = 0;
  let secondWins = 0;
  let totalTurns = 0;
  let totalKills = 0;
  let totalDirect = 0;
  let stepUpEvolutions = 0;
  let stallMatches = 0;

  const destinies = ['BLUE_JUSTICE', 'RED_ZEAL', 'PURPLE_CHAOS'];

  for (let i = 0; i < matchCount; i++) {
    const storage = new InMemoryBinderStorage();
    const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage, masteryThreshold: 100 });
    const seed = 3000000 + i * 37;
    const engine = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, seed);

    const destiny = destinies[i % destinies.length];
    engine.startNewRun(`EXP_${i}`, seed);
    engine.selectFortuneDestiny(destiny);

    const duel: any = engine.state.activeDuel;
    if (!duel) continue;

    const firstSeat = duel.firstPlayerSeat;
    const secondSeat = firstSeat === 0 ? 1 : 0;

    // [어드밴티지 적용: 시작 조건 설정]
    if (scenarioType === 'TOKEN_START') {
      // 후공에게 1레벨 0/0 토큰 추가 배치
      const tokenUnit = {
        instanceId: `TOKEN_SACRIFICE_${i}`,
        cardId: 'TOKEN_LV1_0_0',
        name: '희생의 토큰',
        level: 1,
        cost: 1,
        currentAttack: 0,
        currentDefense: 0,
        maxDefense: 0,
        canAttack: false,
        tags: ['토큰', '#제물'],
        isDeckMaster: false,
        summonedTurnNumber: 0,
      };
      duel.seats[secondSeat].board.push(tokenUnit);
    }

    if (scenarioType === 'NO_SUMMON_TURN1') {
      // 선공의 1턴 소환권을 0으로 박탈
      duel.seats[firstSeat].normalSummonsRemaining = 0;
    }

    // 선공 1턴 시작: SKIP_DRAW가 아닌 기본 룰이라면 선공도 1턴에 1장을 뽑아 6장이 됨.
    // SKIP_DRAW라면 1턴 드로우를 하지 않고 5장 유지.
    // (우리 엔진은 initDuel 시 5장씩 배분하고 1턴 드로우가 없었으므로,
    //  표준 TCG 대조를 위해 SKIP_DRAW가 아닐 때는 선공에게 1장 드로우를 부여하여 6장/6장 공평 드로우를 맞춤)
    if (scenarioType !== 'SKIP_DRAW') {
      engine.drawCard(duel.seats[firstSeat]);
    }

    let duelKills = 0;
    let duelDirect = 0;
    const maxTurns = 60;

    while (duel.status === 'ONGOING' && duel.turnNumber <= maxTurns) {
      const activeSeat = duel.activeSeat;
      const actor = duel.seats[activeSeat];
      const opponent = duel.seats[activeSeat === 0 ? 1 : 0];

      // 1. 공격 준비: [속공 없음 규칙 적용]
      // 3턴 이상이고, 이번 턴에 소환된 유닛이 아닌(summonedTurnNumber < duel.turnNumber) 유닛만 공격 활성화!
      if (duel.turnNumber >= 3) {
        for (const unit of actor.board) {
          if (unit.summonedTurnNumber < duel.turnNumber) {
            unit.canAttack = true;
          } else {
            unit.canAttack = false; // 새로 나온 유닛은 속공 불가!
          }
        }
      } else {
        for (const unit of actor.board) {
          unit.canAttack = false;
        }
      }

      // 2. 마법 카드 발동/세트
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

      // 3. 몬스터 소환 (소환권 확인)
      if ((actor.normalSummonsRemaining ?? 0) > 0 && duel.status === 'ONGOING') {
        const monsterCards = actor.hand
          .map((c: any) => ({ inst: c, def: engine.getCardDef(c.cardId) }))
          .filter((item: any) => item.def && (item.def.type === 'MONSTER' || item.def.effectType === 'SUMMON_UNIT'));

        let summoned = false;

        // 3-1. 계단식 진화 소환
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
                // [속공 제거] 방금 소환된 몬스터는 이번 턴 공격 불가
                const summonedUnit = actor.board.find((u: any) => u.instanceId === m.inst.instanceId);
                if (summonedUnit) {
                  summonedUnit.canAttack = false;
                  summonedUnit.summonedTurnNumber = duel.turnNumber;
                }
                stepUpEvolutions++;
                summoned = true;
                break;
              } catch (e) {}
            }
          }
        }

        // 3-2. Lv 1 일반 소환
        if (!summoned && actor.board.length < 5) {
          const lv1 = monsterCards.find((m: any) => (m.def.level ?? m.def.cost ?? 1) === 1);
          if (lv1) {
            try {
              engine.dispatchDuelCommand({
                type: 'PLAY_CARD',
                seat: activeSeat,
                cardInstanceId: lv1.inst.instanceId,
              });
              // [속공 제거] 방금 소환된 몬스터는 이번 턴 공격 불가
              const summonedUnit = actor.board.find((u: any) => u.instanceId === lv1.inst.instanceId);
              if (summonedUnit) {
                summonedUnit.canAttack = false;
                summonedUnit.summonedTurnNumber = duel.turnNumber;
              }
              summoned = true;
            } catch (e) {}
          }
        }
      }

      // 4. 전투 공격 단계 (3턴 이상부터)
      if (duel.status === 'ONGOING' && duel.turnNumber >= 3) {
        // [속공 제거 원칙] 이전 턴 이전에 소환된 유닛만 공격 가능
        const attackers = actor.board.filter(
          (u: any) => u.canAttack && u.summonedTurnNumber < duel.turnNumber
        ).sort((a: any, b: any) => b.currentAttack - a.currentAttack);

        for (const unit of attackers) {
          if (!unit.canAttack || duel.status !== 'ONGOING') continue;

          let targetUnit: any = null;
          if (opponent.board.length > 0) {
            const killable = opponent.board.filter((u: any) => unit.currentAttack > u.currentDefense);
            if (killable.length > 0) {
              targetUnit = killable.sort((a: any, b: any) => b.currentDefense - a.currentDefense)[0];
            } else {
              const safeEqual = opponent.board.find((u: any) => unit.currentAttack === u.currentDefense);
              if (safeEqual) {
                targetUnit = safeEqual;
              } else {
                continue; // 반사 피해 회피
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
          } catch (e) {}
        }
      }

      // 5. 턴 종료
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

    if (winnerSeat === duel.firstPlayerSeat) firstWins++;
    else secondWins++;

    totalTurns += duel.turnNumber;
    totalKills += duelKills;
    totalDirect += duelDirect;
    if (duel.turnNumber >= 50) stallMatches++;
  }

  const names: Record<string, string> = {
    CONTROL: '대조군 (속공 없음, 후공 보정 없음)',
    SKIP_DRAW: '1번 실험: 선공 1턴 드로우 스킵 (선공 5장 vs 후공 6장)',
    NO_SUMMON_TURN1: '2번 실험: 선공 1턴 일반소환권 없음 (선공 1턴 소환 불가)',
    TOKEN_START: '3번 실험: 후공 1레벨 0/0 토큰 보유 시작 (진화/제물용)',
  };

  return {
    name: names[scenarioType],
    matchCount,
    firstWins,
    secondWins,
    firstWinRate: `${((firstWins / matchCount) * 100).toFixed(1)}%`,
    secondWinRate: `${((secondWins / matchCount) * 100).toFixed(1)}%`,
    avgTurns: +(totalTurns / matchCount).toFixed(1),
    avgKills: +(totalKills / matchCount).toFixed(1),
    avgDirectAttacks: +(totalDirect / matchCount).toFixed(1),
    stepUpEvolutions,
    stallMatches,
  };
}

console.log('================================================================');
console.log('🧪 [속공 제거 및 후공 3대 어드밴티지 대규모 시뮬레이션 개시 (총 4,000전)]');
console.log('================================================================\n');

const resControl = runExperiment('CONTROL', 1000);
console.log(`[0] ${resControl.name}`);
console.log(`    ▶ 선공: ${resControl.firstWins}승 (${resControl.firstWinRate}) vs 후공: ${resControl.secondWins}승 (${resControl.secondWinRate}) | 평균 ${resControl.avgTurns}턴\n`);

const res1 = runExperiment('SKIP_DRAW', 1000);
console.log(`[1] ${res1.name}`);
console.log(`    ▶ 선공: ${res1.firstWins}승 (${res1.firstWinRate}) vs 후공: ${res1.secondWins}승 (${res1.secondWinRate}) | 평균 ${res1.avgTurns}턴\n`);

const res2 = runExperiment('NO_SUMMON_TURN1', 1000);
console.log(`[2] ${res2.name}`);
console.log(`    ▶ 선공: ${res2.firstWins}승 (${res2.firstWinRate}) vs 후공: ${res2.secondWins}승 (${res2.secondWinRate}) | 평균 ${res2.avgTurns}턴\n`);

const res3 = runExperiment('TOKEN_START', 1000);
console.log(`[3] ${res3.name}`);
console.log(`    ▶ 선공: ${res3.firstWins}승 (${res3.firstWinRate}) vs 후공: ${res3.secondWins}승 (${res3.secondWinRate}) | 평균 ${res3.avgTurns}턴\n`);

console.log('================================================================');
console.log('📊 [종합 비교 데이터]');
console.log('----------------------------------------------------------------');
const all = [resControl, res1, res2, res3];
for (const r of all) {
  console.log(`- ${r.name}`);
  console.log(`  선공 ${r.firstWinRate} | 후공 ${r.secondWinRate} | 턴수: ${r.avgTurns}턴 | 킬수: ${r.avgKills} | 진화: ${r.stepUpEvolutions}회`);
}
console.log('================================================================');

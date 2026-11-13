/**
 * 헤드리스 대전 시뮬레이션 도구 (밸런스 측정·AI 회귀 테스트 공용).
 * 두 AI가 같은 규칙 코어로 끝까지 싸운 결과와 통계를 돌려준다.
 */
import { getCardDef, COLLECTIBLE_CARDS } from '../src/cards/catalog.js';
import { registerCatalog, createDuel, applyCommand } from '../src/duel/duelCore.js';
import { chooseAction, createMind, shiftMood, MAX_STEPS_PER_TURN, PERSONALITIES } from '../src/ai/duelAi.js';
import { buildDeck } from '../src/run/content.js';
import { SeededRng } from '../src/duelRogueEngine.js';

registerCatalog(getCardDef);

/**
 * @param {object} a  { deck: {deckCardIds, deckMasterCardId}, personality, volatility, luckBias, name }
 * @param {object} b  같은 형식
 * @param {number} seed
 * @param {object} [opts] { moods: boolean }  moods=false면 성향 변화 없이 기본 성향 고정
 */
export function runDuel(a, b, seed, opts = {}) {
  const duel = createDuel({
    duelId: `SIM_${seed}`,
    seed,
    seats: [a, b].map((p, i) => ({
      duelistId: `SIM_${i}`,
      duelistName: p.name || `P${i}`,
      isCpu: true,
      deckCardIds: p.deck.deckCardIds,
      deckMasterCardId: p.deck.deckMasterCardId,
      luckBias: p.luckBias || 0,
    })),
  });
  const minds = [createMind(a), createMind(b)];
  let safety = 0;
  while (duel.status === 'ONGOING' && safety++ < 5000) {
    const seat = duel.activeSeat;
    const mind = minds[seat];
    if (opts.moods !== false) shiftMood(duel, seat, mind);
    for (let step = 0; step < MAX_STEPS_PER_TURN && duel.status === 'ONGOING' && duel.activeSeat === seat; step++) {
      const action = step === MAX_STEPS_PER_TURN - 1 ? { type: 'END_TURN', seat } : chooseAction(duel, seat, PERSONALITIES[mind.current], getCardDef);
      try {
        applyCommand(duel, action);
      } catch (e) {
        applyCommand(duel, { type: 'END_TURN', seat });
      }
    }
  }
  return {
    winner: duel.status === 'SEAT_0_WIN' ? 0 : duel.status === 'SEAT_1_WIN' ? 1 : -1,
    turns: duel.turnNumber,
    firstSeat: duel.firstPlayerSeat,
    stats: duel.stats,
    lp: duel.seats.map((s) => s.lp),
    moods: minds.map((m) => m.history),
  };
}

export function randomDeck(faction, tier, seed) {
  return buildDeck({ faction, tier, rng: new SeededRng(seed) });
}

export { COLLECTIBLE_CARDS, getCardDef };

/**
 * 밸런스 감사 시뮬레이터.
 *
 * 실행: deno run --allow-read tests/simulate_balance.ts [대전수=900] [티어=3]
 *
 * 진영별 무작위 덱(content.buildDeck)으로 AI끼리 대전시켜 다음을 출력한다.
 * - 선공 승률, 진영별 승률, 평균 턴, 소환·전투 통계
 * - 카드별 '덱에 들어갔을 때 승률' 상·하위 (표본 30덱 이상)
 * - 효과 종류(op)·키워드별 승률
 * - 성향별 승률 (모든 판에서 무작위 성향 배정)
 */
// @ts-nocheck
import { runDuel, randomDeck, getCardDef } from './sim_lib.js';

const args = Deno.args.filter((a) => !a.startsWith('--'));
const JSON_MODE = Deno.args.includes('--json');
const N = Number(args[0] || 900);
const TIER = Number(args[1] || 3);
const FACTIONS = ['BLUE', 'RED', 'PURPLE'];
const PERS = ['AGGRESSIVE', 'DEFENSIVE', 'CALCULATING', 'GAMBLER', 'TRICKSTER'];

const t0 = performance.now();
const faction = Object.fromEntries(FACTIONS.map((f) => [f, { w: 0, g: 0 }]));
const pers = Object.fromEntries(PERS.map((p) => [p, { w: 0, g: 0 }]));
const cards = new Map();
const ops = new Map();
const kws = new Map();
let firstWins = 0;
let decided = 0;
let turns = 0;
let long = 0;
const totals = { summons: 0, stepUps: 0, sumTributes: 0, spells: 0, kills: 0, heroHits: 0 };

function bump(map, key, win) {
  const e = map.get(key) || { w: 0, g: 0 };
  e.g += 1;
  if (win) e.w += 1;
  map.set(key, e);
}

for (let i = 0; i < N; i++) {
  const fa = FACTIONS[i % 3];
  const fb = FACTIONS[(i + 1 + Math.floor(i / 3)) % 3];
  const pa = PERS[(i * 7) % 5];
  const pb = PERS[(i * 3 + 1) % 5];
  const A = { deck: randomDeck(fa, TIER, i * 13 + 1), personality: pa, volatility: 0.5, name: 'A' };
  const B = { deck: randomDeck(fb, TIER, i * 13 + 7), personality: pb, volatility: 0.5, name: 'B' };
  const r = runDuel(A, B, 50000 + i);
  turns += r.turns;
  if (r.turns >= 50) long += 1;
  for (const k of Object.keys(totals)) totals[k] += r.stats[k] || 0;
  if (r.winner < 0) continue;
  decided += 1;
  if (r.winner === r.firstSeat) firstWins += 1;
  const sides = [
    [A, fa, pa],
    [B, fb, pb],
  ];
  sides.forEach(([side, f, p], seat) => {
    const win = r.winner === seat;
    faction[f].g += 1;
    if (win) faction[f].w += 1;
    pers[p].g += 1;
    if (win) pers[p].w += 1;
    for (const id of new Set(side.deck.deckCardIds)) {
      bump(cards, id, win);
      const def = getCardDef(id);
      for (const ab of def.abilities || []) for (const e of ab.effects || []) bump(ops, `${def.type}:${ab.trigger}:${e.op}`, win);
      for (const k of def.kw || []) bump(kws, k, win);
    }
  });
}

if (JSON_MODE) {
  console.log(JSON.stringify({
    first: firstWins / Math.max(1, decided),
    long: long / N,
    turns: turns / N,
    faction: Object.fromEntries(FACTIONS.map((f) => [f, faction[f].w / Math.max(1, faction[f].g)])),
  }));
  Deno.exit(0);
}

const pct = (e) => (e.g ? ((e.w / e.g) * 100).toFixed(1) : '-') + '%';
console.log(`대전 ${N}판 (티어 ${TIER}) — ${((performance.now() - t0) / 1000).toFixed(1)}초`);
console.log(`선공 승률 ${((firstWins / Math.max(1, decided)) * 100).toFixed(1)}%  평균 턴 ${(turns / N).toFixed(1)}  50턴 이상 ${((long / N) * 100).toFixed(1)}%`);
console.log('판당 통계', Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, (v / N).toFixed(1)])));
console.log('진영 승률', Object.fromEntries(FACTIONS.map((f) => [f, pct(faction[f])])));
console.log('성향 승률', Object.fromEntries(PERS.map((p) => [p, pct(pers[p])])));

const cardRows = [...cards.entries()].filter(([, e]) => e.g >= 30).map(([id, e]) => ({ id, name: getCardDef(id).name, rate: e.w / e.g, g: e.g }));
cardRows.sort((a, b) => b.rate - a.rate);
console.log('\n카드 승률 상위 15');
for (const r of cardRows.slice(0, 15)) console.log(`  ${(r.rate * 100).toFixed(1)}%  ${r.id} ${r.name} (${r.g}덱)  ${getCardDef(r.id).effect || ''}`);
console.log('카드 승률 하위 15');
for (const r of cardRows.slice(-15)) console.log(`  ${(r.rate * 100).toFixed(1)}%  ${r.id} ${r.name} (${r.g}덱)  ${getCardDef(r.id).effect || ''}`);

console.log('\n효과 승률');
for (const [k, e] of [...ops.entries()].filter(([, e]) => e.g >= 40).sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g)) console.log(`  ${pct(e)}  ${k} (${e.g})`);
console.log('키워드 승률');
for (const [k, e] of [...kws.entries()].sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g)) console.log(`  ${pct(e)}  ${k} (${e.g})`);

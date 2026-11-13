/**
 * 진영 밸런스 자동 보정.
 *
 * 실행: deno run --allow-read --allow-write --allow-run tools/calibrate_cards.js [반복=6] [판수=2000]
 *
 * 카드 생성 → 티어 1(저레벨 위주)·티어 4~5(고레벨 포함) 시뮬레이션 → 진영 승률이 50%에서 벗어난 만큼
 * card_budget.json의 진영 스탯 보정을 조정 → 반복. 끝나면 마지막 보정으로 카드를 다시 생성한다.
 */
const ITER = Number(Deno.args[0] || 6);
const GAMES = Number(Deno.args[1] || 2000);
const budgetUrl = new URL('./card_budget.json', import.meta.url);
const FACTIONS = ['BLUE', 'RED', 'PURPLE'];

async function run(args) {
  const out = await new Deno.Command(Deno.execPath(), { args, stdout: 'piped', stderr: 'piped' }).output();
  const text = new TextDecoder().decode(out.stdout);
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return text;
}

async function build() {
  await run(['run', '--allow-read', '--allow-write', 'tools/build_cards.js']);
}

async function sim(tier) {
  const text = await run(['run', '--allow-read', 'tests/simulate_balance.ts', String(GAMES), String(tier), '--json']);
  return JSON.parse(text.trim().split('\n').pop());
}

for (let i = 0; i < ITER; i++) {
  const budget = JSON.parse(await Deno.readTextFile(budgetUrl));
  await build();
  const low = await sim(1);
  const h4 = await sim(4);
  const h5 = await sim(5);
  const high = { first: (h4.first + h5.first) / 2, faction: Object.fromEntries(FACTIONS.map((f) => [f, (h4.faction[f] + h5.faction[f]) / 2])) };
  const fmt = (r) => FACTIONS.map((f) => `${f[0]}${(r.faction[f] * 100).toFixed(1)}`).join(' ');
  console.log(`#${i + 1} 저레벨 ${fmt(low)} 선공 ${(low.first * 100).toFixed(1)}% | 고레벨 ${fmt(high)} 선공 ${(high.first * 100).toFixed(1)}%`);
  for (const [band, r] of [['low', low], ['high', high]]) {
    for (const f of FACTIONS) {
      const step = Math.max(-1, Math.min(1, (0.5 - r.faction[f]) * 20));
      budget[f][band] = Math.round((budget[f][band] + step * 0.5) * 10) / 10;
    }
    const mean = FACTIONS.reduce((a, f) => a + budget[f][band], 0) / 3;
    for (const f of FACTIONS) budget[f][band] = Math.round((budget[f][band] - mean) * 10) / 10;
  }
  await Deno.writeTextFile(budgetUrl, JSON.stringify(budget, null, 2) + '\n');
}
await build();
console.log('최종 보정', await Deno.readTextFile(budgetUrl));

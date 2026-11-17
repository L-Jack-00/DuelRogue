/**
 * 런 진행 콘텐츠: 덱 구성기, 부스터 팩, 상점 낱장, 상인 교환 풀, 상대 듀얼리스트 명단, 보스.
 *
 * 카드 풀이 커져도 이 파일의 표만 고치면 상점·상대 덱이 따라오도록, 카드를 ID로 직접 나열하지 않고
 * 진영·희귀도·레벨 조건으로 고른다. 난수는 호출자가 넘기는 rng(nextFloat 메서드)를 쓴다.
 */
import { COLLECTIBLE_CARDS, getCardDef } from '../cards/catalog.js';

export const FACTION_OF_DESTINY = { BLUE_JUSTICE: 'BLUE', RED_ZEAL: 'RED', PURPLE_CHAOS: 'PURPLE' };
export const DESTINY_OF_FACTION = { BLUE: 'BLUE_JUSTICE', RED: 'RED_ZEAL', PURPLE: 'PURPLE_CHAOS', NEUTRAL: 'BLUE_JUSTICE' };
export const DECK_MASTER_OF_FACTION = { BLUE: 'C_BLUE_01', RED: 'C_RED_01', PURPLE: 'C_PURP_01' };
export const GOD_OF_FACTION = { BLUE: 'C_BLUE_05', RED: 'C_TITAN_01', PURPLE: 'C_PURP_03' };

export const RARITY_PRICE = { COMMON: 300, UNCOMMON: 500, RARE: 900, EPIC: 1500, LEGENDARY: 2500 };
const RARITY_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

function weightedPick(rng, entries) {
  const total = entries.reduce((a, e) => a + e.w, 0);
  if (total <= 0) return null;
  let r = rng.nextFloat() * total;
  for (const e of entries) {
    r -= e.w;
    if (r <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

function shuffled(rng, list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 진영 풀: 해당 진영 + 중립 (신 카드 제외) */
export function factionPool(faction, { includeNeutral = true, includeLegendary = false } = {}) {
  return COLLECTIBLE_CARDS.filter(
    (c) => (c.faction === faction || (includeNeutral && c.faction === 'NEUTRAL')) && (includeLegendary || c.rarity !== 'LEGENDARY')
  );
}

// --------------------------------------------------------------------------
// 덱 구성기
// --------------------------------------------------------------------------

/** 티어별 레벨 분포(몬스터 장수)와 희귀도 가중치 */
const DECK_TIERS = {
  0: { levels: { 1: 18, 2: 2, 3: 0, 4: 0, 5: 0 }, rarity: { COMMON: 12, UNCOMMON: 0, RARE: 0, EPIC: 0 } },
  1: { levels: { 1: 10, 2: 7, 3: 3, 4: 0, 5: 0 }, rarity: { COMMON: 6, UNCOMMON: 3, RARE: 0.4, EPIC: 0 } },
  2: { levels: { 1: 9, 2: 7, 3: 3, 4: 1, 5: 0 }, rarity: { COMMON: 4, UNCOMMON: 4, RARE: 1.2, EPIC: 0.1 } },
  3: { levels: { 1: 8, 2: 7, 3: 3, 4: 1, 5: 1 }, rarity: { COMMON: 3, UNCOMMON: 4, RARE: 2.5, EPIC: 0.6 } },
  4: { levels: { 1: 8, 2: 6, 3: 4, 4: 1, 5: 1 }, rarity: { COMMON: 2, UNCOMMON: 3.5, RARE: 3.5, EPIC: 1.5 } },
  5: { levels: { 1: 8, 2: 6, 3: 3, 4: 2, 5: 1 }, rarity: { COMMON: 1.5, UNCOMMON: 3, RARE: 4, EPIC: 2.5 } },
};

/**
 * 30장 덱을 만든다. (몬스터 21장 — 덱 마스터 포함 / 마법 9장 싱글톤)
 * @param {object} opts
 * @param {'BLUE'|'RED'|'PURPLE'} opts.faction
 * @param {number} opts.tier 1~5
 * @param {{nextFloat: () => number}} opts.rng
 * @param {string} [opts.godId] 넣을 신 카드 (Lv5 한 자리를 대신함)
 * @param {number} [opts.neutralWeight] 중립 카드 선택 가중치 (기본 0.45)
 */
export function buildDeck({ faction, tier = 1, rng, godId = null, neutralWeight = 0.45 }) {
  const cfg = DECK_TIERS[Math.max(0, Math.min(5, tier))];
  const masterId = DECK_MASTER_OF_FACTION[faction] || 'C_BLUE_01';
  const pool = factionPool(faction);
  const deck = [masterId, masterId];
  const copies = { [masterId]: 2 };

  const add = (id, n) => {
    for (let i = 0; i < n; i++) {
      deck.push(id);
      copies[id] = (copies[id] || 0) + 1;
    }
  };

  // 몬스터 (덱 마스터 2장을 Lv1 몫에서 뺀다)
  const levels = { ...cfg.levels };
  levels[1] -= 2;
  if (godId) {
    if (levels[5] > 0) levels[5] -= 1;
    else levels[4] = Math.max(0, levels[4] - 1);
    add(godId, 1);
  }
  for (const [lvStr, count] of Object.entries(levels)) {
    const lv = Number(lvStr);
    let remaining = count;
    const candidates = pool.filter((c) => c.type === 'MONSTER' && c.level === lv && c.id !== masterId);
    let guard = 0;
    while (remaining > 0 && guard++ < 200) {
      const card = weightedPick(
        rng,
        candidates
          .filter((c) => (copies[c.id] || 0) < 3)
          .map((c) => ({ item: c, w: (cfg.rarity[c.rarity] ?? 0.1) * (c.faction === 'NEUTRAL' ? neutralWeight : 1) }))
      );
      if (!card) break;
      const n = Math.min(remaining, lv >= 4 ? 1 : rng.nextFloat() < 0.6 ? 2 : 1, 3 - (copies[card.id] || 0));
      add(card.id, n);
      remaining -= n;
    }
  }

  // 부족분은 Lv1~2로 채운다
  const fillers = pool.filter((c) => c.type === 'MONSTER' && c.level <= 2);
  while (deck.length < 21) {
    const card = fillers[Math.floor(rng.nextFloat() * fillers.length)];
    if ((copies[card.id] || 0) < 3) add(card.id, 1);
  }

  // 마법 9장 (싱글톤)
  const spells = shuffled(
    rng,
    pool.filter((c) => c.type === 'SPELL')
  )
    .map((c) => ({ c, w: (cfg.rarity[c.rarity] ?? 0.1) * (c.faction === 'NEUTRAL' ? neutralWeight : 1) * (0.5 + rng.nextFloat()) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 9);
  for (const { c } of spells) add(c.id, 1);

  return { deckMasterCardId: masterId, deckCardIds: deck.slice(0, 30) };
}

/** 플레이어 시작 덱: 운명마다 항상 같은 구성 */
export function createStarterDeck(destiny) {
  const faction = FACTION_OF_DESTINY[destiny] || 'BLUE';
  const seed = { BLUE: 1101, RED: 2202, PURPLE: 3303 }[faction];
  let s = seed;
  const rng = {
    nextFloat() {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    },
  };
  return buildDeck({ faction, tier: 1, rng, neutralWeight: 0.35 });
}

// --------------------------------------------------------------------------
// 부스터 팩
// --------------------------------------------------------------------------

export const PACK_DEFS = [
  { id: 'PACK_BLUE', name: '푸른 성역의 결계', type: 'CONTROL', faction: 'BLUE', price: 500, color: '#38bdf8', tag: '방어 · 결계',
    description: '기사단·천사·골렘과 결계 마법이 수록된 정의 진영 팩' },
  { id: 'PACK_RED', name: '진홍빛 화룡의 돌격', type: 'AGGRO', faction: 'RED', price: 500, color: '#f87171', tag: '돌격 · 관통',
    description: '돌격대·용족·암살단과 화염 마법이 수록된 열의 진영 팩' },
  { id: 'PACK_PURPLE', name: '심연의 도박과 룰렛', type: 'CHAOS_RNG', faction: 'PURPLE', price: 500, color: '#c084fc', tag: '변수 · 비술',
    description: '악마·도박꾼·환영과 변칙 마법이 수록된 혼돈 진영 팩' },
  { id: 'PACK_WILD', name: '방랑자의 보따리', type: 'NEUTRAL', faction: 'NEUTRAL', price: 500, color: '#a3e635', tag: '야수 · 기계 · 용병',
    description: '어느 덱에나 어울리는 야수·기계·정령·언데드·용병 중립 팩' },
  { id: 'PACK_LEGEND', name: '태초의 신과 거신', type: 'LEGEND', faction: 'ALL', price: 1000, color: '#facc15', tag: '에픽 ~ 레전드',
    description: '에픽 이상 등급의 카드만 수록된 특별 팩' },
];

function packPool(pack) {
  if (pack.faction === 'ALL') return COLLECTIBLE_CARDS.filter((c) => c.rarity !== 'COMMON' && c.rarity !== 'UNCOMMON');
  if (pack.faction === 'NEUTRAL') return COLLECTIBLE_CARDS.filter((c) => c.faction === 'NEUTRAL');
  return factionPool(pack.faction);
}

function packRarityWeights(pack, round) {
  if (pack.faction === 'ALL') return { RARE: 55, EPIC: 38, LEGENDARY: 7 };
  const bonus = Math.min(4, Math.max(0, round - 1));
  return { COMMON: 60 - bonus * 6, UNCOMMON: 28 + bonus * 2, RARE: 10 + bonus * 3, EPIC: 2 + bonus };
}

/** 팩 1개를 개봉해 카드 3장의 ID를 돌려준다 */
export function openPack(pack, rng, round = 1) {
  const pool = packPool(pack);
  const weights = packRarityWeights(pack, round);
  const result = [];
  for (let i = 0; i < 3; i++) {
    const rarity = weightedPick(rng, Object.entries(weights).map(([item, w]) => ({ item, w })));
    let candidates = pool.filter((c) => c.rarity === rarity && !result.includes(c.id));
    if (candidates.length === 0) candidates = pool.filter((c) => !result.includes(c.id));
    result.push(candidates[Math.floor(rng.nextFloat() * candidates.length)].id);
  }
  return result;
}

/** 팩 진열 정보 (화면 미리보기용 대표 카드 5장 포함) */
export function packShelfEntry(pack, rng) {
  const pool = packPool(pack);
  const featured = shuffled(rng, pool.filter((c) => RARITY_ORDER.indexOf(c.rarity) >= 2)).slice(0, 5).map((c) => c.id);
  return { ...pack, cards: featured };
}

// --------------------------------------------------------------------------
// 상점 낱장 · 상인
// --------------------------------------------------------------------------

export function rollShopSingles(rng, round, count) {
  const pool = COLLECTIBLE_CARDS.filter((c) => c.rarity === 'RARE' || c.rarity === 'EPIC' || (c.rarity === 'LEGENDARY' && round >= 2));
  const picks = [];
  while (picks.length < count) {
    const c = pool[Math.floor(rng.nextFloat() * pool.length)];
    if (picks.some((p) => p.cardId === c.id)) continue;
    if (c.rarity === 'LEGENDARY' && rng.nextFloat() > 0.25) continue;
    picks.push({ cardId: c.id, price: RARITY_PRICE[c.rarity], reason: `${rarityLabel(c.rarity)} ${c.type === 'SPELL' ? '마법' : `Lv${c.level} 몬스터`} 낱장` });
  }
  return picks;
}

export function rarityLabel(r) {
  return { COMMON: '노말', UNCOMMON: '레어', RARE: '에픽', EPIC: '유니크', LEGENDARY: '레전드' }[r] || r;
}

/** 상인 교환 보상 후보 */
export function merchantRewardPool(kind) {
  if (kind === '1_1') return COLLECTIBLE_CARDS.filter((c) => c.rarity === 'RARE');
  if (kind === '2_1') return COLLECTIBLE_CARDS.filter((c) => c.rarity === 'EPIC');
  return COLLECTIBLE_CARDS.filter((c) => c.rarity === 'LEGENDARY');
}

// --------------------------------------------------------------------------
// 상대 듀얼리스트 명단
// --------------------------------------------------------------------------

export const DUELISTS = [
  { id: 'CPU_ROOKIE_ROKI', tier: 1, name: '초심 듀얼리스트 로키', title: '신예 도전자', faction: 'RED', personality: 'AGGRESSIVE', volatility: 0.45,
    description: '배운 대로 일단 들이받고 보는 입문 듀얼리스트입니다.' },
  { id: 'CPU_ALLEY_MINA', tier: 1, name: '골목대장 미나', title: '동네 놀이터의 여왕', faction: 'BLUE', personality: 'DEFENSIVE', volatility: 0.4,
    description: '방패병을 줄줄이 세워 두는 걸 좋아하는 꼬마 대장입니다.' },
  { id: 'CPU_APPRENTICE_LULU', tier: 1, name: '견습 점술가 루루', title: '수정구 수습생', faction: 'PURPLE', personality: 'GAMBLER', volatility: 0.6,
    description: '점괘가 좋게 나오면 무엇이든 걸어 버리는 견습 점술가입니다.' },
  { id: 'CPU_WANDERER_RICK', tier: 2, name: '방랑 카드 수집가 릭', title: '골목의 승부사', faction: 'PURPLE', personality: 'TRICKSTER', volatility: 0.55,
    description: '희귀 카드를 노리며 함정을 깔아 두는 떠돌이 수집가입니다.' },
  { id: 'CPU_MERC_GARRET', tier: 2, name: '용병 듀얼리스트 가렛', title: '돈 받고 싸우는 남자', faction: 'RED', personality: 'CALCULATING', volatility: 0.35,
    description: '수지가 맞을 때만 칼을 뽑는 계산 빠른 용병입니다.' },
  { id: 'CPU_SISTER_SERA', tier: 2, name: '수도원의 세라', title: '자애로운 수녀', faction: 'BLUE', personality: 'DEFENSIVE', volatility: 0.3,
    description: '치유와 결계로 버티다 상대가 지칠 때를 기다립니다.' },
  { id: 'CPU_VETERAN_VEGA', tier: 3, name: '숙련 듀얼리스트 베가', title: '성소의 수호 기사', faction: 'BLUE', personality: 'CALCULATING', volatility: 0.35,
    description: '수호벽과 반격 결계를 능숙하게 다루는 노련한 실력자입니다.' },
  { id: 'CPU_SHADOW_KAIN', tier: 3, name: '그림자 암살자 카인', title: '소리 없는 칼날', faction: 'RED', personality: 'TRICKSTER', volatility: 0.5,
    description: '은신 몬스터로 빈틈을 찌르고 핵심 카드만 골라 제거합니다.' },
  { id: 'CPU_MADAM_ROSE', tier: 3, name: '카지노의 마담 로즈', title: '뒷골목 카지노 주인', faction: 'PURPLE', personality: 'GAMBLER', volatility: 0.7,
    description: '판돈이 클수록 웃음이 깊어지는 승부사입니다. 기분이 쉽게 바뀝니다.' },
  { id: 'CPU_KNIGHT_ALLEN', tier: 4, name: '홍련의 용기사 알렌', title: '진홍의 학살자', faction: 'RED', personality: 'AGGRESSIVE', volatility: 0.5,
    description: '관통 공격과 고위력 화룡으로 전장을 순식간에 불태웁니다.' },
  { id: 'CPU_SAGE_ORPHEUS', tier: 4, name: '대현자 오르페우스', title: '마탑의 주인', faction: 'BLUE', personality: 'CALCULATING', volatility: 0.25,
    description: '한 수 한 수를 끝까지 계산하는 냉정한 마법사입니다.' },
  { id: 'CPU_PRIEST_NIEL', tier: 4, name: '공허의 사제 니엘', title: '잠든 신의 대변자', faction: 'PURPLE', personality: 'TRICKSTER', volatility: 0.6,
    description: '침묵과 저주로 상대의 계획을 무너뜨리는 광신도입니다.' },
  { id: 'CPU_MASTER_ZERO', tier: 5, name: '심연의 심판관 제로', title: '마스터 듀얼리스트', faction: 'ANY', personality: 'CALCULATING', volatility: 0.7,
    description: '극한의 덱 파워와 신 급 카드를 서슴없이 구사하는 궁극의 상대입니다.' },
];

const TIER_STYLE = {
  1: { stars: '★☆☆☆☆', label: '낮음', color: '#4ade80', reward: 500, luck: 0.0 },
  2: { stars: '★★☆☆☆', label: '보통', color: '#38bdf8', reward: 650, luck: 0.04 },
  3: { stars: '★★★☆☆', label: '높음', color: '#f59e0b', reward: 800, luck: 0.07 },
  4: { stars: '★★★★☆', label: '매우 높음', color: '#fb7185', reward: 950, luck: 0.1 },
  5: { stars: '★★★★★', label: '위험', color: '#a855f7', reward: 1000, luck: 0.14 },
};

/** 라운드에 맞는 상대를 고른다 */
export function rollEncounter(round, rng) {
  const tier = Math.max(1, Math.min(5, round));
  const options = DUELISTS.filter((d) => d.tier === tier);
  const d = options[Math.floor(rng.nextFloat() * options.length)];
  const style = TIER_STYLE[tier];
  const faction = d.faction === 'ANY' ? ['BLUE', 'RED', 'PURPLE'][Math.floor(rng.nextFloat() * 3)] : d.faction;
  const extra = Math.max(0, round - 5);
  const name = `ROUND ${round}`;
  const isBeginner = round === 1;
  return {
    round,
    tier,
    isBeginner,
    cpuLp: isBeginner ? 40 : 100,
    deckTierOverride: isBeginner ? 0 : null,
    duelistId: tier === 5 ? `${d.id}_${round}` : d.id,
    name,
    opponentName: name,
    title: d.title,
    opponentTitle: d.title,
    stars: style.stars,
    difficultyLabel: isBeginner ? '입문' : style.label,
    difficultyColor: style.color,
    faction,
    deckArchetype: DESTINY_OF_FACTION[faction],
    personality: d.personality,
    volatility: isBeginner ? 0.25 : d.volatility,
    luckBias: isBeginner ? 0 : Math.min(0.3, style.luck + extra * 0.02),
    rewardGold: style.reward + extra * 200,
    deckSeed: Math.floor(rng.nextFloat() * 1e9),
    description: d.description,
  };
}

export const BOSSES = {
  BOSS_RED_UNSTOPPABLE_AGGRO: { name: '종언의 화염군주 볼카', faction: 'RED', personality: 'AGGRESSIVE', volatility: 0.55, luckBias: 0.12 },
  BOSS_BLUE_FORTRESS_CONTROL: { name: '절대방벽의 집행관 실피드', faction: 'BLUE', personality: 'DEFENSIVE', volatility: 0.4, luckBias: 0.12 },
  BOSS_PURPLE_RIGGED_FATE: { name: '뒤틀린 운명의 지배자 조커', faction: 'PURPLE', personality: 'GAMBLER', volatility: 0.8, luckBias: 0.3 },
};

export function bossDeck(bossId, rng) {
  const boss = BOSSES[bossId] || BOSSES.BOSS_RED_UNSTOPPABLE_AGGRO;
  return buildDeck({ faction: boss.faction, tier: 5, rng, godId: GOD_OF_FACTION[boss.faction] });
}

export { getCardDef };

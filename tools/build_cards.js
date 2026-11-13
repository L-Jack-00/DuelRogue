/**
 * 확장 카드 생성기.
 *
 * 실행: deno run --allow-write tools/build_cards.js
 * 결과: src/cards/generatedCards.js (직접 수정하지 말고 이 파일의 표를 고친 뒤 다시 생성한다)
 *
 * 구성: 진영 4개(정의·열의·혼돈·중립) × 종족 5개 × 몬스터 19장(Lv1 6 / Lv2 6 / Lv3 4 / Lv4 2 / Lv5 1)
 *       + 진영별 마법 30장(중립 25장)  →  약 500장
 *
 * 스탯 결정 방식:
 *   레벨 기준 스탯 합(+희귀도 보너스) − 효과 가치(effects.js의 abilityCost) − 키워드 가치
 *   를 공/수 합계로 쓰고, 종족 성향(공격 비율)대로 공격력과 수비력에 나눈다.
 *   효과가 큰 카드는 레벨 하한보다 낮은 스탯을 가질 수 있지만 하한의 80% 아래로는 내려가지 않는다.
 *   Lv1 공격력 8 이하, Lv2 공격력 13 이하, 관통은 Lv3 이상 (카드 디자인 원칙)
 *
 * 같은 SEED면 항상 같은 카드가 나온다.
 */
import { abilityCost, keywordsCost } from '../src/duel/effects.js';
import { tokenStatSumOf } from '../src/cards/tokens.js';
import { KEYWORDS } from '../src/duel/keywords.js';

const SEED = 20261113;

// --------------------------------------------------------------------------
// 난수
// --------------------------------------------------------------------------
let rngState = SEED;
function rnd() {
  let s = (rngState = (rngState + 0x6d2b79f5) >>> 0);
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rnd() * list.length)];
function weighted(list) {
  const total = list.reduce((a, x) => a + (x.w ?? 1), 0);
  let r = rnd() * total;
  for (const x of list) {
    r -= x.w ?? 1;
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}
const scaleInt = (v, k) => Math.max(1, Math.round(v * k));

// --------------------------------------------------------------------------
// 레벨 규격
// --------------------------------------------------------------------------
const STAT_RANGE = { 1: [14, 18], 2: [20, 24], 3: [26, 32], 4: [33, 38], 5: [42, 48] };
const STAT_MID = { 1: 16, 2: 22, 3: 29, 4: 35, 5: 45 };
const ATK_CAP = { 1: 8, 2: 13 };
const RARITY_BONUS = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3 };
// 진영 보정: 밸런스 시뮬레이션(tests/simulate_balance.ts) 결과로 맞춘 스탯 예산 가감
// 진영 보정 (스탯 예산 가감). tools/calibrate_cards.js가 시뮬레이션으로 맞춰 card_budget.json에 저장한다.
// 저레벨(1~2)과 고레벨(3~5)을 따로 맞춘다: 확률 효과가 많은 진영은 저레벨에서 체감 전력이 낮다
const FACTION_BUDGET = JSON.parse(await Deno.readTextFile(new URL('./card_budget.json', import.meta.url)));
const LEVEL_PLAN = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5];

function rollRarity(level) {
  const r = rnd();
  if (level === 1) return r < 0.7 ? 'COMMON' : 'UNCOMMON';
  if (level === 2) return r < 0.5 ? 'COMMON' : r < 0.9 ? 'UNCOMMON' : 'RARE';
  if (level === 3) return r < 0.5 ? 'UNCOMMON' : 'RARE';
  if (level === 4) return r < 0.7 ? 'RARE' : 'EPIC';
  return 'EPIC';
}

// 레벨별 효과 기준 수치
const V = {
  dmgUnit: [0, 4, 6, 8, 10, 12],
  dmgAll: [0, 2, 3, 5, 6, 8],
  dmgHero: [0, 5, 7, 9, 11, 14],
  heal: [0, 6, 8, 12, 15, 20],
  shield: [0, 6, 8, 12, 15, 20],
  buffAtk: [0, 2, 3, 4, 5, 6],
  buffDef: [0, 2, 4, 5, 6, 8],
};

// --------------------------------------------------------------------------
// 능력 템플릿 도우미
// --------------------------------------------------------------------------
const ab = (trigger, effects, extra = {}) => ({ trigger, effects, ...extra });
const E = {
  dmgUnit: (target, value) => ({ op: 'DAMAGE_UNIT', target, value }),
  dmgHero: (value) => ({ op: 'DAMAGE_HERO', target: 'ENEMY_HERO', value }),
  selfDmg: (value) => ({ op: 'DAMAGE_HERO', target: 'ALLY_HERO', value }),
  bothDmg: (value) => ({ op: 'DAMAGE_BOTH_HEROES', target: 'BOTH_HEROES', value }),
  heal: (value) => ({ op: 'HEAL_HERO', target: 'ALLY_HERO', value }),
  shield: (value) => ({ op: 'SHIELD_HERO', value }),
  buff: (target, atk, def) => ({ op: 'BUFF', target, ...(atk ? { atk } : {}), ...(def ? { def } : {}) }),
  debuff: (target, atk, def) => ({ op: 'DEBUFF', target, ...(atk ? { atk } : {}), ...(def ? { def } : {}) }),
  destroy: (target, maxLevel) => ({ op: 'DESTROY_UNIT', target, ...(maxLevel ? { maxLevel } : {}) }),
  draw: (value) => ({ op: 'DRAW', value }),
  extra: () => ({ op: 'EXTRA_SUMMON', value: 1 }),
  token: (token, value = 1) => ({ op: 'SUMMON_TOKEN', token, value }),
  freeze: (target) => ({ op: 'FREEZE', target }),
  silence: (target) => ({ op: 'SILENCE', target }),
  bounce: (target, maxLevel) => ({ op: 'RETURN_TO_HAND', target, ...(maxLevel ? { maxLevel } : {}) }),
  grant: (target, keyword) => ({ op: 'GRANT_KEYWORD', target, keyword }),
  discard: (value = 1) => ({ op: 'DISCARD_RANDOM', value }),
  revive: (maxLevel) => ({ op: 'REVIVE', maxLevel }),
  swap: (target) => ({ op: 'SWAP_STATS', target }),
};

// 템플릿: { w, min, max, make(lv, k) }  k = 효과 세기 배율 (예산 초과 시 낮춰 재시도)
const T = {
  shieldOnSummon: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.shield(scaleInt(V.shield[lv], k))]) },
  shieldOnDeath: { w: 2, min: 1, make: (lv, k) => ab('ON_DESTROYED', [E.shield(scaleInt(V.shield[lv] * 1.2, k))]) },
  buffOthersDef: { w: 2, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.buff('ALLY_OTHERS', 0, scaleInt(V.buffDef[lv] * 0.6, k))]) },
  squireToken: { w: 2, min: 3, make: () => ab('ON_SUMMON', [E.token('T_SQUIRE', 1)]) },
  healOnSummon: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.heal(scaleInt(V.heal[lv], k))]) },
  healOnDeath: { w: 2, min: 1, make: (lv, k) => ab('ON_DESTROYED', [E.heal(scaleInt(V.heal[lv] * 1.2, k))]) },
  healTurnEnd: { w: 2, min: 2, make: (lv, k) => ab('ON_TURN_END', [E.heal(scaleInt(V.heal[lv] * 0.4, k))]) },
  grantDivine: { w: 1, min: 3, make: () => ab('ON_SUMMON', [E.grant('ALLY_RANDOM', 'DIVINE')]) },
  pingWeakest: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.dmgUnit('ENEMY_WEAKEST', scaleInt(V.dmgUnit[lv], k))]) },
  pingRandom: { w: 2, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.dmgUnit('ENEMY_RANDOM', scaleInt(V.dmgUnit[lv] * 1.15, k))]) },
  freezeStrongest: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.freeze('ENEMY_STRONGEST')]) },
  silenceStrongest: { w: 1, min: 3, make: () => ab('ON_SUMMON', [E.silence('ENEMY_STRONGEST')]) },
  destroySmall: { w: 1, min: 4, make: (lv) => ab('ON_SUMMON', [E.destroy('ENEMY_RANDOM', lv - 2)]) },
  drawIfLowHand: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.draw(1)], { condition: { type: 'handAtMost', value: 2 } }) },
  healTurnEndSmall: { w: 3, min: 1, make: (lv, k) => ab('ON_TURN_END', [E.heal(scaleInt(V.heal[lv] * 0.35, k))]) },
  buffWeakestDef: { w: 2, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.buff('ALLY_WEAKEST', 0, scaleInt(V.buffDef[lv], k))]) },
  healIfLow: { w: 2, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.heal(scaleInt(V.heal[lv] * 1.6, k))], { condition: { type: 'selfLpBelow', value: 50 } }) },
  gearOnDeath: { w: 3, min: 1, make: () => ab('ON_DESTROYED', [E.token('T_GEAR', 1)]) },
  selfDefTurnEnd: { w: 2, min: 2, make: (lv, k) => ab('ON_TURN_END', [E.buff('SELF', 0, scaleInt(V.buffDef[lv] * 0.4, k))]) },

  atkOnAttack: { w: 3, min: 1, make: (lv, k) => ab('ON_ATTACK', [E.buff('SELF', scaleInt(V.buffAtk[lv] * 0.6, k), 0)]) },
  rallyAtk: { w: 2, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.buff('ALLY_OTHERS', scaleInt(V.buffAtk[lv] * 0.6, k), 0)]) },
  atkOnKill: { w: 3, min: 1, make: (lv, k) => ab('ON_KILL', [E.buff('SELF', scaleInt(V.buffAtk[lv], k), 0)]) },
  burnAll: { w: 3, min: 3, make: (lv, k) => ab('ON_SUMMON', [E.dmgUnit('ENEMY_ALL', scaleInt(V.dmgAll[lv], k))]) },
  faceOnSummon: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.dmgHero(scaleInt(V.dmgHero[lv], k))]) },
  attackPing: { w: 2, min: 2, make: (lv, k) => ab('ON_ATTACK', [E.dmgUnit('ENEMY_RANDOM', scaleInt(V.dmgUnit[lv] * 0.5, k))]) },
  rageLowLp: { w: 2, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.buff('SELF', scaleInt(V.buffAtk[lv] * 1.6, k), 0)], { condition: { type: 'selfLpBelow', value: 50 } }) },
  deathFace: { w: 2, min: 1, make: (lv, k) => ab('ON_DESTROYED', [E.dmgHero(scaleInt(V.dmgHero[lv], k))]) },
  assassinate: { w: 2, min: 3, make: (lv) => ab('ON_SUMMON', [E.destroy('ENEMY_RANDOM', lv - 2)]) },
  stabWeakest: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.dmgUnit('ENEMY_WEAKEST', scaleInt(V.dmgUnit[lv] * 1.1, k))]) },
  weakenAttack: { w: 2, min: 2, make: (lv, k) => ab('ON_ATTACK', [E.debuff('ENEMY_STRONGEST', scaleInt(V.buffAtk[lv] * 0.6, k), 0)]) },
  burnStart: { w: 2, min: 2, make: (lv, k) => ab('ON_TURN_START', [E.dmgHero(scaleInt(V.dmgHero[lv] * 0.35, k))]) },
  fireballStrongest: { w: 3, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.dmgUnit('ENEMY_STRONGEST', scaleInt(V.dmgUnit[lv], k))]) },
  emberToken: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.token('T_EMBER', 1)]) },

  impGamble: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.dmgHero(scaleInt(V.dmgHero[lv] * 1.6, k))], { chance: 0.5, elseEffects: [E.selfDmg(scaleInt(V.dmgHero[lv] * 0.5, k))] }) },
  impOnDeath: { w: 2, min: 2, make: () => ab('ON_DESTROYED', [E.token('T_IMP', 1)]) },
  bloodPact: { w: 2, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.bothDmg(scaleInt(V.dmgHero[lv] * 1.2, k))]) },
  luckyDraw: { w: 3, min: 1, make: () => ab('ON_SUMMON', [E.draw(1)], { chance: 0.4 }) },
  luckyBuff: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.buff('SELF', scaleInt(V.buffAtk[lv] * 1.8, k), scaleInt(V.buffDef[lv] * 1.4, k))], { chance: 0.5 }) },
  deathDrawChance: { w: 2, min: 1, make: () => ab('ON_DESTROYED', [E.draw(1)], { chance: 0.5 }) },
  coinFace: { w: 2, min: 2, make: (lv, k) => ab('ON_ATTACK', [E.dmgHero(scaleInt(V.dmgHero[lv] * 0.9, k))], { chance: 0.5 }) },
  silenceRandom: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.silence('ENEMY_RANDOM')]) },
  weakenAll: { w: 2, min: 3, make: (lv, k) => ab('ON_SUMMON', [E.debuff('ENEMY_ALL', scaleInt(V.buffAtk[lv] * 0.5, k), 0)]) },
  reviveSmall: { w: 2, min: 3, make: (lv) => ab('ON_SUMMON', [E.revive(Math.max(1, lv - 2))]) },
  discardOnSummon: { w: 1, min: 4, make: () => ab('ON_SUMMON', [E.discard(1)]) },
  swapStrongest: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.swap('ENEMY_STRONGEST')]) },
  bounceSmall: { w: 2, min: 3, make: (lv) => ab('ON_SUMMON', [E.bounce('ENEMY_RANDOM', lv - 1)]) },
  phantomToken: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.token('T_PHANTOM', 1)]) },
  freezeRandom: { w: 2, min: 1, make: () => ab('ON_SUMMON', [E.freeze('ENEMY_RANDOM')]) },
  fateDestroy: { w: 2, min: 3, make: (lv) => ab('ON_SUMMON', [E.destroy('ENEMY_STRONGEST')], { chance: Math.min(0.5, 0.1 * lv) }) },
  fateFreezeAll: { w: 1, min: 4, make: () => ab('ON_SUMMON', [E.freeze('ENEMY_ALL')], { chance: 0.5 }) },
  catchUpDraw: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.draw(1)], { condition: { type: 'behindOnBoard' } }) },

  packBuff: { w: 3, min: 1, make: (lv, k) => ab('ON_SUMMON', [E.buff('SELF', scaleInt(V.buffAtk[lv] * 1.3, k), scaleInt(V.buffDef[lv], k))], { condition: { type: 'allyTagAtLeast', tag: '#야수', value: 1 } }) },
  wolfToken: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.token('T_WOLF', 1)]) },
  feedOnKill: { w: 2, min: 1, make: (lv, k) => ab('ON_KILL', [E.heal(scaleInt(V.heal[lv] * 0.7, k))]) },
  frostRandom: { w: 2, min: 2, make: () => ab('ON_SUMMON', [E.freeze('ENEMY_RANDOM')]) },
  skeletonOnDeath: { w: 3, min: 1, make: () => ab('ON_DESTROYED', [E.token('T_SKELETON', 1)]) },
  drainOnSummon: { w: 2, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.debuff('ENEMY_RANDOM', scaleInt(V.buffAtk[lv] * 0.7, k), 0)]) },
  mercBonus: { w: 1, min: 2, make: (lv, k) => ab('ON_SUMMON', [E.buff('SELF', scaleInt(V.buffAtk[lv], k), 0)], { condition: { type: 'enemyBoardAtLeast', value: 3 } }) },
};

// --------------------------------------------------------------------------
// 진영 · 종족 표
// --------------------------------------------------------------------------
const FACTIONS = [
  {
    id: 'BLUE', prefix: 'BL',
    tribes: [
      {
        tag: '#기사단', atkRatio: 0.38,
        mods: ['성역의', '은빛', '맹세한', '백야의', '순례하는', '서약의', '수호하는', '강철 서약의', '여명의', '성채의'],
        nouns: [['종자', '방패병', '창병', '순례기사', '견습 기사', '파수병'], ['기사', '방진 기사', '성기사', '근위병', '순찰 기사', '깃발기사'], ['기사단장', '성벽 수호자', '순백의 성기사', '심판 기사'], ['성역 총사령관', '대성기사'], ['성검의 영웅왕']],
        kws: [{ id: 'TAUNT', w: 4 }, { id: 'BULWARK', w: 2 }, { id: 'RETALIATE', w: 1 }],
        tpl: ['shieldOnSummon', 'shieldOnDeath', 'buffOthersDef', 'squireToken'],
      },
      {
        tag: '#천사', atkRatio: 0.45,
        mods: ['빛날개', '새벽빛', '찬란한', '은총의', '천상의', '성광의', '순결한', '하늘의', '축복받은', '영원의'],
        nouns: [['아기 천사', '빛의 정령', '깃털 수호령', '찬송 천사', '빛망울', '성가대 천사'], ['수호천사', '날개 기사', '빛의 사도', '성광 천사', '하늘 전령', '은빛 천사'], ['권천사', '능천사', '심판의 천사', '치천사'], ['좌천사', '주천사'], ['천사장']],
        kws: [{ id: 'DIVINE', w: 4 }, { id: 'TAUNT', w: 1 }, { id: 'LIFESTEAL', w: 1 }],
        tpl: ['healOnSummon', 'healOnDeath', 'healTurnEnd', 'grantDivine'],
      },
      {
        tag: '#마법사', atkRatio: 0.45,
        mods: ['빛의', '성광의', '룬새김', '별빛', '현자의', '결계의', '고서의', '수정의', '백은의', '진리의'],
        nouns: [['견습 마법사', '룬 학도', '등불 술사', '필경사', '결계 수습생', '빛 점술사'], ['마도사', '결계술사', '룬 마법사', '봉인술사', '별 관측자', '수정술사'], ['대마법사', '대현자', '봉인의 마도사', '진리 탐구자'], ['마탑의 주인', '대결계사'], ['빛의 대현자']],
        kws: [{ id: 'DIVINE', w: 1 }],
        kwChance: 0.25,
        tpl: ['pingWeakest', 'pingRandom', 'freezeStrongest', 'silenceStrongest', 'destroySmall', 'drawIfLowHand'],
      },
      {
        tag: '#수도회', atkRatio: 0.35,
        mods: ['고요한', '기도하는', '수도원의', '참회하는', '묵상의', '순명의', '자애로운', '침묵의', '성배의', '고행의'],
        nouns: [['수련 수도사', '수녀', '탁발승', '종지기', '약초 수도사', '성가 수도사'], ['수도사', '치유사', '고행승', '성배 수호자', '기도 사제', '순례 사제'], ['수도원장', '대사제', '성배의 기사', '은둔 성자'], ['대주교', '성녀'], ['성인']],
        kws: [{ id: 'TAUNT', w: 2 }, { id: 'LIFESTEAL', w: 1 }],
        tpl: ['healTurnEndSmall', 'buffWeakestDef', 'healIfLow', 'healOnSummon'],
      },
      {
        tag: '#골렘', atkRatio: 0.28,
        mods: ['석영', '대리석', '성채', '룬각인', '백금', '결정', '성벽', '화강암', '청동', '방벽'],
        nouns: [['돌정령', '작은 골렘', '파편 골렘', '초석 파수꾼', '문지기 석상', '조약돌 병정'], ['골렘', '석상 경비병', '성문 골렘', '방벽 거인', '룬 석상', '결정 골렘'], ['거신 골렘', '성채 거인', '고대 수호상', '방벽의 거상'], ['요새 골렘', '성벽의 거신'], ['성채 타이탄']],
        kws: [{ id: 'BULWARK', w: 3 }, { id: 'RETALIATE', w: 2 }, { id: 'TAUNT', w: 2 }],
        tpl: ['shieldOnSummon', 'gearOnDeath', 'selfDefTurnEnd'],
      },
    ],
  },
  {
    id: 'RED', prefix: 'RD',
    tribes: [
      {
        tag: '#돌격대', atkRatio: 0.62,
        mods: ['선봉', '진홍', '맹렬한', '돌파의', '함성의', '붉은 깃발', '투지의', '불굴의', '전진하는', '핏빛'],
        nouns: [['돌격병', '창돌격병', '북잡이', '척후병', '신병', '도끼병'], ['돌격대장', '기병', '중갑 돌격병', '전투 나팔수', '파성추병', '쌍도끼병'], ['돌격 군단장', '전투 기병대장', '파괴 공병', '붉은 백인대장'], ['전쟁 군주', '돌파의 장군'], ['불패의 대장군']],
        kws: [{ id: 'DOUBLE', w: 2 }, { id: 'UNDYING', w: 1 }],
        kwChance: 0.35,
        tpl: ['atkOnAttack', 'rallyAtk', 'atkOnKill'],
      },
      {
        tag: '#용족', atkRatio: 0.55,
        mods: ['화산', '홍옥', '작열하는', '잿빛', '용암', '적린', '불꽃 비늘', '태양', '유황', '홍염'],
        nouns: [['새끼 용', '도마뱀 전사', '비룡 알지기', '용혈 견습생', '불도마뱀', '와이번 새끼'], ['와이번', '드레이크', '용기사', '화룡 사냥꾼', '비늘 수호자', '불꽃 비룡'], ['성룡', '고룡 기사', '화염 드래곤', '용족 장군'], ['고대룡', '용왕의 기사'], ['태고의 화룡']],
        kws: [{ id: 'PIERCE', w: 4 }, { id: 'LIFESTEAL', w: 1 }],
        tpl: ['burnAll', 'faceOnSummon', 'attackPing'],
      },
      {
        tag: '#광전사', atkRatio: 0.66,
        mods: ['피에 굶주린', '분노한', '광란의', '핏빛', '폭주하는', '울부짖는', '상처투성이', '야만의', '들끓는', '짐승 같은'],
        nouns: [['광전사', '투사', '검투사', '전쟁광', '폭도', '도끼 투척수'], ['광전사 대장', '피의 검투사', '분노의 전사', '광란 투사', '혈투사', '도살자'], ['광전사 집단장', '피의 군주', '학살자', '광란의 왕'], ['분노의 화신', '전쟁 악귀'], ['피의 대군주']],
        kws: [{ id: 'UNDYING', w: 2 }, { id: 'LIFESTEAL', w: 2 }, { id: 'PIERCE', w: 2 }],
        tpl: ['atkOnKill', 'rageLowLp', 'deathFace'],
      },
      {
        tag: '#암살단', atkRatio: 0.6,
        mods: ['그림자', '밤의', '독 묻은', '소리 없는', '홍련', '검은 장막', '칼날', '은밀한', '안개의', '달 없는'],
        nouns: [['소매치기', '척후 도적', '독침수', '밤손님', '단검수', '정찰병'], ['암살자', '독살자', '그림자 검사', '칼날 무희', '밀정', '저격수'], ['암살단장', '그림자 군주', '독의 대가', '처형인'], ['그림자 왕', '밤의 지배자'], ['전설의 암살자']],
        kws: [{ id: 'STEALTH', w: 4 }, { id: 'DIRECT', w: 1 }, { id: 'LIFESTEAL', w: 1 }],
        tpl: ['assassinate', 'stabWeakest', 'weakenAttack'],
      },
      {
        tag: '#화염술사', atkRatio: 0.55,
        mods: ['불꽃의', '화염', '재의', '작열', '홍염의', '불씨', '분화구', '폭염의', '연소의', '타오르는'],
        nouns: [['불씨 술사', '화염 수습생', '불쏘시개', '봉화지기', '화약 장인', '불꽃 점술사'], ['화염술사', '폭염 마도사', '불의 주술사', '화약 기술자', '연소술사', '불꽃 무희'], ['대화염술사', '불의 현자', '폭발 전문가', '화산의 무녀'], ['불꽃의 대마도사', '지옥불 술사'], ['화염의 군주']],
        kws: [{ id: 'LIFESTEAL', w: 2 }, { id: 'PIERCE', w: 1 }],
        kwChance: 0.15,
        tpl: ['faceOnSummon', 'burnStart', 'fireballStrongest', 'emberToken'],
      },
    ],
  },
  {
    id: 'PURPLE', prefix: 'PU',
    tribes: [
      {
        tag: '#악마', atkRatio: 0.55,
        mods: ['심연', '유황의', '저주받은', '타락한', '검은 불꽃', '역병의', '지옥의', '계약의', '굶주린', '비틀린'],
        nouns: [['임프', '꼬마 악마', '악마 졸개', '지옥견', '혼령', '계약 마귀'], ['악마', '서큐버스', '지옥 기사', '악마 사냥개', '계약 악마', '공포 마귀'], ['대악마', '지옥 군주', '악몽의 기수', '타락 천사'], ['마왕의 수족', '심연의 공작'], ['마왕']],
        kws: [{ id: 'LIFESTEAL', w: 2 }, { id: 'UNDYING', w: 1 }],
        tpl: ['impGamble', 'impOnDeath', 'bloodPact'],
      },
      {
        tag: '#도박꾼', atkRatio: 0.5,
        mods: ['행운의', '파산한', '속임수', '뒷골목', '패를 숨긴', '운명을 건', '은화의', '주사위', '카드패', '한탕의'],
        nouns: [['야바위꾼', '주사위꾼', '카드 사기꾼', '빚쟁이', '동전 마술사', '점쟁이 소녀'], ['도박사', '딜러', '카지노 경비', '타짜', '빚 수금원', '룰렛 마술사'], ['도박장 주인', '타짜의 왕', '행운의 사기꾼', '대도박사'], ['카지노의 제왕', '운명의 딜러'], ['전설의 타짜']],
        kws: [],
        kwChance: 0,
        tpl: ['luckyDraw', 'luckyBuff', 'deathDrawChance', 'coinFace'],
      },
      {
        tag: '#심연', atkRatio: 0.45,
        mods: ['심해의', '공허의', '이름 없는', '촉수의', '잠든', '속삭이는', '별 너머의', '광기의', '끝없는', '뒤틀린'],
        nouns: [['공허 유충', '심연 촉수', '눈알 괴물', '광신도', '속삭이는 그림자', '점액 덩어리'], ['심연 수호자', '공허 사제', '촉수 괴수', '광기의 학자', '심해 망령', '별의 사생아'], ['심연의 감시자', '공허의 군주', '고대의 꿈', '심해 대사제'], ['잠든 신의 사도', '공허의 왕'], ['심연의 군주']],
        kws: [{ id: 'UNDYING', w: 1 }, { id: 'RETALIATE', w: 1 }],
        tpl: ['silenceRandom', 'weakenAll', 'reviveSmall', 'discardOnSummon'],
      },
      {
        tag: '#환영', atkRatio: 0.5,
        mods: ['거울의', '안개', '신기루', '몽환의', '꿈꾸는', '허상의', '달빛', '일그러진', '어스름', '기만의'],
        nouns: [['환영', '도플갱어', '거울 요정', '허깨비', '꿈 나비', '안개 정령'], ['환술사', '거울 기사', '몽마', '신기루 무희', '그림자 분신', '환상 짐승'], ['대환술사', '거울의 여왕', '악몽술사', '허상의 군주'], ['꿈의 지배자', '환영의 왕'], ['몽환의 마녀']],
        kws: [{ id: 'STEALTH', w: 4 }],
        tpl: ['swapStrongest', 'bounceSmall', 'phantomToken', 'freezeRandom'],
      },
      {
        tag: '#운명술사', atkRatio: 0.45,
        mods: ['별점의', '운명의', '점성술', '실 잣는', '카드 점의', '예언의', '시간의', '모래시계', '달의', '숙명의'],
        nouns: [['점성술사', '타로 점쟁이', '운명의 실타래', '별 읽는 아이', '모래시계지기', '예언 소년'], ['운명술사', '예언자', '시간 술사', '별의 무녀', '실 잣는 노파', '점성 기사'], ['대예언자', '운명의 직조자', '시간의 수호자', '별의 대주술사'], ['운명의 여신관', '시간의 지배자'], ['운명을 잣는 자']],
        kws: [],
        kwChance: 0,
        tpl: ['fateDestroy', 'fateFreezeAll', 'catchUpDraw', 'freezeRandom'],
      },
    ],
  },
  {
    id: 'NEUTRAL', prefix: 'NE',
    tribes: [
      {
        tag: '#야수', atkRatio: 0.6,
        mods: ['들판의', '숲의', '설원의', '사나운', '늙은', '굶주린', '바위산', '폭풍의', '갈기', '야생의'],
        nouns: [['늑대', '멧돼지', '독수리', '살쾡이', '들개', '뿔토끼'], ['회색곰', '설표', '거대 독수리', '큰뿔 사슴', '우두머리 늑대', '늪 악어'], ['동굴곰', '그리폰', '늑대왕', '거대 맘모스'], ['천둥새', '숲의 군주'], ['태고의 짐승왕']],
        kws: [{ id: 'DOUBLE', w: 2 }, { id: 'TAUNT', w: 1 }],
        kwChance: 0.3,
        tpl: ['packBuff', 'wolfToken', 'feedOnKill'],
      },
      {
        tag: '#기계', atkRatio: 0.4,
        mods: ['태엽', '증기', '놋쇠', '톱니', '시계탑', '구리', '강철', '자동', '연금', '증기기관'],
        nouns: [['쥐', '병정', '인형', '사냥개', '부엉이', '파수꾼'], ['기사', '골렘', '포대', '경비병', '거미', '로봇'], ['거인', '파괴자', '전차', '요새'], ['타이탄', '수호자'], ['신장']],
        kws: [{ id: 'BULWARK', w: 2 }, { id: 'RETALIATE', w: 2 }],
        tpl: ['gearOnDeath', 'shieldOnSummon', 'selfDefTurnEnd'],
      },
      {
        tag: '#정령', atkRatio: 0.5,
        mods: ['바람의', '물의', '얼음', '대지의', '번개의', '이끼의', '폭풍', '이슬의', '서리', '바위'],
        nouns: [['정령', '도깨비불', '물방울 요정', '바람 요정', '서리 정령', '흙 요정'], ['정령 수호자', '번개 정령', '얼음 정령', '폭풍 정령', '대지 정령', '물의 무희'], ['대정령', '서리 거인', '폭풍의 화신', '대지의 수호령'], ['정령왕의 사자', '원소의 군주'], ['정령왕']],
        kws: [{ id: 'DIVINE', w: 1 }, { id: 'STEALTH', w: 1 }],
        tpl: ['pingRandom', 'healOnSummon', 'frostRandom', 'shieldOnSummon'],
      },
      {
        tag: '#언데드', atkRatio: 0.5,
        mods: ['무덤의', '저주받은', '썩어가는', '망자의', '창백한', '해골', '묘지기', '유령', '안개 낀', '버려진'],
        nouns: [['해골', '구울', '좀비', '망령', '시체 까마귀', '무덤 쥐'], ['해골 기사', '망령 기사', '시체 골렘', '밴시', '구울 대장', '강령술 견습생'], ['리치', '죽음의 기사', '흡혈귀', '강령술사'], ['망자의 군주', '흡혈귀 백작'], ['죽음의 왕']],
        kws: [{ id: 'UNDYING', w: 3 }, { id: 'LIFESTEAL', w: 1 }],
        tpl: ['skeletonOnDeath', 'reviveSmall', 'drainOnSummon'],
      },
      {
        tag: '#용병', atkRatio: 0.5,
        mods: ['떠돌이', '금화의', '외눈', '늙은', '은화', '계약된', '이름난', '전장의', '방랑', '고용된'],
        nouns: [['용병', '석궁병', '방패 용병', '길잡이', '현상금 사냥꾼', '투창병'], ['용병 대장', '중갑 용병', '사냥꾼', '검객', '투석병', '결투가'], ['용병단장', '전설의 검객', '공성 기술자', '결투의 달인'], ['용병왕', '검성'], ['전쟁의 영웅']],
        kws: [{ id: 'TAUNT', w: 2 }, { id: 'PIERCE', w: 2 }, { id: 'DIRECT', w: 1 }],
        tpl: ['mercBonus'],
        vanillaChance: 0.6,
      },
    ],
  },
];

// --------------------------------------------------------------------------
// 마법 표
// --------------------------------------------------------------------------
// 마법 레벨별 효과 예산 (스탯 포인트 환산)
const SPELL_BUDGET = { 1: 6, 2: 9, 3: 13 };

// 마법 템플릿: make(x) — x는 세기 단계(1부터 증가). 예산을 넘지 않는 최대 x를 고른다.
const SPELL_T = {
  nuke: { noun: ['화염탄', '낙뢰', '불화살', '섬광탄', '폭렬구'], trig: 'INSTANT', make: (x) => [E.dmgHero(4 + x * 2)] },
  snipe: { noun: ['일격', '창', '저격', '단죄', '화살'], trig: 'INSTANT', make: (x) => [E.dmgUnit('ENEMY_STRONGEST', 4 + x * 2)] },
  sweep: { noun: ['폭풍', '파도', '섬광', '불길', '진동'], trig: 'INSTANT', make: (x) => [E.dmgUnit('ENEMY_ALL', 2 + x)] },
  execute: { noun: ['처형', '심판', '단두대', '봉인', '소멸'], trig: 'INSTANT', lvMin: 2, make: (x) => [E.destroy('ENEMY_RANDOM', Math.min(4, x))] },
  heal: { noun: ['축복', '기도', '찬가', '성수', '안식'], trig: 'ON_TURN_START', make: (x) => [E.heal(6 + x * 4)] },
  healDraw: { noun: ['계시', '성서', '예언', '묵시', '등불'], trig: 'ON_TURN_START', make: (x) => [E.heal(4 + x * 3), E.draw(1)] },
  shield: { noun: ['결계', '방벽', '수호진', '성벽', '방패'], trig: 'INSTANT', make: (x) => [E.shield(6 + x * 4)] },
  counter: { noun: ['반격 결계', '응징', '보복', '역습', '반사진'], trig: 'ON_ATTACKED', make: (x) => [E.debuff('ATTACKER', 3 + x * 2, 0), E.dmgHero(2 + x * 2)] },
  mine: { noun: ['지뢰', '함정', '덫', '가시밭', '폭약'], trig: 'ON_ATTACKED', make: (x) => [E.dmgUnit('ATTACKER', 6 + x * 3)] },
  frostTrap: { noun: ['서리 덫', '얼음 감옥', '정지 결계', '속박', '사슬'], trig: 'ON_ATTACKED', make: (x) => (x >= 2 ? [E.freeze('ATTACKER'), E.dmgUnit('ATTACKER', 2 + x * 2)] : [E.freeze('ATTACKER')]) },
  rally: { noun: ['나팔', '함성', '군가', '깃발', '진군'], trig: 'ON_TURN_START', make: (x) => [E.buff('ALLY_ALL', 1 + x, 0)] },
  fortify: { noun: ['방진', '축성', '강화', '수호 서약', '갑주'], trig: 'ON_TURN_START', make: (x) => [E.buff('ALLY_ALL', 0, 2 + x * 2)] },
  empower: { noun: ['각성', '광기', '투혼', '피의 맹세', '불꽃 세례'], trig: 'INSTANT', make: (x) => [E.buff('ALLY_RANDOM', 2 + x * 2, 1 + x)] },
  haste: { noun: ['질풍', '돌격 명령', '연격', '쌍검술', '맹공'], trig: 'INSTANT', lvMin: 2, make: (x) => (x >= 2 ? [E.grant('ALLY_RANDOM', 'DOUBLE'), E.buff('ALLY_RANDOM', x, 0)] : [E.grant('ALLY_RANDOM', 'DOUBLE')]) },
  pierceGift: { noun: ['파쇄', '관통술', '창끝', '부서지는 일격', '돌파'], trig: 'INSTANT', make: (x) => [E.grant('ALLY_RANDOM', 'PIERCE'), E.buff('ALLY_RANDOM', 1 + x, 0)] },
  extraSummon: { noun: ['소환진', '증원', '징집', '부름', '집결'], trig: 'ON_TURN_START', make: () => [E.extra()] },
  ambush: { noun: ['매복', '기습', '복병', '함정 사격', '감시탑'], trig: 'ON_ENEMY_SUMMON', make: (x) => [E.dmgUnit('SUMMONED', 5 + x * 3)] },
  banish: { noun: ['추방', '역류', '되돌림', '귀환령', '망각'], trig: 'ON_ENEMY_SUMMON', lvMin: 2, make: () => [E.bounce('SUMMONED')] },
  silenceSpell: { noun: ['침묵', '봉인', '정화', '해주', '무력화'], trig: 'INSTANT', make: (x) => (x >= 2 ? [E.silence('ENEMY_STRONGEST'), E.debuff('ENEMY_STRONGEST', x * 2, 0)] : [E.silence('ENEMY_STRONGEST')]) },
  tokens: { noun: ['소집', '부름', '징병', '군단', '무리'], trig: 'INSTANT', make: (x, token) => [E.token(token, Math.min(3, x))] },
  gambleNuke: { noun: ['룰렛', '주사위', '도박', '동전 던지기', '카드 뒤집기'], trig: 'INSTANT', chance: 0.5, make: (x) => [E.dmgHero(8 + x * 4)], makeElse: (x) => [E.selfDmg(2 + x)] },
  gambleDestroy: { noun: ['운명의 칼날', '파멸의 패', '죽음의 주사위', '흑점', '저주 인형'], trig: 'INSTANT', lvMin: 2, chance: 0.5, make: () => [E.destroy('ENEMY_STRONGEST')] },
  discard: { noun: ['악몽', '도둑질', '망각의 속삭임', '혼란', '탈취'], trig: 'ON_TURN_START', make: (x) => [E.discard(Math.min(2, x))] },
  swapSpell: { noun: ['뒤틀림', '전도', '거울상', '역전', '반전'], trig: 'INSTANT', make: () => [E.swap('ENEMY_STRONGEST')] },
  reviveSpell: { noun: ['부활', '강령', '귀환', '환생', '소생'], trig: 'INSTANT', make: (x) => [E.revive(Math.min(5, x + 1))] },
  curse: { noun: ['저주', '쇠약', '역병', '부식', '저주의 안개'], trig: 'INSTANT', make: (x) => [E.debuff('ENEMY_ALL', 1 + x, 0)] },
  bloodRitual: { noun: ['피의 의식', '희생', '계약', '대가', '피의 제물'], trig: 'INSTANT', make: (x) => [E.dmgHero(8 + x * 3), E.selfDmg(4 + x)] },
  drawLow: { noun: ['탐색', '보급', '정찰', '지혜', '회상'], trig: 'INSTANT', make: (x) => [E.draw(Math.min(2, x))], condition: { type: 'handAtMost', value: 1 } },
  mirror: { noun: ['거울', '반사', '되갚음', '메아리', '역류의 문'], trig: 'ON_ATTACKED', chance: 0.6, make: (x) => [E.dmgHero(6 + x * 3)], makeElse: (x) => [E.selfDmg(2 + x)] },
};

const SPELL_PLAN = {
  BLUE: { prefixes: ['성스러운', '여명의', '심판의', '은빛', '천상의', '빛의', '성역의', '순백의', '수호의', '서약의'], token: 'T_SQUIRE',
    mix: [['heal', 3], ['healDraw', 2], ['shield', 3], ['counter', 3], ['frostTrap', 2], ['sweep', 2], ['execute', 2], ['silenceSpell', 2], ['fortify', 3], ['tokens', 2], ['banish', 2], ['snipe', 2], ['drawLow', 2]], count: 30 },
  RED: { prefixes: ['홍련의', '진홍의', '작열하는', '불꽃의', '화산의', '맹렬한', '전쟁의', '핏빛', '분노의', '홍염의'], token: 'T_EMBER',
    mix: [['nuke', 4], ['snipe', 3], ['mine', 3], ['rally', 3], ['empower', 3], ['haste', 2], ['pierceGift', 2], ['extraSummon', 1], ['tokens', 2], ['ambush', 3], ['bloodRitual', 2], ['sweep', 2]], count: 30 },
  PURPLE: { prefixes: ['심연의', '혼돈의', '뒤틀린', '저주받은', '운명의', '몽환의', '공허의', '광기의', '그림자', '별 너머의'], token: 'T_IMP',
    mix: [['gambleNuke', 4], ['gambleDestroy', 2], ['discard', 2], ['swapSpell', 2], ['reviveSpell', 3], ['curse', 3], ['mirror', 3], ['extraSummon', 2], ['tokens', 2], ['bloodRitual', 2], ['banish', 1], ['silenceSpell', 2], ['frostTrap', 2]], count: 30 },
  NEUTRAL: { prefixes: ['고대의', '방랑자의', '장인의', '대지의', '바람의', '야생의', '숲의', '오래된', '전장의', '시간의'], token: 'T_WOLF',
    mix: [['drawLow', 3], ['empower', 3], ['heal', 2], ['shield', 3], ['snipe', 3], ['tokens', 3], ['reviveSpell', 2], ['mine', 2], ['fortify', 2], ['ambush', 2]], count: 25 },
};

// --------------------------------------------------------------------------
// 생성
// --------------------------------------------------------------------------
const usedNames = new Set([
  // 기본 카드·토큰 이름과 겹치지 않게
  '성소의 방패병', '심판의 섬광', '아이기스 수호신', '빛의 대마법사', '천상의 대천사 미카엘', '신성한 반격 결계', '여명의 축복',
  '선봉 돌격병', '홍련의 화염탄', '광전사 집행관', '홍련의 암살단', '진홍의 화룡 이그니스', '홍련의 화염 지뢰', '전쟁의 진격 나팔',
  '운명의 주사위 악마', '차원 균열의 룰렛', '심연의 창조신 아자젤', '황천의 도박사', '운명의 뒤틀림 룰렛', '혼돈의 소환진', '천벌의 파괴신 테라',
  '성역의 종자', '불씨 정령', '꼬마 임프', '환영 분신', '태엽 부품', '해골 병사', '새끼 늑대',
]);

/** 수식어와 명사가 같은 말을 되풀이하지 않는지 (예: '시간의 시간의 수호자') */
function redundant(mod, noun) {
  const stem = mod.replace(/의$/, '').split(' ').pop();
  return stem.length > 0 && noun.includes(stem);
}

function uniqueName(mods, noun) {
  const order = [...mods].sort(() => rnd() - 0.5).filter((m) => !redundant(m, noun));
  for (const m of order) {
    const name = `${m} ${noun}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  let i = 2;
  while (usedNames.has(`${noun} ${i}`)) i++;
  usedNames.add(`${noun} ${i}`);
  return `${noun} ${i}`;
}

function rollKeywords(tribe, level) {
  const chance = tribe.kwChance ?? 0.55;
  const pool = tribe.kws.filter((k) => level >= ({ PIERCE: 3, DOUBLE: 2 }[k.id] || 1));
  const kw = [];
  if (pool.length === 0 || rnd() > chance) return kw;
  kw.push(weighted(pool).id);
  if (level >= 4 && rnd() < 0.3) {
    const second = weighted(pool).id;
    if (!kw.includes(second)) kw.push(second);
  }
  return kw;
}

function makeMonster(faction, tribe, level, serial) {
  const rarity = rollRarity(level);
  const noun = pick(tribe.nouns[level - 1]);
  const name = uniqueName(tribe.mods, noun);
  let kw = rollKeywords(tribe, level);

  const vanilla = rnd() < (tribe.vanillaChance ?? 0.15);
  const options = tribe.tpl.map((id) => ({ id, ...T[id] })).filter((x) => level >= (x.min || 1));
  const tpl = !vanilla && options.length ? weighted(options) : null;

  const [lo, hi] = STAT_RANGE[level];
  const floor = Math.round(lo * 0.8);
  const target = STAT_MID[level] + RARITY_BONUS[rarity] + FACTION_BUDGET[faction.id][level <= 2 ? 'low' : 'high'] + Math.round(rnd() * 2 - 1);

  let abilities = [];
  let statSum = target - keywordsCost(kw);
  if (tpl) {
    for (const k of [1.0, 0.8, 0.6, 0.45]) {
      const a = tpl.make(level, k);
      const cost = abilityCost(a, 'MONSTER', tokenStatSumOf);
      if (statSum - cost >= floor) {
        abilities = [a];
        statSum -= cost;
        break;
      }
    }
  }
  while (statSum < floor && kw.length > 0) {
    kw.pop();
    statSum = target - keywordsCost(kw) - abilities.reduce((s, a) => s + abilityCost(a, 'MONSTER', tokenStatSumOf), 0);
  }
  // 스탯 상한을 넘는 예산은 버리지 않고 더 강한 효과나 추가 키워드로 바꾼다
  let surplus = statSum - hi;
  if (surplus >= 1.5 && tpl && abilities.length > 0) {
    const current = abilityCost(abilities[0], 'MONSTER', tokenStatSumOf);
    for (const k of [2.2, 1.9, 1.6, 1.4, 1.2]) {
      const a = tpl.make(level, k);
      const extra = abilityCost(a, 'MONSTER', tokenStatSumOf) - current;
      if (extra > 0 && extra <= surplus) {
        abilities = [a];
        statSum -= extra;
        surplus -= extra;
        break;
      }
    }
  }
  for (let extraKw = 0; extraKw < 2 && surplus >= 2; extraKw++) {
    const pool = tribe.kws.filter((k) => !kw.includes(k.id) && level >= KEYWORDS[k.id].minLevel && KEYWORDS[k.id].cost <= surplus);
    if (pool.length === 0) break;
    const id = weighted(pool).id;
    kw.push(id);
    statSum -= KEYWORDS[id].cost;
    surplus -= KEYWORDS[id].cost;
  }
  statSum = Math.max(floor, Math.min(hi, Math.round(statSum)));

  let ratio = tribe.atkRatio + (rnd() * 0.16 - 0.08);
  let atk = Math.round(statSum * ratio);
  if (ATK_CAP[level] && atk > ATK_CAP[level]) atk = ATK_CAP[level];
  atk = Math.max(1, atk);
  let def = Math.max(1, statSum - atk);

  return {
    id: `${faction.prefix}_M${String(serial).padStart(3, '0')}`,
    name,
    type: 'MONSTER',
    faction: faction.id,
    level,
    attack: atk,
    defense: def,
    rarity,
    kw,
    tags: [tribe.tag],
    abilities,
  };
}

function makeSpell(faction, plan, serial) {
  const entry = weighted(plan.mix.map(([id, w]) => ({ id, w })));
  const tpl = SPELL_T[entry.id];
  let level = 1 + Math.floor(rnd() * 3);
  if (tpl.lvMin && level < tpl.lvMin) level = tpl.lvMin;
  const budget = SPELL_BUDGET[level];

  let best = null;
  for (let x = 1; x <= 8; x++) {
    const effects = tpl.make(x, plan.token);
    const ability = { trigger: tpl.trig, effects };
    if (tpl.condition) ability.condition = tpl.condition;
    if (tpl.chance) {
      ability.chance = tpl.chance;
      if (tpl.makeElse) ability.elseEffects = tpl.makeElse(x);
    }
    const cost = abilityCost(ability, 'SPELL', tokenStatSumOf);
    if (cost <= budget || !best) best = { ability, cost };
    if (cost > budget) break;
  }
  const rarity = level === 1 ? (rnd() < 0.7 ? 'COMMON' : 'UNCOMMON') : level === 2 ? (rnd() < 0.6 ? 'UNCOMMON' : 'RARE') : rnd() < 0.7 ? 'RARE' : 'EPIC';
  const name = uniqueName(plan.prefixes, pick(tpl.noun));
  return {
    id: `${faction.prefix}_S${String(serial).padStart(3, '0')}`,
    name,
    type: 'SPELL',
    faction: faction.id,
    level,
    rarity,
    spellTriggerType: tpl.trig,
    kw: [],
    tags: ['#마법'],
    abilities: [best.ability],
  };
}

const cards = [];
for (const faction of FACTIONS) {
  let m = 1;
  for (const tribe of faction.tribes) {
    for (const level of LEVEL_PLAN) cards.push(makeMonster(faction, tribe, level, m++));
  }
  const plan = SPELL_PLAN[faction.id];
  for (let s = 1; s <= plan.count; s++) cards.push(makeSpell(faction, plan, s));
}

const header = `/**
 * 확장 카드 데이터 (자동 생성 — 직접 수정하지 말 것)
 * 생성기: tools/build_cards.js  (deno run --allow-write tools/build_cards.js)
 * 카드 수: ${cards.length}
 */
`;
const body = `export const GENERATED_CARDS = ${JSON.stringify(cards, null, 1)};\n`;
const outPath = new URL('../src/cards/generatedCards.js', import.meta.url);
await Deno.writeTextFile(outPath, header + body);
console.log(`generated ${cards.length} cards → src/cards/generatedCards.js`);

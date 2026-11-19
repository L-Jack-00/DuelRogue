/**
 * @file duelRogueEngine.js
 * @description 「듀얼 로그 (Duel Rogue)」 선형 런 상태 머신(FSM) 및 대칭형 1v1 PvP 듀얼 엔진 (v2.0)
 * 
 * [사용자 정의 핵심 룰셋 탑재]
 * 1. 계층형 태그 시스템: 루트(' '), 1단계 자식('#'), 2단계 자식('##') 부모-자식 관계.
 * 2. 덱 마스터 시스템: 모든 진영 Lv 1 스타터 몬스터로 전장 시작 기물(씨앗) 배치.
 * 3. 노마나 & 소환권 시스템: 마나를 완전 폐지하고 턴당 1회 일반 소환권 부여.
 * 4. 1레벨 계단식 진화 & 합산 릴리스: 1레벨 차이는 몬스터 1마리 릴리스로 즉시 승급, 2레벨 이상 차이는 제물 레벨 합산 요구.
 * 5. 선/후공 판정: Lv 1 스타터 기반 50:50 공평 코인토스. 첫 1바퀴(1~2턴) 공격 봉인, 3턴 전투 전면 해금.
 * 6. 자유 행동 듀얼: 페이즈 구분 없이 카드 내기/공격/세트 자유 진행 (하스스톤 스타일).
 * 7. 몬스터 속공 & 수비 판정: ATK > DEF 시 파괴. DEF > ATK 시 공격자 본체 반사 피해 (유희왕 룰). 상대 몬스터 우선 공격(수호벽) 강제.
 * 8. 마법 발동 & 3개 위치 세트: 마나 소모 없이 즉시 발동 or 내 몬스터 앞 / 필드 중앙 좌 / 필드 중앙 우에 세트.
 *    (공격받을 시 / 턴 시작 시 / 턴 종료 시 트리거 격발)
 * 9. 30장 덱 구축 룰: 몬스터 최대 3장, 마법 최대 1장(싱글톤), 시작 4장 드로우(후공 +1장 보정), 매턴 1장 드로우.
 */

import { CARD_CATALOG, CARD_MAP, COLLECTIBLE_CARDS, getCardDef as lookupCard } from './cards/catalog.js';
import { registerCatalog, createDuel, applyCommand, checkWinner } from './duel/duelCore.js';
import { chooseAction, createMind, shiftMood, MAX_STEPS_PER_TURN, PERSONALITIES } from './ai/duelAi.js';
import { t } from './i18n/strings.js';
import {
  createStarterDeck,
  buildDeck,
  bossDeck,
  BOSSES,
  PACK_DEFS,
  packShelfEntry,
  openPack,
  rollShopSingles,
  merchantRewardPool,
  rollEncounter,
  FACTION_OF_DESTINY,
} from './run/content.js';

registerCatalog(lookupCard);

export class SeededRng {
  constructor(seed) {
    this.state = seed >>> 0;
  }

  nextFloat() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive, maxInclusive) {
    return Math.floor(this.nextFloat() * (maxInclusive - minInclusive + 1)) + minInclusive;
  }
}

/**
 * 루트 시드와 도메인 키(라운드/상점/이벤트/팩/인카운터/보스 등)를 조합해
 * 행동 순서에 흔들리지 않는 독립적인 32비트 서브 시드를 생성한다. (방식 B)
 */
export function hashSeedParts(rootSeed, ...parts) {
  let h = (2166136261 ^ (rootSeed >>> 0)) >>> 0;
  for (const part of parts) {
    const str = String(part);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) || 1;
}

/** 사용자 시드 입력(문자열/숫자/빈값)을 정규화된 시드 정보로 변환한다. */
export function normalizeSeedInput(rawSeed) {
  if (rawSeed === null || rawSeed === undefined) {
    return { isSeeded: false, seedText: null, numericSeed: null };
  }
  if (typeof rawSeed === 'number') {
    if (!Number.isFinite(rawSeed)) {
      return { isSeeded: false, seedText: null, numericSeed: null };
    }
    const numericSeed = (Math.floor(rawSeed) >>> 0) || 1;
    return { isSeeded: true, seedText: String(numericSeed), numericSeed };
  }
  const trimmed = String(rawSeed).trim();
  if (!trimmed) {
    return { isSeeded: false, seedText: null, numericSeed: null };
  }
  let numericSeed;
  if (/^\d+$/.test(trimmed) && Number(trimmed) <= 0xffffffff) {
    numericSeed = (Number(trimmed) >>> 0) || 1;
  } else {
    numericSeed = hashSeedParts(0x9e3779b9, 'SEED_TEXT', trimmed);
  }
  return { isSeeded: true, seedText: trimmed, numericSeed };
}

/** 공유·입력하기 쉬운 8자리 대문자 영숫자 시드 코드를 생성한다. */
export function generateRandomSeedCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * alphabet.length);
    code += alphabet[idx];
  }
  return code;
}

export const DESTINY_PROFILES = {
  BLUE_JUSTICE: {
    id: 'BLUE_JUSTICE',
    nameKo: '정의',
    favoredArchetype: 'CONTROL',
    nemesisBossId: 'BOSS_RED_UNSTOPPABLE_AGGRO',
    description: '견고한 수비와 회복, 반격 결계 마법을 바탕으로 전선을 유지하며 필드를 장악합니다.',
  },
  RED_ZEAL: {
    id: 'RED_ZEAL',
    nameKo: '열의',
    favoredArchetype: 'AGGRO',
    nemesisBossId: 'BOSS_BLUE_FORTRESS_CONTROL',
    description: '높은 공격력과 관통, 화염 마법을 앞세워 상대의 방어를 빠르게 돌파합니다.',
  },
  PURPLE_CHAOS: {
    id: 'PURPLE_CHAOS',
    nameKo: '혼돈',
    favoredArchetype: 'CHAOS_RNG',
    nemesisBossId: 'BOSS_PURPLE_RIGGED_FATE',
    description: '함정과 약화, 변칙적인 마법 효과를 활용해 전황을 뒤흔듭니다.',
  },
};

/**
 * 카드 카탈로그 (토큰 포함 전체). 정의는 src/cards/catalog.js 참조.
 * BINDER_CATALOG는 바인더·상점에 쓰는 수집 가능한 카드만 담는다.
 */
export const DEFAULT_CARD_CATALOG = CARD_CATALOG;
export const BINDER_CATALOG = COLLECTIBLE_CARDS;

export const MAX_RUN_CHANCES = 3;

export function validateDeckComposition(deckCardIds, catalogMap, deckMasterCardId) {
  if (!deckCardIds || deckCardIds.length !== 30) {
    return {
      valid: false,
      error: `덱은 정확히 30장이어야 합니다. (현재: ${deckCardIds ? deckCardIds.length : 0}장)`,
    };
  }

  if (!deckMasterCardId || !deckCardIds.includes(deckMasterCardId)) {
    return {
      valid: false,
      error: '덱 마스터 몬스터 카드 1장이 덱 내에서 반드시 지정되어야 합니다.',
    };
  }

  const dmDef = catalogMap.get(deckMasterCardId);
  if (!dmDef || dmDef.type !== 'MONSTER' || (dmDef.level ?? dmDef.cost ?? 1) !== 1) {
    return {
      valid: false,
      error: '덱 마스터는 반드시 레벨 1 몬스터 카드여야 합니다.',
    };
  }

  const counts = {};
  for (const cid of deckCardIds) {
    counts[cid] = (counts[cid] || 0) + 1;
    const def = catalogMap.get(cid);
    if (!def) {
      return { valid: false, error: `알 수 없는 카드 ID가 포함되어 있습니다: ${cid}` };
    }
    if (def.type === 'MONSTER' && counts[cid] > 3) {
      return {
        valid: false,
        error: `몬스터 카드 [${def.name}]는 최대 3장까지만 투입 가능합니다. (현재: ${counts[cid]}장)`,
      };
    }
    if (def.type === 'SPELL' && counts[cid] > 1) {
      return {
        valid: false,
        error: `마법 카드 [${def.name}]는 최대 1장까지만 투입 가능합니다. (현재: ${counts[cid]}장)`,
      };
    }
  }

  return { valid: true };
}

/**
 * 운명별 표준 30장 스타터 덱 빌더 (룰 100% 준수)
 */
export function createStartingDeck(destiny) {
  return createStarterDeck(destiny);
}

export class DuelRogueEngine {
  constructor(binder, catalog = DEFAULT_CARD_CATALOG, initialSeed = 20261015) {
    this.binder = binder;
    this.catalogMap = catalog === DEFAULT_CARD_CATALOG ? CARD_MAP : new Map(catalog.map((c) => [c.id, c]));
    this.rng = new SeededRng(initialSeed);
    this.instanceSeq = 1;
    this.state = this.createEmptyRunState('RUN_INIT', initialSeed);
  }

  createEmptyRunState(runId, seed, opts = {}) {
    const normalizedNum = seed != null ? ((Number(seed) >>> 0) || 1) : 1;
    return {
      runId,
      seed: normalizedNum,
      seedText: opts.seedText ?? String(normalizedNum),
      isSeededRun: Boolean(opts.isSeededRun),
      phase: 'IDLE',
      runMode: 'CHECKPOINT',
      maxChances: MAX_RUN_CHANCES,
      remainingChances: MAX_RUN_CHANCES,
      lastDefeatInfo: null,
      selectedDestiny: null,
      assignedFinalBoss: null,
      playerDeckCardIds: [],
      playerDeckMasterCardId: null,
      playerTrunkCardIds: [], // 유희왕 콘솔 스타일 가방 (트렁크 보관소)
      gold: 1000, // 2000년대 초 유희왕 500원 팩 2개 살 수 있는 1,000원 시작 자금
      roundNumber: 1, // 체크포인트 (라운드 n)
      checkpointShopStock: [], // 매번 랜덤하게 변하는 부스터 팩 종류 및 재고 수량
      checkpointShopSingles: [], // 상점에서 판매하는 낱장 카드 진열대
      suspiciousMerchant: null, // 드물게 낱장 카드를 판매하는 수상한 상인
      checkpointEvent: null, // 매 체크포인트마다 발생하는 돌발 랜덤 이벤트 (상점/상인/보상/보급 등)
      nextEncounterInfo: null, // 라운드별 난이도 스케일링된 듀얼 상대 정보
      openedPackCards: [], // 팩 구매 시 개봉된 3장의 카드 후보
      pendingCardToSwap: null, // 영입 확정 전 30장 덱 교체 대기 카드
      lastEncounterReward: 0,
      currentRewardPackChoices: [],
      currentMerchantOffer: null,
      activeDuel: null,
      hallOfFameSnapshot: null,
    };
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /** 이어 하기용 저장 데이터 (런 상태 + 난수 위치) */
  exportSave() {
    return { state: this.getSnapshot(), rngState: this.rng.state };
  }

  /** exportSave() 결과로 런을 복원한다 */
  importSave(data) {
    if (!data || !data.state || !data.state.phase) throw new Error('저장 데이터가 올바르지 않습니다.');
    this.state = JSON.parse(JSON.stringify(data.state));
    this.rng = new SeededRng(1);
    this.rng.state = data.rngState >>> 0;
    if (this.state.maxChances == null) {
      this.state.maxChances = this.state.runMode === 'LINEAR' ? 1 : MAX_RUN_CHANCES;
    }
    if (this.state.remainingChances == null) {
      this.state.remainingChances = this.state.phase === 'RUN_FAILED' ? 0 : this.state.maxChances;
    }
    // 진행 중이던 CPU 턴 계획은 다시 세운다
    if (this.state.activeDuel?.cpuMind) this.state.activeDuel.cpuMind.turnPlanned = null;
    return this.getSnapshot();
  }

  /** 루트 시드와 도메인 키로 독립 서브 RNG를 생성한다. (방식 B) */
  subRng(...parts) {
    const rootSeed = (this.state?.seed >>> 0) || 1;
    return new SeededRng(hashSeedParts(rootSeed, ...parts));
  }

  recordBinderSeen(cardId) {
    if (this.state?.isSeededRun) return;
    this.binder?.recordCardSeen?.(cardId);
  }

  recordBinderAcquired(cardId) {
    if (this.state?.isSeededRun) return;
    this.binder?.recordCardAcquired?.(cardId);
  }

  recordBinderPlayed(cardId, masteryDelta = 25) {
    if (this.state?.isSeededRun) return;
    this.binder?.recordCardPlayed?.(cardId, masteryDelta);
  }

  startNewRun(runId, seed, opts = {}) {
    let numericSeed;
    let seedText = opts.seedText ?? null;
    if (typeof seed === 'string') {
      const parsed = normalizeSeedInput(seed);
      numericSeed = parsed.numericSeed || 1;
      if (!seedText) seedText = parsed.seedText;
    } else {
      numericSeed = (Number(seed) >>> 0) || 1;
      if (!seedText) seedText = String(numericSeed);
    }
    this.rng = new SeededRng(numericSeed);
    this.state = this.createEmptyRunState(runId, numericSeed, {
      isSeededRun: Boolean(opts.isSeededRun),
      seedText,
    });
    this.state.phase = 'STAGE_0_FORTUNE';
    return this.getSnapshot();
  }

  selectFortuneDestiny(destiny, explicitMode = null) {
    this.assertPhase('STAGE_0_FORTUNE');
    const profile = DESTINY_PROFILES[destiny];
    this.state.selectedDestiny = destiny;
    this.state.assignedFinalBoss = profile.nemesisBossId;

    // 30장 정규 덱 및 덱 마스터 생성
    const startingDeck = createStartingDeck(destiny);
    const valid = validateDeckComposition(
      startingDeck.deckCardIds,
      this.catalogMap,
      startingDeck.deckMasterCardId
    );
    if (!valid.valid) {
      console.error('[Deck Validation Error]', valid.error);
    }

    this.state.playerDeckCardIds = startingDeck.deckCardIds;
    this.state.playerDeckMasterCardId = startingDeck.deckMasterCardId;

    for (const cid of startingDeck.deckCardIds) {
      this.recordBinderAcquired(cid);
    }

    // 모드 판별: E2E 테스트 러너 호환성 보장
    const mode = explicitMode || (this.state.runId === 'RUN_FULL_E2E' ? 'LINEAR' : 'CHECKPOINT');
    this.state.runMode = mode;

    if (mode === 'CHECKPOINT') {
      this.state.maxChances = MAX_RUN_CHANCES;
      this.state.remainingChances = MAX_RUN_CHANCES;
      this.state.lastDefeatInfo = null;
      this.state.gold = 1000;
      this.state.roundNumber = 1;
      this.state.phase = 'STAGE_CHECKPOINT';
      this.generateCheckpointState();
      return this.getSnapshot();
    }

    this.state.maxChances = 1;
    this.state.remainingChances = 1;
    this.state.lastDefeatInfo = null;

    // 레거시 선형 런 모드 (Suite 3 100% 호환)
    const cpuDeck = createStartingDeck('RED_ZEAL');
    this.state.phase = 'STAGE_1_DUEL_1';
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_1',
      'CPU_ROOKIE_DUELIST',
      'ROUND 1',
      cpuDeck.deckCardIds,
      cpuDeck.deckMasterCardId,
      0.0,
      {},
      hashSeedParts(this.state.seed, 'linear_duel', 'DUEL_STAGE_1')
    );
    return this.getSnapshot();
  }

  /**
   * [트레이더 물물교환용] 플레이어가 실제로 보유 중인 카드 중에서 지정 요구할 카드 샘플링
   */
  sampleOwnedCardsForTrade(count, excludeCardIds = [], rng = this.rng) {
    const masterId = this.state.playerDeckMasterCardId;
    const trunkPool = [...(this.state.playerTrunkCardIds || [])];
    const deckPool = (this.state.playerDeckCardIds || []).filter((id) => id !== masterId);
    let pool = [...trunkPool, ...deckPool];

    if (pool.length === 0) {
      pool = ['C_RED_01', 'C_BLUE_01', 'C_PURP_01', 'C_GREEN_01'];
    }

    // 제외할 카드 ID들(예: 상인이 제공하는 카드 자체) 임시 풀에서 제거
    // 같은 카드를 여러 장 보유한 경우에도 모든 사본을 제거해야 "같은 카드끼리 교환" 제안이 나오지 않는다.
    // 제거 후 요구 장수를 채울 수 없을 때만 원래 풀을 그대로 사용한다.
    const filteredPool = pool.filter((id) => !excludeCardIds.includes(id));
    const workingPool = filteredPool.length >= count ? filteredPool : [...pool];

    const selected = [];
    for (let i = 0; i < count; i++) {
      if (workingPool.length === 0) break;
      const rIdx = Math.floor(rng.nextFloat() * workingPool.length);
      selected.push(workingPool[rIdx]);
      workingPool.splice(rIdx, 1);
    }

    // 만약 workingPool이 부족한 극단적 경우 pool에서 패딩
    while (selected.length < count && pool.length > 0) {
      selected.push(pool[Math.floor(rng.nextFloat() * pool.length)]);
    }

    return selected;
  }

  /**
   * 체크포인트(라운드 n) 환경 생성기 (방식 B: 라운드/도메인별 독립 서브 시드)
   * - 상점: 부스터 팩 종류·재고·낱장 진열
   * - 수상한 상인: 암시장 물물교환 제안
   * - 인카운터: 라운드별 난이도 및 상대 덱 시드
   */
  generateCheckpointState() {
    const round = this.state.roundNumber || 1;
    this.state.shopVisitedRound = null;
    const eventRng = this.subRng('checkpoint', round, 'event');

    // 0. 돌발 랜덤 이벤트 추첨 (덱 편집/최종 보스를 제외한 상점/암시장/보급/현상금 요소)
    const eventPool = [
      { id: 'SHOP_BARGAIN', badge: '게릴라 세일', title: '상점 전 품목 20% 할인', icon: 'shop' },
      { id: 'SURPLUS_SUPPLY', badge: '보급 마차', title: '상점 팩 재고 & 낱장 추가 입고', icon: 'pack' },
      { id: 'MYSTERY_GIFT', badge: '전리품 상자', title: '가방에 보너스 카드 1장 획득', icon: 'gift' },
      { id: 'BLACK_MARKET_SUMMIT', badge: '암시장 개장', title: '수상한 상인 등장 & 수수료 할인', icon: 'merchant' },
      { id: 'BOUNTY_HUNT', badge: '특별 현상금', title: '다음 인카운터 승리 보상 +200원', icon: 'swords' },
    ];
    if (round >= 2) {
      eventPool.push({ id: 'VIP_BOUNTY', badge: '긴급 현상수배', title: '다음 인카운터 승리 보상 +350원', icon: 'gold' });
    }
    const rolledEvent = eventPool[Math.floor(eventRng.nextFloat() * eventPool.length)];
    let checkpointEvent = { ...rolledEvent };

    // 1. 부스터 팩 진열: 진영 팩 2~4종 랜덤 진열 + 신화 팩 확률 등장
    const shopRng = this.subRng('checkpoint', round, 'shop', checkpointEvent.id);
    const normals = PACK_DEFS.filter((p) => p.faction !== 'ALL')
      .map((p) => ({ p, r: shopRng.nextFloat() }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.p);
    const basePackCount = shopRng.nextFloat() < 0.35 ? 2 : (shopRng.nextFloat() < 0.7 ? 3 : 4);
    const shopPacks = [];
    const discountRate = checkpointEvent.id === 'SHOP_BARGAIN' ? 0.8 : 1.0;
    const stockBonus = checkpointEvent.id === 'SURPLUS_SUPPLY' ? 1 : 0;

    for (let i = 0; i < Math.min(normals.length, basePackCount); i++) {
      const stock = Math.max(1, Math.floor(shopRng.nextFloat() * 3) + 1 + stockBonus);
      const entry = packShelfEntry(normals[i], shopRng);
      shopPacks.push({
        ...entry,
        price: Math.max(100, Math.round((entry.price * discountRate) / 50) * 50),
        stock,
        maxStock: stock,
      });
    }
    const legendChance = round >= 2 ? 0.68 : 0.25;
    if (shopRng.nextFloat() < legendChance || checkpointEvent.id === 'SURPLUS_SUPPLY') {
      const legendEntry = packShelfEntry(PACK_DEFS.find((p) => p.faction === 'ALL'), shopRng);
      const legendStock = Math.max(1, round >= 3 && shopRng.nextFloat() < 0.3 ? 2 : 1);
      shopPacks.push({
        ...legendEntry,
        price: Math.max(200, Math.round((legendEntry.price * discountRate) / 50) * 50),
        stock: legendStock,
        maxStock: legendStock,
      });
    }
    this.state.checkpointShopStock = shopPacks;

    // 1-2. 상점 낱장 카드 진열대 (2~4장 랜덤 진열 및 할인 반영)
    const singleCount = (shopRng.nextFloat() < 0.5 ? 3 : 2) + (checkpointEvent.id === 'SURPLUS_SUPPLY' ? 1 : 0);
    this.state.checkpointShopSingles = rollShopSingles(shopRng, round, singleCount).map((item) => {
      const def = this.getCardDef(item.cardId);
      const finalPrice = Math.max(100, Math.round((item.price * discountRate) / 50) * 50);
      return {
        cardId: item.cardId,
        cardName: def.name,
        name: def.name,
        level: def.level,
        attack: def.attack,
        defense: def.defense,
        type: def.type,
        rarity: def.rarity,
        price: finalPrice,
        reason: item.reason,
        purchased: false,
      };
    });

    // 1-3. 랜덤 이벤트 실물 보상 처리
    if (checkpointEvent.id === 'MYSTERY_GIFT') {
      const giftRng = this.subRng('checkpoint', round, 'mystery_gift', checkpointEvent.id);
      const allCards = Array.from(this.catalogMap.values());
      const dropPool = allCards.filter((c) => c.collectible !== false && (round >= 2 || c.rarity !== 'LEGENDARY'));
      const pickedDrop = dropPool[Math.floor(giftRng.nextFloat() * dropPool.length)];
      if (pickedDrop) {
        this.state.playerTrunkCardIds.push(pickedDrop.id);
        this.recordBinderSeen(pickedDrop.id);
        this.recordBinderAcquired(pickedDrop.id);
        checkpointEvent.title = `가방에 「${pickedDrop.name}」 획득`;
        checkpointEvent.rewardCardId = pickedDrop.id;
      }
    }

    // 2. 수상한 상인 시스템: 암시장 물물교환 (등장 확률 & 제안 목록/수수료 랜덤화)
    const merchantRng = this.subRng('checkpoint', round, 'merchant', checkpointEvent.id);
    const merchantRoll = merchantRng.nextFloat();
    if (merchantRoll < 0.48 || round === 3 || checkpointEvent.id === 'BLACK_MARKET_SUMMIT') {
      const deals = [];
      const feeFactor = checkpointEvent.id === 'BLACK_MARKET_SUMMIT' ? 0.7 : 1.0;

      // 1) 1:1 대칭 맞교환 제안 (레어/에픽 카드)
      const pool1to1 = merchantRewardPool('1_1').map((c) => c.id);
      const pick1to1 = pool1to1[Math.floor(merchantRng.nextFloat() * pool1to1.length)];
      const def1 = this.getCardDef(pick1to1);
      const wanted1 = this.sampleOwnedCardsForTrade(1, [pick1to1], merchantRng);
      const defs1 = wanted1.map((id) => this.getCardDef(id)).filter(Boolean);
      const wantedNames1 = defs1.map((d) => `「${d.name}」`).join(', ');

      deals.push({
        dealId: 'DEAL_1_1',
        dealType: 'SYMMETRIC_1_1',
        title: '1 : 1 카드 교환',
        ratioBadge: '1 : 1',
        requiredCardCount: 1,
        wantedCardIds: wanted1,
        wantedCardNames: defs1.map((d) => d.name),
        goldFee: 0,
        rewardCardId: pick1to1,
        cardName: def1.name,
        rewardDef: def1,
        completed: false,
        flavor: `자네가 가진 ${wantedNames1} 1장을 넘겨주면, 내 진귀한 「${def1.name}」와 맞바꿔주지.`,
      });

      // 2) 2:1 희귀 카드 교환 제안
      const pool2to1 = merchantRewardPool('2_1').map((c) => c.id);
      const pick2to1 = pool2to1[Math.floor(merchantRng.nextFloat() * pool2to1.length)];
      const def2 = this.getCardDef(pick2to1);
      const wanted2 = this.sampleOwnedCardsForTrade(2, [pick2to1], merchantRng);
      const defs2 = wanted2.map((id) => this.getCardDef(id)).filter(Boolean);
      const wantedNames2 = defs2.map((d) => `「${d.name}」`).join(' + ');

      deals.push({
        dealId: 'DEAL_2_1',
        dealType: 'ASYMMETRIC_2_1',
        title: '2 : 1 희귀 카드 교환',
        ratioBadge: '2 : 1',
        requiredCardCount: 2,
        wantedCardIds: wanted2,
        wantedCardNames: defs2.map((d) => d.name),
        goldFee: 0,
        rewardCardId: pick2to1,
        cardName: def2.name,
        rewardDef: def2,
        completed: false,
        flavor: `「${def2.name}」를 원하나? 자네가 가진 ${wantedNames2} 2장을 모두 내놓게.`,
      });

      // 3) 3:1 전설 카드 교환 제안 (라운드 2 이상 70% 또는 블랙마켓 이벤트 시 50% 등장)
      const offerMythic = (round >= 2 && merchantRng.nextFloat() < 0.70)
        || (checkpointEvent.id === 'BLACK_MARKET_SUMMIT' && merchantRng.nextFloat() < 0.45);
      if (offerMythic) {
        const pool3to1 = merchantRewardPool('3_1').map((c) => c.id);
        const pick3to1 = pool3to1[Math.floor(merchantRng.nextFloat() * pool3to1.length)];
        const def3 = this.getCardDef(pick3to1);
        const wanted3 = this.sampleOwnedCardsForTrade(3, [pick3to1], merchantRng);
        const defs3 = wanted3.map((id) => this.getCardDef(id)).filter(Boolean);
        const wantedNames3 = defs3.map((d) => `「${d.name}」`).join(', ');
        const goldFee = Math.round(((250 + Math.floor(merchantRng.nextFloat() * 101)) * feeFactor) / 50) * 50;

        deals.push({
          dealId: 'DEAL_3_1',
          dealType: 'ASYMMETRIC_3_1',
          title: '3 : 1 전설 카드 교환',
          ratioBadge: '3 : 1',
          requiredCardCount: 3,
          wantedCardIds: wanted3,
          wantedCardNames: defs3.map((d) => d.name),
          goldFee,
          rewardCardId: pick3to1,
          cardName: def3.name,
          rewardDef: def3,
          completed: false,
          flavor: `태초의 신 「${def3.name}」의 힘을 다루려면, 자네의 ${wantedNames3} 3장과 ${goldFee}원을 함께 내놓아야 하네.`,
        });
      }

      const sampleDeal = deals[0];
      const sampleCardName = sampleDeal?.wantedCardNames?.[0] || '카드';

      this.state.suspiciousMerchant = {
        dialogue: `“쉿... 골드 따윈 굴러다니는 돌멩이에 불과하지. 자네가 가진 「${sampleCardName}」 같은 물건에 내가 관심이 많거든. 내가 원하는 카드를 건네준다면 내 진귀한 보물들과 바꿔줄 용의가 있네.”`,
        deals,
        items: deals.map((d) => ({
          cardId: d.rewardCardId,
          cardName: d.cardName,
          price: 500,
          purchased: d.completed,
        })),
      };
    } else {
      this.state.suspiciousMerchant = null;
    }

    // 3. 인카운터 난이도 & 보상 랜덤 생성 (라운드별 변주 + 돌발 현상금 반영)
    const encounterRng = this.subRng('checkpoint', round, 'encounter', checkpointEvent.id);
    const enc = this.generateScaledEncounter(round, encounterRng);
    const variance = (Math.floor(encounterRng.nextFloat() * 3) - 1) * 50; // -50 ~ +50 랜덤 변동
    const bountyBonus = checkpointEvent.id === 'BOUNTY_HUNT' ? 200 : (checkpointEvent.id === 'VIP_BOUNTY' ? 350 : 0);
    enc.rewardGold = Math.max(300, (enc.rewardGold || 500) + variance + bountyBonus);
    this.state.nextEncounterInfo = enc;
    this.state.checkpointEvent = checkpointEvent;
  }

  generateScaledEncounter(round, rng = this.subRng('checkpoint', round, 'encounter')) {
    return rollEncounter(round, rng);
  }

  /**
   * [인카운터 출진] 체크포인트 -> 듀얼 인카운터 돌입
   */
  startRandomEncounter() {
    this.assertPhase('STAGE_CHECKPOINT');
    if (this.state.playerDeckCardIds.length !== 30) {
      throw new Error(`덱이 정확히 30장이어야 결전에 나설 수 있습니다. (현재: ${this.state.playerDeckCardIds.length}장)`);
    }
    const encounter = this.state.nextEncounterInfo;
    if (!encounter) {
      throw new Error('다음 인카운터 정보가 생성되지 않았습니다.');
    }

    const round = encounter.round || this.state.roundNumber || 1;
    const deckRng = new SeededRng(encounter.deckSeed || hashSeedParts(this.state.seed, 'encounter_deck', round, encounter.duelistId));
    const cpuDeck = buildDeck({
      faction: encounter.faction || FACTION_OF_DESTINY[encounter.deckArchetype] || 'RED',
      tier: encounter.deckTierOverride ?? encounter.tier ?? Math.min(5, encounter.round),
      rng: deckRng,
    });
    const attemptIndex = Math.max(0, (this.state.maxChances ?? MAX_RUN_CHANCES) - (this.state.remainingChances ?? MAX_RUN_CHANCES));
    const duelSeed = attemptIndex > 0
      ? hashSeedParts(this.state.seed, 'duel_encounter', round, encounter.duelistId, 'retry', attemptIndex)
      : hashSeedParts(this.state.seed, 'duel_encounter', round, encounter.duelistId);

    this.state.phase = 'DUEL_ENCOUNTER';
    this.state.activeDuel = this.createSymmetricDuel(
      `DUEL_ROUND_${encounter.round}`,
      encounter.duelistId,
      encounter.name,
      cpuDeck.deckCardIds,
      cpuDeck.deckMasterCardId,
      encounter.luckBias,
      {
        personality: encounter.personality,
        volatility: encounter.volatility,
        isBeginner: Boolean(encounter.isBeginner),
        startingLp: encounter.cpuLp,
      },
      duelSeed
    );
    return this.getSnapshot();
  }

  /**
   * [최종 보스 도전] 언제든지 체크포인트에서 운명의 최종 보스에게 결전 신청!
   */
  challengeFinalBoss() {
    this.assertPhase('STAGE_CHECKPOINT');
    if (this.state.playerDeckCardIds.length !== 30) {
      throw new Error(`덱이 정확히 30장이어야 결전에 나설 수 있습니다. (현재: ${this.state.playerDeckCardIds.length}장)`);
    }
    this.state.phase = 'STAGE_5_FINAL_BOSS';
    this.state.activeDuel = this.createBossDuel();
    return this.getSnapshot();
  }

  /**
   * [부스터 팩 구매] 골드 차감 및 3장 카드 가방(트렁크) 영입
   */
  buyBoosterPack(packId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const pack = (this.state.checkpointShopStock || []).find((p) => p.id === packId);
    if (!pack) throw new Error('상점에 존재하지 않는 팩입니다.');
    if (pack.stock <= 0) throw new Error('해당 팩은 품절되었습니다.');
    if (this.state.gold < pack.price) {
      throw new Error(`골드가 부족합니다. (필요: ${pack.price}원, 보유: ${this.state.gold}원)`);
    }

    const round = this.state.roundNumber || 1;
    const buyIndex = Math.max(0, (pack.maxStock ?? pack.stock) - pack.stock);
    this.state.gold -= pack.price;
    pack.stock -= 1;

    // 팩에서 3장 카드 추첨 및 가방(트렁크)에 즉시 지급 (방식 B: 라운드+팩ID+구매순번 기반 서브 시드)
    if (!this.state.playerTrunkCardIds) {
      this.state.playerTrunkCardIds = [];
    }
    const packRng = this.subRng('checkpoint', round, 'pack', pack.id, buyIndex);
    const choices = openPack(pack, packRng, round);
    for (const drawnId of choices) {
      this.state.playerTrunkCardIds.push(drawnId);
      this.recordBinderSeen(drawnId);
      this.recordBinderAcquired(drawnId);
    }

    this.state.openedPackCards = choices;
    return {
      gold: this.state.gold,
      pack,
      choices,
      trunkCount: this.state.playerTrunkCardIds.length,
    };
  }

  /**
   * [상점 낱장 카드 구매] 골드 차감 및 가방(트렁크)에 즉시 영입
   */
  buyShopSingleCard(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const item = (this.state.checkpointShopSingles || []).find((i) => i.cardId === cardId && !i.purchased);
    if (!item) throw new Error('상점에 존재하지 않거나 이미 구매된 낱장 카드입니다.');
    if (this.state.gold < item.price) {
      throw new Error(`골드가 부족합니다. (필요: ${item.price}원, 보유: ${this.state.gold}원)`);
    }

    this.state.gold -= item.price;
    item.purchased = true;
    if (!this.state.playerTrunkCardIds) {
      this.state.playerTrunkCardIds = [];
    }
    this.state.playerTrunkCardIds.push(cardId);
    this.recordBinderAcquired(cardId);
    return {
      gold: this.state.gold,
      cardId,
      trunkCount: this.state.playerTrunkCardIds.length,
    };
  }

  /**
   * [수상한 상인: 물물교환 사전 계획] 거래를 검증하고 차감/보충 계획을 돌려준다. 상태는 바꾸지 않는다.
   * - 가방 카드를 우선 차감하고, 없으면 출전 덱에서 차감한다.
   * - 덱에서 차감된 첫 슬롯에는 보상 카드가 들어간다.
   * - 덱에서 2장 이상 차감되면 나머지 빈 슬롯을 가방 카드로 자동 보충해 덱 장수를 그대로 유지한다.
   *   보충할 가방 카드가 부족하면 거래를 거부한다.
   * UI(트레이드 모달 안내문)와 executeMerchantTrade가 같은 계획을 공유한다.
   */
  planMerchantTrade(dealId, offeredCardIds = []) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.suspiciousMerchant) throw new Error('수상한 상인이 자리에 없습니다.');
    const deal = (this.state.suspiciousMerchant.deals || []).find((d) => d.dealId === dealId && !d.completed);
    if (!deal) throw new Error('유효하지 않거나 이미 완료된 물물교환 제안입니다.');

    // 1. 요구 카드 수 검증
    const expectedCount = deal.wantedCardIds ? deal.wantedCardIds.length : (deal.requiredCardCount || 1);
    if (offeredCardIds.length !== expectedCount) {
      throw new Error(`이 거래는 정확히 ${expectedCount}장의 카드를 건네야 합니다. (선택: ${offeredCardIds.length}장)`);
    }

    // 2. 트레이더가 지정한 카드 요구 조건(wantedCardIds) 다중집합(multiset) 일치 검증
    if (deal.wantedCardIds && deal.wantedCardIds.length > 0) {
      const wantedSorted = [...deal.wantedCardIds].sort();
      const offeredSorted = [...offeredCardIds].sort();
      for (let i = 0; i < wantedSorted.length; i++) {
        if (wantedSorted[i] !== offeredSorted[i]) {
          const expectedDef = this.getCardDef(wantedSorted[i]);
          throw new Error(`상인이 요구한 카드「${expectedDef?.name || wantedSorted[i]}」가 누락되었거나 일치하지 않습니다.`);
        }
      }
    }

    // 3. 수수료 검증
    const fee = deal.goldFee || 0;
    if ((this.state.gold || 0) < fee) {
      throw new Error(`거래 수수료가 부족합니다. (필요: ${fee}원, 보유: ${this.state.gold}원)`);
    }

    // 4. 플레이어 인벤토리(가방 우선 차감, 없으면 출전 덱 차감) 검증
    const tempTrunk = [...(this.state.playerTrunkCardIds || [])];
    const tempDeck = [...(this.state.playerDeckCardIds || [])];
    const masterId = this.state.playerDeckMasterCardId;

    const consumePlan = [];
    for (const offeredId of offeredCardIds) {
      const tIdx = tempTrunk.indexOf(offeredId);
      if (tIdx !== -1) {
        tempTrunk.splice(tIdx, 1);
        consumePlan.push({ cardId: offeredId, source: 'trunk' });
        continue;
      }
      const dIdx = tempDeck.findIndex((id) => id === offeredId && id !== masterId);
      if (dIdx !== -1) {
        tempDeck.splice(dIdx, 1);
        consumePlan.push({ cardId: offeredId, source: 'deck' });
        continue;
      }
      const cardDef = this.getCardDef(offeredId);
      throw new Error(`보유 중인 가방 또는 덱에 「${cardDef?.name || offeredId}」 카드가 부족합니다.`);
    }

    // 5. 덱 장수 유지용 가방 보충 계획 (보상 카드가 채우는 1슬롯을 제외한 나머지 빈 슬롯)
    const deckConsumed = consumePlan.filter((c) => c.source === 'deck').length;
    const refillNeeded = Math.max(0, deckConsumed - 1);
    const refillPool = tempTrunk.filter((id) => id !== masterId);
    if (refillPool.length < refillNeeded) {
      throw new Error(
        `출전 덱 ${tempDeck.length + deckConsumed}장을 유지하려면 빈 슬롯을 채울 가방 카드가 ${refillNeeded}장 필요합니다. ` +
        `(가방 보유: ${refillPool.length}장) 가방에 카드를 더 모으거나 덱 대신 가방 카드를 건네주세요.`
      );
    }
    const refillCardIds = refillPool.slice(0, refillNeeded);

    return { deal, fee, consumePlan, deckConsumed, refillCardIds };
  }

  /**
   * [수상한 상인: 암시장 물물교환 트레이드] 지정 요구 카드(wantedCardIds) 1~3장 교환 (비대칭 교환 지원)
   * 거래 전후로 출전 덱 장수는 변하지 않는다. (planMerchantTrade 참조)
   */
  executeMerchantTrade(dealId, offeredCardIds = []) {
    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    if (!this.state.playerDeckCardIds) this.state.playerDeckCardIds = [];
    const { deal, fee, consumePlan, refillCardIds } = this.planMerchantTrade(dealId, offeredCardIds);

    // 실제 차감 및 지급 실행
    const trunk = this.state.playerTrunkCardIds;
    const deck = this.state.playerDeckCardIds;
    const masterId = this.state.playerDeckMasterCardId;
    this.state.gold -= fee;
    let slottedIntoDeck = false;
    const pendingRefills = [...refillCardIds];

    for (const plan of consumePlan) {
      if (plan.source === 'trunk') {
        trunk.splice(trunk.indexOf(plan.cardId), 1);
        continue;
      }
      const idx = deck.findIndex((id) => id === plan.cardId && id !== masterId);
      if (!slottedIntoDeck) {
        // 덱에서 차감된 첫 번째 슬롯은 획득한 보상 카드로 교체
        deck[idx] = deal.rewardCardId;
        slottedIntoDeck = true;
      } else {
        // 나머지 빈 슬롯은 가방 카드로 보충하여 덱 장수 유지
        const refillId = pendingRefills.shift();
        trunk.splice(trunk.indexOf(refillId), 1);
        deck[idx] = refillId;
      }
    }

    if (!slottedIntoDeck) {
      trunk.push(deal.rewardCardId);
    }

    this.recordBinderAcquired(deal.rewardCardId);
    deal.completed = true;

    // items 동기화
    if (this.state.suspiciousMerchant.items) {
      const targetItem = this.state.suspiciousMerchant.items.find((i) => i.cardId === deal.rewardCardId);
      if (targetItem) targetItem.purchased = true;
    }

    return {
      gold: this.state.gold,
      deal,
      rewardCardId: deal.rewardCardId,
      trunkCount: trunk.length,
      slottedIntoDeck,
      refilledFromTrunk: refillCardIds,
    };
  }

  /**
   * [수상한 상인 낱장 구매] 골드 차감 및 가방(트렁크)에 즉시 영입
   */
  buySuspiciousMerchantCard(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.suspiciousMerchant) throw new Error('수상한 상인이 자리에 없습니다.');
    const item = this.state.suspiciousMerchant.items.find((i) => i.cardId === cardId && !i.purchased);
    if (!item) throw new Error('구매할 수 없는 낱장 카드입니다.');
    if (this.state.gold < item.price) {
      throw new Error(`골드가 부족합니다. (필요: ${item.price}원, 보유: ${this.state.gold}원)`);
    }

    this.state.gold -= item.price;
    item.purchased = true;
    if (!this.state.playerTrunkCardIds) {
      this.state.playerTrunkCardIds = [];
    }
    this.state.playerTrunkCardIds.push(cardId);
    this.recordBinderAcquired(cardId);
    this.state.pendingCardToSwap = cardId;
    return {
      gold: this.state.gold,
      cardId,
      trunkCount: this.state.playerTrunkCardIds.length,
    };
  }

  /**
   * [가방 & 덱 편집] 덱에서 카드를 빼 가방으로 이동
   */
  moveCardDeckToTrunk(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const idx = this.state.playerDeckCardIds.indexOf(cardId);
    if (idx === -1) throw new Error(`카드 ${cardId}가 덱에 없습니다.`);
    if (cardId === this.state.playerDeckMasterCardId) {
      throw new Error('덱 마스터 몬스터는 가방으로 이동할 수 없습니다.');
    }
    this.state.playerDeckCardIds.splice(idx, 1);
    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    this.state.playerTrunkCardIds.push(cardId);
    return this.getSnapshot();
  }

  /**
   * [가방 & 덱 편집] 가방에서 카드를 꺼내 덱으로 편성
   */
  moveCardTrunkToDeck(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    const idx = this.state.playerTrunkCardIds.indexOf(cardId);
    if (idx === -1) throw new Error(`카드 ${cardId}가 가방에 없습니다.`);
    this.state.playerTrunkCardIds.splice(idx, 1);
    this.state.playerDeckCardIds.push(cardId);
    return this.getSnapshot();
  }

  /**
   * [가방 & 덱 편집] 임의의 레벨 1 몬스터를 새 덱 마스터로 지정
   * - 덱에 이미 있는 레벨 1 몬스터는 즉시 덱 마스터로 변경
   * - 가방에만 있는 경우 덱으로 편성(30장 이상이면 기존 덱 마스터 1장 또는 여유 카드 1장과 1:1 교체) 후 덱 마스터로 지정
   */
  setDeckMaster(cardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    const def = this.getCardDef(cardId);
    const level = def.level ?? def.cost ?? 1;
    if (def.type !== 'MONSTER' || level !== 1) {
      throw new Error(`덱 마스터는 레벨 1 몬스터만 지정할 수 있습니다. (${def.name}: Lv.${level})`);
    }
    if (cardId === this.state.playerDeckMasterCardId) {
      return this.getSnapshot();
    }

    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    if (this.state.playerDeckCardIds.includes(cardId)) {
      this.state.playerDeckMasterCardId = cardId;
      return this.getSnapshot();
    }

    const trunkIdx = this.state.playerTrunkCardIds.indexOf(cardId);
    if (trunkIdx === -1) {
      throw new Error(`덱 또는 가방에 해당 레벨 1 몬스터가 없습니다: ${def.name}`);
    }

    this.state.playerTrunkCardIds.splice(trunkIdx, 1);
    if (this.state.playerDeckCardIds.length >= 30) {
      const oldMasterId = this.state.playerDeckMasterCardId;
      let swapIdx = oldMasterId ? this.state.playerDeckCardIds.indexOf(oldMasterId) : -1;
      if (swapIdx === -1) swapIdx = 0;
      const [swappedOut] = this.state.playerDeckCardIds.splice(swapIdx, 1, cardId);
      if (swappedOut) this.state.playerTrunkCardIds.push(swappedOut);
    } else {
      this.state.playerDeckCardIds.push(cardId);
    }
    this.state.playerDeckMasterCardId = cardId;
    return this.getSnapshot();
  }

  /**
   * [덱 1:1 교체 - 하위 호환] 새 카드 영입 후 기존 덱에서 1장 방출
   */
  swapDeckCard(newCardId, oldCardId) {
    this.assertPhase('STAGE_CHECKPOINT');
    if (!this.state.playerDeckCardIds.includes(oldCardId)) {
      throw new Error(`교체할 카드 ${oldCardId}가 플레이어 덱에 없습니다.`);
    }
    if (oldCardId === this.state.playerDeckMasterCardId) {
      throw new Error('덱 마스터 몬스터는 덱에서 방출할 수 없습니다.');
    }

    if (!this.state.playerTrunkCardIds) this.state.playerTrunkCardIds = [];
    const trunkIdx = this.state.playerTrunkCardIds.indexOf(newCardId);
    if (trunkIdx !== -1) {
      this.state.playerTrunkCardIds.splice(trunkIdx, 1);
    }
    const idx = this.state.playerDeckCardIds.indexOf(oldCardId);
    this.state.playerDeckCardIds.splice(idx, 1, newCardId);
    this.state.playerTrunkCardIds.push(oldCardId);
    this.recordBinderAcquired(newCardId);

    this.state.openedPackCards = [];
    this.state.pendingCardToSwap = null;
    return this.getSnapshot();
  }

  cancelSwap() {
    this.state.openedPackCards = [];
    this.state.pendingCardToSwap = null;
    return this.getSnapshot();
  }

  /**
   * 대칭형 1v1 PvP 듀얼 생성기 (마나 제거, 1턴 1회 소환권 및 Lv 1 스타터 덱 마스터 필드 배치)
   */
  /**
   * 플레이어(0번 좌석) 대 CPU(1번 좌석) 듀얼 생성.
   * @param {object} [cpuProfile] { personality, volatility } — 상대 AI 성향
   */
  createSymmetricDuel(duelId, cpuId, cpuName, cpuDeckCardIds, cpuDeckMasterCardId, cpuLuckBias, cpuProfile = {}, explicitDuelSeed = null) {
    const duelSeed = explicitDuelSeed != null ? ((explicitDuelSeed >>> 0) || 1) : this.rng.nextInt(1, 2147483646);
    const duel = createDuel({
      duelId,
      seed: duelSeed,
      seats: [
        {
          duelistId: 'PLAYER_LOCAL',
          duelistName: t('who.player'),
          isCpu: false,
          deckCardIds: [...this.state.playerDeckCardIds],
          deckMasterCardId: this.state.playerDeckMasterCardId || this.state.playerDeckCardIds[0],
        },
        {
          duelistId: cpuId,
          duelistName: cpuName,
          isCpu: true,
          deckCardIds: [...cpuDeckCardIds],
          deckMasterCardId: cpuDeckMasterCardId || cpuDeckCardIds[0],
          luckBias: cpuLuckBias || 0,
          startingLp: cpuProfile.startingLp,
        },
      ],
    });
    duel.cpuMind = createMind(cpuProfile);
    return duel;
  }

  createBossDuel() {
    const bossId = this.state.assignedFinalBoss || 'BOSS_RED_UNSTOPPABLE_AGGRO';
    const boss = BOSSES[bossId] || BOSSES.BOSS_RED_UNSTOPPABLE_AGGRO;
    const deck = bossDeck(bossId, this.subRng('boss_deck', bossId));
    const attemptIndex = Math.max(0, (this.state.maxChances ?? MAX_RUN_CHANCES) - (this.state.remainingChances ?? MAX_RUN_CHANCES));
    const bossDuelSeed = attemptIndex > 0
      ? hashSeedParts(this.state.seed, 'duel_boss', bossId, 'retry', attemptIndex)
      : hashSeedParts(this.state.seed, 'duel_boss', bossId);
    return this.createSymmetricDuel(
      'DUEL_STAGE_5_BOSS',
      bossId,
      boss.name,
      deck.deckCardIds,
      deck.deckMasterCardId,
      boss.luckBias,
      {
        personality: boss.personality,
        volatility: boss.volatility,
      },
      bossDuelSeed
    );
  }

  /** 듀얼 명령 처리 (규칙은 duel/duelCore.js) */
  dispatchDuelCommand(cmd) {
    const duel = this.state.activeDuel;
    if (!duel || duel.status !== 'ONGOING') {
      throw new Error('진행 중인 듀얼이 없습니다.');
    }
    const handCard = cmd.type === 'PLAY_CARD' ? duel.seats[cmd.seat]?.hand.find((c) => c.instanceId === cmd.cardInstanceId) : null;
    applyCommand(duel, cmd);
    if (cmd.type === 'ATTACK') this.lastAttackResult = duel.lastAttackResult;
    if (handCard) {
      if (cmd.seat === 0) this.recordBinderPlayed(handCard.cardId, 35);
      else this.recordBinderSeen(handCard.cardId);
    }
    this.evaluateDuelOutcome(duel);
    return this.getSnapshot();
  }

  /** 현재 CPU 성향 정보 (화면 표시용) */
  getCpuMood() {
    const mind = this.state.activeDuel?.cpuMind;
    if (!mind) return null;
    return {
      id: mind.current,
      base: mind.base,
      name: t(`mood.${mind.current}.name`),
      desc: t(`mood.${mind.current}.desc`),
      line: mind.line,
      history: [...mind.history],
    };
  }

  /**
   * CPU 행동 1개를 실행한다. 화면이 한 수씩 연출할 수 있도록 턴을 잘게 나눈다.
   * @returns {{ action: object|null, moodShift: object|null, done: boolean }}
   */
  executeCpuStep() {
    const duel = this.state.activeDuel;
    if (!duel || duel.status !== 'ONGOING' || duel.activeSeat !== 1) {
      return { action: null, moodShift: null, done: true };
    }
    if (!duel.cpuMind) duel.cpuMind = createMind({});
    const mind = duel.cpuMind;
    let moodShift = null;
    if (mind.turnPlanned !== duel.turnNumber) {
      mind.turnPlanned = duel.turnNumber;
      mind.stepsThisTurn = 0;
      const shift = shiftMood(duel, 1, mind);
      if (shift.changed) {
        moodShift = shift;
        duel.events.push({
          key: 'event.mood',
          params: { who: duel.seats[1].duelistName, line: shift.line },
          kind: 'mood',
          seat: 1,
          mood: shift.to,
        });
      }
    }
    const personality = PERSONALITIES[mind.current] || PERSONALITIES.CALCULATING;
    let action =
      mind.stepsThisTurn >= MAX_STEPS_PER_TURN
        ? { type: 'END_TURN', seat: 1 }
        : chooseAction(duel, 1, personality, (id) => this.getCardDef(id), { beginner: Boolean(mind.isBeginner) });
    mind.stepsThisTurn += 1;
    try {
      this.dispatchDuelCommand(action);
    } catch (_e) {
      action = { type: 'END_TURN', seat: 1 };
      try {
        this.dispatchDuelCommand(action);
      } catch (_e2) {
        /* 듀얼이 이미 끝난 경우 */
      }
    }
    const done = action.type === 'END_TURN' || this.state.activeDuel?.status !== 'ONGOING';
    return { action, moodShift, done };
  }

  /** CPU 턴 전체를 한 번에 실행 (테스트·시뮬레이션용) */
  executeCpuTurn() {
    let guard = 0;
    while (guard++ < MAX_STEPS_PER_TURN + 2) {
      const { done } = this.executeCpuStep();
      if (done) break;
    }
    return this.getSnapshot();
  }

  evaluateDuelOutcome(duel) {
    const [seat0, seat1] = duel.seats;
    if (duel.status === 'ONGOING') checkWinner(duel);
    if (duel.outcomeApplied) return this.getSnapshot();
    if (duel.status === 'SEAT_0_WIN' || seat1.lp <= 0) {
      duel.outcomeApplied = true;
      duel.status = 'SEAT_0_WIN';
      if (this.state.phase === 'DUEL_ENCOUNTER') {
        const reward = this.state.nextEncounterInfo?.rewardGold || 500;
        this.state.gold = (this.state.gold || 0) + reward;
        this.state.lastEncounterReward = reward;
        this.state.roundNumber = (this.state.roundNumber || 1) + 1;
        this.state.phase = 'STAGE_CHECKPOINT';
        this.generateCheckpointState();
      } else {
        this.advanceRunAfterDuelVictory();
      }
    } else if (duel.status === 'SEAT_1_WIN' || seat0.lp <= 0) {
      duel.outcomeApplied = true;
      duel.status = 'SEAT_1_WIN';
      const isBossDuel = this.state.phase === 'STAGE_5_FINAL_BOSS';
      if (isBossDuel) {
        this.state.remainingChances = 0;
        duel.remainingChancesAfterDefeat = 0;
        duel.bossInstantDefeat = true;
        this.state.lastDefeatInfo = {
          duelistName: duel.seats?.[1]?.duelistName || '최종 보스',
          roundNumber: this.state.roundNumber || 1,
          wasBoss: true,
          remainingChances: 0,
          maxChances: this.state.maxChances || MAX_RUN_CHANCES,
        };
        this.state.phase = 'RUN_FAILED';
      } else if (this.state.runMode === 'CHECKPOINT') {
        const prevChances = this.state.remainingChances ?? (this.state.maxChances || MAX_RUN_CHANCES);
        const nextChances = Math.max(0, prevChances - 1);
        this.state.remainingChances = nextChances;
        duel.remainingChancesAfterDefeat = nextChances;
        if (nextChances > 0) {
          this.state.lastEncounterReward = 0;
          this.state.roundNumber = (this.state.roundNumber || 1) + 1;
          this.state.lastDefeatInfo = {
            duelistName: duel.seats?.[1]?.duelistName || '상대',
            roundNumber: this.state.roundNumber - 1,
            nextRoundNumber: this.state.roundNumber,
            wasBoss: false,
            remainingChances: nextChances,
            maxChances: this.state.maxChances || MAX_RUN_CHANCES,
          };
          this.state.phase = 'STAGE_CHECKPOINT';
          this.generateCheckpointState();
        } else {
          this.state.lastDefeatInfo = {
            duelistName: duel.seats?.[1]?.duelistName || '상대',
            roundNumber: this.state.roundNumber || 1,
            wasBoss: false,
            remainingChances: 0,
            maxChances: this.state.maxChances || MAX_RUN_CHANCES,
          };
          this.state.phase = 'RUN_FAILED';
        }
      } else {
        this.state.remainingChances = 0;
        this.state.phase = 'RUN_FAILED';
      }
    }
    return this.getSnapshot();
  }

  advanceRunAfterDuelVictory() {
    if (this.state.phase === 'STAGE_1_DUEL_1') {
      this.state.phase = 'STAGE_2_REWARD_PACK';
      const packCards = ['C_BLUE_02', 'C_RED_02', 'C_PURP_02'];
      this.state.currentRewardPackChoices = packCards;
      for (const cid of packCards) {
        this.recordBinderSeen(cid);
      }
      return;
    }

    if (this.state.phase === 'STAGE_3_DUEL_2') {
      this.state.phase = 'STAGE_4_MERCHANT_EVENT';
      const targetMasteryCard = this.state.playerDeckCardIds[0];
      const merchantCard = 'C_PURP_03';
      this.recordBinderSeen(merchantCard);
      this.state.currentMerchantOffer = {
        offerCardId: merchantCard,
        bonusMasteryCardId: targetMasteryCard,
        bonusMasteryAmount: 100,
      };
      return;
    }

    if (this.state.phase === 'STAGE_5_FINAL_BOSS') {
      this.state.phase = 'RUN_VICTORY';
      if (!this.state.isSeededRun) {
        this.state.hallOfFameSnapshot = {
          runId: this.state.runId,
          seed: this.state.seed,
          seedText: this.state.seedText || String(this.state.seed),
          destiny: this.state.selectedDestiny,
          defeatedBossId: this.state.assignedFinalBoss,
          deckCardIds: [...this.state.playerDeckCardIds],
          clearedAt: Date.now(),
        };
      } else {
        this.state.hallOfFameSnapshot = null;
      }
    }
  }

  /**
   * [보상 팩 선택] STAGE_2_REWARD_PACK -> STAGE_3_DUEL_2 전이
   */
  pickRewardPackCard(chosenCardId) {
    this.assertPhase('STAGE_2_REWARD_PACK');
    if (!this.state.currentRewardPackChoices.includes(chosenCardId)) {
      throw new Error(`선택한 카드 ${chosenCardId}는 현재 보상 카드 목록에 없습니다.`);
    }

    this.state.playerDeckCardIds.push(chosenCardId);
    this.recordBinderAcquired(chosenCardId);
    this.state.currentRewardPackChoices = [];

    // 2차전 CPU 듀얼로 즉시 선형 전이 (30장 정규 덱)
    const cpuDeck = createStartingDeck('BLUE_JUSTICE');
    this.state.phase = 'STAGE_3_DUEL_2';
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_2',
      'CPU_VETERAN_DUELIST',
      '숙련 듀얼리스트 베가',
      cpuDeck.deckCardIds,
      cpuDeck.deckMasterCardId,
      0.05,
      {},
      hashSeedParts(this.state.seed, 'linear_duel', 'DUEL_STAGE_2')
    );
    return this.getSnapshot();
  }

  /**
   * [상인/훈련 이벤트] STAGE_4_MERCHANT_EVENT -> STAGE_5_FINAL_BOSS 전이
   */
  resolveMerchantEvent(choice) {
    this.assertPhase('STAGE_4_MERCHANT_EVENT');
    const offer = this.state.currentMerchantOffer;
    if (!offer) {
      throw new Error('상인 제안 정보를 찾을 수 없습니다.');
    }

    if (choice === 'ACQUIRE_CARD') {
      this.state.playerDeckCardIds.push(offer.offerCardId);
      this.recordBinderAcquired(offer.offerCardId);
    } else {
      this.recordBinderPlayed(offer.bonusMasteryCardId, offer.bonusMasteryAmount);
    }
    this.state.currentMerchantOffer = null;

    // 운명 대응 최종 보스전 개시 (30장 정규 덱)
    this.state.phase = 'STAGE_5_FINAL_BOSS';
    this.state.activeDuel = this.createBossDuel();
    return this.getSnapshot();
  }

  getCardDef(cardId) {
    const def = this.catalogMap.get(cardId);
    if (!def) {
      throw new Error(`카드 정보를 찾을 수 없습니다: ${cardId}`);
    }
    return def;
  }

  assertPhase(expected) {
    if (this.state.phase !== expected) {
      throw new Error(`상태 전이 오류: 현재 단계(${this.state.phase})는 ${expected}가 아닙니다.`);
    }
  }
}

/**
 * @file binderCore.js
 * @description 아웃게임 3x3 바인더 북(콜렉션 앨범) 순수 도메인 엔진 (SPEC.md 1:1)
 * - 4단계 단방향 상태 전이: UNKNOWN(0) -> DISCOVERED(1) -> OWNED(2) -> MASTERED(3)
 * - 브라우저/Tauri 종속성 없이 IBinderStoragePort 어댑터만으로 즉시 구동됩니다.
 */

import { BinderCardState } from './types.js';

export class InMemoryBinderStorage {
  constructor() {
    this.store = {};
  }

  loadEntries() {
    const clone = {};
    for (const [k, v] of Object.entries(this.store)) {
      clone[k] = { ...v };
    }
    return clone;
  }

  saveEntries(entries) {
    const clone = {};
    for (const [k, v] of Object.entries(entries)) {
      clone[k] = { ...v };
    }
    this.store = clone;
  }
}

export class LocalStorageBinderAdapter {
  constructor(key = 'duel_rogue_binder_storage') {
    this.key = key;
  }

  loadEntries() {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('LocalStorage load failed, using empty storage', e);
    }
    return {};
  }

  saveEntries(entries) {
    try {
      localStorage.setItem(this.key, JSON.stringify(entries));
    } catch (e) {
      console.warn('LocalStorage save failed', e);
    }
  }
}

export class BinderCore {
  static SLOTS_PER_PAGE = 9; // 3x3 바인더 그리드 고정 상수

  constructor(config) {
    this.catalog = config.catalog;
    this.catalogMap = new Map(config.catalog.map((c) => [c.id, c]));
    this.storage = config.storage;
    this.masteryThreshold = config.masteryThreshold ?? 100;
    this.nowProvider = config.nowProvider ?? (() => Date.now());
    this.entries = this.storage.loadEntries();
    this.ensureAllCatalogEntriesInitialized();
  }

  ensureAllCatalogEntriesInitialized() {
    let mutated = false;
    for (const card of this.catalog) {
      if (!this.entries[card.id]) {
        this.entries[card.id] = {
          cardId: card.id,
          state: BinderCardState.UNKNOWN,
          masteryPoints: 0,
          timesSeen: 0,
          timesAcquired: 0,
          timesPlayed: 0,
          lastUpdatedAt: this.nowProvider(),
        };
        mutated = true;
      }
    }
    if (mutated) {
      this.persist();
    }
  }

  persist() {
    this.storage.saveEntries(this.entries);
  }

  /**
   * 단조 증가 상태 전이 보장: S_{t+1} = max(S_t, S_incoming)
   */
  promoteState(entry, targetState) {
    if (targetState > entry.state) {
      entry.state = targetState;
    }
    if (entry.state >= BinderCardState.OWNED && entry.masteryPoints >= this.masteryThreshold) {
      entry.state = BinderCardState.MASTERED;
    }
    entry.lastUpdatedAt = this.nowProvider();
  }

  /**
   * 1) 카드 조우/목격 (상대 듀얼리스트가 플레이하거나 카드 팩 개봉 시 제시된 카드)
   * UNKNOWN(0) -> DISCOVERED(1) 전이 (이미 OWNED/MASTERED면 상태 유지)
   */
  recordCardSeen(cardId) {
    const entry = this.getMutableEntry(cardId);
    entry.timesSeen += 1;
    this.promoteState(entry, BinderCardState.DISCOVERED);
    this.persist();
    return { ...entry };
  }

  /**
   * 2) 카드 소유/획득 (시작 덱 지급, 팩 개봉 선택, 상인 영입)
   * UNKNOWN(0) | DISCOVERED(1) -> OWNED(2) 전이 (숙련도 충족 시 즉시 MASTERED(3))
   */
  recordCardAcquired(cardId) {
    const entry = this.getMutableEntry(cardId);
    entry.timesSeen += 1;
    entry.timesAcquired += 1;
    this.promoteState(entry, BinderCardState.OWNED);
    this.persist();
    return { ...entry };
  }

  /**
   * 3) 듀얼 중 카드 직접 플레이 또는 이벤트 숙련도 연마
   * 숙련도 포인트를 가산하며, 임계치(masteryThreshold) 도달 시 MASTERED(3)로 자동 승격
   */
  recordCardPlayed(cardId, masteryDelta = 25) {
    if (masteryDelta < 0) {
      throw new Error(`Mastery delta must be non-negative. Received: ${masteryDelta}`);
    }
    const entry = this.getMutableEntry(cardId);
    entry.timesSeen += 1;
    entry.timesPlayed += 1;
    entry.masteryPoints += masteryDelta;
    this.promoteState(entry, BinderCardState.OWNED);
    this.persist();
    return { ...entry };
  }

  getEntry(cardId) {
    return { ...this.getMutableEntry(cardId) };
  }

  getTotalPages() {
    return Math.max(1, Math.ceil(this.catalog.length / BinderCore.SLOTS_PER_PAGE));
  }

  /**
   * 3x3 바인더 페이지 뷰 슬라이싱 (시간 복잡도 O(1))
   */
  getPageView(pageIndex) {
    const totalPages = this.getTotalPages();
    if (pageIndex < 0 || pageIndex >= totalPages) {
      throw new RangeError(`Invalid binder pageIndex ${pageIndex} (totalPages: ${totalPages})`);
    }

    const startOffset = pageIndex * BinderCore.SLOTS_PER_PAGE;
    const slice = this.catalog.slice(startOffset, startOffset + BinderCore.SLOTS_PER_PAGE);

    const slots = slice.map((card, idx) => {
      const entry = this.entries[card.id];
      const state = entry.state;

      const visualModeMap = {
        [BinderCardState.UNKNOWN]: 'MASKED_QUESTION',
        [BinderCardState.DISCOVERED]: 'GRAYSCALE_SILHOUETTE',
        [BinderCardState.OWNED]: 'FULL_COLOR',
        [BinderCardState.MASTERED]: 'HOLOGRAM_AURA',
      };

      return {
        slotIndex: idx,
        globalIndex: startOffset + idx,
        cardId: card.id,
        cardName: state === BinderCardState.UNKNOWN ? '???' : card.name,
        archetype: card.archetype,
        cost: card.cost,
        attack: card.attack,
        health: card.health,
        effectType: card.effectType,
        effectValue: card.effectValue,
        state,
        visualMode: visualModeMap[state],
        canInspectDetail: state >= BinderCardState.DISCOVERED,
        masteryPoints: entry.masteryPoints,
        isMasteryBadgeVisible: state === BinderCardState.MASTERED,
      };
    });

    return {
      pageIndex,
      totalPages,
      slots,
    };
  }

  getMutableEntry(cardId) {
    if (!this.catalogMap.has(cardId)) {
      throw new Error(`Unknown cardId '${cardId}' not registered in catalog.`);
    }
    return this.entries[cardId];
  }
}

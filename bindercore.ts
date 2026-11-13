/**
 * @file binderCore.ts
 * @description 아웃게임 3x3 바인더 북(콜렉션 앨범) 순수 도메인 엔진
 * - 4단계 단방향 상태 전이: UNKNOWN(0) -> DISCOVERED(1) -> OWNED(2) -> MASTERED(3)
 * - 브라우저/Tauri 종속성 없이 IBinderStoragePort 어댑터만으로 즉시 구동됩니다.
 */

import {
  BinderCardEntry,
  BinderCardState,
  BinderPageView,
  BinderSlotView,
  CardDefinition,
  IBinderStoragePort,
} from './types.ts';

export class InMemoryBinderStorage implements IBinderStoragePort {
  private store: Record<string, BinderCardEntry> = {};

  public loadEntries(): Record<string, BinderCardEntry> {
    const clone: Record<string, BinderCardEntry> = {};
    for (const [k, v] of Object.entries(this.store)) {
      clone[k] = { ...v };
    }
    return clone;
  }

  public saveEntries(entries: Record<string, BinderCardEntry>): void {
    const clone: Record<string, BinderCardEntry> = {};
    for (const [k, v] of Object.entries(entries)) {
      clone[k] = { ...v };
    }
    this.store = clone;
  }
}

export interface BinderCoreConfig {
  readonly catalog: readonly CardDefinition[];
  readonly storage: IBinderStoragePort;
  readonly masteryThreshold?: number; // 기본 100 포인트
  readonly nowProvider?: () => number;
}

export class BinderCore {
  public static readonly SLOTS_PER_PAGE = 9; // 3x3 바인더 그리드 고정 상수

  private readonly catalog: readonly CardDefinition[];
  private readonly catalogMap: Map<string, CardDefinition>;
  private readonly storage: IBinderStoragePort;
  private readonly masteryThreshold: number;
  private readonly nowProvider: () => number;
  private entries: Record<string, BinderCardEntry>;

  constructor(config: BinderCoreConfig) {
    this.catalog = config.catalog;
    this.catalogMap = new Map(config.catalog.map((c) => [c.id, c]));
    this.storage = config.storage;
    this.masteryThreshold = config.masteryThreshold ?? 100;
    this.nowProvider = config.nowProvider ?? (() => Date.now());
    this.entries = this.storage.loadEntries();
    this.ensureAllCatalogEntriesInitialized();
  }

  private ensureAllCatalogEntriesInitialized(): void {
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

  private persist(): void {
    this.storage.saveEntries(this.entries);
  }

  /**
   * 단조 증가 상태 전이 보장: S_{t+1} = max(S_t, S_incoming)
   */
  private promoteState(entry: BinderCardEntry, targetState: BinderCardState): void {
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
  public recordCardSeen(cardId: string): BinderCardEntry {
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
  public recordCardAcquired(cardId: string): BinderCardEntry {
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
  public recordCardPlayed(cardId: string, masteryDelta: number = 25): BinderCardEntry {
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

  public getEntry(cardId: string): BinderCardEntry {
    return { ...this.getMutableEntry(cardId) };
  }

  public getTotalPages(): number {
    return Math.max(1, Math.ceil(this.catalog.length / BinderCore.SLOTS_PER_PAGE));
  }

  /**
   * 3x3 바인더 페이지 뷰 슬라이싱 (시간 복잡도 O(1))
   */
  public getPageView(pageIndex: number): BinderPageView {
    const totalPages = this.getTotalPages();
    if (pageIndex < 0 || pageIndex >= totalPages) {
      throw new RangeError(`Invalid binder pageIndex ${pageIndex} (totalPages: ${totalPages})`);
    }

    const startOffset = pageIndex * BinderCore.SLOTS_PER_PAGE;
    const slice = this.catalog.slice(startOffset, startOffset + BinderCore.SLOTS_PER_PAGE);

    const slots: BinderSlotView[] = slice.map((card, idx) => {
      const entry = this.entries[card.id];
      const state = entry.state;

      const visualModeMap: Record<BinderCardState, BinderSlotView['visualMode']> = {
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

  private getMutableEntry(cardId: string): BinderCardEntry {
    if (!this.catalogMap.has(cardId)) {
      throw new Error(`Unknown cardId '${cardId}' not registered in catalog.`);
    }
    return this.entries[cardId];
  }
}
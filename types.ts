/**
 * @file types.ts
 * @description 「듀얼 로그 (Duel Rogue)」 코어 도메인 타입, 인터페이스 및 포트(Port) 명세
 * DOM/Tauri 의존성이 전혀 없는 순수 TypeScript 계약(Contract) 정의입니다.
 * (Erasable TypeScript Syntax 준수로 별도 번들러 없이 최신 런타임 및 Vite/esbuild 즉시 호환)
 */

// ============================================================================
// 1. 점쟁이 운명 (Destiny) 및 보스 아키타입 정의
// ============================================================================

export type DestinyColor = 'BLUE_JUSTICE' | 'RED_ZEAL' | 'PURPLE_CHAOS';

export type ArchetypeTag = 'CONTROL' | 'AGGRO' | 'CHAOS_RNG' | 'NEUTRAL';

export type BossId =
  | 'BOSS_RED_UNSTOPPABLE_AGGRO'   // 파란색(정의) 선택 시 매칭되는 어그로/미드레인지 보스
  | 'BOSS_BLUE_FORTRESS_CONTROL'   // 빨간색(열의) 선택 시 매칭되는 광역/고점 컨트롤 보스
  | 'BOSS_PURPLE_RIGGED_FATE';     // 보라색(혼돈) 선택 시 매칭되는 극단적 행운/도박 보스

export interface DestinyProfile {
  readonly id: DestinyColor;
  readonly nameKo: string;
  readonly favoredArchetype: ArchetypeTag;
  readonly nemesisBossId: BossId;
  readonly description: string;
}

// ============================================================================
// 2. 아웃게임 3x3 바인더 북 (콜렉션 앨범) 4단계 상태 정의
// ============================================================================

export const BinderCardState = {
  UNKNOWN: 0,     // 미발견: 바인더에 '?' 표시
  DISCOVERED: 1,  // 발견: 흑백 실루엣/음영, 상세 정보 열람 가능 (스쳐 지나감/상대가 사용)
  OWNED: 2,       // 소유: 정식 컬러 활성화 (덱에 편입하거나 보상/상인으로 획득)
  MASTERED: 3,    // 숙련: 숙련도 임계치 도달, 홀로그램/오라 이펙트 및 포인트 노출
} as const;

export type BinderCardState = (typeof BinderCardState)[keyof typeof BinderCardState];

export interface BinderCardEntry {
  readonly cardId: string;
  state: BinderCardState;
  masteryPoints: number;
  timesSeen: number;
  timesAcquired: number;
  timesPlayed: number;
  lastUpdatedAt: number;
}

export interface BinderSlotView {
  readonly slotIndex: number; // 0 ~ 8 (3x3 그리드 내 좌표)
  readonly globalIndex: number;
  readonly cardId: string;
  readonly cardName: string; // UNKNOWN일 경우 '???'로 마스킹
  readonly state: BinderCardState;
  readonly visualMode: 'MASKED_QUESTION' | 'GRAYSCALE_SILHOUETTE' | 'FULL_COLOR' | 'HOLOGRAM_AURA';
  readonly canInspectDetail: boolean;
  readonly masteryPoints: number;
  readonly isMasteryBadgeVisible: boolean;
}

export interface BinderPageView {
  readonly pageIndex: number;
  readonly totalPages: number;
  readonly slots: readonly BinderSlotView[]; // 최대 9개 (3x3)
}

export interface IBinderStoragePort {
  loadEntries(): Record<string, BinderCardEntry>;
  saveEntries(entries: Record<string, BinderCardEntry>): void;
}

// ============================================================================
// 3. 카드 카탈로그 및 대칭형 듀얼 (Symmetric PvP) 모델
// ============================================================================

export type CardEffectType =
  | 'SUMMON_UNIT'
  | 'DIRECT_DAMAGE'
  | 'BOARD_WIPE'
  | 'HEAL_AND_GUARD'
  | 'CHAOS_GAMBLE';

export type TargetPolarity = 'BENEFICIAL' | 'MIXED' | 'HARMFUL';

export interface CardDefinition {
  readonly id: string;
  readonly name: string;
  readonly archetype: ArchetypeTag;
  readonly cost: number;
  readonly attack: number;
  readonly health: number;
  readonly effectType: CardEffectType;
  readonly effectValue: number;
  readonly tags: readonly string[];
  readonly targetPolarity?: TargetPolarity;
}

export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
  readonly ownerSeat: 0 | 1;
  currentAttack: number;
  currentHealth: number;
  maxHealth?: number;
  canAttack: boolean;
  tags?: string[];
}

export type SeatIndex = 0 | 1; // 0: 로컬 플레이어, 1: 가상 듀얼리스트(CPU) 또는 온라인 상대

export interface DuelistSeatState {
  readonly seatIndex: SeatIndex;
  readonly duelistId: string;
  readonly duelistName: string;
  readonly isCpu: boolean;
  readonly rngLuckBias: number; // 기본 0.0, 보라색 최종보스(Rigged Fate)는 +0.40 편향
  lp: number;
  mana: number;
  maxMana: number;
  deck: CardInstance[];
  hand: CardInstance[];
  board: CardInstance[];
  graveyard: CardInstance[];
}

export type DuelStatus = 'ONGOING' | 'SEAT_0_WIN' | 'SEAT_1_WIN';

export interface SymmetricDuelState {
  readonly duelId: string;
  readonly seed: number;
  turnNumber: number;
  activeSeat: SeatIndex;
  status: DuelStatus;
  seats: [DuelistSeatState, DuelistSeatState];
}

export type DuelCommand =
  | {
      readonly type: 'PLAY_CARD';
      readonly seat: SeatIndex;
      readonly cardInstanceId: string;
      readonly targetSeat?: SeatIndex;
      readonly targetInstanceId?: string;
    }
  | {
      readonly type: 'ATTACK';
      readonly seat: SeatIndex;
      readonly attackerInstanceId: string;
      readonly targetInstanceId?: string; // 생략 시 상대 본체(LP) 직접 타격
    }
  | {
      readonly type: 'END_TURN';
      readonly seat: SeatIndex;
    };

// ============================================================================
// 4. 선형 인카운터 런 상태 머신 (Linear Run FSM) 모델
// ============================================================================

export type RunStagePhase =
  | 'IDLE'
  | 'STAGE_0_FORTUNE'        // 점쟁이 운명 선택
  | 'STAGE_1_DUEL_1'         // 1차전 CPU 듀얼
  | 'STAGE_3_DUEL_2'         // 2차전 CPU 듀얼
  | 'STAGE_2_REWARD_PACK'    // 승리 보상: 카드 팩 개봉 (3장 제시 -> 1장 선택)
  | 'STAGE_4_MERCHANT_EVENT' // 상인/이벤트 인카운터
  | 'STAGE_5_FINAL_BOSS'     // 운명 대응 최종 보스전
  | 'RUN_VICTORY'            // 런 완주 성공 (명예의 전당 등록 가능)
  | 'RUN_FAILED';            // 런 패배 종료

export interface MerchantOffer {
  readonly offerCardId: string;
  readonly bonusMasteryCardId: string;
  readonly bonusMasteryAmount: number;
}

export interface HallOfFameDeckSnapshot {
  readonly runId: string;
  readonly destiny: DestinyColor;
  readonly defeatedBossId: BossId;
  readonly deckCardIds: readonly string[];
  readonly clearedAt: number;
}

export interface RunStateSnapshot {
  readonly runId: string;
  readonly seed: number;
  phase: RunStagePhase;
  selectedDestiny: DestinyColor | null;
  assignedFinalBoss: BossId | null;
  playerDeckCardIds: string[];
  currentRewardPackChoices: string[];
  currentMerchantOffer: MerchantOffer | null;
  activeDuel: SymmetricDuelState | null;
  hallOfFameSnapshot: HallOfFameDeckSnapshot | null;
}
/**
 * @file duelRogueEngine.ts
 * @description 「듀얼 로그 (Duel Rogue)」 선형 런 상태 머신(FSM) 및 대칭형 1v1 PvP 듀얼 엔진
 * - 점쟁이의 3가지 운명 선택 및 카운터 성향 최종 보스 매칭
 * - 5단계 선형 인카운터 자동 진행 (운명 선택 -> 1차전 -> 카드 팩 개봉 -> 2차전 -> 상인/이벤트 -> 최종 보스)
 * - 플레이어와 가상 듀얼리스트(CPU/원격 유저)가 동일한 규칙과 상태를 공유하는 대칭형 PvP 엔진
 * - 모든 액션에서 실시간으로 BinderCore 상태를 자동 갱신합니다.
 */

import { BinderCore } from './binderCore.ts';
import {
  BossId,
  CardDefinition,
  CardInstance,
  DestinyColor,
  DestinyProfile,
  DuelCommand,
  DuelistSeatState,
  RunStagePhase,
  RunStateSnapshot,
  SeatIndex,
  SymmetricDuelState,
} from './types.ts';

/**
 * 결정론적 시드 기반 난수 생성기 (Mulberry32)
 * 리플레이 검증 및 온라인 1v1 동기화를 위해 Math.random() 대신 사용합니다.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public nextFloat(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public nextInt(minInclusive: number, maxInclusive: number): number {
    return Math.floor(this.nextFloat() * (maxInclusive - minInclusive + 1)) + minInclusive;
  }
}

export const DESTINY_PROFILES: Readonly<Record<DestinyColor, DestinyProfile>> = {
  BLUE_JUSTICE: {
    id: 'BLUE_JUSTICE',
    nameKo: '파란색 (정의)',
    favoredArchetype: 'CONTROL',
    nemesisBossId: 'BOSS_RED_UNSTOPPABLE_AGGRO',
    description: '컨트롤 덱 구축에 유리하며, 최종 보스로 맹렬한 어그로·미드레인지 듀얼리스트가 등장합니다.',
  },
  RED_ZEAL: {
    id: 'RED_ZEAL',
    nameKo: '빨간색 (열의)',
    favoredArchetype: 'AGGRO',
    nemesisBossId: 'BOSS_BLUE_FORTRESS_CONTROL',
    description: '어그로 덱 구축에 유리하며, 최종 보스로 광역 제거기와 회복을 갖춘 고점 컨트롤 듀얼리스트가 등장합니다.',
  },
  PURPLE_CHAOS: {
    id: 'PURPLE_CHAOS',
    nameKo: '보라색 (혼돈)',
    favoredArchetype: 'CHAOS_RNG',
    nemesisBossId: 'BOSS_PURPLE_RIGGED_FATE',
    description: '도박/RNG 변칙 카드가 대거 등장하며, 최종 보스는 극단적으로 사기적인 행운 편향을 지닙니다.',
  },
};

export const DEFAULT_CARD_CATALOG: readonly CardDefinition[] = [
  // 파란색 (정의 / CONTROL)
  { 
    id: 'C_BLUE_01', 
    name: '성소의 방패병', 
    archetype: 'CONTROL', 
    cost: 1, 
    attack: 4, 
    health: 14, 
    effectType: 'SUMMON_UNIT', 
    effectValue: 0,
    tags: ['수호', '신성', '보호막'],
    targetPolarity: 'BENEFICIAL'
  },
  { 
    id: 'C_BLUE_02', 
    name: '심판의 섬광', 
    archetype: 'CONTROL', 
    cost: 2, 
    attack: 0, 
    health: 0, 
    effectType: 'BOARD_WIPE', 
    effectValue: 12,
    tags: ['마법', '빛', '광역정화'],
    targetPolarity: 'HARMFUL'
  },
  { 
    id: 'C_BLUE_03', 
    name: '아이기스 수호신', 
    archetype: 'CONTROL', 
    cost: 3, 
    attack: 10, 
    health: 26, 
    effectType: 'HEAL_AND_GUARD', 
    effectValue: 20,
    tags: ['신성', '거신', '치유'],
    targetPolarity: 'BENEFICIAL'
  },
  // 빨간색 (열의 / AGGRO)
  { 
    id: 'C_RED_01', 
    name: '선봉 돌격병', 
    archetype: 'AGGRO', 
    cost: 1, 
    attack: 8, 
    health: 8, 
    effectType: 'SUMMON_UNIT', 
    effectValue: 0,
    tags: ['돌격', '전사', '경량'],
    targetPolarity: 'HARMFUL'
  },
  { 
    id: 'C_RED_02', 
    name: '홍련의 화염탄', 
    archetype: 'AGGRO', 
    cost: 1, 
    attack: 0, 
    health: 0, 
    effectType: 'DIRECT_DAMAGE', 
    effectValue: 16,
    tags: ['마법', '화염', '직접타격'],
    targetPolarity: 'HARMFUL'
  },
  { 
    id: 'C_RED_03', 
    name: '광전사 집행관', 
    archetype: 'AGGRO', 
    cost: 2, 
    attack: 16, 
    health: 10, 
    effectType: 'SUMMON_UNIT', 
    effectValue: 0,
    tags: ['광전사', '관통', '중공격'],
    targetPolarity: 'HARMFUL'
  },
  // 보라색 (혼돈 / CHAOS_RNG)
  { 
    id: 'C_PURP_01', 
    name: '운명의 주사위 악마', 
    archetype: 'CHAOS_RNG', 
    cost: 1, 
    attack: 7, 
    health: 9, 
    effectType: 'CHAOS_GAMBLE', 
    effectValue: 15,
    tags: ['악마', '도박', '변칙'],
    targetPolarity: 'MIXED'
  },
  { 
    id: 'C_PURP_02', 
    name: '차원 균열의 룰렛', 
    archetype: 'CHAOS_RNG', 
    cost: 2, 
    attack: 0, 
    health: 0, 
    effectType: 'CHAOS_GAMBLE', 
    effectValue: 22,
    tags: ['마법', '혼돈', '도박'],
    targetPolarity: 'MIXED'
  },
  { 
    id: 'C_PURP_03', 
    name: '혼돈의 거수 아자젤', 
    archetype: 'CHAOS_RNG', 
    cost: 3, 
    attack: 18, 
    health: 18, 
    effectType: 'CHAOS_GAMBLE', 
    effectValue: 28,
    tags: ['괴수', '혼돈', '관통'],
    targetPolarity: 'MIXED'
  },
  {
    id: 'C_TITAN_01',
    name: '천벌의 파괴거신',
    archetype: 'AGGRO',
    cost: 4,
    attack: 28,
    health: 32,
    effectType: 'SUMMON_UNIT',
    effectValue: 0,
    tags: ['거신', '관통', '대지진', '고중량'],
    targetPolarity: 'HARMFUL'
  }
];

export class DuelRogueEngine {
  private readonly catalogMap: Map<string, CardDefinition>;
  private readonly binder: BinderCore;
  private rng: SeededRng;
  private state: RunStateSnapshot;
  private instanceSeq = 1;

  constructor(binder: BinderCore, catalog: readonly CardDefinition[] = DEFAULT_CARD_CATALOG, initialSeed = 20261015) {
    this.binder = binder;
    this.catalogMap = new Map(catalog.map((c) => [c.id, c]));
    this.rng = new SeededRng(initialSeed);
    this.state = this.createEmptyRunState('RUN_INIT', initialSeed);
  }

  private createEmptyRunState(runId: string, seed: number): RunStateSnapshot {
    return {
      runId,
      seed,
      phase: 'IDLE',
      selectedDestiny: null,
      assignedFinalBoss: null,
      playerDeckCardIds: [],
      currentRewardPackChoices: [],
      currentMerchantOffer: null,
      activeDuel: null,
      hallOfFameSnapshot: null,
    };
  }

  public getSnapshot(): RunStateSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as RunStateSnapshot;
  }

  /**
   * [런 시작] IDLE -> STAGE_0_FORTUNE (점쟁이의 3가지 운명 선택 진입)
   */
  public startNewRun(runId: string, seed: number): RunStateSnapshot {
    this.rng = new SeededRng(seed);
    this.state = this.createEmptyRunState(runId, seed);
    this.state.phase = 'STAGE_0_FORTUNE';
    return this.getSnapshot();
  }

  /**
   * [단계 0 -> 단계 1] 점쟁이 운명 선택
   * - 선택한 성향에 맞는 초기 덱 구성 및 바인더 OWNED 등록
   * - 반대/특화 성향의 최종 보스 확정 후 즉시 1차전 CPU 듀얼(STAGE_1_DUEL_1)로 진입
   */
  public selectFortuneDestiny(destiny: DestinyColor): RunStateSnapshot {
    this.assertPhase('STAGE_0_FORTUNE');
    const profile = DESTINY_PROFILES[destiny];
    this.state.selectedDestiny = destiny;
    this.state.assignedFinalBoss = profile.nemesisBossId;

    // 성향에 맞는 기본 카드 6장으로 시작 덱 구성
    const favoredCards = Array.from(this.catalogMap.values()).filter(
      (c) => c.archetype === profile.favoredArchetype
    );
    const starterDeck: string[] = [];
    for (let i = 0; i < 6; i++) {
      const card = favoredCards[i % favoredCards.length];
      starterDeck.push(card.id);
      this.binder.recordCardAcquired(card.id);
    }
    this.state.playerDeckCardIds = starterDeck;

    // 1차전 CPU 듀얼 자동 개시
    this.state.phase = 'STAGE_1_DUEL_1';
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_1',
      'CPU_ROOKIE_DUELIST',
      '견습 듀얼리스트 카이',
      ['C_RED_01', 'C_BLUE_01', 'C_RED_01', 'C_BLUE_01', 'C_PURP_01', 'C_RED_01'],
      0.0
    );
    return this.getSnapshot();
  }

  /**
   * 대칭형 1v1 듀얼 커맨드 실행 (플레이어 Seat 0 및 CPU/원격 Seat 1 공통 파이프라인)
   */
  public dispatchDuelCommand(cmd: DuelCommand): RunStateSnapshot {
    const duel = this.state.activeDuel;
    if (!duel || duel.status !== 'ONGOING') {
      throw new Error('No active ongoing duel to dispatch command.');
    }
    if (cmd.seat !== duel.activeSeat) {
      throw new Error(`Turn mismatch: expected seat ${duel.activeSeat}, got ${cmd.seat}`);
    }

    const actor = duel.seats[cmd.seat];
    const opponentSeat: SeatIndex = cmd.seat === 0 ? 1 : 0;
    const opponent = duel.seats[opponentSeat];

    if (cmd.type === 'PLAY_CARD') {
      const handIdx = actor.hand.findIndex((c) => c.instanceId === cmd.cardInstanceId);
      if (handIdx === -1) {
        throw new Error(`Card instance ${cmd.cardInstanceId} not found in seat ${cmd.seat} hand.`);
      }
      const cardInst = actor.hand[handIdx];
      const def = this. getCardDef(cardInst.cardId);

      if (actor.mana < def.cost) {
        throw new Error(`Insufficient mana: required ${def.cost}, available ${actor.mana}`);
      }

      actor.mana -= def.cost;
      actor.hand.splice(handIdx, 1);

      // 바인더 실시간 연동: 로컬 플레이어(Seat 0)가 직접 플레이하면 숙련도 획득, 상대(Seat 1)가 플레이하면 DISCOVERED 기록
      if (cmd.seat === 0) {
        this.binder.recordCardPlayed(def.id, 35);
      } else {
        this.binder.recordCardSeen(def.id);
      }

      this.resolveCardEffect(def, cardInst, actor, opponent);
    } else if (cmd.type === 'ATTACK') {
      const attacker = actor.board.find((u) => u.instanceId === cmd.attackerInstanceId);
      if (!attacker || !attacker.canAttack) {
        throw new Error(`Unit ${cmd.attackerInstanceId} cannot attack.`);
      }
      attacker.canAttack = false;

      const attackerDef = this.getCardDef(attacker.cardId);
      const attackResult = {
        attackerInstanceId: attacker.instanceId,
        attackerCardId: attacker.cardId,
        attackerCost: attackerDef?.cost || 1,
        attackerAttack: attacker.currentAttack,
        targetInstanceId: cmd.targetInstanceId || null,
        targetType: cmd.targetInstanceId ? 'UNIT' : 'HERO',
        defenderDied: false,
        attackerDied: false,
        pierceDamage: 0,
        damageDealt: attacker.currentAttack,
      };

      if (cmd.targetInstanceId) {
        const targetIdx = opponent.board.findIndex((u) => u.instanceId === cmd.targetInstanceId);
        if (targetIdx === -1) {
          throw new Error(`Target unit ${cmd.targetInstanceId} not found on opponent board.`);
        }
        const defender = opponent.board[targetIdx];
        const overkill = attacker.currentAttack - defender.currentHealth;

        defender.currentHealth -= attacker.currentAttack;
        attacker.currentHealth -= defender.currentAttack;

        if (defender.currentHealth <= 0) {
          attackResult.defenderDied = true;
          opponent.board.splice(targetIdx, 1);
          opponent.graveyard.push(defender);

          const hasPierce = (attackerDef?.tags || []).some((t) => t.includes('관통') || t.includes('PIERCE')) || overkill > 0;
          if (hasPierce && overkill > 0) {
            attackResult.pierceDamage = overkill;
            opponent.lp = Math.max(0, opponent.lp - overkill);
          }
        }
        if (attacker.currentHealth <= 0) {
          attackResult.attackerDied = true;
          const attIdx = actor.board.findIndex((u) => u.instanceId === attacker.instanceId);
          if (attIdx !== -1) actor.board.splice(attIdx, 1);
          actor.graveyard.push(attacker);
        }
      } else {
        opponent.lp = Math.max(0, opponent.lp - attacker.currentAttack);
      }
    } else if (cmd.type === 'END_TURN') {
      duel.activeSeat = opponentSeat;
      duel.turnNumber += 1;
      opponent.maxMana = Math.min(10, opponent.maxMana + 1);
      opponent.mana = opponent.maxMana;
      for (const unit of opponent.board) {
        unit.canAttack = true;
      }
      this.drawCard(opponent);
    }

    this.evaluateDuelOutcome(duel);
    return this.getSnapshot();
  }

  /**
   * CPU 턴 자동 실행 헬퍼 (대칭형 커맨드만 사용하여 CPU 턴을 진행)
   */
  public executeCpuTurn(): RunStateSnapshot {
    const duel = this.state.activeDuel;
    if (!duel || duel.status !== 'ONGOING' || duel.activeSeat !== 1) {
      return this.getSnapshot();
    }

    const cpu = duel.seats[1];
    // 플레이 가능한 카드를 앞에서부터 순서대로 사용
    let played = true;
    while (played && duel.status === 'ONGOING') {
      played = false;
      for (const cardInst of [...cpu.hand]) {
        const def = this.getCardDef(cardInst.cardId);
        if (cpu.mana >= def.cost && (def.effectType !== 'SUMMON_UNIT' || cpu.board.length < 5)) {
          this.dispatchDuelCommand({
            type: 'PLAY_CARD',
            seat: 1,
            cardInstanceId: cardInst.instanceId,
          });
          played = true;
          break;
        }
      }
    }

    // 공격 가능한 모든 유닛으로 본체 타격
    if (duel.status === 'ONGOING') {
      const playerSeat = duel.seats[0];
      for (const unit of [...cpu.board]) {
        if (unit.canAttack && duel.status === 'ONGOING') {
          const targetUnit = playerSeat.board.length > 0 ? playerSeat.board[0] : null;
          this.dispatchDuelCommand({
            type: 'ATTACK',
            seat: 1,
            attackerInstanceId: unit.instanceId,
            targetInstanceId: targetUnit ? targetUnit.instanceId : undefined,
          });
        }
      }
    }

    if (duel.status === 'ONGOING') {
      this.dispatchDuelCommand({ type: 'END_TURN', seat: 1 });
    }
    return this.getSnapshot();
  }

  /**
   * [단계 2] 승리 보상 카드 팩 개봉 선택 (STAGE_2_REWARD_PACK -> STAGE_3_DUEL_2)
   * - 팩 개봉 시 제시된 3장은 이미 DISCOVERED로 등록된 상태이며, 선택한 1장은 OWNED 및 덱에 추가됩니다.
   */
  public pickRewardPackCard(chosenCardId: string): RunStateSnapshot {
    this.assertPhase('STAGE_2_REWARD_PACK');
    if (!this.state.currentRewardPackChoices.includes(chosenCardId)) {
      throw new Error(`Chosen card ${chosenCardId} is not in current reward pack choices.`);
    }

    this.state.playerDeckCardIds.push(chosenCardId);
    this.binder.recordCardAcquired(chosenCardId);
    this.state.currentRewardPackChoices = [];

    // 2차전 CPU 듀얼로 즉시 선형 전이
    this.state.phase = 'STAGE_3_DUEL_2';
    this.state.activeDuel = this.createSymmetricDuel(
      'DUEL_STAGE_2',
      'CPU_VETERAN_DUELIST',
      '숙련 듀얼리스트 베가',
      ['C_BLUE_01', 'C_RED_02', 'C_PURP_01', 'C_BLUE_03', 'C_RED_03', 'C_PURP_02'],
      0.05
    );
    return this.getSnapshot();
  }

  /**
   * [단계 4] 상인/이벤트 선택 처리 (STAGE_4_MERCHANT_EVENT -> STAGE_5_FINAL_BOSS)
   * - ACQUIRE_CARD: 상인이 제안한 카드를 덱에 영입 (OWNED)
   * - TRAIN_MASTERY: 주력 카드의 숙련도를 집중 연마하여 즉시 MASTERED 승격 지원
   */
  public resolveMerchantEvent(choice: 'ACQUIRE_CARD' | 'TRAIN_MASTERY'): RunStateSnapshot {
    this.assertPhase('STAGE_4_MERCHANT_EVENT');
    const offer = this.state.currentMerchantOffer;
    if (!offer) {
      throw new Error('No merchant offer available.');
    }

    if (choice === 'ACQUIRE_CARD') {
      this.state.playerDeckCardIds.push(offer.offerCardId);
      this.binder.recordCardAcquired(offer.offerCardId);
    } else {
      this.binder.recordCardPlayed(offer.bonusMasteryCardId, offer.bonusMasteryAmount);
    }
    this.state.currentMerchantOffer = null;

    // 운명 대응 최종 보스전 개시
    const bossId = this.state.assignedFinalBoss!;
    this.state.phase = 'STAGE_5_FINAL_BOSS';
    this.state.activeDuel = this.createBossDuel(bossId);
    return this.getSnapshot();
  }

  private createBossDuel(bossId: BossId): SymmetricDuelState {
    if (bossId === 'BOSS_RED_UNSTOPPABLE_AGGRO') {
      return this.createSymmetricDuel(
        'DUEL_STAGE_5_BOSS',
        bossId,
        '종언의 어그로 군주 볼카 (파란색 운명 카운터)',
        ['C_RED_01', 'C_RED_02', 'C_RED_03', 'C_RED_01', 'C_RED_02', 'C_RED_03'],
        0.1
      );
    }
    if (bossId === 'BOSS_BLUE_FORTRESS_CONTROL') {
      return this.createSymmetricDuel(
        'DUEL_STAGE_5_BOSS',
        bossId,
        '절대방벽의 집행관 실피드 (빨간색 운명 카운터)',
        ['C_BLUE_01', 'C_BLUE_02', 'C_BLUE_03', 'C_BLUE_02', 'C_BLUE_03', 'C_BLUE_01'],
        0.1
      );
    }
    return this.createSymmetricDuel(
      'DUEL_STAGE_5_BOSS',
      bossId,
      '사기적 행운의 지배자 조커 (보라색 운명 카운터)',
      ['C_PURP_01', 'C_PURP_02', 'C_PURP_03', 'C_PURP_02', 'C_PURP_03', 'C_PURP_01'],
      0.4 // 극단적인 행운 편향치
    );
  }

  private createSymmetricDuel(
    duelId: string,
    cpuId: string,
    cpuName: string,
    cpuCardIds: string[],
    cpuLuckBias: number
  ): SymmetricDuelState {
    const seat0Deck = this.state.playerDeckCardIds.map((cardId) =>
      this.instantiateCard(cardId, 0)
    );
    const seat1Deck = cpuCardIds.map((cardId) => this.instantiateCard(cardId, 1));

    const seat0: DuelistSeatState = {
      seatIndex: 0,
      duelistId: 'PLAYER_LOCAL',
      duelistName: '플레이어',
      isCpu: false,
      rngLuckBias: 0.0,
      lp: 100,
      mana: 3,
      maxMana: 3,
      deck: seat0Deck,
      hand: [],
      board: [],
      graveyard: [],
    };

    const seat1: DuelistSeatState = {
      seatIndex: 1,
      duelistId: cpuId,
      duelistName: cpuName,
      isCpu: true,
      rngLuckBias: cpuLuckBias,
      lp: 100,
      mana: 3,
      maxMana: 3,
      deck: seat1Deck,
      hand: [],
      board: [],
      graveyard: [],
    };

    // 대칭형 초기 손패 3장씩 드로우
    for (let i = 0; i < 3; i++) {
      this.drawCard(seat0);
      this.drawCard(seat1);
    }

    return {
      duelId,
      seed: this.state.seed,
      turnNumber: 1,
      activeSeat: 0,
      status: 'ONGOING',
      seats: [seat0, seat1],
    };
  }

  private instantiateCard(cardId: string, ownerSeat: SeatIndex): CardInstance {
    const def = this.getCardDef(cardId);
    return {
      instanceId: `INST_${this.instanceSeq++}_${cardId}`,
      cardId: def.id,
      ownerSeat,
      currentAttack: def.attack,
      currentHealth: def.health,
      maxHealth: def.health,
      canAttack: true,
      tags: [...(def.tags || [])],
    };
  }

  private drawCard(seat: DuelistSeatState): void {
    const next = seat.deck.shift();
    if (next) {
      seat.hand.push(next);
    }
  }

  private resolveCardEffect(
    def: CardDefinition,
    cardInst: CardInstance,
    actor: DuelistSeatState,
    opponent: DuelistSeatState
  ): void {
    if (def.effectType === 'SUMMON_UNIT') {
      if (actor.board.length < 5) {
        cardInst.canAttack = true;
        actor.board.push(cardInst);
      } else {
        actor.graveyard.push(cardInst);
      }
      return;
    }

    if (def.effectType === 'DIRECT_DAMAGE') {
      opponent.lp = Math.max(0, opponent.lp - def.effectValue);
      actor.graveyard.push(cardInst);
      return;
    }

    if (def.effectType === 'BOARD_WIPE') {
      for (const unit of opponent.board) {
        unit.currentHealth -= def.effectValue;
      }
      opponent.board = opponent.board.filter((u) => {
        if (u.currentHealth <= 0) {
          opponent.graveyard.push(u);
          return false;
        }
        return true;
      });
      opponent.lp = Math.max(0, opponent.lp - def.effectValue);
      actor.graveyard.push(cardInst);
      return;
    }

    if (def.effectType === 'HEAL_AND_GUARD') {
      actor.lp = Math.min(30, actor.lp + def.effectValue);
      if (actor.board.length < 5) {
        cardInst.canAttack = true;
        actor.board.push(cardInst);
      }
      return;
    }

    if (def.effectType === 'CHAOS_GAMBLE') {
      const roll = Math.min(1.0, this.rng.nextFloat() + actor.rngLuckBias);
      const damage = roll >= 0.4 ? def.effectValue : Math.ceil(def.effectValue / 2);
      opponent.lp = Math.max(0, opponent.lp - damage);
      if (def.attack > 0 && actor.board.length < 5) {
        cardInst.canAttack = true;
        actor.board.push(cardInst);
      } else {
        actor.graveyard.push(cardInst);
      }
    }
  }

  private evaluateDuelOutcome(duel: SymmetricDuelState): void {
    const [seat0, seat1] = duel.seats;
    if (seat1.lp <= 0) {
      duel.status = 'SEAT_0_WIN';
      this.advanceRunAfterDuelVictory();
    } else if (seat0.lp <= 0) {
      duel.status = 'SEAT_1_WIN';
      this.state.phase = 'RUN_FAILED';
    }
  }

  private advanceRunAfterDuelVictory(): void {
    if (this.state.phase === 'STAGE_1_DUEL_1') {
      this.state.phase = 'STAGE_2_REWARD_PACK';
      // 보상 팩 3장 제시 (제시되는 즉시 3장 모두 바인더에 DISCOVERED로 기록!)
      const packCards = ['C_BLUE_02', 'C_RED_02', 'C_PURP_02'];
      this.state.currentRewardPackChoices = packCards;
      for (const cid of packCards) {
        this.binder.recordCardSeen(cid);
      }
      return;
    }

    if (this.state.phase === 'STAGE_3_DUEL_2') {
      this.state.phase = 'STAGE_4_MERCHANT_EVENT';
      const targetMasteryCard = this.state.playerDeckCardIds[0];
      const merchantCard = 'C_PURP_03';
      // 상인 진열대에 올라온 카드도 플레이어가 목격했으므로 DISCOVERED 처리
      this.binder.recordCardSeen(merchantCard);
      this.state.currentMerchantOffer = {
        offerCardId: merchantCard,
        bonusMasteryCardId: targetMasteryCard,
        bonusMasteryAmount: 100,
      };
      return;
    }

    if (this.state.phase === 'STAGE_5_FINAL_BOSS') {
      this.state.phase = 'RUN_VICTORY';
      this.state.hallOfFameSnapshot = {
        runId: this.state.runId,
        destiny: this.state.selectedDestiny!,
        defeatedBossId: this.state.assignedFinalBoss!,
        deckCardIds: [...this.state.playerDeckCardIds],
        clearedAt: Date.now(),
      };
    }
  }

  private getCardDef(cardId: string): CardDefinition {
    const def = this.catalogMap.get(cardId);
    if (!def) {
      throw new Error(`Card definition not found: ${cardId}`);
    }
    return def;
  }

  private assertPhase(expected: RunStagePhase): void {
    if (this.state.phase !== expected) {
      throw new Error(`Invalid FSM transition: expected phase ${expected}, current is ${this.state.phase}`);
    }
  }
}
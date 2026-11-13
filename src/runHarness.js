import { CARDS_DATABASE, DESTINIES } from './database.js';

export const RUN_STATES = {
  IDLE: 'IDLE',
  FORTUNE_SELECTION: 'FORTUNE_SELECTION',
  ENCOUNTER_INTRO: 'ENCOUNTER_INTRO',
  IN_DUEL: 'IN_DUEL',
  IN_REWARD: 'IN_REWARD',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT'
};

export class RunHarness {
  constructor(options = {}) {
    this.binder = options.binder;
    this.events = options.events || new EventEmitter();
    this.state = RUN_STATES.IDLE;
    
    // Safety & Interlock (LJack Pillar 4 & 6)
    this.isPaused = false;
    this.emergencyStopped = false;

    // Run Context (Blackboard)
    this.destiny = null;
    this.deck = [];
    this.currentStep = 0;
    this.encounters = [];
    this.currentDuel = null;
  }

  // Emergency Stop Interlock (Pillar 4)
  triggerEmergencyStop(reason = "Emergency Stop Invoked") {
    this.emergencyStopped = true;
    this.isPaused = true;
    this.events.emit('emergency_stop', { reason, step: this.currentStep });
    return { success: true, state: this.state, reason };
  }

  // Zero-overhead Pause/Resume
  pause() {
    if (this.emergencyStopped) return false;
    this.isPaused = true;
    this.events.emit('paused', { step: this.currentStep });
    return true;
  }

  resume() {
    if (this.emergencyStopped) return false;
    this.isPaused = false;
    this.events.emit('resumed', { step: this.currentStep });
    return true;
  }

  // Start new run with Destiny
  startRun(destinyKey) {
    if (this.emergencyStopped) throw new Error("System in Emergency Stop condition");
    if (!DESTINIES[destinyKey]) throw new Error(`Invalid destiny: ${destinyKey}`);

    this.destiny = DESTINIES[destinyKey];
    this.deck = ["c01", "c01", "c02", "c04", "c10"]; // Starter deck
    this.currentStep = 0;
    this.state = RUN_STATES.ENCOUNTER_INTRO;

    // Construct linear encounters
    this.encounters = [
      {
        step: 1,
        type: "DUEL",
        title: "1라운드 듀얼",
        opponent: {
          name: "견습 듀얼리스트 레오",
          title: "아마추어 랭커",
          avatar: "🧑‍🎓",
          hp: 20,
          deckArchetype: "기본 밸런스 덱",
          desc: "플레이어와 동등한 룰과 라이프 포인트로 승부합니다."
        }
      },
      {
        step: 2,
        type: "REWARD",
        title: "승리 보상: 카드 팩 개봉",
        desc: "새 카드를 획득하고 바인더에 소유 상태로 등록하세요."
      },
      {
        step: 3,
        type: "DUEL",
        title: "2라운드 듀얼",
        opponent: {
          name: "심연의 추종자 크로우",
          title: "언더그라운드 챔피언",
          avatar: "🦹",
          hp: 25,
          deckArchetype: "속공/전술 덱",
          desc: "패를 빠르게 순환시키며 압박해오는 강적입니다."
        }
      },
      {
        step: 4,
        type: "REWARD",
        title: "신비한 상인: 카드 보강",
        desc: "최종 보스전에 대비해 강력한 카드를 영입합니다."
      },
      {
        step: 5,
        type: "DUEL_BOSS",
        title: `최종 보스 듀얼 - ${this.destiny.boss.name}`,
        opponent: {
          name: this.destiny.boss.name,
          title: "운명의 지배자 (FINAL BOSS)",
          avatar: this.destiny.boss.avatar || "👑",
          hp: this.destiny.boss.hp,
          deckArchetype: this.destiny.boss.archetype,
          desc: this.destiny.boss.desc
        }
      }
    ];

    this.events.emit('run_started', { destiny: this.destiny });
    return this.nextEncounter();
  }

  nextEncounter() {
    if (this.emergencyStopped || this.isPaused) return null;

    if (this.currentStep >= this.encounters.length) {
      this.state = RUN_STATES.VICTORY;
      this.events.emit('run_won', { deck: this.deck, destiny: this.destiny });
      return { completed: true, won: true };
    }

    const current = this.encounters[this.currentStep];
    this.currentStep++;

    if (current.type === 'DUEL' || current.type === 'DUEL_BOSS') {
      this.state = RUN_STATES.IN_DUEL;
      this.currentDuel = new DuelMatch({
        playerHp: 20,
        playerDeck: [...this.deck],
        opponent: current.opponent,
        binder: this.binder,
        events: this.events
      });
      this.events.emit('encounter_duel', { encounter: current, match: this.currentDuel });
      return { type: 'DUEL', encounter: current, match: this.currentDuel };
    } else {
      this.state = RUN_STATES.IN_REWARD;
      const rewardCards = this.generateRewardCards();
      // Discover cards in binder
      if (this.binder) {
        rewardCards.forEach(c => this.binder.discoverCard(c.id));
      }
      this.events.emit('encounter_reward', { encounter: current, options: rewardCards });
      return { type: 'REWARD', encounter: current, options: rewardCards };
    }
  }

  generateRewardCards() {
    const matching = CARDS_DATABASE.filter(c => c.archetype === this.destiny.id || c.archetype === 'NEUTRAL');
    return matching.slice(0, 3);
  }

  claimReward(cardId) {
    if (this.state !== RUN_STATES.IN_REWARD) return false;
    if (cardId) {
      this.deck.push(cardId);
      if (this.binder) {
        this.binder.obtainCard(cardId);
      }
    }
    return this.nextEncounter();
  }

  skipReward() {
    if (this.state !== RUN_STATES.IN_REWARD) return false;
    return this.nextEncounter();
  }
}

// Duel Match Engine (Decoupled & Testable)
export class DuelMatch {
  constructor({ playerHp, playerDeck, opponent, binder, events }) {
    this.playerHp = playerHp;
    this.maxPlayerHp = playerHp;
    this.opponent = opponent;
    this.cpuHp = opponent.hp;
    this.maxCpuHp = opponent.hp;
    this.playerDeck = playerDeck;
    this.binder = binder;
    this.events = events;

    this.round = 1;
    this.isPlayerTurn = true;
    this.isOver = false;
    this.winner = null;

    // Draw initial 4 cards
    this.playerHand = this.playerDeck.slice(0, 4);
  }

  playCard(handIndex) {
    if (this.isOver || !this.isPlayerTurn) return { success: false, reason: "Not player turn or duel ended" };
    if (handIndex < 0 || handIndex >= this.playerHand.length) return { success: false, reason: "Invalid card index" };

    const cardId = this.playerHand[handIndex];
    const cardData = CARDS_DATABASE.find(c => c.id === cardId) || { name: cardId, damage: 5 };

    const dmg = cardData.damage || (cardData.power || 5);
    this.cpuHp = Math.max(0, this.cpuHp - dmg);

    if (this.binder) {
      this.binder.addMastery(cardId, 1);
    }

    if (this.events) {
      this.events.emit('card_played', { card: cardData, damage: dmg, target: 'CPU' });
    }

    if (this.cpuHp <= 0) {
      this.isOver = true;
      this.winner = 'PLAYER';
      if (this.events) this.events.emit('duel_ended', { winner: 'PLAYER' });
      return { success: true, ended: true, winner: 'PLAYER' };
    }

    return { success: true, ended: false, cpuHp: this.cpuHp };
  }

  endTurn() {
    if (this.isOver || !this.isPlayerTurn) return { success: false };

    this.isPlayerTurn = false;
    this.round++;

    // CPU Turn execution (Deterministic logic for headless verification)
    const cpuDamage = Math.floor(this.opponent.hp / 6) + 3;
    this.playerHp = Math.max(0, this.playerHp - cpuDamage);

    if (this.events) {
      this.events.emit('cpu_acted', { damage: cpuDamage, target: 'PLAYER' });
    }

    if (this.playerHp <= 0) {
      this.isOver = true;
      this.winner = 'CPU';
      if (this.events) this.events.emit('duel_ended', { winner: 'CPU' });
      return { isOver: true, winner: 'CPU', playerHp: this.playerHp };
    }

    this.isPlayerTurn = true;
    return { isOver: false, playerHp: this.playerHp, round: this.round };
  }
}

export class EventEmitter {
  constructor() {
    this.listeners = {};
  }
  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => fn(data));
    }
  }
}

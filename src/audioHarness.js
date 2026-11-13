/**
 * @file audioHarness.js
 * @description 무음원 프로시저럴 Web Audio API 사운드 합성 하네스
 * 외부 사운드 파일 없이도 6종의 고품질 아케이드/TCG 효과음을 즉시 생성합니다.
 */

export class ProceduralAudioHarness {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** 효과음 출력 노드. 음량 조절(SFX 볼륨)은 이 노드의 gain으로 한다. */
  output() {
    if (!this.outNode && this.ctx) {
      this.outNode = this.ctx.createGain();
      this.outNode.gain.value = this.outputVolume ?? 1;
      this.outNode.connect(this.ctx.destination);
    }
    return this.outNode || this.ctx.destination;
  }

  setOutputVolume(v) {
    this.outputVolume = v;
    if (this.outNode) this.outNode.gain.value = v;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 1. 카드 픽업 / 셔플음
  playCardPickup() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(780, now + 0.08);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc.connect(gain);
    gain.connect(this.output());

    osc.start(now);
    osc.stop(now + 0.08);
  }

  // 2. 카드 필드 착지 / 묵직한 타격음
  playCardPlayImpact() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);

    osc.connect(gain);
    gain.connect(this.output());

    osc.start(now);
    osc.stop(now + 0.18);
  }

  // 3. 대미지 타격음 (금속성 피격)
  playDamageHit() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.output());

    osc.start(now);
    osc.stop(now + 0.12);
  }

  // 4. 승리 팡파레
  playVictoryJingle() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = this.ctx.currentTime + idx * 0.1;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);

      osc.connect(gain);
      gain.connect(this.output());

      osc.start(startTime);
      osc.stop(startTime + 0.35);
    });
  }

  // 5. 턴 전환 벨소리
  playTurnBell() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.25);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(gain);
    gain.connect(this.output());

    osc.start(now);
    osc.stop(now + 0.25);
  }

  // 6. 공격력 비례 묵직한 타격음 & 서브베이스 쿵소리
  playHeavyImpact(attack = 8) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const intensity = Math.min(2.5, Math.max(0.5, attack / 8));

    // 펀치 베이스
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(140 * intensity, now);
    osc1.frequency.exponentialRampToValueAtTime(30, now + 0.25);

    gain1.gain.setValueAtTime(Math.min(0.6, 0.25 * intensity), now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(this.output());
    osc1.start(now);
    osc1.stop(now + 0.28);

    // 공격력 12 이상일 경우 서브베이스 지진 진동음 추가
    if (attack >= 12) {
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(65, now);
      osc2.frequency.exponentialRampToValueAtTime(20, now + 0.45);
      gain2.gain.setValueAtTime(0.4, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(this.output());
      osc2.start(now);
      osc2.stop(now + 0.45);
    }
  }

  // 7. 가벼운 톡 치는 타격음
  playLightTap() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.06);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // 8. 카드 산산조각 파괴음 (크리스탈/유리 깨짐 합성)
  playCardShatter() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // 3개의 불협화음 고주파 오실레이터로 유리 파편 소리 생성
    const freqs = [1800, 2400, 3150];
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f + i * 200, now + i * 0.02);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.22 + i * 0.03);

      gain.gain.setValueAtTime(0.14, now + i * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24 + i * 0.03);

      osc.connect(gain);
      gain.connect(this.output());
      osc.start(now + i * 0.02);
      osc.stop(now + 0.25 + i * 0.03);
    });
  }

  // 9. 영혼의 형태 묘지 이동음 (에테리얼 공명음)
  playSoulWisp() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.6);

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.6);
  }

  // 10. 관통 에너지 볼트 가속 발사음
  playPiercingBolt() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.18);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // 11. 플레이어 본체 피격 특화음 (둔탁한 가슴 쿵 + 먼지/후폭풍 노이즈 스위시)
  playPlayerImpact(attack = 10) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const intensity = Math.min(2.0, Math.max(0.6, attack / 10));

    // 1. 깊은 바디 덤프 톤 (저음 쿵)
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85 * intensity, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.32);

    gain.gain.setValueAtTime(Math.min(0.5, 0.35 * intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain);
    gain.connect(this.output());
    osc.start(now);
    osc.stop(now + 0.32);

    // 2. 먼지 털리는 백색 분진 노이즈 필터링 스위시
    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.25);
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(90, now + 0.25);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.25, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.output());

      whiteNoise.start(now);
      whiteNoise.stop(now + 0.25);
    } catch (_) {}
  }
}

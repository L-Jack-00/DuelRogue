/**
 * 사운드 뱅크: 효과음·배경음 재생과 음량 계층(마스터 / 배경음 / 효과음).
 *
 * - 효과음: assets/asset_manifest.json에 등록된 파일이 있으면 그 파일을, 없으면 기존 합성음
 *   (ProceduralAudioHarness)을 재생한다. 호출 방법은 합성음 하네스와 같다 (audio.playCardPickup() 등).
 * - 배경음: playBgm(id)로 화면별 곡을 교차 전환한다. 파일이 없으면 조용히 넘어간다.
 * - 브라우저 자동 재생 제한: 첫 입력(클릭·키)에서 오디오를 깨우고, 대기 중이던 배경음을 시작한다.
 * - 동시 재생 제한: 같은 효과음은 동시에 MAX_VOICES개까지만 울린다.
 */
const VOLUME_KEY = 'duel_rogue_volume_v1';
const MAX_VOICES = 4;

export class SoundBank {
  constructor(procedural, manifestUrl = 'assets/asset_manifest.json') {
    this.procedural = procedural;
    this.manifestUrl = manifestUrl;
    this.samples = new Map(); // cue -> { buffer, pitchVariance }
    this.voices = new Map(); // cue -> 재생 중 개수
    this.bgmTracks = new Map(); // id -> { path, loop, volume }
    this.bgmEl = null;
    this.bgmId = null;
    this.pendingBgm = null;
    this.unlocked = false;
    this.volume = { master: 0.8, bgm: 0.6, sfx: 0.9 };
    try {
      Object.assign(this.volume, JSON.parse(localStorage.getItem(VOLUME_KEY) || '{}'));
    } catch {
      /* 저장소를 못 쓰면 기본 음량 */
    }
    this.applySfxVolume();
    this.installUnlock();
    this.wrapCues();
  }

  // ---------------- 음량 ----------------
  setVolume(layer, value) {
    this.volume[layer] = Math.max(0, Math.min(1, value));
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volume));
    } catch {
      /* 무시 */
    }
    this.applySfxVolume();
    if (this.bgmEl) this.bgmEl.volume = this.bgmTarget();
  }

  applySfxVolume() {
    this.procedural.setOutputVolume?.(this.volume.master * this.volume.sfx);
  }

  bgmTarget(trackVolume = null) {
    const tv = trackVolume ?? this.bgmTracks.get(this.bgmId)?.volume ?? 0.5;
    return this.volume.master * this.volume.bgm * tv;
  }

  // ---------------- 자동 재생 제한 해제 ----------------
  installUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlocked = true;
      try {
        this.procedural.init();
      } catch {
        /* 오디오 장치가 없으면 무음으로 진행 */
      }
      if (this.pendingBgm) {
        const id = this.pendingBgm;
        this.pendingBgm = null;
        this.playBgm(id);
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ---------------- 불러오기 ----------------
  async load() {
    let manifest;
    try {
      const res = await fetch(this.manifestUrl, { cache: 'no-cache' });
      manifest = await res.json();
    } catch {
      return; // 목록이 없으면 합성음만 쓴다
    }
    for (const entry of manifest.audio || []) {
      if (entry.type === 'audio_bgm' && entry.ready === true) {
        this.bgmTracks.set(entry.id, { path: entry.path, loop: entry.audioMeta?.loop !== false, volume: entry.audioMeta?.volume ?? 0.5 });
      }
    }
    const sfx = (manifest.audio || []).filter((e) => e.type === 'audio_sfx' && e.cue && e.ready === true);
    await Promise.all(sfx.map((e) => this.loadSample(e)));
  }

  async loadSample(entry) {
    try {
      const res = await fetch(entry.path);
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      this.procedural.init();
      const ctx = this.procedural.ctx;
      if (!ctx) return;
      const buffer = await ctx.decodeAudioData(data);
      this.samples.set(entry.cue, { buffer, pitchVariance: entry.audioMeta?.pitchVariance ?? 0 });
    } catch {
      /* 파일이 없거나 디코딩 실패 → 합성음 사용 */
    }
  }

  // ---------------- 효과음 ----------------
  wrapCues() {
    const proto = Object.getPrototypeOf(this.procedural);
    const cues = Object.getOwnPropertyNames(proto).filter((n) => n.startsWith('play') && typeof proto[n] === 'function');
    for (const cue of [...cues, 'playMoodShift']) {
      this[cue] = (...args) => this.playCue(cue, args);
    }
  }

  playCue(cue, args) {
    const sample = this.samples.get(cue);
    if (sample && this.procedural.ctx) {
      const active = this.voices.get(cue) || 0;
      if (active >= MAX_VOICES) return;
      const ctx = this.procedural.ctx;
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      if (sample.pitchVariance) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * sample.pitchVariance;
      src.connect(this.procedural.output());
      this.voices.set(cue, active + 1);
      src.onended = () => this.voices.set(cue, Math.max(0, (this.voices.get(cue) || 1) - 1));
      src.start();
      return;
    }
    const fallback = this.procedural[cue] || (cue === 'playMoodShift' ? this.procedural.playTurnBell : null);
    try {
      fallback?.apply(this.procedural, args);
    } catch {
      /* 오디오 장치 오류는 게임 진행을 막지 않는다 */
    }
  }

  // ---------------- 배경음 ----------------
  playBgm(id) {
    if (this.bgmId === id) return;
    const track = this.bgmTracks.get(id);
    if (!track) return;
    if (!this.unlocked) {
      this.pendingBgm = id;
      return;
    }
    const previous = this.bgmEl;
    const el = new Audio(track.path);
    el.loop = track.loop;
    el.volume = 0;
    el.addEventListener('error', () => {
      if (this.bgmEl === el) this.bgmEl = null;
    });
    this.bgmEl = el;
    this.bgmId = id;
    el.play()
      .then(() => this.fade(el, this.bgmTarget(track.volume), 900))
      .catch(() => {
        /* 파일 없음·재생 거부 → 무음 */
      });
    if (previous) this.fade(previous, 0, 700, () => previous.pause());
  }

  stopBgm() {
    if (this.bgmEl) {
      const el = this.bgmEl;
      this.fade(el, 0, 600, () => el.pause());
    }
    this.bgmEl = null;
    this.bgmId = null;
  }

  fade(el, to, ms, done) {
    const from = el.volume;
    const start = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - start) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(tick);
      else done?.();
    };
    requestAnimationFrame(tick);
  }
}

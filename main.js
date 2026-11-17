/**
 * @file main.js
 * @description 「듀얼 로그 (Duel Rogue)」 UI 레이어 컨트롤러
 * - SPEC.md 계층 3 (Desktop & UI Harness) 준수
 * - Pure Domain Core(binderCore.js, duelRogueEngine.js, desktopHarness.js) 연결
 * - 7가지 UI View FSM 전환 및 3x3 바인더 오버레이 모달 제어
 * - PointerCapture 기반 카드 드래그 앤 드롭 및 프로시저럴 사운드 연동
 */

import { BinderCardState } from './src/types.js';
import { BinderCore, LocalStorageBinderAdapter } from './src/binderCore.js';
import {
  DuelRogueEngine,
  DEFAULT_CARD_CATALOG,
  BINDER_CATALOG,
  normalizeSeedInput,
  generateRandomSeedCode,
} from './src/duelRogueEngine.js';
import { FACTION_OF_DESTINY, DECK_MASTER_OF_FACTION } from './src/run/content.js';
import { getCardDef as lookupCardDef, CARD_CATALOG } from './src/cards/catalog.js';
import { t } from './src/i18n/strings.js';
import { keywordDesc } from './src/duel/keywords.js';
import { attackableTargets, canAttackHero, previewAttack, hasKw, getManualTargetSpec } from './src/duel/duelCore.js';
import { RunSaveStore } from './src/runSave.js';
import { installBrowserInterferenceGuard, SafeCardPointerController } from './src/desktopHarness.js';
import { ProceduralAudioHarness } from './src/audioHarness.js';
import { SoundBank } from './src/audio/soundBank.js';
import { CanvasJuiceEngine } from './src/canvasJuiceEngine.js';
import { svgIcon, keywordIcon, magicCircleSvg, hydrateVectorIcons } from './src/ui/vectorIcons.js';
import {
  configureAppDialog,
  openAppDialog,
  showGameAlert,
  showGameConfirm,
} from './src/ui/appDialog.js';
import {
  configureCardRenderer,
  generateClawLevelHtml,
  generateCardBackHtml,
  getCardArtHtml,
  formatCardNameHtml,
  generateCompositeCardHtml,
  generateIdleCardHtml,
  updateCardInspector,
} from './src/ui/cardRenderer.js';
import {
  RARITY_TIERS,
  RARITY_LABELS_KO,
  RARITY_PRESET_INFO,
  loadRarityConfig,
  saveRarityConfig,
  cloneDefaultRarityConfig,
  applyRarityConfigToRoot,
  normalizeRarityKey,
} from './src/ui/raritySystem.js';
import {
  MASTERY_TIERS,
  MASTERY_FX_PRESETS,
  loadMasteryFxConfig,
  saveMasteryFxConfig,
  resolveCardMasteryVisual,
} from './src/ui/masterySystem.js';
import {
  bakeAllVectorAssets,
  resolveBakedAsset,
  upgradeDomSvgImages,
} from './src/ui/vectorBaker.js';

let rarityConfig = loadRarityConfig();
let masteryFxConfig = loadMasteryFxConfig();
applyRarityConfigToRoot(rarityConfig);
configureCardRenderer({
  rarityPresetResolver: (rarityKey) => rarityConfig[rarityKey]?.preset || 'NONE',
  masteryVisualResolver: (cardId) => {
    const entry = typeof binder !== 'undefined' ? binder?.entries?.[cardId] : null;
    return resolveCardMasteryVisual(cardId, entry?.masteryPoints || 0, entry?.state || 0, masteryFxConfig);
  },
});

// 1. 브라우저 개입 원천 차단기 (우클릭, F5, Ctrl+R, 줌 차단)
installBrowserInterferenceGuard(window);

// 2. 프로시저럴 사운드 엔진
// 효과음 파일이 있으면 파일을, 없으면 합성음을 재생한다 (src/audio/soundBank.js)
const audio = new SoundBank(new ProceduralAudioHarness());
audio.load();
configureAppDialog({
  playOkSound: () => audio.playCardPickup(),
  playCancelSound: () => audio.playLightTap(),
});

// 2-1. [LJack 60FPS Game FX Canvas] 전용 캔버스 2D 주스 엔진 인스턴스화
const fxCanvas = document.getElementById('game-fx-canvas');
const fxEngine = new CanvasJuiceEngine();
if (fxCanvas) {
  fxEngine.init(fxCanvas);
}

// 3. 순수 도메인 바인더 및 듀얼 엔진 인스턴스화
const binderStorage = new LocalStorageBinderAdapter('duel_rogue_persistent_binder_v1');
const binder = new BinderCore({
  catalog: BINDER_CATALOG,
  storage: binderStorage,
  masteryThreshold: 100,
});
let engine = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG);
const runSaves = new RunSaveStore(window.localStorage);

/**
 * 그림 파일이 있으면 그림을, 없으면 대체 표시(이모지 등)를 보여 주는 HTML.
 * 파일이 없어도 깨진 그림 아이콘이 나오지 않는다.
 */
function artImg(src, className, fallbackHtml) {
  if (!src) return fallbackHtml;
  const resolvedSrc = resolveBakedAsset(src);
  return `<img src="${resolvedSrc}" data-raw-src="${src}" class="${className}" alt="" draggable="false" onerror="this.remove(); this.nextElementSibling && this.nextElementSibling.classList.remove('art-fallback-hidden');" onload="this.nextElementSibling && this.nextElementSibling.classList.add('art-fallback-hidden');" /><span class="art-fallback art-fallback-hidden">${fallbackHtml}</span>`;
}

const PACK_ART = {
  PACK_BLUE: 'assets/ui/pack_blue.svg',
  PACK_RED: 'assets/ui/pack_red.svg',
  PACK_PURPLE: 'assets/ui/pack_purple.svg',
  PACK_WILD: 'assets/ui/pack_neutral.svg',
  PACK_LEGEND: 'assets/ui/pack_legend.svg',
};

/** 상점 주인·수상한 상인 초상화: 내장 벡터 SVG 초상화 반환 */
function npcPortraitSrc(kind, _round, _mood = null) {
  if (kind === 'shop') return 'assets/ui/npc_shopkeeper.svg';
  if (kind === 'merchant') return 'assets/ui/npc_merchant.svg';
  return null;
}

/** index.html에 미리 넣어 둔 그림 슬롯([data-art])을 채운다 */
function hydrateStaticArt(root = document) {
  root.querySelectorAll('[data-art]').forEach((el) => {
    if (el.dataset.hydrated) return;
    el.dataset.hydrated = '1';
    el.innerHTML = artImg(el.dataset.art, el.dataset.artClass || 'static-art-img', el.innerHTML);
  });
}
hydrateStaticArt();

/** index.html의 data-i18n="키" 요소를 현재 언어 사전의 문구로 바꾼다 */
function applyStaticTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
}
applyStaticTranslations();

/** 진행 상황을 저장한다. 런이 끝났으면 저장본을 지운다. (잦은 호출을 묶어 한 번만 쓴다) */
let saveTimer = null;
function scheduleRunSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const phase = engine.state.phase;
    if (phase === 'IDLE') return;
    if (phase === 'RUN_VICTORY' || phase === 'RUN_FAILED') {
      runSaves.clear();
    } else {
      runSaves.save(engine.exportSave());
    }
    refreshContinueButton();
  }, 250);
}

function refreshContinueButton() {
  const btn = document.getElementById('btn-continue-run');
  if (!btn) return;
  const saved = runSaves.load();
  btn.hidden = !saved;
  if (saved) {
    const st = saved.data.state;
    const when = new Date(saved.savedAt);
    const seedPrefix = st.isSeededRun ? `[시드: ${st.seedText || st.seed}] ` : '';
    btn.title = `${seedPrefix}라운드 ${st.roundNumber || 1} · ${when.toLocaleString()}`;
  }
}

// 4. 화면(View) 맵핑 (SPEC.md 3)
const views = {
  VIEW_TITLE_LOBBY: document.getElementById('view-title-lobby'),
  VIEW_FORTUNE_TELLER: document.getElementById('view-fortune-teller'),
  VIEW_CHECKPOINT: document.getElementById('view-checkpoint'),
  VIEW_CHECKPOINT_SHOP: document.getElementById('view-checkpoint-shop'),
  VIEW_CHECKPOINT_MERCHANT: document.getElementById('view-checkpoint-merchant'),
  VIEW_CHECKPOINT_DECK_EDITOR: document.getElementById('view-checkpoint-deck-editor'),
  VIEW_DUEL_ARENA: document.getElementById('view-duel-arena'),
  VIEW_PACK_OPENING: document.getElementById('view-pack-opening'),
  VIEW_MERCHANT_EVENT: document.getElementById('view-merchant-event'),
  VIEW_RUN_SUMMARY: document.getElementById('view-run-summary'),
};

const overlayBinderBook = document.getElementById('overlay-binder-book');
let currentBinderPage = 0;
let selectedCardInPack = null;

// ============================================================================
// [중앙 턴 타이머 하네스 (DuelTurnTimer)]
// - 45초 턴당 시간 연출: 12시 방향부터 반시계방향(CCW)으로 서서히 소광
// - 10초 이하 긴박한 펄스 FX & 0초 도달 시 자동 턴 종료 안전망
// ============================================================================
class DuelTurnTimer {
  constructor() {
    this.totalSeconds = 45;
    this.remainingSeconds = 45;
    this.intervalId = null;
    this.active = false;
    this.isPlayerTurn = false;
    this.isPaused = false;
    this.lastTurnKey = null;
  }

  syncWithDuel(duel) {
    if (!duel) {
      this.stop();
      return;
    }

    const currentTurnKey = `${duel.turnNumber}_${duel.activeSeat}`;
    const isPlayer = duel.activeSeat === 0;

    if (this.lastTurnKey !== currentTurnKey) {
      this.lastTurnKey = currentTurnKey;
      if (isPlayer) {
        this.startPlayerTurn();
      } else {
        this.pauseForCpuTurn();
      }
    } else {
      if (isPlayer && !this.active && !this.isPaused) {
        this.startPlayerTurn();
      } else if (!isPlayer) {
        this.updateCpuTurnUI();
      }
    }
  }

  togglePause() {
    if (!this.active && !this.isPaused) return;
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause() {
    if (!this.isPlayerTurn || this.isPaused) return;
    this.isPaused = true;
    this.stopInterval();
    document.getElementById('timer-pause-popup')?.classList.remove('is-hidden');
    document.getElementById('turn-timer-container')?.classList.add('is-paused');
  }

  resume() {
    this.isPaused = false;
    document.getElementById('timer-pause-popup')?.classList.add('is-hidden');
    document.getElementById('turn-timer-container')?.classList.remove('is-paused');
    if (this.isPlayerTurn && this.active) {
      this.stopInterval();
      this.intervalId = setInterval(() => {
        if (!this.active || !this.isPlayerTurn || this.isPaused) return;
        this.remainingSeconds = Math.max(0, this.remainingSeconds - 0.1);
        this.updateUI();

        if (this.remainingSeconds <= 0) {
          this.stop();
          this.onTimeExpired();
        }
      }, 100);
    }
  }

  startPlayerTurn() {
    this.stopInterval();
    this.totalSeconds = 45;
    this.remainingSeconds = 45;
    this.active = true;
    this.isPlayerTurn = true;
    this.isPaused = false;
    document.getElementById('timer-pause-popup')?.classList.add('is-hidden');
    document.getElementById('turn-timer-container')?.classList.remove('is-paused');
    this.updateUI();

    this.intervalId = setInterval(() => {
      if (!this.active || !this.isPlayerTurn || this.isPaused) return;
      this.remainingSeconds = Math.max(0, this.remainingSeconds - 0.1);
      this.updateUI();

      if (this.remainingSeconds <= 0) {
        this.stop();
        this.onTimeExpired();
      }
    }, 100);
  }

  pauseForCpuTurn() {
    this.stopInterval();
    this.isPlayerTurn = false;
    this.active = false;
    this.isPaused = false;
    document.getElementById('timer-pause-popup')?.classList.add('is-hidden');
    document.getElementById('turn-timer-container')?.classList.remove('is-paused');
    this.updateCpuTurnUI();
  }

  stopInterval() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  stop() {
    this.stopInterval();
    this.active = false;
    this.isPlayerTurn = false;
    this.isPaused = false;
    this.lastTurnKey = null;
    document.getElementById('timer-pause-popup')?.classList.add('is-hidden');
    document.getElementById('turn-timer-container')?.classList.remove('is-paused');
  }

  onTimeExpired() {
    const snap = engine.getSnapshot();
    if (snap.activeDuel && snap.activeDuel.activeSeat === 0) {
      audio.playTurnBell();
      selectedAttackerInstanceId = null;
      clearTargetHighlights();
      engine.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
      syncRunPhaseView();
    }
  }

  updateUI() {
    const containerEl = document.getElementById('turn-timer-container');
    const ringEl = document.getElementById('timer-progress-ring');
    const countEl = document.getElementById('turn-timer-countdown');
    const btnEl = document.getElementById('btn-end-turn');
    const btnTitleEl = btnEl?.querySelector('.turn-btn-title');

    if (!containerEl || !ringEl || !countEl || !btnEl) return;

    btnEl.disabled = false;
    if (typeof renderTurnButtonTitle === 'function') {
      renderTurnButtonTitle(engine.getSnapshot()?.activeDuel);
    } else if (btnTitleEl) {
      btnTitleEl.textContent = '내 턴 종료';
    }

    const fractionElapsed = Math.min(1, Math.max(0, (this.totalSeconds - this.remainingSeconds) / this.totalSeconds));
    // 둘레 = 2 * Math.PI * 44 ≈ 276.46
    // 12시 방향에서 시작하여 반시계방향(CCW)으로 서서히 소광되는 효과
    const offset = -(fractionElapsed * 276.46);
    ringEl.style.strokeDashoffset = `${offset}px`;

    const displaySec = Math.ceil(this.remainingSeconds);
    countEl.textContent = `${displaySec}s`;

    if (this.remainingSeconds <= 10) {
      containerEl.classList.add('is-urgent');
    } else {
      containerEl.classList.remove('is-urgent');
    }
  }

  updateCpuTurnUI() {
    const containerEl = document.getElementById('turn-timer-container');
    const ringEl = document.getElementById('timer-progress-ring');
    const countEl = document.getElementById('turn-timer-countdown');
    const btnEl = document.getElementById('btn-end-turn');
    const btnTitleEl = btnEl?.querySelector('.turn-btn-title');

    if (!containerEl || !ringEl || !countEl || !btnEl) return;

    btnEl.disabled = true;
    if (typeof renderTurnButtonTitle === 'function') {
      renderTurnButtonTitle(engine.getSnapshot()?.activeDuel);
    } else if (btnTitleEl) {
      btnTitleEl.textContent = '상대 턴';
    }
    countEl.textContent = '—';
    containerEl.classList.remove('is-urgent');
    ringEl.style.strokeDashoffset = '-276.46px';
  }
}

const duelTurnTimer = new DuelTurnTimer();

// 화면별 배경음
const VIEW_BGM = {
  VIEW_TITLE_LOBBY: 'BGM_TITLE',
  VIEW_FORTUNE_TELLER: 'BGM_TITLE',
  VIEW_CHECKPOINT: 'BGM_HUB',
  VIEW_CHECKPOINT_DECK_EDITOR: 'BGM_HUB',
  VIEW_CHECKPOINT_SHOP: 'BGM_SHOP',
  VIEW_CHECKPOINT_MERCHANT: 'BGM_MERCHANT',
  VIEW_MERCHANT_EVENT: 'BGM_MERCHANT',
  VIEW_PACK_OPENING: 'BGM_SHOP',
};

let currentViewKey = null;
let viewTransitionTimerId = null;

function switchView(viewKey) {
  if (viewKey !== 'VIEW_DUEL_ARENA') {
    duelTurnTimer.stop();
  }
  const phase = engine?.state?.phase;
  let bgm = VIEW_BGM[viewKey];
  if (viewKey === 'VIEW_DUEL_ARENA') bgm = phase === 'STAGE_5_FINAL_BOSS' ? 'BGM_BOSS' : 'BGM_DUEL';
  if (viewKey === 'VIEW_RUN_SUMMARY') bgm = phase === 'RUN_VICTORY' ? 'BGM_VICTORY' : 'BGM_DEFEAT';
  if (bgm) audio.playBgm(bgm);
  document.body.dataset.view = viewKey;
  document.body.dataset.boss = phase === 'STAGE_5_FINAL_BOSS' ? engine.state.assignedFinalBoss || '' : '';

  const isActualChange = Boolean(currentViewKey && currentViewKey !== viewKey);
  currentViewKey = viewKey;
  const transMs = Math.max(0, Number(tunerSettings?.transitionMs ?? 260));
  document.documentElement.style.setProperty('--view-transition-ms', `${transMs}ms`);

  const veil = document.getElementById('view-transition-veil');
  const applySwitch = () => {
    Object.values(views).forEach((v) => v?.classList.remove('active', 'screen-entering'));
    if (views[viewKey]) {
      views[viewKey].classList.add('active');
      if (isActualChange && transMs > 0) {
        void views[viewKey].offsetWidth;
        views[viewKey].classList.add('screen-entering');
      }
    }
    if (isActualChange && viewKey === 'VIEW_DUEL_ARENA' && fxCanvas) {
      const r = fxCanvas.getBoundingClientRect();
      fxEngine.spawnSummonBurst(r.width * 0.5, r.height * 0.5, phase === 'STAGE_5_FINAL_BOSS' ? '#f43f5e' : '#38bdf8', 170);
    }
  };

  if (isActualChange && transMs > 0 && veil) {
    if (viewTransitionTimerId) clearTimeout(viewTransitionTimerId);
    veil.classList.add('is-active');
    applySwitch();
    viewTransitionTimerId = setTimeout(() => {
      veil.classList.remove('is-active');
      viewTransitionTimerId = null;
    }, Math.min(180, Math.round(transMs * 0.55)));
  } else {
    veil?.classList.remove('is-active');
    applySwitch();
  }
}

// ============================================================================
// 하스스톤식 카드 사용/발동 상세 그래픽 팝업 쇼케이스
// ============================================================================
let cardShowcaseFadeTimer = null;
let cardShowcaseClearTimer = null;

function applyShowcaseTunerVars() {
  const root = document.documentElement.style;
  root.setProperty('--showcase-x', `${tunerSettings?.showcaseX ?? 17}%`);
  root.setProperty('--showcase-y', `${tunerSettings?.showcaseY ?? 48}%`);
  root.setProperty('--showcase-scale', `${tunerSettings?.showcaseScale ?? 1.15}`);
}

function showCardPlayShowcase(cardOrDef, { actorLabel = '카드 발동', isCpu = false, atk = null, def = null } = {}) {
  if (!cardOrDef || tunerSettings?.showcaseEnabled === false) return;
  const host = document.getElementById('card-play-showcase');
  if (!host) return;

  const cardDef = cardOrDef.cardId ? lookupCardDef(cardOrDef.cardId) || cardOrDef : cardOrDef;
  if (!cardDef) return;

  if (cardShowcaseFadeTimer) clearTimeout(cardShowcaseFadeTimer);
  if (cardShowcaseClearTimer) clearTimeout(cardShowcaseClearTimer);

  applyShowcaseTunerVars();

  const resolvedAtk = atk ?? cardOrDef.currentAttack ?? cardDef.attack ?? 0;
  const resolvedDef = def ?? cardOrDef.currentDefense ?? cardDef.defense ?? cardDef.health ?? 0;
  const iconName = cardDef.type === 'SPELL' ? 'spell' : 'swords';

  host.innerHTML = `
    <div class="showcase-banner-pill ${isCpu ? 'is-cpu' : ''}">
      ${svgIcon(iconName)} <span>${actorLabel}</span>
    </div>
    <div class="showcase-card-shell">
      ${generateCompositeCardHtml(cardDef, resolvedAtk, resolvedDef, 1.0, false)}
    </div>
  `;

  host.classList.remove('is-exiting', 'is-visible');
  void host.offsetWidth;
  host.classList.add('is-visible');

  const duration = Math.max(400, Number(tunerSettings?.showcaseDurationMs ?? 1500));
  cardShowcaseFadeTimer = setTimeout(() => {
    host.classList.add('is-exiting');
    host.classList.remove('is-visible');
    cardShowcaseClearTimer = setTimeout(() => {
      host.classList.remove('is-exiting');
      host.innerHTML = '';
    }, 260);
  }, duration);
}

// ============================================================================
// 타이틀바 & 윈도우 컨트롤 (Tauri v2 호환)
// ============================================================================
// 메인 메뉴(타이틀 화면) 바로가기
document.getElementById('btn-return-main-menu')?.addEventListener('click', () => {
  const goLobby = () => {
    audio.playCardPickup();
    engine.state = engine.createEmptyRunState('RUN_INIT', Date.now());
    resetRunUiTransitionState('IDLE');
    refreshContinueButton();
    switchView('VIEW_TITLE_LOBBY');
  };
  if (views.VIEW_CHECKPOINT_DECK_EDITOR?.classList.contains('active')) {
    attemptLeaveDeckEditor(goLobby);
    return;
  }
  goLobby();
});
function getTauriWindow() {
  const winMod = window.__TAURI__?.window;
  if (!winMod) return null;
  if (typeof winMod.getCurrentWindow === 'function') return winMod.getCurrentWindow();
  if (typeof winMod.getCurrent === 'function') return winMod.getCurrent();
  return null;
}

document.getElementById('btn-win-close')?.addEventListener('click', () => {
  const tauriWin = getTauriWindow();
  if (tauriWin) {
    tauriWin.close();
  } else {
    window.close();
  }
});

document.getElementById('btn-win-minimize')?.addEventListener('click', () => {
  getTauriWindow()?.minimize();
});

document.getElementById('btn-win-maximize')?.addEventListener('click', () => {
  getTauriWindow()?.toggleMaximize();
});

// 전역 바인더 토글 버튼
document.getElementById('btn-toggle-binder-global')?.addEventListener('click', () => {
  toggleBinderModal();
});
document.getElementById('btn-close-binder')?.addEventListener('click', () => {
  overlayBinderBook.classList.remove('active');
});

// ============================================================================
// 1. VIEW_TITLE_LOBBY
// ============================================================================
let pendingCustomSeedText = '';

function updateTitleSeedButtonUI() {
  const btn = document.getElementById('btn-title-seed-config');
  const label = document.getElementById('btn-title-seed-label');
  if (!btn || !label) return;
  const trimmed = String(pendingCustomSeedText || '').trim();
  if (trimmed) {
    btn.classList.add('is-seeded-active');
    const shortText = trimmed.length > 12 ? `${trimmed.slice(0, 12)}…` : trimmed;
    label.textContent = `시드: ${shortText}`;
    btn.title = `시드 런 설정됨: ${trimmed} (바인더·명예의 전당 미반영)`;
  } else {
    btn.classList.remove('is-seeded-active');
    label.textContent = '시드 설정';
    btn.title = '고정 시드 설정';
  }
}

document.getElementById('btn-start-run')?.addEventListener('click', async () => {
  if (runSaves.hasSave()) {
    const ok = await showGameConfirm(
      '이어할 수 있는 진행 기록이 있습니다.\n새로 시작하면 저장된 진행 상황이 사라집니다. 계속할까요?',
      { title: '새 게임 시작', confirmText: '새로 시작', cancelText: '취소', icon: 'warn', danger: true }
    );
    if (!ok) return;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  runSaves.clear();
  refreshContinueButton();
  audio.playCardPickup();

  const parsed = normalizeSeedInput(pendingCustomSeedText);
  if (parsed.isSeeded) {
    engine.startNewRun(`RUN_SEED_${Date.now()}`, parsed.numericSeed, {
      isSeededRun: true,
      seedText: parsed.seedText,
    });
  } else {
    const randomSeed = Date.now();
    engine.startNewRun(`RUN_${randomSeed}`, randomSeed, {
      isSeededRun: false,
      seedText: String(randomSeed >>> 0),
    });
  }
  resetRunUiTransitionState('STAGE_0_FORTUNE');
  switchView('VIEW_FORTUNE_TELLER');
});

document.getElementById('btn-continue-run')?.addEventListener('click', async () => {
  const saved = runSaves.load();
  if (!saved) {
    refreshContinueButton();
    return;
  }
  try {
    audio.playCardPickup();
    engine.importSave(saved.data);
    resetRunUiTransitionState(engine.state.phase);
    syncRunPhaseView({ skipOutcomeTransition: true });
  } catch (err) {
    console.error('[Continue Error]', err);
    await showGameAlert('저장된 진행 상황을 불러오지 못했습니다. 새 런을 시작해 주세요.', { title: '불러오기 실패', danger: true });
    runSaves.clear();
    refreshContinueButton();
  }
});
refreshContinueButton();

document.getElementById('btn-open-binder-menu')?.addEventListener('click', () => {
  audio.playCardPickup();
  toggleBinderModal();
});

// ============================================================================
// [스케치 2] 듀얼 전장 조작 인터랙션 (전투 로그 팝업)
// ============================================================================
const duelArenaEl = document.getElementById('view-duel-arena');
const combatLogDrawer = document.getElementById('combat-log-drawer');
const btnToggleLogDrawer = document.getElementById('btn-toggle-log-drawer');
const btnCloseCombatLogPopup = document.getElementById('btn-close-combat-log-popup');
const btnClearCombatLog = document.getElementById('btn-clear-combat-log');
const logDrawerIcon = document.getElementById('log-drawer-icon');
const logDrawerLabel = document.getElementById('log-drawer-label');

// 전투 로그창 팝업 토글 (기본값 접힘 / 동일 좌표에서 폈다 접었다 제자리 클릭 지원)
function updateLogToggleUI() {
  const isCollapsed = combatLogDrawer?.classList.contains('is-collapsed');
  if (isCollapsed) {
    if (logDrawerIcon) logDrawerIcon.innerHTML = svgIcon('scroll');
    if (logDrawerLabel) logDrawerLabel.textContent = '전투 로그';
    btnToggleLogDrawer?.classList.remove('active');
  } else {
    if (logDrawerIcon) logDrawerIcon.innerHTML = svgIcon('cross');
    if (logDrawerLabel) logDrawerLabel.textContent = '로그 닫기';
    btnToggleLogDrawer?.classList.add('active');
  }
}

// 초기 기본값: 접힌 상태
if (combatLogDrawer) {
  combatLogDrawer.classList.add('is-collapsed');
}
updateLogToggleUI();

btnToggleLogDrawer?.addEventListener('click', (e) => {
  e.stopPropagation();
  audio.playCardPickup();
  const willOpen = combatLogDrawer?.classList.contains('is-collapsed');
  combatLogDrawer?.classList.toggle('is-collapsed');
  updateLogToggleUI();
  if (!willOpen && typeof hideLogCardHoverPreview === 'function') {
    hideLogCardHoverPreview();
  }
  if (willOpen) {
    const logContainer = document.getElementById('combat-log-history');
    if (logContainer) {
      requestAnimationFrame(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
      });
    }
  }
});

btnCloseCombatLogPopup?.addEventListener('click', (e) => {
  e.stopPropagation();
  audio.playCardPickup();
  combatLogDrawer?.classList.add('is-collapsed');
  updateLogToggleUI();
  hideLogCardHoverPreview();
});

// 4. 로그 청소 버튼
btnClearCombatLog?.addEventListener('click', () => {
  hideLogCardHoverPreview();
  const container = document.getElementById('combat-log-history');
  if (container) {
    container.innerHTML = `
      <div class="log-entry log-system">
        <span class="log-badge badge-sys">시스템</span>
        <span class="log-msg">전투 기록 초기화</span>
      </div>
    `;
  }
});

// ============================================================================
// 게임 설정 & 옵션 모달 + 타이틀 시드 설정 모달
// ============================================================================
const inGameOptionsModal = document.getElementById('in-game-options-modal');
const btnInGameOptions = document.getElementById('btn-in-game-options');
const btnTitleOptions = document.getElementById('btn-title-options');
const btnCloseOptions = document.getElementById('btn-close-options');
const optionsModalBackdrop = document.getElementById('options-modal-backdrop');

const seedConfigModal = document.getElementById('seed-config-modal');
const btnTitleSeedConfig = document.getElementById('btn-title-seed-config');
const seedConfigInput = document.getElementById('seed-config-input');
const seedPreviewStatus = document.getElementById('seed-preview-status');

function refreshOptionsModalContext() {
  const phase = engine?.state?.phase || 'IDLE';
  const inRun = phase !== 'IDLE';
  const inDuel = DUEL_COMBAT_PHASES.has(phase) && Boolean(engine?.state?.activeDuel);

  const runSection = document.getElementById('options-section-run-control');
  if (runSection) runSection.hidden = !inRun;

  const winBtn = document.getElementById('btn-instant-win-test');
  if (winBtn) winBtn.hidden = !inDuel;

  const badgeEl = document.getElementById('opt-run-mode-badge');
  const codeEl = document.getElementById('opt-current-run-seed');
  if (badgeEl && codeEl && inRun) {
    const isSeeded = Boolean(engine.state.isSeededRun);
    badgeEl.textContent = isSeeded ? '시드 런' : '일반 런';
    badgeEl.classList.toggle('is-seeded', isSeeded);
    codeEl.textContent = engine.state.seedText || String(engine.state.seed || '-');
  }
}

function toggleInGameOptions(show) {
  if (!inGameOptionsModal) return;
  const isCurrentlyHidden = inGameOptionsModal.classList.contains('is-hidden');
  const shouldOpen = show !== undefined ? show : isCurrentlyHidden;

  if (shouldOpen) {
    refreshOptionsModalContext();
    audio.playCardPickup();
    inGameOptionsModal.classList.remove('is-hidden');
    btnInGameOptions?.classList.add('active');
    btnTitleOptions?.classList.add('active');
  } else {
    audio.playCardPickup();
    inGameOptionsModal.classList.add('is-hidden');
    btnInGameOptions?.classList.remove('active');
    btnTitleOptions?.classList.remove('active');
  }
}

btnInGameOptions?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleInGameOptions();
});
btnTitleOptions?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleInGameOptions();
});
btnCloseOptions?.addEventListener('click', () => toggleInGameOptions(false));
optionsModalBackdrop?.addEventListener('click', () => toggleInGameOptions(false));

document.getElementById('btn-copy-run-seed')?.addEventListener('click', async () => {
  const seedVal = engine?.state?.seedText || String(engine?.state?.seed || '');
  if (!seedVal) return;
  const btn = document.getElementById('btn-copy-run-seed');
  try {
    await navigator.clipboard?.writeText(seedVal);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    }
  } catch {
    /* clipboard 미지원 환경 무시 */
  }
});

function updateSeedPreviewStatus() {
  if (!seedPreviewStatus || !seedConfigInput) return;
  const parsed = normalizeSeedInput(seedConfigInput.value);
  if (parsed.isSeeded) {
    seedPreviewStatus.classList.add('is-seeded');
    seedPreviewStatus.textContent = `시드 런 적용 예정 · "${parsed.seedText}" (바인더·명예의 전당 제외)`;
  } else {
    seedPreviewStatus.classList.remove('is-seeded');
    seedPreviewStatus.textContent = '일반 랜덤 런 · 바인더 및 명예의 전당 정상 반영';
  }
}

function toggleSeedConfigModal(show) {
  if (!seedConfigModal) return;
  const isHidden = seedConfigModal.classList.contains('is-hidden');
  const shouldOpen = show !== undefined ? show : isHidden;
  if (shouldOpen) {
    audio.playCardPickup();
    if (seedConfigInput) seedConfigInput.value = pendingCustomSeedText;
    updateSeedPreviewStatus();
    seedConfigModal.classList.remove('is-hidden');
    btnTitleSeedConfig?.classList.add('active');
    setTimeout(() => seedConfigInput?.focus(), 40);
  } else {
    audio.playCardPickup();
    seedConfigModal.classList.add('is-hidden');
    btnTitleSeedConfig?.classList.remove('active');
  }
}

function applySeedConfigAndClose() {
  pendingCustomSeedText = String(seedConfigInput?.value || '').trim();
  updateTitleSeedButtonUI();
  toggleSeedConfigModal(false);
}

btnTitleSeedConfig?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSeedConfigModal(true);
});
document.getElementById('btn-close-seed-modal')?.addEventListener('click', () => toggleSeedConfigModal(false));
document.getElementById('seed-modal-backdrop')?.addEventListener('click', () => toggleSeedConfigModal(false));
document.getElementById('btn-seed-cancel')?.addEventListener('click', () => toggleSeedConfigModal(false));
document.getElementById('btn-seed-apply')?.addEventListener('click', applySeedConfigAndClose);

// ============================================================================
// 타이틀 룰북 모달 (신규 유저 온보딩)
// ============================================================================
const rulebookModal = document.getElementById('rulebook-modal');
const btnTitleRulebook = document.getElementById('btn-title-rulebook');

function switchRulebookTab(tabKey) {
  document.querySelectorAll('.rulebook-tab-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-rulebook-tab') === tabKey);
  });
  document.querySelectorAll('.rulebook-tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.getAttribute('data-rulebook-panel') === tabKey);
  });
  document.querySelectorAll('.rulebook-visual-pane').forEach((pane) => {
    pane.classList.toggle('is-active', pane.getAttribute('data-rulebook-visual') === tabKey);
  });
}

function toggleRulebookModal(show) {
  if (!rulebookModal) return;
  const isHidden = rulebookModal.classList.contains('is-hidden');
  const shouldOpen = show !== undefined ? show : isHidden;
  audio.playCardPickup();
  if (shouldOpen) {
    switchRulebookTab('basics');
    rulebookModal.classList.remove('is-hidden');
    btnTitleRulebook?.classList.add('active');
    hydrateVectorIcons(rulebookModal);
  } else {
    rulebookModal.classList.add('is-hidden');
    btnTitleRulebook?.classList.remove('active');
  }
}

btnTitleRulebook?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleRulebookModal(true);
});
document.getElementById('btn-close-rulebook')?.addEventListener('click', () => toggleRulebookModal(false));
document.getElementById('rulebook-modal-backdrop')?.addEventListener('click', () => toggleRulebookModal(false));
document.getElementById('btn-rulebook-confirm')?.addEventListener('click', () => toggleRulebookModal(false));
document.querySelectorAll('.rulebook-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playLightTap();
    switchRulebookTab(btn.getAttribute('data-rulebook-tab') || 'basics');
  });
});
document.getElementById('btn-seed-generate')?.addEventListener('click', () => {
  audio.playCardPickup();
  if (seedConfigInput) {
    seedConfigInput.value = generateRandomSeedCode();
    updateSeedPreviewStatus();
  }
});
document.getElementById('btn-seed-clear')?.addEventListener('click', () => {
  audio.playCardPickup();
  if (seedConfigInput) {
    seedConfigInput.value = '';
    updateSeedPreviewStatus();
  }
});
seedConfigInput?.addEventListener('input', updateSeedPreviewStatus);
seedConfigInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applySeedConfigAndClose();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    toggleSeedConfigModal(false);
  }
});
updateTitleSeedButtonUI();

// 옵션 모달 내 엔지니어링 도구 바로가기 버튼들
document.getElementById('btn-opt-tuner')?.addEventListener('click', () => {
  toggleInGameOptions(false);
  toggleTunerModal();
});
document.getElementById('btn-opt-rarity-tuner')?.addEventListener('click', () => {
  toggleInGameOptions(false);
  toggleRarityTunerModal();
});
document.getElementById('btn-opt-playground')?.addEventListener('click', () => {
  toggleInGameOptions(false);
  const btn = document.getElementById('btn-toggle-playground');
  if (btn) btn.click();
});

// 볼륨 슬라이더 (마스터 / 배경음 / 효과음) — 값은 브라우저에 저장된다
for (const [layer, inputId] of [['master', 'opt-master-vol'], ['bgm', 'opt-bgm-vol'], ['sfx', 'opt-sfx-vol']]) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(`${inputId}-val`);
  if (!input) continue;
  input.value = String(Math.round(audio.volume[layer] * 100));
  if (label) label.textContent = `${input.value}%`;
  input.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    if (label) label.textContent = `${val}%`;
    audio.setVolume(layer, val / 100);
  });
}

// ============================================================================
// [묘지(Graveyard) 상세 뷰어: 파괴된 카드 역순(최신순) 나열 모달]
// ============================================================================
const graveyardViewerModal = document.getElementById('graveyard-viewer-modal');
const btnCloseGraveyard = document.getElementById('btn-close-graveyard');
const gyModalBackdrop = document.getElementById('gy-modal-backdrop');

function openGraveyardViewer(seatIndex) {
  const snap = engine.getSnapshot();
  if (!snap.activeDuel) return;
  const seat = snap.activeDuel.seats[seatIndex];
  if (!seat) return;

  audio.playCardPickup();
  const modal = document.getElementById('graveyard-viewer-modal');
  const titleEl = document.getElementById('gy-modal-title');
  const container = document.getElementById('gy-modal-cards-container');
  if (!modal || !titleEl || !container) return;

  const isPlayer = seatIndex === 0;
  const gy = seat.graveyard || [];
  titleEl.innerHTML = `${svgIcon('skull')} ${isPlayer ? '플레이어' : '상대'} 묘지 <span class="gy-count-tag">(총 ${gy.length}장 / 최신순)</span>`;

  container.innerHTML = '';
  if (gy.length === 0) {
    container.innerHTML = `
      <div class="empty-gy-notice">
        <span class="empty-gy-icon">${svgIcon('tombstone')}</span>
        <p>묘지에 파괴되거나 소모된 카드가 없습니다.</p>
      </div>
    `;
  } else {
    // 파괴된 카드들을 역순 (가장 최근에 파괴된 카드부터 먼저)으로 정렬
    const reversedGy = [...gy].reverse();
    reversedGy.forEach((cardInst, idx) => {
      const def = lookupCardDef(cardInst.cardId) || cardInst;
      const orderNum = gy.length - idx; // 원래 파괴된 순번
      const cardRow = document.createElement('div');
      cardRow.className = 'gy-card-entry';
      cardRow.title = `클릭 시 좌측 카드 인스펙터에 상세 정보 표시`;

      const isMonster = def.type === 'MONSTER' || def.type === 'UNIT';
      const atk = cardInst.currentAttack ?? def.attack ?? 0;
      const defStat = cardInst.currentDefense ?? cardInst.currentHealth ?? def.defense ?? def.health ?? 0;
      const level = def.level || 1;

      cardRow.innerHTML = `
        <div class="gy-card-badge">#${orderNum} ${idx === 0 ? '<span class="latest-tag">최신</span>' : ''}</div>
        <div class="gy-card-mini-preview">
          ${generateCompositeCardHtml(def, atk, defStat, 0.38, true)}
        </div>
        <div class="gy-card-info">
          <div class="gy-card-name-line">
            <span class="gy-card-name">${def.name}</span>
            <span class="gy-card-type-tag ${isMonster ? 'tag-monster' : 'tag-spell'}">${isMonster ? `Lv.${level} 몬스터` : '마법 카드'}</span>
          </div>
          ${isMonster ? `
            <div class="gy-card-stats">
              <span class="stat-atk">공격력 <strong>${atk}</strong></span>
              <span class="stat-def">수비력 <strong>${defStat}</strong></span>
            </div>
          ` : ''}
          <div class="gy-card-desc">${def.description || def.effectDescription || '기본 카드 효과'}</div>
        </div>
      `;

      cardRow.addEventListener('mouseenter', () => updateCardInspector(def));
      cardRow.addEventListener('click', () => {
        audio.playCardPickup();
        updateCardInspector(def);
      });

      container.appendChild(cardRow);
    });
  }

  modal.classList.remove('is-hidden');
}

document.getElementById('player-graveyard')?.addEventListener('click', () => openGraveyardViewer(0));
document.getElementById('cpu-graveyard')?.addEventListener('click', () => openGraveyardViewer(1));
btnCloseGraveyard?.addEventListener('click', () => {
  graveyardViewerModal?.classList.add('is-hidden');
});
gyModalBackdrop?.addEventListener('click', () => {
  graveyardViewerModal?.classList.add('is-hidden');
});

// 4. 턴 타이머 일시정지 팝업 모달 이벤트
document.getElementById('btn-resume-timer-popup')?.addEventListener('click', () => {
  duelTurnTimer.resume();
});
document.getElementById('timer-pause-backdrop')?.addEventListener('click', () => {
  duelTurnTimer.resume();
});
document.getElementById('turn-timer-container')?.addEventListener('click', (e) => {
  // 턴 종료 버튼 자체가 아닌 타이머 링 영역 클릭 시 일시정지/재개 토글
  const endBtn = document.getElementById('btn-end-turn');
  if (endBtn && (e.target === endBtn || endBtn.contains(e.target))) return;
  duelTurnTimer.togglePause();
});

// ESC 키로 열려있는 모달들 닫기 & Space 키로 타이머 일시정지 토글
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (seedConfigModal && !seedConfigModal.classList.contains('is-hidden')) {
      toggleSeedConfigModal(false);
    }
    if (inGameOptionsModal && !inGameOptionsModal.classList.contains('is-hidden')) {
      toggleInGameOptions(false);
    }
    if (graveyardViewerModal && !graveyardViewerModal.classList.contains('is-hidden')) {
      graveyardViewerModal.classList.add('is-hidden');
    }
    if (duelTurnTimer.isPaused) {
      duelTurnTimer.resume();
    }
  } else if (e.code === 'Space' && !e.target.matches('input, textarea')) {
    if (views.VIEW_DUEL_ARENA?.classList.contains('active')) {
      // 듀얼 아레나 화면에서 스페이스바 입력 시 턴 타이머 일시정지/재개 토글
      e.preventDefault();
      duelTurnTimer.togglePause();
    }
  }
});

// ============================================================================
// 2. VIEW_FORTUNE_TELLER (점쟁이 운명 선택)
// ============================================================================
function renderFortuneDeckMasterProposals() {
  document.querySelectorAll('[data-destiny-master-slot]').forEach((slotEl) => {
    const destiny = slotEl.getAttribute('data-destiny-master-slot');
    const faction = FACTION_OF_DESTINY[destiny] || 'BLUE';
    const masterId = DECK_MASTER_OF_FACTION[faction] || 'C_BLUE_01';
    const def = lookupCardDef(masterId);
    if (!def) return;
    slotEl.innerHTML = `
      <div class="tarot-master-card-frame">
        ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 1, true)}
      </div>
      <div class="tarot-master-meta">
        <span class="tarot-proposal-kicker">${svgIcon('crown')} 시작 덱 마스터</span>
        <strong class="tarot-proposal-name">${def.name}</strong>
        <span class="tarot-proposal-stat">Lv.${def.level ?? 1} · 공 ${def.attack} / 수 ${def.defense ?? def.health}</span>
      </div>
    `;
  });
}
renderFortuneDeckMasterProposals();

document.querySelectorAll('.tarot-card').forEach((cardEl) => {
  cardEl.addEventListener('click', () => {
    const destiny = cardEl.getAttribute('data-destiny');
    audio.playCardPlayImpact();
    engine.selectFortuneDestiny(destiny);
    syncRunPhaseView();
  });
});

// ============================================================================
// 3. FSM 상태와 View 동기화 라우터 (SPEC.md 2.2 & 3)
// ============================================================================
let isCpuTurnScheduled = false;

function toCanvasLocalRect(domRect) {
  const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0 };
  return {
    left: domRect.left - cRect.left,
    top: domRect.top - cRect.top,
    width: domRect.width,
    height: domRect.height,
  };
}

function captureBoardRects(boardSelector) {
  const map = new Map();
  document.querySelectorAll(`${boardSelector} .unit-field-card[data-instance-id]`).forEach((el) => {
    map.set(el.getAttribute('data-instance-id'), el.getBoundingClientRect());
  });
  return map;
}

function playCpuStepVisualEffects({ preCpuRects, prePlayerRects, prePlayerMetaRect, preCpuIds, prePlayerIds, preLastSpell, act, liveDuel }) {
  const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0, width: 1280, height: 800 };
  const playerGyEl = document.getElementById('player-graveyard');
  const cpuGyEl = document.getElementById('cpu-graveyard');
  const pGyRect = playerGyEl ? toCanvasLocalRect(playerGyEl.getBoundingClientRect()) : { left: 100, top: 650, width: 70, height: 90 };
  const cGyRect = cpuGyEl ? toCanvasLocalRect(cpuGyEl.getBoundingClientRect()) : { left: 1100, top: 100, width: 70, height: 90 };

  // 1. 새로 격발된 세트 마법 / 함정 쇼케이스
  if (liveDuel?.lastSpellTriggerResult && liveDuel.lastSpellTriggerResult !== preLastSpell) {
    const trig = liveDuel.lastSpellTriggerResult;
    const trigDef = lookupCardDef(trig.cardId);
    if (trigDef) {
      showCardPlayShowcase(trigDef, {
        actorLabel: trig.fizzled ? `마법 불발 (${trigDef.name})` : (trig.ownerSeat === 1 ? '상대 세트 마법 발동!' : '내 함정/마법 발동!'),
        isCpu: trig.ownerSeat === 1,
      });
    }
  }

  // 2. 사라진 플레이어 유닛 파괴 파편 & 영혼 궤적
  const postPlayerIds = new Set((liveDuel?.seats?.[0]?.board || []).map((u) => u.instanceId));
  prePlayerIds.forEach((id) => {
    if (!postPlayerIds.has(id)) {
      const deadRect = prePlayerRects.get(id);
      if (deadRect) {
        const localR = toCanvasLocalRect(deadRect);
        fxEngine.spawnCardShatter(localR, tunerSettings.shatterShards);
        fxEngine.spawnSoulWisp(localR, pGyRect, () => {});
        audio.playCardShatter();
      }
    }
  });

  if (!act) return;

  if (act.type === 'PLAY_CARD') {
    const cpuSeat = liveDuel?.seats?.[1];
    const summonedUnit = (cpuSeat?.board || []).find((u) => !preCpuIds.has(u.instanceId));
    if (summonedUnit) {
      audio.playCardPlayImpact();
      const unitEl = document.querySelector(`#cpu-board .unit-field-card[data-instance-id="${summonedUnit.instanceId}"]`);
      if (unitEl) {
        unitEl.classList.add('summon-slam-enter');
        const ur = unitEl.getBoundingClientRect();
        fxEngine.spawnSummonBurst(ur.left - cRect.left + ur.width / 2, ur.top - cRect.top + ur.height / 2, '#f43f5e', 105);
      }
      showCardPlayShowcase(summonedUnit, {
        actorLabel: '상대 몬스터 소환',
        isCpu: true,
        atk: summonedUnit.currentAttack,
        def: summonedUnit.currentDefense,
      });
    } else {
      const castCard = [...(cpuSeat?.graveyard || [])].reverse().find((c) => c.instanceId === act.cardInstanceId)
        || (cpuSeat?.graveyard || [])[cpuSeat.graveyard.length - 1];
      const spellDef = castCard ? lookupCardDef(castCard.cardId) : null;
      audio.playCardPlayImpact();
      const arenaEl = document.getElementById('arena-field');
      const ar = arenaEl ? arenaEl.getBoundingClientRect() : cRect;
      const sx = ar.left - cRect.left + ar.width / 2;
      const sy = ar.top - cRect.top + ar.height * 0.42;
      fxEngine.spawnSummonBurst(sx, sy, '#c084fc', 135);
      fxEngine.triggerScreenShake(7);
      if (spellDef) {
        showCardPlayShowcase(spellDef, { actorLabel: '상대 마법 발동', isCpu: true });
      }
    }
  } else if (act.type === 'SET_SPELL') {
    audio.playCardPickup();
    const slotEl = act.slotType === 'FIELD_RIGHT'
      ? document.getElementById('field-set-right')
      : act.slotType === 'FIELD_LEFT'
        ? document.getElementById('field-set-left')
        : document.querySelector('#cpu-board .unit-field-card') || document.getElementById('cpu-board');
    if (slotEl) {
      const sr = slotEl.getBoundingClientRect();
      fxEngine.spawnSummonBurst(sr.left - cRect.left + sr.width / 2, sr.top - cRect.top + sr.height / 2, '#818cf8', 68);
    }
  } else if (act.type === 'ATTACK') {
    const res = engine.lastAttackResult;
    if (!res) return;
    const atkPower = res.attackerAttack || 6;
    const isHeroHit = res.targetType === 'HERO' || !res.targetInstanceId;
    const rawTargetRect = isHeroHit
      ? prePlayerMetaRect
      : (prePlayerRects.get(res.targetInstanceId) || prePlayerMetaRect);
    if (!rawTargetRect) return;

    const tx = rawTargetRect.left - cRect.left + rawTargetRect.width / 2;
    const ty = rawTargetRect.top - cRect.top + rawTargetRect.height / 2;

    const atkEl = document.querySelector(`#cpu-board .unit-field-card[data-instance-id="${res.attackerInstanceId}"]`);
    if (atkEl) {
      atkEl.classList.add('summon-slam-enter');
    }

    fxEngine.triggerHitstop(tunerSettings.hitstopMs || 50);
    fxEngine.triggerScreenShake(Math.min(25, 4 + atkPower * 1.25));

    if (isHeroHit) {
      audio.playPlayerImpact(atkPower);
      fxEngine.spawnShockwave(tx, ty, 220, '#f43f5e');
      fxEngine.spawnImpactStarburst(tx, ty, 58, '#f43f5e');
      fxEngine.spawnPlayerDustPuff(tx, ty, rawTargetRect.width, rawTargetRect.height, 42);
      fxEngine.showFloatingText(tx, ty - 26, `-${res.damageDealt}`, '#ef4444', 32);
    } else {
      audio.playDamageHit();
      fxEngine.spawnShockwave(tx, ty, Math.min(130, 45 + atkPower * 3.5), '#f43f5e');
      fxEngine.spawnImpactStarburst(tx, ty, Math.min(45, 16 + atkPower * 2), atkPower > 10 ? '#f59e0b' : '#f43f5e');
      fxEngine.showFloatingText(tx, ty - 24, `-${res.damageDealt}`, '#ef4444', 28);
      const targetNowEl = document.querySelector(`#player-board .unit-field-card[data-instance-id="${res.targetInstanceId}"]`);
      if (targetNowEl) {
        targetNowEl.classList.add('slam-hit-target');
        setTimeout(() => targetNowEl.classList.remove('slam-hit-target'), 320);
      }
    }

    if (res.attackerDied) {
      const deadCpuRect = preCpuRects.get(res.attackerInstanceId);
      if (deadCpuRect) {
        const localCpu = toCanvasLocalRect(deadCpuRect);
        fxEngine.spawnCardShatter(localCpu, tunerSettings.shatterShards);
        fxEngine.spawnSoulWisp(localCpu, cGyRect, () => {});
        audio.playCardShatter();
      }
    }

    if (res.recoilDamage > 0) {
      const cpuMetaEl = document.getElementById('cpu-meta') || document.getElementById('cpu-seat');
      if (cpuMetaEl) {
        const mr = cpuMetaEl.getBoundingClientRect();
        const mx = mr.left - cRect.left + mr.width / 2;
        const my = mr.top - cRect.top + mr.height / 2;
        audio.playPlayerImpact(res.recoilDamage);
        fxEngine.spawnShockwave(mx, my, 160, '#f97316');
        fxEngine.showFloatingText(mx, my + 24, `반사 -${res.recoilDamage}`, '#f97316', 26);
      }
    }

    if (res.pierceDamage > 0 && prePlayerMetaRect) {
      audio.playPiercingBolt();
      fxEngine.spawnPiercingBolt(toCanvasLocalRect(rawTargetRect), toCanvasLocalRect(prePlayerMetaRect), res.pierceDamage, () => {
        audio.playPlayerImpact(res.pierceDamage);
      });
    }
  }
}

let cpuStepTimerId = null;
let runSessionEpoch = 0;

function scheduleCpuTurnIfNeeded(snap) {
  const duel = snap?.activeDuel;
  if (!duel || duel.status !== 'ONGOING' || duel.activeSeat !== 1) {
    return;
  }
  if (isCpuTurnScheduled) return;
  isCpuTurnScheduled = true;

  const epoch = runSessionEpoch;
  const cpuTempo = Math.max(0.4, Number(tunerSettings?.cpuTempo ?? 1.0));

  // 상대는 한 수씩 둔다: 사전 좌표 캡처 → 행동 실행 → 화면 갱신 → 상대 이펙트 & 쇼케이스 재생
  const step = () => {
    cpuStepTimerId = null;
    if (epoch !== runSessionEpoch) {
      isCpuTurnScheduled = false;
      return;
    }
    const preDuel = engine.getSnapshot().activeDuel;
    if (!preDuel || preDuel.status !== 'ONGOING' || preDuel.activeSeat !== 1) {
      isCpuTurnScheduled = false;
      return;
    }
    const preCpuRects = captureBoardRects('#cpu-board');
    const prePlayerRects = captureBoardRects('#player-board');
    const prePlayerMetaEl = document.getElementById('player-meta') || document.getElementById('player-seat');
    const prePlayerMetaRect = prePlayerMetaEl ? prePlayerMetaEl.getBoundingClientRect() : null;
    const preCpuIds = new Set((preDuel?.seats?.[1]?.board || []).map((u) => u.instanceId));
    const prePlayerIds = new Set((preDuel?.seats?.[0]?.board || []).map((u) => u.instanceId));
    const preLastSpell = preDuel?.lastSpellTriggerResult || null;

    let result = { done: true };
    try {
      result = engine.executeCpuStep();
    } catch (e) {
      console.error('[CPU Turn Error]', e);
    }

    if (epoch !== runSessionEpoch) {
      isCpuTurnScheduled = false;
      return;
    }

    syncRunPhaseView();
    const liveDuel = engine.getSnapshot().activeDuel;
    playCpuStepVisualEffects({
      preCpuRects,
      prePlayerRects,
      prePlayerMetaRect,
      preCpuIds,
      prePlayerIds,
      preLastSpell,
      act: result.action,
      liveDuel,
    });

    if (!result.done && liveDuel && liveDuel.status === 'ONGOING' && liveDuel.activeSeat === 1) {
      if (epoch !== runSessionEpoch) {
        isCpuTurnScheduled = false;
        return;
      }
      const baseDelay = result.action?.type === 'ATTACK' ? 980 : 760;
      cpuStepTimerId = setTimeout(step, Math.round(baseDelay / cpuTempo));
    } else {
      isCpuTurnScheduled = false;
      if (epoch === runSessionEpoch) {
        syncRunPhaseView();
      }
    }
  };
  const startDelay = Math.max(
    Math.round(750 / cpuTempo),
    Math.max(0, (duelTransitionUntil || 0) - Date.now() + 260)
  );
  cpuStepTimerId = setTimeout(step, startDelay);
}

// 듀얼 이벤트(효과 발동·파괴·피해 등)를 전투 로그로 옮긴다
let lastEventDuelId = null;
let lastEventIndex = 0;
const EVENT_LOG_CATEGORY = {
  attack: 'attack',
  destroy: 'destroy',
  spell: 'spell',
  trigger: 'spell',
  fizzle: 'spell',
  set: 'spell',
};
const COMBAT_KINDS = new Set(['attack', 'destroy', 'damage']);
const CARD_BY_NAME = new Map(CARD_CATALOG.map((c) => [c.name, c]));

function escapeLogHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTurnButtonTitle(duel) {
  const turnOwnerEl = document.getElementById('duel-turn-owner');
  if (!turnOwnerEl || !duel) return;
  const n = duel.turnNumber ?? 1;
  if (duel.activeSeat === 0) {
    turnOwnerEl.innerHTML = n <= 2 ? `턴 ${n} 종료<br><span class="turn-phase-sub">(준비)</span>` : `턴 ${n} 종료`;
  } else {
    turnOwnerEl.innerHTML = n <= 2 ? `상대 턴 ${n}<br><span class="turn-phase-sub">(준비)</span>` : `상대 턴 ${n}`;
  }
}

function extractCardIdsFromLog(text, ev = null) {
  const seen = new Set();
  const pushName = (name) => {
    const clean = String(name || '').replace(/[「」]/g, '').trim();
    const def = CARD_BY_NAME.get(clean);
    if (def && !seen.has(def.id)) seen.add(def.id);
  };
  if (ev?.params) {
    if (ev.params.card) pushName(ev.params.card);
    if (ev.params.attacker) pushName(ev.params.attacker);
    if (ev.params.target) pushName(ev.params.target);
    if (ev.params.cards) {
      String(ev.params.cards).split(',').forEach(pushName);
    }
  }
  const raw = String(text || '');
  const re = /「([^」]+)」/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    pushName(m[1]);
  }
  return Array.from(seen);
}

function renderLogTextWithCardRefs(text) {
  const raw = String(text || '');
  const re = /「([^」]+)」/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) out += escapeLogHtml(raw.slice(last, m.index));
    const cardName = m[1];
    const def = CARD_BY_NAME.get(cardName);
    if (def) {
      out += `<span class="log-card-ref" data-card-id="${escapeLogHtml(def.id)}">「${escapeLogHtml(cardName)}」</span>`;
    } else {
      out += escapeLogHtml(m[0]);
    }
    last = re.lastIndex;
  }
  if (last < raw.length) out += escapeLogHtml(raw.slice(last));
  return out;
}

let logCardHoverPreviewEl = null;
function ensureLogCardHoverPreview() {
  if (logCardHoverPreviewEl && document.body.contains(logCardHoverPreviewEl)) {
    return logCardHoverPreviewEl;
  }
  const el = document.createElement('div');
  el.id = 'log-card-hover-preview';
  el.className = 'log-card-hover-preview is-hidden';
  document.body.appendChild(el);
  logCardHoverPreviewEl = el;
  return el;
}

function hideLogCardHoverPreview() {
  if (!logCardHoverPreviewEl) return;
  logCardHoverPreviewEl.classList.add('is-hidden');
}

function showLogCardHoverPreview(cardIds, anchorEl) {
  const defs = (cardIds || [])
    .map((id) => lookupCardDef(id))
    .filter(Boolean)
    .slice(0, 2);
  if (defs.length === 0 || !anchorEl) {
    hideLogCardHoverPreview();
    return;
  }

  updateCardInspector(defs[0]);

  const preview = ensureLogCardHoverPreview();
  preview.innerHTML = defs
    .map((def) => {
      const cardHtml = generateCompositeCardHtml(
        { cardId: def.id, currentAttack: def.attack, currentDefense: def.defense },
        def.attack,
        def.defense,
        0.72,
        false
      );
      const isMonster = def.type === 'MONSTER';
      const effectHtml = isMonster && def.effect
        ? `<div class="log-hover-effect">${escapeLogHtml(def.effect)}</div>`
        : '';
      return `<div class="log-hover-card-item">${cardHtml}${effectHtml}</div>`;
    })
    .join('');

  preview.classList.remove('is-hidden');

  const anchorRect = anchorEl.getBoundingClientRect();
  const prevRect = preview.getBoundingClientRect();
  const pad = 12;

  let left;
  let top;
  if (anchorEl.closest('#combat-log-drawer')) {
    const popupRect = document.getElementById('combat-log-drawer').getBoundingClientRect();
    left = popupRect.left - prevRect.width - 14;
    if (left < pad) left = anchorRect.left - prevRect.width - 14;
    top = anchorRect.top + anchorRect.height / 2 - prevRect.height / 2;
  } else {
    left = anchorRect.left + anchorRect.width / 2 - prevRect.width / 2;
    top = anchorRect.top - prevRect.height - 12;
    if (top < pad) top = anchorRect.bottom + 12;
  }

  left = Math.max(pad, Math.min(window.innerWidth - prevRect.width - pad, left));
  top = Math.max(pad, Math.min(window.innerHeight - prevRect.height - pad, top));
  preview.style.left = `${Math.round(left)}px`;
  preview.style.top = `${Math.round(top)}px`;
}

function bindLogCardHoverDelegation() {
  const logHistory = document.getElementById('combat-log-history');
  if (logHistory && !logHistory.dataset.hoverBound) {
    logHistory.dataset.hoverBound = '1';
    logHistory.addEventListener('mouseover', (e) => {
      const refEl = e.target.closest('.log-card-ref');
      const entryEl = e.target.closest('.log-entry');
      if (refEl && refEl.dataset.cardId) {
        showLogCardHoverPreview([refEl.dataset.cardId], entryEl || refEl);
        return;
      }
      if (entryEl && entryEl.dataset.cardIds) {
        try {
          const ids = JSON.parse(entryEl.dataset.cardIds);
          if (Array.isArray(ids) && ids.length > 0) {
            showLogCardHoverPreview(ids, entryEl);
            return;
          }
        } catch {}
      }
      hideLogCardHoverPreview();
    });
    logHistory.addEventListener('mouseleave', hideLogCardHoverPreview);
    logHistory.addEventListener('scroll', hideLogCardHoverPreview, { passive: true });
  }

  const hudLogPill = document.getElementById('duel-turn-log-pill');
  if (hudLogPill && !hudLogPill.dataset.hoverBound) {
    hudLogPill.dataset.hoverBound = '1';
    hudLogPill.addEventListener('mouseover', (e) => {
      const refEl = e.target.closest('.log-card-ref');
      if (refEl && refEl.dataset.cardId) {
        showLogCardHoverPreview([refEl.dataset.cardId], hudLogPill);
        return;
      }
      if (hudLogPill.dataset.cardIds) {
        try {
          const ids = JSON.parse(hudLogPill.dataset.cardIds);
          if (Array.isArray(ids) && ids.length > 0) {
            showLogCardHoverPreview(ids, hudLogPill);
            return;
          }
        } catch {}
      }
    });
    hudLogPill.addEventListener('mouseleave', hideLogCardHoverPreview);
  }
}

bindLogCardHoverDelegation();

function formatCompactDuelEvent(ev) {
  if (!ev || !ev.key) return '';
  const p = ev.params || {};
  switch (ev.key) {
    case 'event.summon':
      return `${p.who} · 「${p.card}」 소환`;
    case 'event.tribute':
      return `${p.who} · 「${p.cards}」 제물`;
    case 'event.spell':
      return `${p.who} · 「${p.card}」 발동`;
    case 'event.set':
      return `${p.who} · 마법 세트`;
    case 'event.trigger':
      return `「${p.card}」 효과`;
    case 'event.fizzle':
      return `「${p.card}」 불발`;
    case 'event.attack':
      return `「${p.attacker}」 → ${p.target} 공격`;
    case 'event.destroyed':
      return `「${p.card}」 파괴`;
    case 'event.undying':
      return `「${p.card}」 불굴`;
    case 'event.heroDamage':
      return `${p.who} LP -${p.value}`;
    case 'event.heroHeal':
      return `${p.who} LP +${p.value}`;
    case 'event.shieldAbsorb':
      return `${p.who} 방어 ${p.value}`;
    case 'event.recoil':
      return `반사 ${p.who} -${p.value}`;
    case 'event.pierce':
      return `관통 -${p.value}`;
    case 'event.fatigue':
      return `탈진 ${p.who} -${p.value}`;
    case 'event.chanceFail':
      return `「${p.card}」 확률 실패`;
    case 'event.chanceWin':
      return `「${p.card}」 확률 성공`;
    case 'event.turnLimit':
      return `제한 턴 종료`;
    case 'event.suddenDeath':
      return `결전 ${p.who} -${p.value}`;
    default:
      return '';
  }
}

function compactHudLogText(rawText) {
  const s = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  let m;
  if ((m = s.match(/^⚔️?\s*(「[^」]+」)\s*\([^)]*\)\s*➔\s*(.+?)\s*공격!?$/))) {
    return `${m[1]} → ${m[2]} 공격`;
  }
  if ((m = s.match(/상대 본체에\s*(\d+)의 직접 타격/))) {
    return `상대 본체 LP -${m[1]}`;
  }
  if ((m = s.match(/세트 마법\s*(「[^」]+」)\s*발동\s*➔.*불발/))) {
    return `${m[1]} 세트 불발`;
  }
  if ((m = s.match(/세트 마법\s*(「[^」]+」)\s*발동/))) {
    return `${m[1]} 세트 발동`;
  }
  if ((m = s.match(/\[전투 파괴!?\].*?(「[^」]+」)/))) {
    return `${m[1]} 파괴`;
  }
  if ((m = s.match(/반사 피해\s*-(\d+)/))) {
    return `반사 피해 -${m[1]}`;
  }
  if ((m = s.match(/🛡️?\s*(「[^」]+」).*버텨냈습니다/))) {
    return `${m[1]} 수비 버팀`;
  }
  if ((m = s.match(/초과 피해\s*(\d+)/))) {
    return `관통 -${m[1]}`;
  }
  if ((m = s.match(/선공 결정.*?—\s*(플레이어|상대)/))) {
    return `선공: ${m[1] === '플레이어' ? '내 선공' : '상대 선공'}`;
  }
  return s
    .replace(/^[⚔️🩸🔮💨💀💥🛡️⚡⚠️]+\s*/u, '')
    .replace(/(을\(를\)|이\(가\))\s*(소환했습니다|발동했습니다|공격했습니다|파괴되었습니다)\.?$/, ' $2')
    .replace(/소환했습니다\.?$/, '소환')
    .replace(/발동했습니다\.?$/, '발동')
    .replace(/공격했습니다\.?$/, '공격')
    .replace(/파괴되었습니다\.?$/, '파괴')
    .replace(/세트했습니다\.?$/, '세트')
    .replace(/입었습니다\.?$/, '')
    .trim();
}

function flushDuelEventsToLog(duel, { skipCombat = false } = {}) {
  if (!duel || !Array.isArray(duel.events)) return;
  if (lastEventDuelId !== duel.duelId + duel.seed) {
    lastEventDuelId = duel.duelId + duel.seed;
    lastEventIndex = 0;
    updateTurnHudLastAction('대전 시작');
  }
  for (let i = lastEventIndex; i < duel.events.length; i++) {
    const ev = duel.events[i];
    if (ev.kind === 'mood') continue;
    if (skipCombat && COMBAT_KINDS.has(ev.kind)) continue;
    const fullText = t(ev.key, ev.params);
    const compact = formatCompactDuelEvent(ev) || compactHudLogText(fullText);
    const cardIds = extractCardIdsFromLog(compact, ev);
    appendCombatLog(EVENT_LOG_CATEGORY[ev.kind] || 'system', compact, {
      alreadyCompact: true,
      fullTitle: fullText,
      cardIds,
    });
  }
  lastEventIndex = duel.events.length;
}

function updateTurnHudLastAction(rawText, fullTitle = null, cardIds = null) {
  const el = document.getElementById('duel-turn-last-log');
  const pillEl = document.getElementById('duel-turn-log-pill');
  if (!el || !rawText) return;
  const clean = compactHudLogText(rawText);
  if (!clean) return;
  const ids = Array.isArray(cardIds) ? cardIds : extractCardIdsFromLog(clean);
  el.innerHTML = renderLogTextWithCardRefs(clean);
  const resolvedTitle = fullTitle ? String(fullTitle).replace(/\s+/g, ' ').trim() : String(rawText).replace(/\s+/g, ' ').trim();
  el.title = resolvedTitle;
  if (pillEl) {
    pillEl.title = resolvedTitle;
    if (ids.length > 0) {
      pillEl.dataset.cardIds = JSON.stringify(ids);
      pillEl.classList.add('has-card-preview');
    } else {
      delete pillEl.dataset.cardIds;
      pillEl.classList.remove('has-card-preview');
    }
  }
}

let previousUiRunPhase = null;
let previousUiRunId = null;
let lastStartedDuelKey = null;
let lastNotifiedCheckpointKey = null;
let checkpointEncounterToastTimer = null;
let duelVictoryOverlayTimer = null;
let duelStartOverlayTimer = null;
let duelTransitionTimer = null;
let duelTransitionUntil = 0;
let isDuelEndTransitionPending = false;
const DUEL_COMBAT_PHASES = new Set(['DUEL_ENCOUNTER', 'STAGE_1_DUEL_1', 'STAGE_3_DUEL_2', 'STAGE_5_FINAL_BOSS']);

/** 런 경계(새 게임, 이어하기, 메인 메뉴 복귀, 포기)마다 UI 전이 상태와 잔여 오버레이/타이머를 초기화한다. */
function resetRunUiTransitionState(initialPhase = null, { clearTimers = true } = {}) {
  runSessionEpoch += 1;
  if (clearTimers) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (cpuStepTimerId) {
      clearTimeout(cpuStepTimerId);
      cpuStepTimerId = null;
    }
    if (duelTransitionTimer) {
      clearTimeout(duelTransitionTimer);
      duelTransitionTimer = null;
    }
    if (duelVictoryOverlayTimer) {
      clearTimeout(duelVictoryOverlayTimer);
      duelVictoryOverlayTimer = null;
    }
    if (duelStartOverlayTimer) {
      clearTimeout(duelStartOverlayTimer);
      duelStartOverlayTimer = null;
    }
    if (checkpointEncounterToastTimer) {
      clearTimeout(checkpointEncounterToastTimer);
      checkpointEncounterToastTimer = null;
    }
  }
  isDuelEndTransitionPending = false;
  isCpuTurnScheduled = false;
  deckEditorBaseline = null;
  isAttackAnimating = false;
  duelTransitionUntil = 0;
  previousUiRunPhase = initialPhase;
  previousUiRunId = engine?.state?.runId || null;
  lastStartedDuelKey = null;
  lastNotifiedCheckpointKey = null;
  lastLoggedTurnKey = null;
  lastEventDuelId = null;
  lastEventIndex = 0;

  document.getElementById('view-duel-arena')?.classList.remove('is-arena-blurred', 'is-defeat-desaturate');
  document.getElementById('duel-victory-overlay')?.classList.remove('is-visible');
  document.getElementById('duel-defeat-overlay')?.classList.remove('is-visible');
  document.getElementById('duel-start-overlay')?.classList.remove('is-visible');
  document.getElementById('checkpoint-encounter-toast')?.classList.remove('is-visible');
  document.body.classList.remove('run-victory');
}

function triggerCheckpointEncounterToast(snap) {
  const toast = document.getElementById('checkpoint-encounter-toast');
  if (!toast || !snap?.nextEncounterInfo) return;
  const key = `${snap.runId || 'run'}_R${snap.roundNumber || 1}`;
  if (lastNotifiedCheckpointKey === key) return;
  lastNotifiedCheckpointKey = key;

  const enc = snap.nextEncounterInfo;
  const subEl = document.getElementById('checkpoint-toast-sub');
  const metaEl = document.getElementById('checkpoint-toast-meta');
  if (subEl) subEl.textContent = `라운드 ${snap.roundNumber || 1} 도전자 출현 · 골목길에서 대전을 시작할 수 있습니다.`;
  if (metaEl) metaEl.textContent = `${enc.stars || '★☆☆☆☆'} · +${(enc.rewardGold || 500).toLocaleString()}원`;

  toast.classList.remove('is-visible');
  void toast.offsetWidth;
  toast.classList.add('is-visible');
  if (checkpointEncounterToastTimer) clearTimeout(checkpointEncounterToastTimer);
  checkpointEncounterToastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 3600);
}

function triggerDuelStartCutIn(cpuName = '상대 듀얼리스트', playerName = '플레이어') {
  const overlay = document.getElementById('duel-start-overlay');
  const pEl = document.getElementById('duel-start-player-name');
  const cEl = document.getElementById('duel-start-cpu-name');
  const arenaEl = document.getElementById('view-duel-arena');
  if (pEl) pEl.textContent = playerName;
  if (cEl) cEl.textContent = cpuName;
  duelTransitionUntil = Date.now() + 1450;
  if (arenaEl) arenaEl.classList.add('is-arena-blurred');
  if (overlay) {
    overlay.classList.remove('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
    if (duelStartOverlayTimer) clearTimeout(duelStartOverlayTimer);
    duelStartOverlayTimer = setTimeout(() => {
      overlay.classList.remove('is-visible');
      arenaEl?.classList.remove('is-arena-blurred');
    }, 1400);
  }
}

function triggerDuelVictoryFX(headline = 'VICTORY!', subtext = '결투에서 승리했습니다', durationMs = 1350) {
  audio.playVictoryJingle();
  const rect = fxCanvas ? fxCanvas.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  fxEngine.spawnVictoryCelebration((rect.width || window.innerWidth) * 0.5, (rect.height || window.innerHeight) * 0.44);

  const overlay = document.getElementById('duel-victory-overlay');
  const titleEl = document.getElementById('duel-victory-title');
  const subEl = document.getElementById('duel-victory-sub');
  const arenaEl = document.getElementById('view-duel-arena');
  if (arenaEl) arenaEl.classList.add('is-arena-blurred');
  if (overlay) {
    if (titleEl) titleEl.textContent = headline;
    if (subEl) subEl.textContent = subtext;
    overlay.classList.remove('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
    if (duelVictoryOverlayTimer) clearTimeout(duelVictoryOverlayTimer);
    duelVictoryOverlayTimer = setTimeout(() => {
      overlay.classList.remove('is-visible');
      arenaEl?.classList.remove('is-arena-blurred');
    }, durationMs);
  }
}

function triggerDuelDefeatFX(durationMs = 1500) {
  const overlay = document.getElementById('duel-defeat-overlay');
  const arenaEl = document.getElementById('view-duel-arena');
  if (arenaEl) arenaEl.classList.add('is-defeat-desaturate');
  if (overlay) {
    overlay.classList.remove('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
  }
  return durationMs;
}

function applyRunPhaseScreen(snap) {
  const arenaEl = document.getElementById('view-duel-arena');
  arenaEl?.classList.remove('is-arena-blurred', 'is-defeat-desaturate');
  document.getElementById('duel-victory-overlay')?.classList.remove('is-visible');
  document.getElementById('duel-defeat-overlay')?.classList.remove('is-visible');

  switch (snap.phase) {
    case 'STAGE_0_FORTUNE':
      lastNotifiedCheckpointKey = null;
      switchView('VIEW_FORTUNE_TELLER');
      break;

    case 'STAGE_CHECKPOINT':
      switchView('VIEW_CHECKPOINT');
      renderCheckpointView(snap);
      triggerCheckpointEncounterToast(snap);
      break;

    case 'DUEL_ENCOUNTER':
    case 'STAGE_1_DUEL_1':
    case 'STAGE_3_DUEL_2':
    case 'STAGE_5_FINAL_BOSS': {
      switchView('VIEW_DUEL_ARENA');
      renderDuelArena(snap);
      const duelKey = snap.activeDuel ? `${snap.activeDuel.duelId}_${snap.activeDuel.seed}` : null;
      if (duelKey && duelKey !== lastStartedDuelKey) {
        lastStartedDuelKey = duelKey;
        const cpuName = snap.activeDuel?.seats?.[1]?.duelistName || '상대 듀얼리스트';
        triggerDuelStartCutIn(cpuName, '플레이어');
      }
      scheduleCpuTurnIfNeeded(snap);
      break;
    }

    case 'STAGE_2_REWARD_PACK':
      switchView('VIEW_PACK_OPENING');
      renderPackOpening(snap);
      break;

    case 'STAGE_4_MERCHANT_EVENT':
      switchView('VIEW_MERCHANT_EVENT');
      renderMerchantEvent(snap);
      break;

    case 'RUN_VICTORY':
      switchView('VIEW_RUN_SUMMARY');
      renderRunSummary(snap, true);
      break;

    case 'RUN_FAILED':
      switchView('VIEW_RUN_SUMMARY');
      renderRunSummary(snap, false);
      break;

    case 'IDLE':
    default:
      lastStartedDuelKey = null;
      lastNotifiedCheckpointKey = null;
      switchView('VIEW_TITLE_LOBBY');
      break;
  }
}

function syncRunPhaseView({ skipOutcomeTransition = false } = {}) {
  const snap = engine.getSnapshot();
  const sameRun = Boolean(previousUiRunId && snap.runId && previousUiRunId === snap.runId);
  const wasDuelPhase = !skipOutcomeTransition && sameRun && DUEL_COMBAT_PHASES.has(previousUiRunPhase);
  previousUiRunPhase = snap.phase;
  previousUiRunId = snap.runId || null;
  scheduleRunSave();

  const isVictoryTransition = wasDuelPhase && (snap.phase === 'STAGE_CHECKPOINT' || snap.phase === 'STAGE_2_REWARD_PACK' || snap.phase === 'RUN_VICTORY');
  const isDefeatTransition = wasDuelPhase && snap.phase === 'RUN_FAILED';

  if (isVictoryTransition) {
    if (isDuelEndTransitionPending) return;
    isDuelEndTransitionPending = true;
    // 최종 전장 상태 업데이트 후 전장 위 블러 + 일시 정지로 승리 연출 감상 시간 확보
    if (snap.activeDuel) renderDuelArena(snap);
    const headline = snap.phase === 'RUN_VICTORY' ? 'VICTORY' : 'VICTORY!';
    const subtext = snap.phase === 'RUN_VICTORY'
      ? '최종 보스를 물리치고 여정을 완주했습니다!'
      : snap.phase === 'STAGE_CHECKPOINT'
        ? `대전 승리 · 라운드 ${snap.checkpointRound || snap.roundNumber || 1}`
        : '대전에서 승리했습니다!';
    const holdMs = 1350;
    triggerDuelVictoryFX(headline, subtext, holdMs);
    if (duelTransitionTimer) clearTimeout(duelTransitionTimer);
    duelTransitionTimer = setTimeout(() => {
      isDuelEndTransitionPending = false;
      applyRunPhaseScreen(engine.getSnapshot());
    }, holdMs);
    return;
  }

  if (isDefeatTransition) {
    if (isDuelEndTransitionPending) return;
    isDuelEndTransitionPending = true;
    if (snap.activeDuel) renderDuelArena(snap);
    const holdMs = triggerDuelDefeatFX(1500);
    if (duelTransitionTimer) clearTimeout(duelTransitionTimer);
    duelTransitionTimer = setTimeout(() => {
      isDuelEndTransitionPending = false;
      applyRunPhaseScreen(engine.getSnapshot());
    }, holdMs);
    return;
  }

  if (duelTransitionTimer) {
    clearTimeout(duelTransitionTimer);
    duelTransitionTimer = null;
    isDuelEndTransitionPending = false;
  }
  applyRunPhaseScreen(snap);
}

// ============================================================================
// LJack Game Feel Live Tuner (기둥 5 & F1/F2 핫키)
// ============================================================================
const defaultTunerSettings = {
  shakeMult: 1.0,
  slamSpeed: 1.0,
  inertiaMult: 1.0,
  shatterShards: 18,
  pierceSpeed: 1.0,
  hitstopMs: 50,
  transitionMs: 260,
  ambientFxMult: 1.0,
  cpuTempo: 1.0,
  showcaseEnabled: true,
  showcaseX: 17,
  showcaseY: 48,
  showcaseDurationMs: 1500,
  showcaseScale: 1.15,
};

let tunerSettings = { ...defaultTunerSettings };
try {
  const saved = localStorage.getItem('duel_rogue_tuner_settings_v1');
  if (saved) {
    tunerSettings = { ...defaultTunerSettings, ...JSON.parse(saved) };
  }
} catch (e) {}

fxEngine.updateTuner(tunerSettings);
applyShowcaseTunerVars();
document.documentElement.style.setProperty('--view-transition-ms', `${tunerSettings.transitionMs ?? 260}ms`);

const overlayLiveTuner = document.getElementById('overlay-live-tuner');

function syncTunerInputs() {
  const setSlider = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const setText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setSlider('slider-shake', tunerSettings.shakeMult);
  setSlider('slider-slam-speed', tunerSettings.slamSpeed);
  setSlider('slider-inertia', tunerSettings.inertiaMult);
  setSlider('slider-shards', tunerSettings.shatterShards);
  setSlider('slider-pierce-speed', tunerSettings.pierceSpeed);
  setSlider('slider-hitstop', tunerSettings.hitstopMs);
  setSlider('slider-transition-ms', tunerSettings.transitionMs);
  setSlider('slider-ambient-fx', tunerSettings.ambientFxMult);
  setSlider('slider-cpu-tempo', tunerSettings.cpuTempo);
  setSlider('slider-showcase-x', tunerSettings.showcaseX);
  setSlider('slider-showcase-y', tunerSettings.showcaseY);
  setSlider('slider-showcase-ms', tunerSettings.showcaseDurationMs);
  setSlider('slider-showcase-scale', tunerSettings.showcaseScale);

  const checkShowcase = document.getElementById('check-showcase-enabled');
  if (checkShowcase) checkShowcase.checked = tunerSettings.showcaseEnabled !== false;

  setText('val-shake', `${Number(tunerSettings.shakeMult).toFixed(1)}x`);
  setText('val-slam-speed', `${Number(tunerSettings.slamSpeed).toFixed(1)}x`);
  setText('val-inertia', `${Number(tunerSettings.inertiaMult).toFixed(1)}x`);
  setText('val-shards', `${tunerSettings.shatterShards}개`);
  setText('val-pierce-speed', `${Number(tunerSettings.pierceSpeed).toFixed(1)}x`);
  setText('val-hitstop', `${tunerSettings.hitstopMs}ms`);
  setText('val-transition-ms', `${tunerSettings.transitionMs}ms`);
  setText('val-ambient-fx', `${Number(tunerSettings.ambientFxMult).toFixed(1)}x`);
  setText('val-cpu-tempo', `${Number(tunerSettings.cpuTempo).toFixed(1)}x`);
  setText('val-showcase-x', `${tunerSettings.showcaseX}%`);
  setText('val-showcase-y', `${tunerSettings.showcaseY}%`);
  setText('val-showcase-ms', `${tunerSettings.showcaseDurationMs}ms`);
  setText('val-showcase-scale', `${Number(tunerSettings.showcaseScale).toFixed(2)}x`);

  document.documentElement.style.setProperty('--view-transition-ms', `${tunerSettings.transitionMs}ms`);
  applyShowcaseTunerVars();
  fxEngine.updateTuner(tunerSettings);
}

function toggleTunerModal() {
  if (!overlayLiveTuner) return;
  overlayLiveTuner.classList.toggle('active');
  if (overlayLiveTuner.classList.contains('active')) {
    syncTunerInputs();
  }
}

function saveTunerSettings() {
  try {
    localStorage.setItem('duel_rogue_tuner_settings_v1', JSON.stringify(tunerSettings));
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = '전투 연출 설정이 저장되었습니다.';
  } catch (e) {}
  if (overlayLiveTuner) overlayLiveTuner.classList.remove('active');
}

window.__TOGGLE_LIVE_TUNER = toggleTunerModal;
window.__SAVE_LIVE_TUNER = saveTunerSettings;

document.getElementById('btn-toggle-tuner')?.addEventListener('click', toggleTunerModal);
document.getElementById('btn-close-tuner')?.addEventListener('click', () => overlayLiveTuner?.classList.remove('active'));
document.getElementById('btn-tuner-to-playground')?.addEventListener('click', () => {
  overlayLiveTuner?.classList.remove('active');
  window.__TOGGLE_SLAM_PLAYGROUND?.();
});
document.getElementById('btn-tuner-save')?.addEventListener('click', saveTunerSettings);
document.getElementById('btn-tuner-reset')?.addEventListener('click', () => {
  tunerSettings = { ...defaultTunerSettings };
  syncTunerInputs();
});

document.getElementById('check-showcase-enabled')?.addEventListener('change', (e) => {
  tunerSettings.showcaseEnabled = e.target.checked;
});

document.getElementById('btn-showcase-preview')?.addEventListener('click', () => {
  const sampleCard = lookupCardDef('C_BLUE_05') || lookupCardDef('C_BLUE_01');
  if (sampleCard) {
    const prevEnabled = tunerSettings.showcaseEnabled;
    tunerSettings.showcaseEnabled = true;
    showCardPlayShowcase(sampleCard, { actorLabel: '카드 팝업 미리보기', isCpu: false });
    tunerSettings.showcaseEnabled = prevEnabled;
  }
});

const TUNER_SLIDER_MAP = [
  ['slider-shake', 'val-shake', 'shakeMult', (v) => `${v.toFixed(1)}x`, false],
  ['slider-slam-speed', 'val-slam-speed', 'slamSpeed', (v) => `${v.toFixed(1)}x`, false],
  ['slider-inertia', 'val-inertia', 'inertiaMult', (v) => `${v.toFixed(1)}x`, false],
  ['slider-shards', 'val-shards', 'shatterShards', (v) => `${v}개`, true],
  ['slider-pierce-speed', 'val-pierce-speed', 'pierceSpeed', (v) => `${v.toFixed(1)}x`, false],
  ['slider-hitstop', 'val-hitstop', 'hitstopMs', (v) => `${v}ms`, true],
  ['slider-transition-ms', 'val-transition-ms', 'transitionMs', (v) => `${v}ms`, true],
  ['slider-ambient-fx', 'val-ambient-fx', 'ambientFxMult', (v) => `${v.toFixed(1)}x`, false],
  ['slider-cpu-tempo', 'val-cpu-tempo', 'cpuTempo', (v) => `${v.toFixed(1)}x`, false],
  ['slider-showcase-x', 'val-showcase-x', 'showcaseX', (v) => `${v}%`, true],
  ['slider-showcase-y', 'val-showcase-y', 'showcaseY', (v) => `${v}%`, true],
  ['slider-showcase-ms', 'val-showcase-ms', 'showcaseDurationMs', (v) => `${v}ms`, true],
  ['slider-showcase-scale', 'val-showcase-scale', 'showcaseScale', (v) => `${v.toFixed(2)}x`, false],
];

TUNER_SLIDER_MAP.forEach(([sliderId, valId, prop, fmt, isInt]) => {
  const el = document.getElementById(sliderId);
  el?.addEventListener('input', (e) => {
    const val = isInt ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
    tunerSettings[prop] = val;
    const label = document.getElementById(valId);
    if (label) label.textContent = fmt(val);
    document.documentElement.style.setProperty('--view-transition-ms', `${tunerSettings.transitionMs}ms`);
    applyShowcaseTunerVars();
    fxEngine.updateTuner(tunerSettings);
  });
});

// ============================================================================
// [F4] 카드 레어도 비주얼 실시간 튜너 (별도 분리 모달)
// ============================================================================
const overlayRarityTuner = document.getElementById('overlay-rarity-tuner');
let activeRarityTab = 'LEGENDARY';
let activeRarityPreviewType = 'MONSTER';

function getRaritySampleDef(tier, type) {
  const found = DEFAULT_CARD_CATALOG.find(
    (c) => normalizeRarityKey(c.rarity) === tier && (type === 'SPELL' ? c.type === 'SPELL' : c.type === 'MONSTER')
  );
  if (found) return { ...found, rarity: tier };
  const base = type === 'SPELL' ? (lookupCardDef('C_BLUE_02') || DEFAULT_CARD_CATALOG[1]) : (lookupCardDef('C_BLUE_03') || DEFAULT_CARD_CATALOG[0]);
  return { ...base, rarity: tier };
}

function renderRarityTunerPreview() {
  const mount = document.getElementById('rarity-preview-card-mount');
  const caption = document.getElementById('rarity-preview-caption');
  if (!mount) return;
  const tierCfg = rarityConfig[activeRarityTab] || rarityConfig.COMMON;
  const sampleDef = getRaritySampleDef(activeRarityTab, activeRarityPreviewType);
  mount.innerHTML = generateCompositeCardHtml(sampleDef, sampleDef.attack, sampleDef.defense ?? sampleDef.health, 0.95, false);
  if (caption) {
    const info = RARITY_PRESET_INFO[tierCfg.preset];
    caption.textContent = `${RARITY_LABELS_KO[activeRarityTab] || activeRarityTab} · ${info ? info.label : tierCfg.preset}`;
  }
}

function syncRarityTunerControls() {
  const tierCfg = rarityConfig[activeRarityTab] || rarityConfig.COMMON;
  const sel = document.getElementById('sel-rarity-preset');
  const colorInput = document.getElementById('input-rarity-name-color');
  const artFxSlider = document.getElementById('slider-rarity-art-fx');
  const glowSlider = document.getElementById('slider-rarity-glow');
  const nameGlowSlider = document.getElementById('slider-rarity-name-glow');

  if (sel) sel.value = tierCfg.preset || 'NONE';
  if (colorInput) colorInput.value = tierCfg.nameColor || '#1a0f05';
  if (artFxSlider) artFxSlider.value = String(tierCfg.artFx ?? 0);
  if (glowSlider) glowSlider.value = String(tierCfg.glow ?? 0);
  if (nameGlowSlider) nameGlowSlider.value = String(tierCfg.nameGlow ?? 0);

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setText('val-rarity-name-color', tierCfg.nameColor || '#1a0f05');
  setText('val-rarity-art-fx', `${Number(tierCfg.artFx ?? 0).toFixed(1)}x`);
  setText('val-rarity-glow', `${Number(tierCfg.glow ?? 0).toFixed(1)}x`);
  setText('val-rarity-name-glow', `${Number(tierCfg.nameGlow ?? 0).toFixed(1)}x`);

  document.querySelectorAll('#rarity-tuner-tabs .rarity-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-rarity') === activeRarityTab);
  });

  applyRarityConfigToRoot(rarityConfig);
  renderRarityTunerPreview();
}

function toggleRarityTunerModal() {
  if (!overlayRarityTuner) return;
  overlayRarityTuner.classList.toggle('active');
  if (overlayRarityTuner.classList.contains('active')) {
    syncRarityTunerControls();
  }
}

window.__TOGGLE_RARITY_TUNER = toggleRarityTunerModal;

document.getElementById('btn-toggle-rarity-tuner')?.addEventListener('click', toggleRarityTunerModal);
document.getElementById('btn-close-rarity-tuner')?.addEventListener('click', () => overlayRarityTuner?.classList.remove('active'));

document.querySelectorAll('#rarity-tuner-tabs .rarity-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playCardPickup();
    activeRarityTab = normalizeRarityKey(btn.getAttribute('data-rarity'));
    syncRarityTunerControls();
  });
});

document.getElementById('btn-rarity-preview-monster')?.addEventListener('click', (e) => {
  activeRarityPreviewType = 'MONSTER';
  e.currentTarget.classList.add('active');
  document.getElementById('btn-rarity-preview-spell')?.classList.remove('active');
  renderRarityTunerPreview();
});
document.getElementById('btn-rarity-preview-spell')?.addEventListener('click', (e) => {
  activeRarityPreviewType = 'SPELL';
  e.currentTarget.classList.add('active');
  document.getElementById('btn-rarity-preview-monster')?.classList.remove('active');
  renderRarityTunerPreview();
});

document.getElementById('sel-rarity-preset')?.addEventListener('change', (e) => {
  const preset = e.target.value;
  const info = RARITY_PRESET_INFO[preset];
  const target = rarityConfig[activeRarityTab];
  target.preset = preset;
  if (info) {
    target.artFx = info.artFx;
    target.glow = info.glow;
    target.nameGlow = info.nameGlow;
  }
  syncRarityTunerControls();
});

document.getElementById('input-rarity-name-color')?.addEventListener('input', (e) => {
  rarityConfig[activeRarityTab].nameColor = e.target.value;
  rarityConfig[activeRarityTab].accentColor = e.target.value;
  syncRarityTunerControls();
});

document.querySelectorAll('#rarity-name-swatches .swatch-btn').forEach((sw) => {
  sw.addEventListener('click', () => {
    const c = sw.getAttribute('data-color');
    rarityConfig[activeRarityTab].nameColor = c;
    rarityConfig[activeRarityTab].accentColor = c;
    if (rarityConfig[activeRarityTab].preset === 'NONE') {
      rarityConfig[activeRarityTab].preset = 'NAME_ONLY';
    }
    syncRarityTunerControls();
  });
});

[
  ['slider-rarity-art-fx', 'artFx'],
  ['slider-rarity-glow', 'glow'],
  ['slider-rarity-name-glow', 'nameGlow'],
].forEach(([id, prop]) => {
  document.getElementById(id)?.addEventListener('input', (e) => {
    rarityConfig[activeRarityTab][prop] = parseFloat(e.target.value);
    syncRarityTunerControls();
  });
});

document.getElementById('btn-rarity-reset')?.addEventListener('click', () => {
  rarityConfig = cloneDefaultRarityConfig();
  saveRarityConfig(rarityConfig);
  syncRarityTunerControls();
});

document.getElementById('btn-rarity-save')?.addEventListener('click', () => {
  saveRarityConfig(rarityConfig);
  applyRarityConfigToRoot(rarityConfig);
  overlayRarityTuner?.classList.remove('active');
  const logEl = document.getElementById('duel-narrative-log');
  if (logEl) logEl.textContent = '카드 비주얼 설정이 저장되었습니다.';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F4') {
    e.preventDefault();
    toggleRarityTunerModal();
  }
});

// ============================================================================
// 4. [Canvas 60FPS] 대상 카드 3색 오라 하이라이트 (녹색/보라/빨강)
// ============================================================================
function resolveHighlightTargetsForCard(duel, cardDef) {
  const green = new Set();
  const purple = new Set();
  const red = new Set();
  if (!duel || !cardDef) return { green, purple, red };

  const isMonster = cardDef.type === 'MONSTER';
  const abilities = (cardDef.abilities || []).filter((ab) => !isMonster || ab.trigger === 'ON_SUMMON');
  if (abilities.length === 0) return { green, purple, red };

  const player = duel.seats[0];
  const cpu = duel.seats[1];
  const playerEls = new Map(
    Array.from(document.querySelectorAll('#player-board .unit-field-card')).map((el) => [el.getAttribute('data-instance-id'), el])
  );
  const cpuEls = new Map(
    Array.from(document.querySelectorAll('#cpu-board .unit-field-card')).map((el) => [el.getAttribute('data-instance-id'), el])
  );
  const playerSeatEl = document.getElementById('player-seat');
  const cpuSeatEl = document.getElementById('cpu-seat');

  const HARMFUL_OPS = new Set(['DAMAGE_UNIT', 'DEBUFF', 'FREEZE', 'SILENCE', 'DESTROY', 'DAMAGE_HERO', 'DISCARD_RANDOM']);
  const BENEFICIAL_OPS = new Set(['BUFF', 'HEAL_UNIT', 'HEAL_HERO', 'BARRIER', 'EXTRA_SUMMON', 'REVIVE', 'DRAW', 'SUMMON_TOKEN']);

  for (const ab of abilities) {
    const isMixedChance = ab.chance != null && ab.chance < 1;
    const allEffects = [...(ab.effects || []), ...(ab.elseEffects || [])];
    for (const ef of allEffects) {
      const tgt = ef.target || '';
      const nonDivineEnemies = cpu.board.filter((u) => !hasKw(u, 'DIVINE') && (!ef.maxLevel || u.level <= ef.maxLevel));
      let matchedEls = [];

      if (tgt === 'ALLY_ALL' || tgt === 'ALLY_OTHERS' || tgt === 'ALLY_RANDOM') {
        matchedEls = player.board.map((u) => playerEls.get(u.instanceId)).filter(Boolean);
      } else if (tgt === 'ALLY_WEAKEST' && player.board.length > 0) {
        const sorted = [...player.board].sort((a, b) => a.currentDefense - b.currentDefense);
        const el = playerEls.get(sorted[0].instanceId);
        if (el) matchedEls = [el];
      } else if (tgt === 'ENEMY_ALL' || tgt === 'ENEMY_RANDOM') {
        matchedEls = nonDivineEnemies.map((u) => cpuEls.get(u.instanceId)).filter(Boolean);
      } else if ((tgt === 'ENEMY_STRONGEST' || tgt === 'ATTACKER' || tgt === 'SUMMONED') && nonDivineEnemies.length > 0) {
        const sorted = [...nonDivineEnemies].sort((a, b) => b.currentAttack - a.currentAttack || b.level - a.level);
        const el = cpuEls.get(sorted[0].instanceId);
        if (el) matchedEls = [el];
      } else if (tgt === 'ENEMY_WEAKEST' && nonDivineEnemies.length > 0) {
        const sorted = [...nonDivineEnemies].sort((a, b) => a.currentDefense - b.currentDefense);
        const el = cpuEls.get(sorted[0].instanceId);
        if (el) matchedEls = [el];
      } else if (tgt === 'ENEMY_HIGHEST_LEVEL' && nonDivineEnemies.length > 0) {
        const sorted = [...nonDivineEnemies].sort((a, b) => b.level - a.level || b.currentAttack - a.currentAttack);
        const el = cpuEls.get(sorted[0].instanceId);
        if (el) matchedEls = [el];
      } else if (ef.op === 'DAMAGE_HERO' && cpuSeatEl) {
        matchedEls = [cpuSeatEl];
      } else if ((ef.op === 'HEAL_HERO' || ef.op === 'BARRIER' || ef.op === 'EXTRA_SUMMON' || ef.op === 'DRAW') && playerSeatEl) {
        matchedEls = [playerSeatEl];
      } else if (ef.op === 'DISCARD_RANDOM' && cpuSeatEl) {
        matchedEls = [cpuSeatEl];
      }

      if (matchedEls.length === 0) continue;
      const isHarm = HARMFUL_OPS.has(ef.op);
      const isBene = BENEFICIAL_OPS.has(ef.op);
      const bucket = isMixedChance ? purple : isHarm && !isBene ? red : isBene ? green : purple;
      matchedEls.forEach((el) => bucket.add(el));
    }
  }

  // 한 대상이 유리·해로운 효과에 동시에 걸리면 보라색(혼합)으로 승격
  for (const el of [...green]) {
    if (red.has(el)) {
      green.delete(el);
      red.delete(el);
      purple.add(el);
    }
  }
  return { green, purple, red };
}

function highlightTargets(cardDef) {
  clearTargetHighlights();
  if (!cardDef) return;
  const duel = engine.getSnapshot()?.activeDuel;
  const { green, purple, red } = resolveHighlightTargetsForCard(duel, cardDef);

  const greenArr = [...green];
  const purpleArr = [...purple];
  const redArr = [...red];

  greenArr.forEach((el) => el.classList.add('aura-beneficial'));
  purpleArr.forEach((el) => el.classList.add('aura-purple'));
  redArr.forEach((el) => el.classList.add('aura-harmful'));

  if (greenArr.length > 0) fxEngine.setTargetAura(greenArr, 'GREEN', true);
  if (purpleArr.length > 0) fxEngine.setTargetAura(purpleArr, 'PURPLE', true);
  if (redArr.length > 0) fxEngine.setTargetAura(redArr, 'RED', true);
}

function formatAttackOutcomeBadge(prev) {
  if (!prev) return null;
  if (!prev.canAttack) {
    const label = prev.reason?.includes('도발') ? '도발 우선' : prev.reason?.includes('은신') ? '은신' : '대상 불가';
    return { cls: 'outcome-blocked', text: `🚫 ${label}` };
  }
  if (prev.targetType === 'HERO') {
    return {
      cls: 'outcome-kill hero-direct-pill',
      text: prev.isLethal ? `🏆 킬각! -${prev.heroDamage}` : `⚔️ 직공 -${prev.heroDamage}`,
    };
  }
  if (prev.canKill) {
    return {
      cls: 'outcome-kill',
      text: prev.pierceDamage > 0 ? `⚔️ 처치 · 관통 -${prev.pierceDamage}` : '⚔️ 처치 가능',
    };
  }
  if (prev.survivesUndying) {
    return { cls: 'outcome-survive', text: '🛡️ 불굴 (1 생존)' };
  }
  if (prev.recoilDamage > 0) {
    const extra = prev.attackerDies ? ' · 반격사' : prev.retaliateDamage > 0 ? ` · 반격 -${prev.retaliateDamage}` : '';
    return { cls: 'outcome-recoil', text: `💥 불가 · 반사 -${prev.recoilDamage}${extra}` };
  }
  if (prev.retaliateDamage > 0) {
    return { cls: 'outcome-neutral', text: `⚠️ 불가 · 반격 -${prev.retaliateDamage}` };
  }
  return { cls: 'outcome-neutral', text: '🛡️ 처치 불가 (무피해)' };
}

function formatAttackOutcomeNarrative(targetUnit, prev) {
  if (!prev) return '';
  if (!prev.canAttack) return `🚫 ${prev.reason}`;
  if (!targetUnit) {
    return prev.isLethal
      ? `🏆 직접 공격 시 상대 LP 0 (이번 공격으로 승리!)`
      : `⚔️ 상대 본체 직접 공격 예상 피해: -${prev.heroDamage} LP`;
  }
  if (prev.canKill) {
    return prev.pierceDamage > 0
      ? `⚔️ 「${targetUnit.name}」 처치 가능! (+관통 ${prev.pierceDamage} 본체 피해)`
      : `⚔️ 「${targetUnit.name}」 처치 가능!`;
  }
  if (prev.survivesUndying) {
    return `🛡️ 「${targetUnit.name}」은 불굴로 1회 버티고 수비력 1로 남습니다.`;
  }
  if (prev.recoilDamage > 0) {
    return `⚠️ 「${targetUnit.name}」 수비력이 더 높아 처치 불가 (공격 시 내 본체 -${prev.recoilDamage} 반사 피해!)`;
  }
  return `🛡️ 「${targetUnit.name}」 공격력과 수비력이 같아 처치 불가 (반사 피해 없음)`;
}

function clearAttackOutcomeBadges() {
  document.querySelectorAll('.attack-outcome-pill').forEach((el) => el.remove());
  document.querySelectorAll('.unit-field-card.attack-blocked-target').forEach((el) => {
    el.classList.remove('attack-blocked-target');
  });
}

function applyAttackOutcomeBadges(duel, attacker) {
  clearAttackOutcomeBadges();
  if (!duel || !attacker || duel.activeSeat !== 0) return;
  const cpu = duel.seats[1];
  document.querySelectorAll('#cpu-board .unit-field-card').forEach((el) => {
    const id = el.getAttribute('data-instance-id');
    const defender = cpu.board.find((u) => u.instanceId === id);
    if (!defender) return;
    const prev = previewAttack(duel, attacker, defender);
    const badgeInfo = formatAttackOutcomeBadge(prev);
    if (badgeInfo) {
      const pill = document.createElement('span');
      pill.className = `attack-outcome-pill ${badgeInfo.cls}`;
      pill.textContent = badgeInfo.text;
      el.appendChild(pill);
    }
    if (!prev.canAttack) el.classList.add('attack-blocked-target');
  });

  if (canAttackHero(duel, attacker)) {
    const heroPrev = previewAttack(duel, attacker, null);
    const badgeInfo = formatAttackOutcomeBadge(heroPrev);
    const cpuSeatEl = document.getElementById('cpu-seat');
    if (badgeInfo && cpuSeatEl) {
      const pill = document.createElement('span');
      pill.className = `attack-outcome-pill ${badgeInfo.cls}`;
      pill.textContent = badgeInfo.text;
      cpuSeatEl.appendChild(pill);
    }
  }
}

function clearTargetHighlights() {
  fxEngine.clearTargetAura();
  clearAttackOutcomeBadges();
  document.querySelectorAll('.aura-beneficial, .aura-mixed, .aura-purple, .aura-harmful').forEach((el) => {
    el.classList.remove('aura-beneficial', 'aura-mixed', 'aura-purple', 'aura-harmful');
  });
}

// ============================================================================
// 4-B. [드래그 앤 드롭] 낼 수 있는 카드 존(Valid Drop Zones) 하이라이트
// ============================================================================
function highlightPlayableDropZones(cardDef, cardInst) {
  clearPlayableDropZones();
  if (!cardDef) return;
  const snap = engine.getSnapshot();
  const duel = snap?.activeDuel;
  if (!duel || duel.status !== 'ONGOING') return;
  const player = duel.seats[0];
  if (!player) return;

  const isMonster = cardDef.type === 'MONSTER' || cardDef.effectType === 'SUMMON_UNIT';
  const cardLevel = cardDef.level ?? cardDef.cost ?? 1;
  const playerBoardEl = document.getElementById('player-board');
  const playerUnits = Array.from(playerBoardEl?.querySelectorAll('.unit-field-card') || []);

  if (isMonster) {
    if (cardLevel === 1) {
      if ((player.normalSummonsRemaining ?? 0) > 0 && player.board.length < 5 && playerBoardEl) {
        playerBoardEl.classList.add('valid-drop-zone');
      }
    } else {
      // Lv 2+ 몬스터: 1단계 진화 가능한 아군 몬스터 하이라이트
      playerUnits.forEach((uEl) => {
        const uId = uEl.getAttribute('data-instance-id');
        const unit = player.board.find((u) => u.instanceId === uId);
        if (unit && cardLevel - (unit.level || 1) <= 1) {
          uEl.classList.add('valid-evolution-target');
        }
      });
      // 합산 제물 소환 가능 시 플레이어 보드 하이라이트
      const sumLevel = player.board.reduce((acc, u) => acc + (u.level || 1), 0);
      if ((player.normalSummonsRemaining ?? 0) > 0 && sumLevel >= cardLevel && playerBoardEl) {
        playerBoardEl.classList.add('valid-drop-zone');
      }
    }
  } else {
    // 마법 카드: 어디에든 자유 세트 가능 (중앙 좌/우, 몬스터 앞, 또는 즉시 발동)
    if (!duel.fieldSetSlots?.left) {
      document.getElementById('field-set-left')?.classList.add('valid-slot-drop');
    }
    if (!duel.fieldSetSlots?.right) {
      document.getElementById('field-set-right')?.classList.add('valid-slot-drop');
    }
    playerUnits.forEach((uEl) => {
      const uId = uEl.getAttribute('data-instance-id');
      const hasFront = player.setSpells?.some(
        (s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === uId
      );
      if (!hasFront) {
        uEl.classList.add('valid-spell-set-target');
      }
    });
    if (playerBoardEl) {
      playerBoardEl.classList.add('valid-drop-zone');
    }
  }
}

function clearPlayableDropZones() {
  document.getElementById('player-board')?.classList.remove('valid-drop-zone');
  document.getElementById('field-set-left')?.classList.remove('valid-slot-drop');
  document.getElementById('field-set-right')?.classList.remove('valid-slot-drop');
  document.querySelectorAll('.valid-evolution-target, .valid-spell-set-target').forEach((el) => {
    el.classList.remove('valid-evolution-target', 'valid-spell-set-target');
  });
}

function addGraveyardGhost(graveyardId, cardDef) {
  const stack = document.getElementById(graveyardId === 'cpu-graveyard' ? 'cpu-gy-stack' : 'player-gy-stack');
  if (!stack) return;
  const ghost = document.createElement('div');
  ghost.className = 'graveyard-card-ghost';
  ghost.innerHTML = `
    <span style="font-weight:700;">${cardDef?.name || '파괴됨'}</span>
    <span style="font-size:0.55rem; color:#64748b;">${svgIcon('skull')} DESTROYED</span>
  `;
  stack.innerHTML = '';
  stack.appendChild(ghost);
}

let selectedAttackerInstanceId = null;
let isAttackAnimating = false;

// ============================================================================
// [스케치 1 & 2 연동] 카드 비주얼 구체화 & 인스펙터 & 전투 로그 하네스
// ============================================================================

/** 카드 대표 아이콘 심볼 결정 헬퍼 */
function getCardArtIcon(cardDef) {
  if (!cardDef) return svgIcon('pack');
  const name = cardDef.name || '';
  const tags = (cardDef.tags || []).join(' ');
  const type = cardDef.type || '';

  if (name.includes('방패') || tags.includes('수호자') || tags.includes('방어')) return svgIcon('shield');
  if (name.includes('천사') || tags.includes('신성') || name.includes('미카엘')) return svgIcon('divineHalo');
  if (name.includes('마법사') || type === 'SPELL' || tags.includes('마법')) return svgIcon('crystal');
  if (name.includes('거신') || name.includes('아이기스') || tags.includes('거신')) return svgIcon('bulwark');
  if (name.includes('돌격') || name.includes('전사') || tags.includes('전사')) return svgIcon('swords');
  if (name.includes('화염') || name.includes('용') || name.includes('드래곤')) return svgIcon('flame');
  if (name.includes('늑대') || name.includes('야수') || tags.includes('돌격병')) return svgIcon('tauntBanner');
  if (name.includes('혼돈') || tags.includes('도박') || tags.includes('변칙')) return svgIcon('dice');
  if (name.includes('저격') || tags.includes('원거리')) return svgIcon('target');
  if (type === 'MONSTER') return svgIcon('sword');
  if ((m = s.match(/선공 결정.*?—\s*(플레이어|상대)/))) {
    return `선공: ${m[1] === '플레이어' ? '내 선공' : '상대 선공'}`;
  }
  return svgIcon('spark');
}

/** 실시간 전투 상세 로그 추가 헬퍼 (스케치 2 우측 로그창) */
function appendCombatLog(category, message, meta = null) {
  const logContainer = document.getElementById('combat-log-history');
  if (!logContainer) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const rawStr = String(message ?? '').trim();
  const simplified = meta?.alreadyCompact ? rawStr : (compactHudLogText(rawStr) || rawStr);
  const fullTitle = meta?.fullTitle ? String(meta.fullTitle).replace(/\s+/g, ' ').trim() : rawStr;
  const cardIds = Array.isArray(meta?.cardIds) ? meta.cardIds : extractCardIdsFromLog(simplified);

  const entry = document.createElement('div');
  let categoryClass = 'log-system';
  let badgeClass = 'badge-sys';
  let badgeText = '시스템';

  switch (category) {
    case 'attack':
      categoryClass = 'log-attack';
      badgeClass = 'badge-atk';
      badgeText = '공격';
      break;
    case 'destroy':
      categoryClass = 'log-destroy';
      badgeClass = 'badge-dst';
      badgeText = '파괴';
      break;
    case 'spell':
      categoryClass = 'log-spell';
      badgeClass = 'badge-spl';
      badgeText = '마법';
      break;
    case 'turn':
      categoryClass = 'log-turn';
      badgeClass = 'badge-trn';
      badgeText = '턴';
      break;
  }

  entry.className = `log-entry ${categoryClass}${cardIds.length > 0 ? ' has-card-preview' : ''}`;
  if (fullTitle) entry.title = fullTitle;
  if (cardIds.length > 0) entry.dataset.cardIds = JSON.stringify(cardIds);
  entry.innerHTML = `
    <span class="log-badge ${badgeClass}">${badgeText}</span>
    <span class="log-msg">[${timeStr}] ${renderLogTextWithCardRefs(simplified)}</span>
  `;

  // 최신 로그는 항상 맨 아래에 순차적으로 추가 (새로운 전투 기록이 하단에 누적)
  logContainer.appendChild(entry);
  requestAnimationFrame(() => {
    logContainer.scrollTop = logContainer.scrollHeight;
  });

  if (category !== 'turn' && simplified && !simplified.startsWith('1~2턴')) {
    updateTurnHudLastAction(simplified, fullTitle, cardIds);
  }
}

// ============================================================================
// 5. [Canvas 2D Engine 연동] 방향별 직접 타격 / 역경직 / 파편 / 영혼 / 관통 시퀀스
// ============================================================================
/** 공격이 규칙상 가능한지 미리 확인한다. 불가능하면 사유를 돌려준다. */
function attackBlockReason(attacker, targetUnit) {
  const duel = engine.state.activeDuel;
  if (!duel) return '진행 중인 듀얼이 없습니다.';
  if (duel.turnNumber <= 2) return '1~2턴은 준비 단계입니다. 3턴부터 공격할 수 있습니다.';
  const live = duel.seats[0].board.find((u) => u.instanceId === attacker.instanceId);
  if (!live || !live.canAttack || live.attacksLeft <= 0) return '이 몬스터는 지금 공격할 수 없습니다.';
  if (!targetUnit) {
    return canAttackHero(duel, live) ? null : '상대 필드에 몬스터가 있어 본체를 직접 공격할 수 없습니다.';
  }
  const legal = attackableTargets(duel, 0);
  if (legal.some((u) => u.instanceId === targetUnit.instanceId)) return null;
  if (legal.some((u) => u.kw.includes('TAUNT'))) return '상대의 도발 몬스터부터 공격해야 합니다.';
  return '은신한 몬스터는 공격 대상으로 지정할 수 없습니다.';
}

function performFullAttackSequence(attacker, attackerEl, targetUnit, targetEl, onComplete) {
  if (isAttackAnimating) return;
  const blocked = attackBlockReason(attacker, targetUnit);
  if (blocked) {
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = blocked;
    appendCombatLog('system', blocked);
    onComplete?.();
    return;
  }
  isAttackAnimating = true;

  // 1. 공격자 카드가 드래그 중이었다면 즉시 홈 슬롯 위치로 강제 스냅 (트랜지션 없이 좌표 정렬)
  attackerEl.style.transition = 'none';
  attackerEl.classList.remove('is-dragging-attacker');
  attackerEl.style.setProperty('--card-tx', '0px');
  attackerEl.style.setProperty('--card-ty', '0px');
  attackerEl.style.setProperty('--card-tz', '0px');
  attackerEl.style.setProperty('--slam-rot-z', '0deg');
  void attackerEl.offsetHeight; // 강제 DOM 리플로우로 즉시 (0, 0) 홈 슬롯 좌표 확정
  attackerEl.style.transition = '';

  const attackerDef = lookupCardDef(attacker.cardId);
  const atk = attacker.currentAttack ?? attacker.attack ?? 10;

  // 2. 홈 슬롯 공격자 및 피격 타겟의 정확한 상대 좌표 및 타격 방향 회전각(theta) 계산
  const attackerRect = attackerEl.getBoundingClientRect();
  const ax = attackerRect.left + attackerRect.width / 2;
  const ay = attackerRect.top + attackerRect.height / 2;

  const isTargetLeader = !targetUnit || (targetEl && (targetEl.id === 'cpu-meta' || targetEl.closest('#cpu-meta') || targetEl.id === 'player-meta' || targetEl.closest('#player-meta') || targetEl.id === 'cpu-seat' || targetEl.closest('#cpu-seat') || targetEl.id === 'player-seat' || targetEl.closest('#player-seat') || targetEl.id === 'cpu-hand-container' || targetEl.closest('#cpu-hand-container')));

  let tx, ty;
  if (isTargetLeader) {
    const isPlayerAttacker = attackerEl.closest('#player-board') !== null;
    if (isPlayerAttacker) {
      // 플레이어 ➔ 상대 본체 직접 공격: 화면 상단 정중앙 타겟팅!
      const cpuSeat = document.getElementById('cpu-seat');
      const csRect = cpuSeat ? cpuSeat.getBoundingClientRect() : null;
      tx = csRect ? (csRect.left + csRect.width / 2) : (window.innerWidth / 2);
      ty = csRect ? (csRect.top + csRect.height / 2) : 55;
    } else {
      // 상대 ➔ 플레이어 본체 직접 공격: 화면 하단 정중앙 타겟팅!
      const playerSeat = document.getElementById('player-seat');
      const psRect = playerSeat ? playerSeat.getBoundingClientRect() : null;
      tx = psRect ? (psRect.left + psRect.width / 2) : (window.innerWidth / 2);
      ty = psRect ? (psRect.top + psRect.height / 2) : (window.innerHeight - 55);
    }
  } else {
    const targetRect = targetEl.getBoundingClientRect();
    tx = targetRect.left + targetRect.width / 2;
    ty = targetRect.top + targetRect.height / 2;
  }

  const dx = tx - ax;
  const dy = ty - ay;
  const rawDist = Math.hypot(dx, dy);
  const dist = Math.max(10, rawDist);
  // Y축 상단을 0도로 하는 타겟 방향 Z회전 각도 (타겟을 똑바로 조준)
  const angleDeg = rawDist > 5 ? (Math.atan2(dy, dx) * 180 / Math.PI) + 90 : 0;

  // 치켜들기(Windup) 반동 벡터: 타겟의 반대 방향으로 카드를 뒤로 젖히며 에너지를 축적
  const windupDist = 24;
  const nx = rawDist > 5 ? dx / rawDist : 0;
  const ny = rawDist > 5 ? dy / rawDist : -1;
  const wx = -nx * windupDist;
  const wy = -ny * windupDist;

  const windupTime = Math.max(80, 160 / tunerSettings.slamSpeed);
  const slamTime = Math.max(60, 110 / tunerSettings.slamSpeed);

  // CSS 변수 동적 주입: 방향 각도 및 타겟 좌표로 직접 타격
  attackerEl.style.setProperty('--windup-tx', `${wx.toFixed(1)}px`);
  attackerEl.style.setProperty('--windup-ty', `${wy.toFixed(1)}px`);
  attackerEl.style.setProperty('--target-dx', `${dx.toFixed(1)}px`);
  attackerEl.style.setProperty('--target-dy', `${dy.toFixed(1)}px`);
  attackerEl.style.setProperty('--slam-rot-z', `${angleDeg.toFixed(1)}deg`);
  attackerEl.style.setProperty('--windup-duration', `${windupTime}ms`);
  attackerEl.style.setProperty('--slam-duration', `${slamTime}ms`);

  // 1. 하단 앵커 내리치기 준비 (Windup: 타겟 반대 방향으로 뒤로 젖힘)
  attackerEl.classList.add('slam-windup');
  if (atk <= 4) {
    audio.playLightTap();
  } else {
    audio.playHeavyImpact(atk);
  }

  setTimeout(() => {
    // 2. 대상에게 직접 돌진하며 강력하게 내리치기 (Direct Strike Slam Down)
    attackerEl.classList.remove('slam-windup');
    attackerEl.classList.add('slam-down');

    setTimeout(() => {
      // 3. 엔진 커맨드 격발 및 결과 판정
      if (engine && attacker.instanceId) {
        try {
          engine.dispatchDuelCommand({
            type: 'ATTACK',
            seat: 0,
            attackerInstanceId: attacker.instanceId,
            targetInstanceId: targetUnit ? targetUnit.instanceId : undefined,
          });
          // 공격 연출이 전투 결과를 직접 기록하므로, 그 밖의 효과(함정·능력 발동 등)만 로그로 옮긴다
          flushDuelEventsToLog(engine.getSnapshot().activeDuel, { skipCombat: true });
        } catch (err) {
          console.error(err);
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = `[알림] ${err.message}`;
        }
      }

      const res = engine.lastAttackResult || { attackerAttack: atk, defenderDied: false, pierceDamage: 0, damageDealt: atk };
      const canvasRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0 };
      const currentTargetRect = targetEl ? targetEl.getBoundingClientRect() : { left: tx, top: ty, width: 200, height: 80 };

      // 캔버스 상대 좌표 (본체 피격 시 상단/하단 중앙 좌표 적용)
      let cx, cy;
      if (isTargetLeader) {
        cx = tx - canvasRect.left;
        cy = ty - canvasRect.top;
      } else {
        cx = currentTargetRect.left - canvasRect.left + currentTargetRect.width / 2;
        cy = currentTargetRect.top - canvasRect.top + currentTargetRect.height / 2;
      }

      // 실시간 전투 상세 로그 기록 (스케치 2 우측 로그창 연동)
      appendCombatLog('attack', `⚔️ 「${attackerDef?.name || '아군 유닛'}」 (공격력 ${atk}) ➔ ${isTargetLeader ? '상대 본체' : `「${targetUnit?.name || '적 유닛'}」`} 공격!`);

      // ★ 1. 역경직 (Hitstop / Freeze Frame) - 타격 쾌감의 핵심
      fxEngine.triggerHitstop(tunerSettings.hitstopMs || 50);

      // ★ 2. 캔버스 가산 발광 충격파 링 & 스파크 버스트 (본체 피격 시 상단 중앙 대형 폭발)
      if (isTargetLeader) {
        fxEngine.spawnShockwave(cx, cy, 240, '#ffffff');
        fxEngine.spawnImpactStarburst(cx, cy, 65, '#f43f5e');
        fxEngine.spawnPlayerDustPuff(cx, cy, 260, 90, 48);
        audio.playPlayerImpact(atk);
        appendCombatLog('attack', `🩸 상대 본체에 ${res.damageDealt}의 직접 타격 피해를 입혔습니다!`);
      } else {
        fxEngine.spawnShockwave(cx, cy, Math.min(130, 45 + atk * 3.5), '#ffffff');
        fxEngine.spawnImpactStarburst(cx, cy, Math.min(45, 16 + atk * 2), atk > 10 ? '#f59e0b' : '#38bdf8');
      }

      // ★ 2-C. [세트 마법 트리거 격발 및 불발 피드백]
      if (res.triggeredSpell) {
        const trigDef = lookupCardDef(res.triggeredSpell.cardId);
        if (trigDef) {
          showCardPlayShowcase(trigDef, {
            actorLabel: res.triggeredSpell.fizzled ? `마법 불발 (${trigDef.name})` : '상대 세트 마법 발동!',
            isCpu: true,
          });
        }
        if (res.triggeredSpell.fizzled) {
          fxEngine.showFloatingText(cx, cy - 50, `💨 마법 불발! (${res.triggeredSpell.name})`, '#94a3b8', 20);
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = `🔮 세트 마법 「${res.triggeredSpell.name}」 발동... 그러나 ${res.triggeredSpell.fizzleReason || '조건 불일치'}로 불발 소멸되었습니다!`;
          appendCombatLog('spell', `💨 세트 마법 「${res.triggeredSpell.name}」 발동 ➔ ${res.triggeredSpell.fizzleReason || '조건 불일치'}로 불발 소멸`);
        } else {
          fxEngine.spawnShockwave(cx, cy, 95, '#c084fc');
          fxEngine.showFloatingText(cx, cy - 50, `🔮 세트 마법: ${res.triggeredSpell.name}!`, '#c084fc', 22);
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = `⚡ [함정/마법 발동!] 세트된 「${res.triggeredSpell.name}」이(가) 성공적으로 격발되었습니다!`;
          appendCombatLog('spell', `🔮 세트 마법 「${res.triggeredSpell.name}」 발동 ➔ 전장 효과 적용!`);
        }
      }

      // ★ 3. 물리 카메라 쉐이크 & 부유 데미지 텍스트 팝업
      fxEngine.triggerScreenShake(Math.min(25, 4 + atk * 1.3));
      fxEngine.showFloatingText(cx, cy - 25, `-${res.damageDealt}`, '#ef4444', isTargetLeader ? 32 : 28);

      targetEl.classList.add('slam-hit-target');

      // ★ 4. 카드 파괴 시퀀스 (Canvas 크리스탈 물리 Shatter + 3차 베지에 영혼 Wisp)
      if (res.defenderDied) {
        const defenderDef = lookupCardDef(res.defenderCardId);
        targetEl.classList.add('card-whiteout');
        audio.playCardShatter();
        appendCombatLog('destroy', `💀 [전투 파괴!] 공격력이 수비력을 상회하여 「${defenderDef?.name || targetUnit?.name || '적 유닛'}」이(가) 파괴되어 묘지로 이송되었습니다!`);

        // 캔버스 크리스탈 물리 유리 파편 폭발
        const cardLocalRect = {
          left: currentTargetRect.left - canvasRect.left,
          top: currentTargetRect.top - canvasRect.top,
          width: currentTargetRect.width,
          height: currentTargetRect.height,
        };
        fxEngine.spawnCardShatter(cardLocalRect, tunerSettings.shatterShards);

        // 캔버스 3차 베지에 포물선 영혼 리본 트레일
        audio.playSoulWisp();
        const gyEl = document.getElementById('cpu-graveyard') || document.getElementById('pg-graveyard-slot');
        const gyR = gyEl ? gyEl.getBoundingClientRect() : { left: 100, top: 100, width: 70, height: 90 };
        const gyLocalRect = {
          left: gyR.left - canvasRect.left,
          top: gyR.top - canvasRect.top,
          width: gyR.width,
          height: gyR.height,
        };

        fxEngine.spawnSoulWisp(cardLocalRect, gyLocalRect, () => {
          if (document.getElementById('cpu-graveyard')) {
            addGraveyardGhost('cpu-graveyard', defenderDef);
          }
        });
      } else if (!isTargetLeader) {
        if (res.recoilDamage > 0) {
          audio.playPlayerImpact(res.recoilDamage);
          appendCombatLog('damage', `💥 [수비 반사 피해!] 상대 수비력(${targetUnit?.currentDefense ?? targetUnit?.defense})이 공격력(${atk})보다 높아 공격 플레이어가 차이만큼 반사 피해 -${res.recoilDamage}를 입었습니다!`);
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = `💥 [수비 반사 피해!] 적 수비력이 공격력보다 높아 -${res.recoilDamage}의 본체 반사 피해를 입었습니다!`;

          // 공격자 본체 위에 반사 데미지 텍스트 팝업 및 피격 반응 (중앙 플레이어 영역)
          const playerLeaderEl = document.getElementById('player-meta') || document.getElementById('player-seat');
          if (playerLeaderEl) {
            const pRect = playerLeaderEl.getBoundingClientRect();
            const px = pRect.left - canvasRect.left + pRect.width / 2;
            const py = pRect.top - canvasRect.top + pRect.height / 2;
            fxEngine.spawnShockwave(px, py, 190, '#f97316');
            fxEngine.spawnPlayerDustPuff(px, py, pRect.width, pRect.height, 36);
            fxEngine.showFloatingText(px, py - 20, `💥 반사 -${res.recoilDamage}`, '#f97316', 28);
            playerLeaderEl.classList.add('slam-hit-target');
            setTimeout(() => playerLeaderEl.classList.remove('slam-hit-target'), 300);
          }
        } else {
          appendCombatLog('attack', `🛡️ 「${targetUnit?.name || '적 유닛'}」이(가) 수비력으로 공격을 버텨냈습니다.`);
        }
      }

      // ★ 5. 관통 데미지 시퀀스 (Ease-In 가속 플라즈마 볼트 + 코멧 테일)
      if (res.pierceDamage > 0) {
        audio.playPiercingBolt();
        appendCombatLog('destroy', `⚡ [관통 데미지 작렬!] 방어벽을 뚫은 초과 피해 ${res.pierceDamage}가 상대 본체 LP를 강타했습니다!`);
        const avatarEl = document.getElementById('cpu-meta') || document.getElementById('cpu-seat');
        const avR = avatarEl ? avatarEl.getBoundingClientRect() : { left: 100, top: 50, width: 50, height: 50 };
        const cardLocalRect = {
          left: currentTargetRect.left - canvasRect.left,
          top: currentTargetRect.top - canvasRect.top,
          width: currentTargetRect.width,
          height: currentTargetRect.height,
        };
        const avLocalRect = {
          left: avR.left - canvasRect.left,
          top: avR.top - canvasRect.top,
          width: avR.width,
          height: avR.height,
        };

        fxEngine.spawnPiercingBolt(cardLocalRect, avLocalRect, res.pierceDamage, () => {
          avatarEl?.classList.add('slam-hit-target');
          setTimeout(() => avatarEl?.classList.remove('slam-hit-target'), 300);
          audio.playPlayerImpact(res.pierceDamage);
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = `⚡ [관통!] 수비벽을 뚫고 초과 피해 ${res.pierceDamage}가 상대 본체를 강타했습니다!`;
        });
      }

      // 4. 원위치 부드러운 복귀 (Slam Return)
      setTimeout(() => {
        attackerEl.classList.remove('slam-down');
        attackerEl.classList.add('slam-return');

        setTimeout(() => {
          attackerEl.classList.remove('slam-return');
          targetEl.classList.remove('slam-hit-target');
          attackerEl.style.setProperty('--card-tx', '0px');
          attackerEl.style.setProperty('--card-ty', '0px');
          attackerEl.style.setProperty('--card-tz', '0px');
          attackerEl.style.setProperty('--slam-rot-z', '0deg');
          attackerEl.style.setProperty('--slam-rot-x', '0deg');
          attackerEl.style.setProperty('--target-dx', '0px');
          attackerEl.style.setProperty('--target-dy', '0px');
          attackerEl.style.setProperty('--windup-tx', '0px');
          attackerEl.style.setProperty('--windup-ty', '0px');
          selectedAttackerInstanceId = null;
          clearTargetHighlights();
          isAttackAnimating = false;
          onComplete?.();
        }, 280);
      }, 350);
    }, slamTime);
  }, windupTime);
}

// ============================================================================
// 6. 대칭형 1v1 PvP 듀얼 전장 렌더링 & 드래그 앤 드롭
// ============================================================================
let lastLoggedTurnKey = null;

/**
 * [덱(Deck) 카드 스택 렌더링 헬퍼]
 * - 덱 매수(잔여량)에 비례하여 동적으로 덱 높이(두께)와 3D 측면 적층 음영이 조절되는 연출
 * - 0장 소진 시 ∅ 슬롯 프레임 표시
 */
function renderDeckStack(stackEl, count) {
  if (!stackEl) return;
  if (count <= 0) {
    stackEl.innerHTML = `
      <div class="deck-card-layer empty-deck">
        <span class="empty-deck-icon">∅</span>
        <span class="empty-deck-text">소진</span>
      </div>
    `;
    return;
  }

  // 덱 매수에 따른 동적 덱 높이(두께) 연출:
  // 1~25장 범위에서 매수가 많을수록 측면 3D 적층 두께가 두껍게 솟아오름
  const heightPx = Math.min(14, Math.max(1, Math.round((count / 25) * 12)));
  const rimCount = count >= 20 ? 4 : count >= 14 ? 3 : count >= 7 ? 2 : count >= 2 ? 1 : 0;

  // 3D 덱 측면 적층 음영 그림자 생성 (각 1px 간격 카드 종이 단층 효과)
  const shadowParts = [];
  for (let i = 1; i <= heightPx; i++) {
    const color = i % 2 === 0 ? '#0b1120' : '#1e293b';
    shadowParts.push(`${i}px ${i}px 0 ${color}`);
  }
  shadowParts.push(`${heightPx + 2}px ${heightPx + 6}px 14px rgba(0, 0, 0, 0.75)`);
  const stackShadow = shadowParts.join(', ');

  let rimsHtml = '';
  for (let r = rimCount; r >= 1; r--) {
    const offset = Math.round((r / (rimCount + 1)) * heightPx);
    rimsHtml += `<div class="deck-card-layer dynamic-rim" style="top: ${offset}px; left: ${offset}px;"></div>`;
  }

  stackEl.innerHTML = `
    ${rimsHtml}
    <div class="deck-card-layer layer-top" style="top: 0; left: 0; box-shadow: ${stackShadow};">
      ${generateCardBackHtml(0.36)}
      <div class="deck-count-badge">${count}</div>
    </div>
  `;
}

function renderDuelArena(snap) {
  const duel = snap.activeDuel;
  if (!duel) return;
  if (duel.status !== 'ONGOING' || duel.activeSeat !== 0) {
    closeFieldTargetMode();
  }

  const [player, cpu] = duel.seats;

  // [스케치 2 좌측] 카드 인스펙터 초기 프리뷰 설정
  const previewBox = document.getElementById('inspector-card-preview');
  if (previewBox && (!previewBox.firstElementChild || previewBox.querySelector('.card-idle-placeholder'))) {
    const defaultUnit = player.board.find((u) => u.isDeckMaster) || player.board[0];
    const defaultCard = defaultUnit || (player.hand[0] ? lookupCardDef(player.hand[0].cardId) : null);
    if (defaultCard) {
      updateCardInspector(defaultCard);
    }
  }

  // [스케치 2 우측] 턴 변경 실시간 전투 로그 기록
  const turnKey = `${duel.turnNumber}_${duel.activeSeat}`;
  if (lastLoggedTurnKey !== turnKey) {
    lastLoggedTurnKey = turnKey;
    const isPlayerTurn = duel.activeSeat === 0;
    appendCombatLog('turn', `[TURN ${duel.turnNumber}] ${isPlayerTurn ? '내 턴' : '상대 턴'} (소환 ${isPlayerTurn ? (player.normalSummonsRemaining ?? 0) : (cpu.normalSummonsRemaining ?? 0)}/1)`, { alreadyCompact: true });
    if (duel.turnNumber === 1 && duel.turnDecisionReason) {
      appendCombatLog('system', duel.turnDecisionReason);
      appendCombatLog('system', '1~2턴 준비 (공격 불가)', { alreadyCompact: true });
    } else if (duel.turnNumber === 3) {
      appendCombatLog('system', '3턴 · 공격 가능', { alreadyCompact: true });
    }
  }

  // 플레이어 및 CPU 스탯 렌더링 (기본 체력 100)
  const playerHp = Math.max(0, player.lp);
  const cpuHp = Math.max(0, cpu.lp);
  document.getElementById('player-lp').textContent = playerHp;
  const playerSummonEl = document.getElementById('player-summon');
  if (playerSummonEl) playerSummonEl.textContent = `${player.normalSummonsRemaining ?? 0}/1`;

  document.getElementById('cpu-name').textContent = cpu.duelistName;
  flushDuelEventsToLog(duel);
  document.getElementById('cpu-lp').textContent = cpuHp;
  const cpuSummonEl = document.getElementById('cpu-summon');
  if (cpuSummonEl) cpuSummonEl.textContent = `${cpu.normalSummonsRemaining ?? 0}/1`;
  const cpuBadgeEl = document.getElementById('cpu-badge');
  if (cpuBadgeEl) cpuBadgeEl.textContent = cpu.duelistId;

  // 라이프포인트 게이지바 동적 구간별 색상 헬퍼 (상한선 제거 & 구간별 색상 변경)
  const updateLpGaugeBar = (fillEl, hp) => {
    if (!fillEl) return;
    const pct = Math.max(0, Math.min(100, (hp / 100) * 100));
    fillEl.style.width = `${pct}%`;
    if (hp >= 75) {
      fillEl.style.background = 'linear-gradient(90deg, #15803d 0%, #22c55e 100%)';
      fillEl.style.boxShadow = '0 0 12px rgba(34, 197, 94, 0.75)';
    } else if (hp > 25) {
      fillEl.style.background = 'linear-gradient(90deg, #b45309 0%, #f59e0b 100%)';
      fillEl.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.75)';
    } else {
      fillEl.style.background = 'linear-gradient(90deg, #b91c1c 0%, #ef4444 100%)';
      fillEl.style.boxShadow = '0 0 14px rgba(239, 68, 68, 0.9)';
    }
  };

  // 100 기준 체력바 연동 (상한선 없이 raw LP 수치 표기 & 구간별 색상 반영)
  const playerLpBar = document.getElementById('player-lp-bar');
  const cpuLpBar = document.getElementById('cpu-lp-bar');
  updateLpGaugeBar(playerLpBar, playerHp);
  updateLpGaugeBar(cpuLpBar, cpuHp);

  renderTurnButtonTitle(duel);

  // 중앙 턴 타이머 동기화 (12시 시작 반시계방향 45초 타이머 연출)
  duelTurnTimer.syncWithDuel(duel);

  // 중앙 필드 좌/우 마법 세트 존 상태 렌더링
  const setLeftEl = document.getElementById('field-set-left');
  const setRightEl = document.getElementById('field-set-right');
  // 마법 세트 존 실물 카드 렌더링 헬퍼 (사악한 전방향 오라 연출 및 가로방향 세트 확대)
  const renderSetSlot = (slotEl, setSpell, defaultLabel) => {
    if (!slotEl) return;
    if (setSpell) {
      slotEl.classList.add('has-set-card');
      const isMine = setSpell.ownerSeat === 0;
      const slotHint = slotEl?.id === 'field-set-right' ? '상대 턴 종료 시 발동' : '상대 턴 시작 시 발동';
      const title = isMine ? `[세트 · ${slotHint}] ${setSpell.name}` : `[상대 세트 카드 · ${slotHint}] ?`;
      const badgeText = isMine ? setSpell.name : `${svgIcon('lock')} ?`;
      slotEl.innerHTML = `
        <div class="physical-set-card horizontal-central-set ${isMine ? 'mine' : 'enemy'}" title="${title}">
          <div class="horizontal-card-rotator central-rotator">
            <!-- 사악하게 모든 방향으로 퍼지는 다크 오라 이펙트 레이어 -->
            <div class="sinister-dark-aura" aria-hidden="true">
              <div class="sinister-omni-mist"></div>
              <div class="sinister-wisp wisp-top"></div>
              <div class="sinister-wisp wisp-bottom"></div>
              <div class="sinister-wisp wisp-left"></div>
              <div class="sinister-wisp wisp-right"></div>
            </div>
            ${generateCardBackHtml(0.70)}
          </div>
          <div class="set-card-glow-overlay"></div>
          <div class="set-card-label-badge ${isMine ? '' : 'enemy-badge'}">${badgeText}</div>
        </div>
      `;
      slotEl.onmouseenter = () => {
        if (isMine) {
          updateCardInspector(setSpell);
        } else {
          updateCardInspector({
            isOpponentSecret: true,
            isFacedown: true,
          });
        }
      };
    } else {
      const side = slotEl?.id === 'field-set-right' ? 'right' : 'left';
      slotEl.classList.remove('has-set-card');
      slotEl.innerHTML = `
        <div class="empty-set-slot-frame">
          <span class="set-slot-magic">${magicCircleSvg(side)}</span>
          <span class="set-slot-label">${defaultLabel}</span>
        </div>
      `;
      slotEl.onmouseenter = null;
    }
  };

  renderSetSlot(document.getElementById('field-set-left'), duel.fieldSetSlots?.left, '중앙 좌측 · 상대 턴 시작');
  renderSetSlot(document.getElementById('field-set-right'), duel.fieldSetSlots?.right, '중앙 우측 · 상대 턴 종료');

  // 듀얼 개시 안내 (선/후공 결정 안내)
  const narrativeEl = document.getElementById('duel-narrative-log');
  if (narrativeEl && duel.turnNumber === 1 && duel.turnDecisionReason && !selectedAttackerInstanceId) {
    narrativeEl.textContent = duel.turnDecisionReason;
  }

  // 상대 손패 (정교한 카드 뒷면 렌더링 & 호버 매수 팝업)
  const cpuHandEl = document.getElementById('cpu-hand-row');
  if (cpuHandEl) {
    cpuHandEl.innerHTML = '';
    cpu.hand.forEach(() => {
      const cardBack = document.createElement('div');
      cardBack.className = 'cpu-card-back';
      cardBack.innerHTML = generateCardBackHtml(0.28);
      cpuHandEl.appendChild(cardBack);
    });
  }
  const cpuHandCountText = document.getElementById('cpu-hand-count-text');
  if (cpuHandCountText) cpuHandCountText.textContent = `${cpu.hand.length}`;
  const cpuHandTooltip = document.getElementById('cpu-hand-tooltip');
  if (cpuHandTooltip) cpuHandTooltip.innerHTML = `상대 손패: <strong id="cpu-hand-count-text">${cpu.hand.length}</strong>장`;

  // 상대 덱 스택 렌더링 & 호버 매수 툴팁
  const cpuDeckStack = document.getElementById('cpu-deck-stack');
  renderDeckStack(cpuDeckStack, cpu.deck.length);
  const cpuDeckTooltip = document.getElementById('cpu-deck-tooltip');
  if (cpuDeckTooltip) cpuDeckTooltip.innerHTML = `상대 덱: <strong id="cpu-deck-count-text">${cpu.deck.length}</strong>장 남음`;

  // 플레이어 덱 스택 렌더링 & 호버 매수 툴팁
  const playerDeckStack = document.getElementById('player-deck-stack');
  renderDeckStack(playerDeckStack, player.deck.length);
  const playerDeckTooltip = document.getElementById('player-deck-tooltip');
  if (playerDeckTooltip) playerDeckTooltip.innerHTML = `내 덱: <strong id="player-deck-count-text">${player.deck.length}</strong>장 남음`;

  // 상대 필드 보드 렌더링
  const cpuBoardEl = document.getElementById('cpu-board');
  cpuBoardEl.innerHTML = '';
  const selectedLegalTargetIds =
    selectedAttackerInstanceId && duel.activeSeat === 0
      ? new Set(attackableTargets(duel, 0).map((u) => u.instanceId))
      : null;
  cpu.board.forEach((unit) => {
    const unitEl = createUnitElement(unit, false, cpu.setSpells || []);
    if (selectedAttackerInstanceId && duel.activeSeat === 0) {
      if (selectedLegalTargetIds?.has(unit.instanceId)) {
        unitEl.classList.add('aura-harmful');
      }
      unitEl.style.cursor = 'crosshair';
      unitEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const attacker = player.board.find((u) => u.instanceId === selectedAttackerInstanceId);
        const attackerEl = document.querySelector(`[data-instance-id="${selectedAttackerInstanceId}"]`);
        if (attacker && attackerEl) {
          performFullAttackSequence(attacker, attackerEl, unit, unitEl, () => {
            syncRunPhaseView();
          });
        }
      });
    }
    cpuBoardEl.appendChild(unitEl);
  });

  // 상대 본체 직접 공격 바인딩 (화면 상단 아무데나 클릭해도 상대 플레이어 타겟팅)
  const cpuSeatEl = document.getElementById('cpu-seat');
  const hasCpuMonsters = cpu.board.length > 0;
  const selectedAttacker = selectedAttackerInstanceId
    ? player.board.find((u) => u.instanceId === selectedAttackerInstanceId)
    : null;

  if (selectedAttacker && duel.activeSeat === 0) {
    const canHeroHit = canAttackHero(duel, selectedAttacker);
    if (!canHeroHit) {
      if (cpuSeatEl) {
        cpuSeatEl.style.cursor = 'not-allowed';
        cpuSeatEl.onclick = (e) => {
          e.stopPropagation();
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = '🛡️ [수호벽] 상대 필드에 몬스터가 존재하여 본체를 직접 공격할 수 없습니다. 적 몬스터를 먼저 처치하세요!';
        };
      }
    } else {
      const handleDirectAttackClick = (e) => {
        e.stopPropagation();
        const attacker = player.board.find((u) => u.instanceId === selectedAttackerInstanceId);
        const attackerEl = document.querySelector(`[data-instance-id="${selectedAttackerInstanceId}"]`);
        if (attacker && attackerEl && cpuSeatEl) {
          performFullAttackSequence(attacker, attackerEl, null, cpuSeatEl, () => {
            syncRunPhaseView();
          });
        }
      };
      if (cpuSeatEl) {
        cpuSeatEl.style.cursor = 'crosshair';
        cpuSeatEl.onclick = handleDirectAttackClick;
        cpuSeatEl.classList.add('aura-harmful');
      }
      if (!hasCpuMonsters && cpuBoardEl) {
        cpuBoardEl.style.cursor = 'crosshair';
        cpuBoardEl.onclick = handleDirectAttackClick;
      }
    }
  } else {
    if (cpuSeatEl) {
      cpuSeatEl.onclick = null;
      cpuSeatEl.style.cursor = '';
      cpuSeatEl.classList.remove('aura-harmful');
    }
    if (cpuBoardEl) {
      cpuBoardEl.onclick = null;
      cpuBoardEl.style.cursor = '';
    }
  }

  // 플레이어 필드 보드 렌더링
  const playerBoardEl = document.getElementById('player-board');
  playerBoardEl.innerHTML = '';
  player.board.forEach((unit) => {
    const unitEl = createUnitElement(unit, true, player.setSpells || []);
    if (unit.canAttack && duel.activeSeat === 0) {
      unitEl.classList.add('can-attack');
      if (selectedAttackerInstanceId === unit.instanceId) {
        unitEl.classList.add('aura-beneficial');
      }

      // [기능 2 & 3] 카드를 드래그하여 대상을 쥐어 옮겨 직접 타격 & 클릭 지정 듀얼 인터랙션
      let isDragging = false;
      let startX = 0, startY = 0;
      let hasMovedFar = false;
      let hoveredTargetEl = null;

      const onPointerDown = (e) => {
        if (e.button !== 0 || isAttackAnimating) return;
        e.preventDefault();
        isDragging = true;
        hasMovedFar = false;
        startX = e.clientX;
        startY = e.clientY;
        hoveredTargetEl = null;
        unitEl.setPointerCapture(e.pointerId);
        unitEl.classList.add('is-dragging-attacker');

        // 적 유닛/본체 공격 결과(처치 가능/반사/차단) 프리뷰 및 합법 타겟 하이라이트
        const legalIds = new Set(attackableTargets(duel, 0).map((u) => u.instanceId));
        document.querySelectorAll('#cpu-board .unit-field-card').forEach((el) => {
          if (legalIds.has(el.getAttribute('data-instance-id'))) {
            el.classList.add('aura-harmful');
          }
        });
        if (canAttackHero(duel, unit)) {
          document.getElementById('cpu-hand-container')?.classList.add('aura-harmful');
          document.getElementById('cpu-seat')?.classList.add('aura-harmful');
        }
        applyAttackOutcomeBadges(duel, unit);
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) > 6) {
          hasMovedFar = true;
        }
        if (hasMovedFar) {
          unitEl.style.setProperty('--card-tx', `${dx}px`);
          unitEl.style.setProperty('--card-ty', `${dy}px`);
          unitEl.style.setProperty('--card-tz', '50px');

          // 마우스 포인터 아래 위치한 적 유닛 또는 적 본체 검출
          const elementsUnderPoint = document.elementsFromPoint(e.clientX, e.clientY);
          // 1. 상대 몬스터 카드 최우선 판정: 몬스터 카드의 어떠한 내부 자식(이미지/공수/프레임 등)을 호버해도 정확히 .unit-field-card 포착
          let foundMonster = null;
          for (const el of elementsUnderPoint) {
            const card = el.closest('#cpu-board .unit-field-card');
            if (card) {
              foundMonster = card;
              break;
            }
          }

          let actualTarget = null;
          const canHeroHit = canAttackHero(duel, unit);
          if (foundMonster) {
            actualTarget = foundMonster;
          } else if (canHeroHit) {
            // 본체 직공 허용(적 필드 비어있거나 직접공격 키워드) 시 상대 본체 영역 타겟팅
            const isOverCpuZone = elementsUnderPoint.some(
              (el) => el.id === 'cpu-seat' || el.closest('#cpu-seat') || el.id === 'cpu-board' || el.closest('#cpu-board') || el.id === 'cpu-meta' || el.closest('#cpu-meta')
            );
            if (isOverCpuZone || e.clientY < 280) {
              actualTarget = document.getElementById('cpu-seat');
            }
          }

          if (actualTarget !== hoveredTargetEl) {
            if (hoveredTargetEl) hoveredTargetEl.classList.remove('target-drag-hovered');
            hoveredTargetEl = actualTarget;
            if (hoveredTargetEl) {
              hoveredTargetEl.classList.add('target-drag-hovered');
              const logEl = document.getElementById('duel-narrative-log');
              if (logEl) {
                const hoveredMonsterId = hoveredTargetEl.classList?.contains('unit-field-card')
                  ? hoveredTargetEl.getAttribute('data-instance-id')
                  : null;
                const hoveredEnemy = hoveredMonsterId ? cpu.board.find((u) => u.instanceId === hoveredMonsterId) : null;
                const prev = previewAttack(duel, unit, hoveredEnemy);
                logEl.textContent = formatAttackOutcomeNarrative(hoveredEnemy, prev);
              }
            }
          }
          unitEl.style.setProperty('--slam-rot-z', '0deg');
        }
      };

      const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (unitEl.hasPointerCapture(e.pointerId)) {
          unitEl.releasePointerCapture(e.pointerId);
        }
        unitEl.classList.remove('is-dragging-attacker');
        if (hoveredTargetEl) {
          hoveredTargetEl.classList.remove('target-drag-hovered');
        }
        clearTargetHighlights();

        if (hasMovedFar && hoveredTargetEl) {
          const targetEl = hoveredTargetEl;
          hoveredTargetEl = null;

          // 적 몬스터 카드인지, 아니면 본체(리더) 직접 공격인지 명확히 분리 판정
          const targetMonsterCard = targetEl.closest('#cpu-board .unit-field-card') || (targetEl.classList?.contains('unit-field-card') ? targetEl : null);
          const isDirectTarget = !targetMonsterCard && (targetEl.id === 'cpu-seat' || targetEl.id === 'cpu-meta' || targetEl.closest('#cpu-seat') || targetEl.closest('#cpu-meta') || targetEl.id === 'cpu-board');

          // 유희왕식 수호벽: 필드에 적 몬스터가 있으면 본체 직접 공격 차단 (직접공격 키워드 예외)
          if (hasCpuMonsters && isDirectTarget && !(unit.kw || []).includes('DIRECT')) {
            const logEl = document.getElementById('duel-narrative-log');
            if (logEl) logEl.textContent = '🛡️ [수호벽] 상대 필드에 몬스터가 존재하여 본체를 직접 공격할 수 없습니다. 적 몬스터를 먼저 처치하세요!';
            unitEl.style.transition = 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)';
            unitEl.style.setProperty('--card-tx', '0px');
            unitEl.style.setProperty('--card-ty', '0px');
            unitEl.style.setProperty('--card-tz', '0px');
            unitEl.style.setProperty('--slam-rot-z', '0deg');
            setTimeout(() => { unitEl.style.transition = ''; }, 200);
            return;
          }

          unitEl.style.transition = 'transform 0.07s cubic-bezier(0.2, 0, 0.4, 1)';
          unitEl.style.setProperty('--card-tx', '0px');
          unitEl.style.setProperty('--card-ty', '0px');
          unitEl.style.setProperty('--card-tz', '0px');
          unitEl.style.setProperty('--slam-rot-z', '0deg');

          setTimeout(() => {
            unitEl.style.transition = '';
            const targetInstId = targetMonsterCard ? targetMonsterCard.getAttribute('data-instance-id') : null;
            const targetUnit = targetInstId ? cpu.board.find((u) => u.instanceId === targetInstId) : null;
            performFullAttackSequence(unit, unitEl, targetUnit, targetMonsterCard || targetEl, () => {
              syncRunPhaseView();
            });
          }, 75);
        } else if (!hasMovedFar) {
          unitEl.style.setProperty('--card-tx', '0px');
          unitEl.style.setProperty('--card-ty', '0px');
          unitEl.style.setProperty('--card-tz', '0px');
          unitEl.style.setProperty('--slam-rot-z', '0deg');

          if (selectedAttackerInstanceId === unit.instanceId) {
            selectedAttackerInstanceId = null;
            clearTargetHighlights();
            document.getElementById('duel-narrative-log').textContent = '공격 선택을 취소했습니다.';
            renderDuelArena(engine.getSnapshot());
            return;
          }

          selectedAttackerInstanceId = unit.instanceId;
          clearTargetHighlights();
          document.getElementById('duel-narrative-log').textContent = canAttackHero(duel, unit)
            ? `⚔️ [${unit.currentAttack}공] 대상 지정 중: 적 몬스터 또는 상대 본체를 공격할 수 있습니다! (배지로 처치 가능 여부 확인)`
            : `⚔️ [${unit.currentAttack}공] 대상 지정 중: 적 몬스터의 배지를 확인하고 클릭하거나 드래그하여 공격하세요!`;
          renderDuelArena(engine.getSnapshot());
        } else {
          // 허공에 놓음 -> 부드럽게 원위치
          unitEl.style.transition = 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)';
          unitEl.style.setProperty('--card-tx', '0px');
          unitEl.style.setProperty('--card-ty', '0px');
          unitEl.style.setProperty('--card-tz', '0px');
          unitEl.style.setProperty('--slam-rot-z', '0deg');
          setTimeout(() => {
            unitEl.style.transition = '';
          }, 200);
        }
      };

      unitEl.addEventListener('pointerdown', onPointerDown);
      unitEl.addEventListener('pointermove', onPointerMove);
      unitEl.addEventListener('pointerup', onPointerUp);
      unitEl.addEventListener('pointercancel', onPointerUp);
    } else if (duel.activeSeat === 0 && duel.turnNumber <= 2) {
      unitEl.addEventListener('click', () => {
        const logEl = document.getElementById('duel-narrative-log');
        if (logEl) logEl.textContent = '🛡️ [첫 1바퀴] 1~2턴은 전개 및 세트 단계입니다. 본격적인 전투 공격은 3턴부터 가능합니다.';
      });
    }
    playerBoardEl.appendChild(unitEl);
  });

  if (selectedAttacker && duel.activeSeat === 0) {
    applyAttackOutcomeBadges(duel, selectedAttacker);
  } else {
    clearAttackOutcomeBadges();
  }

  // 플레이어 손패 렌더링 (부채꼴 3D 비스듬함 & 계층형 태그 롤링 & 마법 세트 지원)
  const playerHandEl = document.getElementById('player-hand-row');
  playerHandEl.innerHTML = '';
  const arenaField = document.getElementById('arena-field');

  const handCount = player.hand.length;
  const midIndex = (handCount - 1) / 2;

  // 패 매수에 따른 동적 카드 겹침(Negative Margin) 계산:
  // 패가 늘어나도 중앙 안전 영역(최대 480px)을 엄격히 유지하여
  // 좌측 덱/묘지와 우측 라이프 HUD에 일절 가려지거나 겹치지 않음!
  const maxHandWidth = 480;
  const cardWidth = 105;
  let dynamicMarginRight = 0;
  if (handCount > 1) {
    const rawSpacing = (maxHandWidth - cardWidth) / (handCount - 1);
    const clampedSpacing = Math.min(88, rawSpacing);
    dynamicMarginRight = clampedSpacing - cardWidth;
  }

  player.hand.forEach((cardInst, idx) => {
    const def = lookupCardDef(cardInst.cardId);
    if (!def) return;

    // 부채꼴 비스듬함 각도 및 아치 높이 계산
    const offsetFromMid = idx - midIndex;
    const fanRotZ = (offsetFromMid * 4.5).toFixed(1);
    const fanArchY = (Math.abs(offsetFromMid) * 4.5).toFixed(1);
    const fanTiltX = -8;

    const cardEl = document.createElement('div');
    cardEl.className = 'duel-card';
    cardEl.setAttribute('data-card-instance-id', cardInst.instanceId);
    cardEl.style.setProperty('--fan-rz', `${fanRotZ}deg`);
    cardEl.style.setProperty('--fan-ty', `${fanArchY}px`);
    cardEl.style.setProperty('--fan-rx', `${fanTiltX}deg`);
    if (idx < handCount - 1) {
      cardEl.style.marginRight = `${dynamicMarginRight.toFixed(1)}px`;
    }
    // 맨 왼쪽 카드가 제일 위로 올라오도록 좌에서 우 순으로 순차적 z-index 및 3D Depth 배치 (0번 카드가 최상위)
    const cardDepth = (handCount - idx) * 10;
    const fanDepthZ = (handCount - idx) * 3;
    cardEl.style.zIndex = `${cardDepth}`;
    cardEl.style.setProperty('--card-z', `${cardDepth}`);
    cardEl.style.setProperty('--fan-tz', `${fanDepthZ}px`);

    const isMonster = def.type === 'MONSTER' || def.effectType === 'SUMMON_UNIT';
    const cardLevel = def.level ?? def.cost ?? 1;

    cardEl.innerHTML = `
      <div class="card-holo-foil"></div>
      ${generateCompositeCardHtml(cardInst, def.attack, def.defense ?? def.health, 0.55, true)}
    `;

    // 마우스 호버 시 스케치 2 좌측 상세 & 효과 확인창 동기화
    cardEl.addEventListener('mouseenter', () => {
      updateCardInspector(def);
    });

    // 소환권/조건 부족 시 비활성화 시각 피드백 (투명화 대신 dull 톤다운 처리)
    const isPlayerTurn = duel.activeSeat === 0;
    const canPlayMonster = isMonster && (player.normalSummonsRemaining ?? 0) > 0 && (cardLevel === 1 ? player.board.length < 5 : player.board.length > 0);
    const canPlayCard = isPlayerTurn && (isMonster ? canPlayMonster : true);

    if (!canPlayCard) {
      cardEl.classList.add('card-dull-exhausted');
      cardEl.style.cursor = 'not-allowed';
    } else {
      // 1. 단순 클릭 인터랙션 (클릭 시 선택 상태 유지하여 팝업 버튼 안정화)
      cardEl.addEventListener('click', (e) => {
        if (cardEl.classList.contains('is-dragging')) return;
        if (cardEl.dataset.suppressNextClick === '1') {
          delete cardEl.dataset.suppressNextClick;
          return;
        }
        if (e.target.closest('.spell-action-popover')) return;

        if (def.type === 'SPELL') {
          if (cardEl.classList.contains('is-selected')) {
            closeSpellPopovers();
          } else {
            showSpellActionMenu(cardEl, cardInst, def, duel, player);
          }
        } else if (cardLevel === 1) {
          if (cardEl.classList.contains('is-selected')) {
            closeSpellPopovers();
          } else {
            showMonsterSummonMenu(cardEl, cardInst, def, duel);
          }
        } else {
          if (cardEl.classList.contains('is-selected')) {
            closeTributeModal();
          } else {
            openTributeSelectionModal(cardInst, def, duel, player, cardEl);
          }
        }
      });

      // 2. PointerCapture 기반 정밀 드래그 앤 드롭 & 필드 투하 후 대상 지정
      new SafeCardPointerController(cardEl, cardInst.instanceId, def, {
        onCardHoldStart: (_id, d) => {
          const snapNow = engine.getSnapshot()?.activeDuel;
          const isManualOrTribute =
            Boolean(getManualTargetSpec(snapNow, d, 0)) ||
            (d.type === 'MONSTER' && (d.level ?? d.cost ?? 1) >= 2);
          if (!isManualOrTribute) {
            highlightTargets(d);
          }
          highlightPlayableDropZones(d, cardInst);
        },
        onCardHoldEnd: () => {
          clearTargetHighlights();
          clearPlayableDropZones();
        },
        onTiltUpdate: (_id, _tilt, isDragging) => {
          if (isDragging) arenaField.classList.add('drop-target-active');
        },
        onCardReset: () => {
          arenaField.classList.remove('drop-target-active');
          clearTargetHighlights();
          clearPlayableDropZones();
        },
        onCardDrop: (cardId, clientX, clientY, didDrag = false) => {
          arenaField.classList.remove('drop-target-active');
          clearTargetHighlights();
          clearPlayableDropZones();
          if (!didDrag) return;
          closeSpellPopovers();

          const latestDuel = engine.getSnapshot()?.activeDuel || duel;
          const elementsUnder = document.elementsFromPoint(clientX, clientY);
          const droppedBackOnHand = elementsUnder.some(
            (el) => !cardEl.contains(el) && (el.id === 'player-hand-row' || el.classList?.contains('player-interaction-tray') || el.id === 'player-seat')
          );
          const fieldRect = arenaField.getBoundingClientRect();
          if (droppedBackOnHand || clientY > fieldRect.bottom) {
            closeTributeModal();
            closeFieldTargetMode();
            cardEl.classList.remove('is-selected');
            return;
          }

          // 2-1. 중앙 좌측 세트 존에 드롭 (모든 마법 세트 허용)
          const dropOnLeft = elementsUnder.find((el) => el.id === 'field-set-left' || el.closest('#field-set-left'));
          if (dropOnLeft) {
            if (def.type === 'SPELL') {
              handleSetSpell(cardId, 'FIELD_LEFT');
              return;
            }
          }

          // 2-2. 중앙 우측 세트 존에 드롭 (모든 마법 세트 허용)
          const dropOnRight = elementsUnder.find((el) => el.id === 'field-set-right' || el.closest('#field-set-right'));
          if (dropOnRight) {
            if (def.type === 'SPELL') {
              handleSetSpell(cardId, 'FIELD_RIGHT');
              return;
            }
          }

          // 2-3. 내 몬스터 위에 직접 드롭하여 계단식 진화 소환 or 전방 마법 세트
          const dropOnFriendlyUnit = elementsUnder.find(
            (el) => el.classList?.contains('unit-field-card') && el.closest('#player-board')
          );
          if (dropOnFriendlyUnit) {
            const targetUnitInstId = dropOnFriendlyUnit.getAttribute('data-instance-id');
            if (def.type === 'SPELL') {
              handleSetSpell(cardId, 'MONSTER_FRONT', targetUnitInstId);
              return;
            } else if (isMonster && cardLevel >= 2) {
              const targetUnit = latestDuel?.seats?.[0]?.board?.find((u) => u.instanceId === targetUnitInstId);
              if (targetUnit && cardLevel - (targetUnit.level || 1) <= 1) {
                const specAfter = getManualTargetSpec(latestDuel, def, 0, [targetUnitInstId]);
                if (specAfter && (specAfter.unitIds.length > 0 || specAfter.heroSeats.length > 0)) {
                  startFieldTargetMode({
                    mode: 'MANUAL_TARGET',
                    cardInst,
                    cardDef: def,
                    duel: latestDuel,
                    tributeIds: [targetUnitInstId],
                  });
                } else {
                  handlePlayCard(cardId, [targetUnitInstId]);
                }
                return;
              }
            }
          }

          // 2-4. 전장 일반 영역에 드롭: 먼저 필드에 올린 뒤 대상 지정(제물·단일 타겟) 또는 즉시 발동
          if (clientY <= fieldRect.bottom) {
            if (def.type === 'SPELL') {
              const spec = getManualTargetSpec(latestDuel, def, 0);
              if (spec && (spec.unitIds.length > 0 || spec.heroSeats.length > 0)) {
                startFieldTargetMode({ mode: 'MANUAL_TARGET', cardInst, cardDef: def, duel: latestDuel });
              } else {
                handlePlayCard(cardId);
              }
            } else if (cardLevel === 1) {
              const spec = getManualTargetSpec(latestDuel, def, 0);
              if (spec && (spec.unitIds.length > 0 || spec.heroSeats.length > 0)) {
                startFieldTargetMode({ mode: 'MANUAL_TARGET', cardInst, cardDef: def, duel: latestDuel });
              } else {
                handlePlayCard(cardId);
              }
            } else {
              openTributeSelectionModal(cardInst, def, latestDuel, latestDuel?.seats?.[0] || player, cardEl);
            }
          }
        },
      });
    }

    playerHandEl.appendChild(cardEl);
  });

  // 버튼 활성화 여부
  document.getElementById('btn-end-turn').disabled = duel.activeSeat !== 0;
}

// ============================================================================
// 통합 태그 포맷터 & 롤링 티커 (#)
// ============================================================================
function formatTagHtml(tagStr) {
  if (!tagStr) return '';
  const s = String(tagStr).trim();
  const m = s.match(/^#+(.*)$/);
  if (m) {
    const label = m[1].trim();
    return `<span class="tag-badge level-1 tag-fade-in"><span class="tag-prefix">#</span>${label}</span>`;
  }
  return `<span class="tag-badge level-1 tag-fade-in"><span class="tag-prefix">#</span>${s}</span>`;
}

// 2.4초마다 모든 카드의 태그를 순환 표시하는 글로벌 티커 루프
setInterval(() => {
  document.querySelectorAll('.card-tag-ticker').forEach((tickerEl) => {
    try {
      const raw = tickerEl.getAttribute('data-tags');
      if (!raw) return;
      const tags = JSON.parse(raw);
      if (!Array.isArray(tags) || tags.length <= 1) return;
      let curIdx = parseInt(tickerEl.getAttribute('data-tag-index') || '0', 10);
      curIdx = (curIdx + 1) % tags.length;
      tickerEl.setAttribute('data-tag-index', curIdx);
      tickerEl.innerHTML = formatTagHtml(tags[curIdx]);
    } catch (e) {}
  });
}, 2400);

// ============================================================================
// 마법 카드 액션 팝오버 및 세트 처리기
// ============================================================================
function closeSpellPopovers() {
  document.querySelectorAll('.spell-action-popover').forEach((el) => el.remove());
  document.querySelectorAll('.duel-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.spell-action-popover') && !e.target.closest('.duel-card') && !e.target.closest('#tribute-select-modal')) {
    closeSpellPopovers();
    closeTributeModal();
  }
});

function handleSetSpell(cardInstanceId, slotType, targetMonsterInstanceId = null) {
  try {
    audio.playCardPlayImpact();
    engine.dispatchDuelCommand({
      type: 'SET_SPELL',
      seat: 0,
      cardInstanceId,
      slotType,
      targetMonsterInstanceId,
    });
    syncRunPhaseView();
    const slotDesc =
      slotType === 'FIELD_LEFT'
        ? '필드 중앙 좌측 · 상대 턴 시작 시 발동'
        : slotType === 'FIELD_RIGHT'
        ? '필드 중앙 우측 · 상대 턴 종료 시 발동'
        : '내 몬스터 앞 · 해당 몬스터 피격 시 발동';
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) {
      logEl.textContent = `🔮 마법 카드가 [${slotDesc}]에 세트되었습니다.`;
    }
  } catch (err) {
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = `[알림] ${err.message}`;
  }
}

function showSpellActionMenu(cardEl, cardInst, def, duel, player) {
  closeSpellPopovers();
  cardEl.classList.add('is-selected');

  const popover = document.createElement('div');
  popover.className = 'spell-action-popover';

  // 1. 즉시 발동 옵션 (대상을 고르는 마법이면 필드에 올려 대상 지정 진입)
  const btnInstant = document.createElement('button');
  btnInstant.className = 'spell-popover-btn';
  btnInstant.innerHTML = `${svgIcon('bolt')} 즉시 발동`;
  btnInstant.onclick = (e) => {
    e.stopPropagation();
    closeSpellPopovers();
    const spec = getManualTargetSpec(duel, def, 0);
    if (spec && (spec.unitIds.length > 0 || spec.heroSeats.length > 0)) {
      startFieldTargetMode({ mode: 'MANUAL_TARGET', cardInst, cardDef: def, duel });
    } else {
      handlePlayCard(cardInst.instanceId);
    }
  };
  popover.appendChild(btnInstant);

  // 2. 내 몬스터 앞 세트 옵션 (필드에 내고 원하는 보호 대상 몬스터 직접 지정)
  const availableMonsters = (player.board || []).filter(
    (u) => !player.setSpells.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === u.instanceId)
  );
  if (availableMonsters.length > 0) {
    const btnFront = document.createElement('button');
    btnFront.className = 'spell-popover-btn';
    btnFront.innerHTML = `${svgIcon('shield')} 몬스터 앞 세트 · 대상 선택`;
    btnFront.onclick = (e) => {
      e.stopPropagation();
      closeSpellPopovers();
      startFieldTargetMode({ mode: 'SET_MONSTER_FRONT', cardInst, cardDef: def, duel });
    };
    popover.appendChild(btnFront);
  }

  // 3. 필드 중앙 좌측 세트 옵션 (상대 턴 시작 시 발동)
  if (!duel.fieldSetSlots?.left) {
    const btnLeft = document.createElement('button');
    btnLeft.className = 'spell-popover-btn';
    btnLeft.innerHTML = `${svgIcon('crystal')} 중앙 좌측 · 상대 턴 시작`;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      closeSpellPopovers();
      handleSetSpell(cardInst.instanceId, 'FIELD_LEFT');
    };
    popover.appendChild(btnLeft);
  }

  // 4. 필드 중앙 우측 세트 옵션 (상대 턴 종료 시 발동)
  if (!duel.fieldSetSlots?.right) {
    const btnRight = document.createElement('button');
    btnRight.className = 'spell-popover-btn';
    btnRight.innerHTML = `${svgIcon('crystal')} 중앙 우측 · 상대 턴 종료`;
    btnRight.onclick = (e) => {
      e.stopPropagation();
      closeSpellPopovers();
      handleSetSpell(cardInst.instanceId, 'FIELD_RIGHT');
    };
    popover.appendChild(btnRight);
  }

  // 취소 버튼
  const btnCancel = document.createElement('button');
  btnCancel.className = 'spell-popover-btn cancel-btn';
  btnCancel.innerHTML = `${svgIcon('cross')} 취소`;
  btnCancel.onclick = (e) => {
    e.stopPropagation();
    closeSpellPopovers();
  };
  popover.appendChild(btnCancel);

  cardEl.appendChild(popover);
}

function showMonsterSummonMenu(cardEl, cardInst, def, duel) {
  closeSpellPopovers();
  cardEl.classList.add('is-selected');

  const popover = document.createElement('div');
  popover.className = 'spell-action-popover';

  const btnSummon = document.createElement('button');
  btnSummon.className = 'spell-popover-btn';
  btnSummon.innerHTML = `${svgIcon('sword')} 일반 소환`;
  btnSummon.onclick = (e) => {
    e.stopPropagation();
    closeSpellPopovers();
    const latestDuel = engine.getSnapshot()?.activeDuel || duel;
    const spec = getManualTargetSpec(latestDuel, def, 0);
    if (spec && (spec.unitIds.length > 0 || spec.heroSeats.length > 0)) {
      startFieldTargetMode({ mode: 'MANUAL_TARGET', cardInst, cardDef: def, duel: latestDuel });
    } else {
      handlePlayCard(cardInst.instanceId);
    }
  };
  popover.appendChild(btnSummon);

  const btnCancel = document.createElement('button');
  btnCancel.className = 'spell-popover-btn cancel-btn';
  btnCancel.innerHTML = `${svgIcon('cross')} 취소`;
  btnCancel.onclick = (e) => {
    e.stopPropagation();
    closeSpellPopovers();
  };
  popover.appendChild(btnCancel);

  cardEl.appendChild(popover);
}

function createUnitElement(unit, isPlayer, setSpells = []) {
  const def = lookupCardDef(unit.cardId);
  const el = document.createElement('div');
  el.className = 'unit-field-card';
  el.setAttribute('data-instance-id', unit.instanceId);

  if (unit.isDeckMaster) {
    el.classList.add('is-deck-master');
  }

  const tags = unit.tags || def?.tags || [];
  const primaryTag = tags.length > 0 ? tags[0] : '몬스터';
  const icon = getCardArtIcon(def);

  let frontSpellBadgeHtml = '';
  const frontSpell = setSpells.find(
    (s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === unit.instanceId
  );
  if (frontSpell) {
    el.classList.add('has-attached-spell');
    const isMine = frontSpell.ownerSeat === 0;
    const title = isMine ? `[세트 · 피격 시 발동] ${frontSpell.name}` : `[상대 세트 카드 · 피격 시 발동] ?`;
    frontSpellBadgeHtml = `
      <!-- 중앙 세트 카드와 동일한 사악한 다크 오라 이펙트 (보랏빛/붉은빛 미아즈마 & 4방향 플로팅 위스프) -->
      <div class="sinister-dark-aura monster-set-aura" aria-hidden="true">
        <div class="sinister-omni-mist"></div>
        <div class="sinister-wisp wisp-top"></div>
        <div class="sinister-wisp wisp-bottom"></div>
        <div class="sinister-wisp wisp-left"></div>
        <div class="sinister-wisp wisp-right"></div>
      </div>
      <!-- 몬스터 카드 뒤에 겹쳐진 풀사이즈 실물 세트 카드 (우측/하단으로 오프셋) -->
      <div class="monster-stacked-set-card ${isMine ? 'mine' : 'enemy'}" title="${title}">
        ${generateCardBackHtml(0.58)}
        <span class="front-set-pill">${isMine ? frontSpell.name : '세트'}</span>
      </div>
    `;
  } else {
    el.classList.remove('has-attached-spell');
  }

  // [스케치 1 우측: 인게임 필드 유닛 카드]
  // 몬스터 밑 세트 카드(빼꼼)는 몬스터 카드 래퍼보다 아래 계층에 배치
  const unitLevel = unit.level ?? def?.level ?? def?.cost ?? 1;
  el.innerHTML = `
    ${frontSpellBadgeHtml}
    ${generateCompositeCardHtml(unit, unit.currentAttack, unit.currentDefense ?? unit.currentHealth, 0.58, true)}
  `;

  // 몬스터 밑 중첩 세트 카드 호버 시 인스펙터 동기화 (상대 세트인 경우 정체 은닉)
  const stackedCardEl = el.querySelector('.monster-stacked-set-card');
  if (stackedCardEl && frontSpell) {
    const isMine = frontSpell.ownerSeat === 0;
    stackedCardEl.addEventListener('mouseenter', (e) => {
      e.stopPropagation();
      if (isMine) {
        updateCardInspector(frontSpell);
      } else {
        updateCardInspector({
          isOpponentSecret: true,
          isFacedown: true,
        });
      }
    });
  }

  // 마우스 호버 및 클릭 시 스케치 2 좌측 상세 & 효과 확인창 동기화
  el.addEventListener('mouseenter', () => {
    updateCardInspector(unit);
  });
  el.addEventListener('click', () => {
    updateCardInspector(unit);
  });

  return el;
}

function handlePlayCard(cardInstanceId, tributeInstanceIds = null, chosenTarget = null) {
  try {
    closeFieldTargetMode();
    const preSnap = engine.getSnapshot();
    const preDuel = preSnap?.activeDuel;
    const playedInst = preDuel?.seats?.[0]?.hand?.find((c) => c.instanceId === cardInstanceId);
    const playedDef = playedInst ? lookupCardDef(playedInst.cardId) : null;
    const preTrig = preDuel?.lastSpellTriggerResult || null;

    audio.playCardPlayImpact();
    engine.dispatchDuelCommand({
      type: 'PLAY_CARD',
      seat: 0,
      cardInstanceId,
      tributeInstanceIds: tributeInstanceIds || undefined,
      chosenTarget: chosenTarget || undefined,
    });
    syncRunPhaseView();

    const postDuel = engine.getSnapshot().activeDuel;
    const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0, width: 1280, height: 800 };
    if (playedDef) {
      const isMonster = playedDef.type === 'MONSTER' || (playedDef.attack > 0 && playedDef.type !== 'SPELL');
      if (isMonster) {
        const summonedEl = document.querySelector(`#player-board .unit-field-card[data-instance-id="${cardInstanceId}"]`);
        if (summonedEl) {
          summonedEl.classList.add('summon-slam-enter');
          const sr = summonedEl.getBoundingClientRect();
          fxEngine.spawnSummonBurst(sr.left - cRect.left + sr.width / 2, sr.top - cRect.top + sr.height / 2, '#38bdf8', 105);
        }
      } else {
        const arenaEl = document.getElementById('arena-field');
        const ar = arenaEl ? arenaEl.getBoundingClientRect() : cRect;
        fxEngine.spawnSummonBurst(ar.left - cRect.left + ar.width / 2, ar.top - cRect.top + ar.height * 0.56, '#34d399', 130);
      }
      showCardPlayShowcase(playedInst || playedDef, {
        actorLabel: isMonster ? '내 몬스터 소환' : '내 마법 발동',
        isCpu: false,
      });
    }
    if (postDuel?.lastSpellTriggerResult && postDuel.lastSpellTriggerResult !== preTrig) {
      const trig = postDuel.lastSpellTriggerResult;
      const trigDef = lookupCardDef(trig.cardId);
      if (trigDef) {
        setTimeout(() => {
          showCardPlayShowcase(trigDef, {
            actorLabel: trig.fizzled ? `마법 불발 (${trigDef.name})` : (trig.ownerSeat === 1 ? '상대 함정 반응 발동!' : '내 세트 마법 발동!'),
            isCpu: trig.ownerSeat === 1,
          });
        }, playedDef ? 420 : 0);
      }
    }
  } catch (err) {
    document.getElementById('duel-narrative-log').textContent = `[알림] ${err.message}`;
  }
}

let activeFieldTargetCleanup = null;

function closeFieldTargetMode() {
  if (typeof activeFieldTargetCleanup === 'function') {
    const fn = activeFieldTargetCleanup;
    activeFieldTargetCleanup = null;
    fn();
  }
}

function closeTributeModal() {
  closeFieldTargetMode();
  document.querySelectorAll('.duel-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
}

/**
 * 하스스톤식 "카드를 먼저 필드에 내려놓은 뒤 대상 지정" 컨트롤러.
 * - mode: 'TRIBUTE_SUMMON' (제물 선택), 'MANUAL_TARGET' (단일 대상 지정), 'SET_MONSTER_FRONT' (몬스터 앞 세트 대상 선택)
 */
function startFieldTargetMode({ mode, cardInst, cardDef, duel, tributeIds = [] }) {
  closeSpellPopovers();
  closeFieldTargetMode();
  clearTargetHighlights();
  clearPlayableDropZones();

  const latestDuel = engine.getSnapshot()?.activeDuel || duel;
  const player = latestDuel?.seats?.[0];
  if (!latestDuel || latestDuel.status !== 'ONGOING' || latestDuel.activeSeat !== 0 || !player) return;

  const isMonster = cardDef.type === 'MONSTER';
  const cardLevel = cardDef.level ?? cardDef.cost ?? 1;
  if (mode === 'TRIBUTE_SUMMON' && player.board.length === 0) {
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = `⚠️ [제물 부족] 필드에 제물로 바칠 몬스터가 없습니다.`;
    return;
  }

  // 손패 원본 카드는 선택 표시
  const handCardEl = document.querySelector(`.duel-card[data-card-instance-id="${cardInst.instanceId}"]`);
  handCardEl?.classList.add('is-selected');

  // 1. 필드에 대기 카드 먼저 배치 (몬스터 -> 아군 보드, 마법 -> 중앙 시전 단상)
  const playerBoardEl = document.getElementById('player-board');
  const arenaFieldEl = document.getElementById('arena-field');
  let stagedEl = null;

  if (isMonster && playerBoardEl) {
    stagedEl = document.createElement('div');
    stagedEl.className = 'unit-field-card field-pending-unit';
    stagedEl.innerHTML = generateCompositeCardHtml(cardInst, cardDef.attack, cardDef.defense ?? cardDef.health, 0.58, true);
    playerBoardEl.appendChild(stagedEl);
  } else if (arenaFieldEl) {
    stagedEl = document.createElement('div');
    stagedEl.className = 'field-pending-cast-card';
    stagedEl.innerHTML = generateCompositeCardHtml(cardInst, 0, 0, 0.62, true);
    arenaFieldEl.appendChild(stagedEl);
  }

  // 2. 상단 비차단 안내 배너 생성
  const banner = document.createElement('div');
  banner.className = 'field-targeting-banner';
  document.body.appendChild(banner);

  const selectedTributeIds = new Set(tributeIds || []);
  let arrowColor = mode === 'SET_MONSTER_FRONT' ? 'PURPLE' : mode === 'TRIBUTE_SUMMON' ? 'YELLOW' : 'RED';

  function refreshTargetVisuals() {
    clearTargetHighlights();
    document.querySelectorAll('.targeting-valid-choice, .valid-evolution-target, .valid-spell-set-target, .aura-tribute-ready, .tribute-selected').forEach((el) => {
      el.classList.remove('targeting-valid-choice', 'valid-evolution-target', 'valid-spell-set-target', 'aura-tribute-ready', 'tribute-selected');
    });

    if (mode === 'SET_MONSTER_FRONT') {
      arrowColor = 'PURPLE';
      const validEls = [];
      playerBoardEl?.querySelectorAll('.unit-field-card:not(.field-pending-unit)').forEach((el) => {
        const uId = el.getAttribute('data-instance-id');
        const occupied = player.setSpells?.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === uId);
        if (!occupied) {
          el.classList.add('valid-spell-set-target', 'targeting-valid-choice');
          validEls.push(el);
        }
      });
      if (validEls.length > 0) fxEngine.setTargetAura(validEls, 'PURPLE', true);
      banner.innerHTML = `
        <span>${svgIcon('shield')} <strong>${cardDef.name}</strong> · 몬스터 앞 세트 — 보호할 아군 몬스터를 클릭하세요</span>
        <div class="banner-actions">
          <button type="button" class="btn secondary-btn banner-btn" data-action="cancel">취소 (우클릭)</button>
        </div>
      `;
    } else if (mode === 'MANUAL_TARGET') {
      const spec = getManualTargetSpec(latestDuel, cardDef, 0, tributeIds);
      arrowColor = spec?.polarity || 'RED';
      const auraCls = arrowColor === 'GREEN' ? 'aura-beneficial' : arrowColor === 'PURPLE' ? 'aura-purple' : 'aura-harmful';
      const validEls = [];

      if (spec) {
        const unitSet = new Set(spec.unitIds);
        document.querySelectorAll('#player-board .unit-field-card:not(.field-pending-unit), #cpu-board .unit-field-card').forEach((el) => {
          const uId = el.getAttribute('data-instance-id');
          if (unitSet.has(uId)) {
            el.classList.add(auraCls, 'targeting-valid-choice');
            validEls.push(el);
          }
        });
        if (spec.heroSeats.includes(1)) {
          const cpuSeatEl = document.getElementById('cpu-seat');
          if (cpuSeatEl) {
            cpuSeatEl.classList.add(auraCls, 'targeting-valid-choice');
            validEls.push(cpuSeatEl);
          }
        }
        if (spec.heroSeats.includes(0)) {
          const playerSeatEl = document.getElementById('player-seat');
          if (playerSeatEl) {
            playerSeatEl.classList.add(auraCls, 'targeting-valid-choice');
            validEls.push(playerSeatEl);
          }
        }
      }
      if (validEls.length > 0) fxEngine.setTargetAura(validEls, arrowColor, true);
      banner.innerHTML = `
        <span>${svgIcon('target')} <strong>${cardDef.name}</strong> · 발동 대상을 필드에서 선택하세요</span>
        <div class="banner-actions">
          <button type="button" class="btn secondary-btn banner-btn" data-action="cancel">취소 (우클릭)</button>
        </div>
      `;
    } else {
      // TRIBUTE_SUMMON
      arrowColor = 'YELLOW';
      const selectedUnits = Array.from(selectedTributeIds)
        .map((id) => player.board.find((u) => u.instanceId === id))
        .filter(Boolean);
      const sumLevel = selectedUnits.reduce((acc, u) => acc + (u.level || 1), 0);
      const isStepUp = selectedUnits.length === 1 && cardLevel - (selectedUnits[0].level || 1) <= 1;
      const isSumValid = selectedUnits.length >= 2 && sumLevel >= cardLevel;
      const canConfirm = isStepUp || isSumValid;

      const selectedEls = [];
      playerBoardEl?.querySelectorAll('.unit-field-card:not(.field-pending-unit)').forEach((el) => {
        const uId = el.getAttribute('data-instance-id');
        const unit = player.board.find((u) => u.instanceId === uId);
        if (!unit) return;
        el.classList.add('targeting-valid-choice');
        if (selectedTributeIds.has(uId)) {
          el.classList.add('tribute-selected');
          selectedEls.push(el);
        } else if (cardLevel - (unit.level || 1) <= 1) {
          el.classList.add('valid-evolution-target');
        } else {
          el.classList.add('aura-tribute-ready');
        }
      });
      if (selectedEls.length > 0) fxEngine.setTargetAura(selectedEls, 'GREEN', true);

      const status = isStepUp
        ? `1단계 진화 준비 (★Lv.${selectedUnits[0].level})`
        : isSumValid
        ? `합산 제물 충족 (★Lv.${sumLevel} / ${cardLevel})`
        : `필드 제물 클릭 (★Lv.${sumLevel} / 필요 ★Lv.${cardLevel})`;
      banner.innerHTML = `
        <span>${svgIcon('crown')} <strong>${cardDef.name} (★Lv.${cardLevel})</strong> · ${status}</span>
        <div class="banner-actions">
          <button type="button" class="btn primary-btn banner-btn" data-action="confirm" ${canConfirm ? '' : 'disabled style="opacity:0.45;cursor:not-allowed;"'}>소환 확정</button>
          <button type="button" class="btn secondary-btn banner-btn" data-action="cancel">취소 (우클릭)</button>
        </div>
      `;
    }

    banner.querySelector('[data-action="cancel"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeFieldTargetMode();
    });
    banner.querySelector('[data-action="confirm"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmTributeSelection();
    });
  }

  function confirmTributeSelection() {
    const tributes = Array.from(selectedTributeIds);
    const chosenUnits = tributes.map((id) => player.board.find((u) => u.instanceId === id)).filter(Boolean);
    const sumLevel = chosenUnits.reduce((acc, u) => acc + (u.level || 1), 0);
    const ok =
      (chosenUnits.length === 1 && cardLevel - (chosenUnits[0].level || 1) <= 1) ||
      (chosenUnits.length >= 2 && sumLevel >= cardLevel);
    if (!ok) return;

    const spec = getManualTargetSpec(latestDuel, cardDef, 0, tributes);
    closeFieldTargetMode();
    if (spec && (spec.unitIds.length > 0 || spec.heroSeats.length > 0)) {
      startFieldTargetMode({ mode: 'MANUAL_TARGET', cardInst, cardDef, duel: latestDuel, tributeIds: tributes });
    } else {
      handlePlayCard(cardInst.instanceId, tributes);
    }
  }

  const onPointerMove = (e) => {
    if (!stagedEl || !fxCanvas) return;
    const cRect = fxCanvas.getBoundingClientRect();
    const sRect = stagedEl.getBoundingClientRect();
    fxEngine.setAimingArrow(
      sRect.left - cRect.left + sRect.width * 0.5,
      sRect.top - cRect.top + sRect.height * 0.5,
      e.clientX - cRect.left,
      e.clientY - cRect.top,
      arrowColor
    );
  };

  const onTargetClickCapture = (e) => {
    if (e.target.closest('.field-targeting-banner')) return;
    const unitEl = e.target.closest('.unit-field-card');
    if (unitEl?.classList.contains('field-pending-unit')) return;

    if (mode === 'SET_MONSTER_FRONT') {
      if (unitEl && unitEl.closest('#player-board') && unitEl.classList.contains('targeting-valid-choice')) {
        e.stopPropagation();
        e.preventDefault();
        const uId = unitEl.getAttribute('data-instance-id');
        closeFieldTargetMode();
        handleSetSpell(cardInst.instanceId, 'MONSTER_FRONT', uId);
      }
      return;
    }

    if (mode === 'MANUAL_TARGET') {
      if (unitEl && unitEl.classList.contains('targeting-valid-choice')) {
        e.stopPropagation();
        e.preventDefault();
        const uId = unitEl.getAttribute('data-instance-id');
        handlePlayCard(cardInst.instanceId, tributeIds, { type: 'UNIT', instanceId: uId });
        return;
      }
      const cpuSeatHit = e.target.closest('#cpu-seat.targeting-valid-choice');
      if (cpuSeatHit) {
        e.stopPropagation();
        e.preventDefault();
        handlePlayCard(cardInst.instanceId, tributeIds, { type: 'HERO', seat: 1 });
        return;
      }
      const playerSeatHit = e.target.closest('#player-seat.targeting-valid-choice');
      if (playerSeatHit) {
        e.stopPropagation();
        e.preventDefault();
        handlePlayCard(cardInst.instanceId, tributeIds, { type: 'HERO', seat: 0 });
      }
      return;
    }

    if (mode === 'TRIBUTE_SUMMON' && unitEl && unitEl.closest('#player-board')) {
      e.stopPropagation();
      e.preventDefault();
      const uId = unitEl.getAttribute('data-instance-id');
      if (selectedTributeIds.has(uId)) {
        selectedTributeIds.delete(uId);
      } else {
        selectedTributeIds.add(uId);
      }
      audio.playLightTap();
      refreshTargetVisuals();
    }
  };

  const onRightClickCancel = (e) => {
    e.preventDefault();
    closeFieldTargetMode();
  };

  const onEscapeCancel = (e) => {
    if (e.key === 'Escape') {
      closeFieldTargetMode();
    }
  };

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('click', onTargetClickCapture, true);
  document.addEventListener('contextmenu', onRightClickCancel);
  document.addEventListener('keydown', onEscapeCancel);

  activeFieldTargetCleanup = () => {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('click', onTargetClickCapture, true);
    document.removeEventListener('contextmenu', onRightClickCancel);
    document.removeEventListener('keydown', onEscapeCancel);
    fxEngine.clearAimingArrow();
    clearTargetHighlights();
    document.querySelectorAll('.targeting-valid-choice, .valid-evolution-target, .valid-spell-set-target, .aura-tribute-ready, .tribute-selected').forEach((el) => {
      el.classList.remove('targeting-valid-choice', 'valid-evolution-target', 'valid-spell-set-target', 'aura-tribute-ready', 'tribute-selected');
    });
    stagedEl?.remove();
    banner.remove();
    handCardEl?.classList.remove('is-selected');
  };

  refreshTargetVisuals();
}

function openTributeSelectionModal(cardInst, def, duel, player, cardEl = null) {
  startFieldTargetMode({ mode: 'TRIBUTE_SUMMON', cardInst, cardDef: def, duel });
}

// 턴 종료 버튼 (중앙 타이머 정지 및 차례 넘김)
document.getElementById('btn-end-turn')?.addEventListener('click', () => {
  closeFieldTargetMode();
  audio.playTurnBell();
  duelTurnTimer.stop();
  selectedAttackerInstanceId = null;
  clearTargetHighlights();
  updateTurnHudLastAction('내 턴 종료');
  engine.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
  syncRunPhaseView();
});

// 진행 포기 및 메인 메뉴 복귀 버튼
document.getElementById('btn-abandon-run')?.addEventListener('click', async () => {
  const ok = await showGameConfirm('현재 진행 중인 여정을 포기하고 메인 메뉴로 돌아가시겠습니까?', {
    title: '여정 포기',
    confirmText: '포기하기',
    cancelText: '계속 진행',
    icon: 'flag',
    danger: true,
  });
  if (ok) {
    toggleInGameOptions(false);
    audio.playCardPickup();
    engine.state = engine.createEmptyRunState('RUN_INIT', Date.now());
    resetRunUiTransitionState('IDLE');
    refreshContinueButton();
    switchView('VIEW_TITLE_LOBBY');
  }
});

// 빠른 흐름 점검용 [테스트] 즉시 승리
document.getElementById('btn-instant-win-test')?.addEventListener('click', () => {
  const snap = engine.getSnapshot();
  if (snap.activeDuel) {
    audio.playDamageHit();
    snap.activeDuel.seats[1].lp = 0;
    engine.evaluateDuelOutcome(snap.activeDuel);
    syncRunPhaseView();
  }
});

// ============================================================================
// 4.5. VIEW_CHECKPOINT & 서브페이지 컨트롤러
// - 메인 허브: 4대 포털 (인카운터, 상점, 수상한 상인, 가방 & 덱 편집)
// - 유희왕 콘솔 스타일: 덱 ⇄ 가방(트렁크) 2분할 덱 편집기
// ============================================================================

/** 1. 체크포인트 메인 허브 화면 동기화 */
function renderCheckpointView(snap) {
  const roundTitleEl = document.getElementById('checkpoint-round-title');
  if (roundTitleEl) {
    roundTitleEl.textContent = `ROUND ${snap.roundNumber || 1}`;
  }

  const seededPillEl = document.getElementById('hub-seeded-run-pill');
  const seededTextEl = document.getElementById('hub-seeded-run-text');
  if (seededPillEl) {
    const isSeeded = Boolean(snap.isSeededRun);
    seededPillEl.hidden = !isSeeded;
    if (isSeeded && seededTextEl) {
      seededTextEl.textContent = `시드: ${snap.seedText || snap.seed} · 기록 미반영`;
    }
  }

  const eventPill = document.getElementById('hub-checkpoint-event-pill');
  const eventBadge = document.getElementById('hub-checkpoint-event-badge');
  const eventTitle = document.getElementById('hub-checkpoint-event-title');
  const ev = snap.checkpointEvent;
  if (eventPill) {
    if (ev) {
      eventPill.style.display = 'inline-flex';
      if (eventBadge) eventBadge.textContent = ev.badge || '돌발';
      if (eventTitle) eventTitle.textContent = ev.title || '';
    } else {
      eventPill.style.display = 'none';
    }
  }

  const goldAmountEl = document.getElementById('checkpoint-gold-amount');
  if (goldAmountEl) {
    goldAmountEl.textContent = (snap.gold ?? 0).toLocaleString();
  }

  const deckCountEl = document.getElementById('checkpoint-deck-count');
  const deckCount = snap.playerDeckCardIds?.length || 30;
  if (deckCountEl) deckCountEl.textContent = deckCount;

  const trunkCountEl = document.getElementById('checkpoint-trunk-count');
  const trunkCount = (snap.playerTrunkCardIds || []).length;
  if (trunkCountEl) trunkCountEl.textContent = trunkCount;

  const deckPill = document.getElementById('checkpoint-deck-status-pill');
  if (deckPill) {
    if (deckCount === 30) {
      deckPill.classList.remove('deck-warning');
    } else {
      deckPill.classList.add('deck-warning');
    }
  }

  // 포털 1: 다음 듀얼 인카운터 (상대 이름/전술 비공개 · 난이도와 보상만 표시)
  const enc = snap.nextEncounterInfo;
  if (enc) {
    const starsEl = document.getElementById('hub-encounter-stars');
    const rewardEl = document.getElementById('hub-encounter-reward');

    if (starsEl) starsEl.textContent = `${enc.stars || '★☆☆☆☆'}`;
    if (rewardEl) rewardEl.textContent = `+${(enc.rewardGold || 500).toLocaleString()}원`;
  }

  // 포털 2: 정발 카드팩 상점
  const totalStock = (snap.checkpointShopStock || []).reduce((acc, p) => acc + (p.stock || 0), 0);
  const packKinds = (snap.checkpointShopStock || []).length;
  const shopStockEl = document.getElementById('hub-shop-stock-count');
  if (shopStockEl) {
    shopStockEl.textContent = `${packKinds}종 · ${totalStock}팩`;
  }

  // 포털 3: 수상한 상인의 뒷골목
  const merchantBadge = document.getElementById('hub-merchant-status-badge');
  const merchantAvailDesc = document.getElementById('hub-merchant-avail-desc');
  const hasMerchant = snap.suspiciousMerchant && snap.suspiciousMerchant.items && snap.suspiciousMerchant.items.length > 0;
  if (hasMerchant) {
    if (merchantBadge) {
      merchantBadge.textContent = '방문 중';
      merchantBadge.className = 'portal-tag tag-merchant';
    }
    if (merchantAvailDesc) {
      const unboughtCount = snap.suspiciousMerchant.items.filter((i) => !i.purchased).length;
      merchantAvailDesc.textContent = unboughtCount > 0 ? `${unboughtCount}건 교환` : '완판';
      merchantAvailDesc.style.color = '#f472b6';
    }
  } else {
    if (merchantBadge) {
      merchantBadge.textContent = '미출현';
      merchantBadge.className = 'portal-tag';
      merchantBadge.style.background = 'rgba(100, 116, 139, 0.2)';
      merchantBadge.style.color = '#94a3b8';
      merchantBadge.style.border = '1px solid #475569';
    }
    if (merchantAvailDesc) {
      merchantAvailDesc.textContent = '부재중';
      merchantAvailDesc.style.color = '#94a3b8';
    }
  }

  // 포털 4: 가방 & 덱 편집 (트렁크)
  const deckReadyStatus = document.getElementById('hub-deck-ready-status');
  if (deckReadyStatus) deckReadyStatus.textContent = `${deckCount}/30`;

  const trunkTotalStatus = document.getElementById('hub-trunk-total-status');
  if (trunkTotalStatus) trunkTotalStatus.textContent = `가방 ${trunkCount}`;

  const deckValidityText = document.getElementById('hub-deck-validity-text');
  if (deckValidityText) {
    if (deckCount === 30) {
      deckValidityText.textContent = '출격 가능';
      deckValidityText.style.color = '#4ade80';
    } else {
      deckValidityText.innerHTML = `${svgIcon('warn')} ${deckCount}장`;
      deckValidityText.style.color = '#f87171';
    }
  }
}

/** 2. 다음 듀얼 인카운터 브리핑 & 출격 확인 페이지 (상대 정보 비공개, 대략적 난이도와 시작 확인만 표기) */
function renderCheckpointEncounterSubpage(snap) {
  const deckCount = snap.playerDeckCardIds?.length || 30;
  const deckStatusEl = document.getElementById('encounter-subpage-deck-status');
  if (deckStatusEl) deckStatusEl.textContent = `${deckCount} / 30`;

  const enc = snap.nextEncounterInfo;
  if (enc) {
    const avatarEl = document.getElementById('encounter-dossier-avatar');
    const starsEl = document.getElementById('encounter-dossier-stars');
    const titleEl = document.getElementById('encounter-dossier-title');
    const nameEl = document.getElementById('encounter-dossier-name');
    const descEl = document.getElementById('encounter-dossier-desc');
    const rewardEl = document.getElementById('encounter-dossier-reward');

    if (starsEl) starsEl.textContent = `${enc.stars || '★☆☆☆☆'} · 위험도: ${enc.difficultyLabel || '낮음'}`;
    if (titleEl) titleEl.textContent = `라운드 ${snap.roundNumber || 1} 도전자`;
    if (nameEl) nameEl.textContent = '???';
    if (descEl) {
      descEl.textContent = '전장에 입장하기 전까지 상대의 정체는 공개되지 않습니다. 대전을 시작하시겠습니까?';
    }
    if (rewardEl) rewardEl.textContent = `+${(enc.rewardGold || 500).toLocaleString()}원`;

    if (avatarEl) {
      avatarEl.innerHTML = `<span class="mystery-mark">?</span>`;
    }
  }

  const hintEl = document.getElementById('encounter-dossier-deck-hint');
  const duelBtn = document.getElementById('btn-start-encounter-from-subpage');
  if (deckCount === 30) {
    if (hintEl) {
      hintEl.innerHTML = `${svgIcon('check')} 출전 준비 완료 (30 / 30)`;
      hintEl.className = 'dossier-deck-hint';
    }
    if (duelBtn) duelBtn.disabled = false;
  } else {
    if (hintEl) {
      hintEl.innerHTML = `${svgIcon('warn')} 출전 덱은 30장이어야 합니다 (현재 ${deckCount}장). [덱 편집]에서 30장을 맞춰 주세요.`;
      hintEl.className = 'dossier-deck-hint is-invalid';
    }
    if (duelBtn) duelBtn.disabled = true;
  }
}

/** 3. 카드팩 상점 전용 페이지 */
function renderCheckpointShopSubpage(snap) {
  const shopPortrait = document.getElementById('shopkeeper-portrait');
  if (shopPortrait) {
    const allSold = (snap.checkpointShopStock || []).every((p) => p.stock <= 0);
    const hasLegend = (snap.checkpointShopStock || []).some((p) => p.faction === 'ALL' && p.stock > 0);
    const mood = allSold ? 3 : hasLegend ? 2 : null;
    const src = npcPortraitSrc('shop', snap.roundNumber, mood);
    if (shopPortrait.dataset.src !== src) {
      shopPortrait.dataset.src = src;
      shopPortrait.innerHTML = artImg(src, 'npc-portrait-img', svgIcon('shop'));
    }
  }
  const goldEl = document.getElementById('shop-subpage-gold');
  if (goldEl) goldEl.textContent = (snap.gold ?? 0).toLocaleString();

  const shelfContainer = document.getElementById('checkpoint-shop-shelf-container');
  if (!shelfContainer) return;

  shelfContainer.innerHTML = '';
  const packs = snap.checkpointShopStock || [];

  packs.forEach((pack) => {
    const packEl = document.createElement('div');
    const isLegend = pack.theme === 'LEGENDARY';
    packEl.className = `booster-pack-item ${isLegend ? 'pack-legendary' : ''}`;

    let visualClass = 'pack-visual-blue';
    let symbol = svgIcon('balance');
    let tagline = '성역 · 수호 · 결계';

    if (pack.id === 'PACK_RED') {
      visualClass = 'pack-visual-red';
      symbol = svgIcon('flame');
      tagline = '맹공 · 화염 · 돌파';
    } else if (pack.id === 'PACK_PURPLE') {
      visualClass = 'pack-visual-purple';
      symbol = svgIcon('dice');
      tagline = '변수 · 도박 · 비술';
    } else if (pack.id === 'PACK_WILD') {
      visualClass = 'pack-visual-neutral';
      symbol = svgIcon('gear');
      tagline = '야수 · 기계 · 정령 · 용병';
    } else if (pack.id === 'PACK_LEGEND') {
      visualClass = 'pack-visual-legend';
      symbol = svgIcon('crown');
      tagline = '에픽 ~ 레전드 등급 수록';
    }

    const isSoldOut = pack.stock <= 0;
    const canAfford = (snap.gold ?? 0) >= pack.price;

    packEl.innerHTML = `
      <div class="pack-visual-box ${visualClass}">
        ${artImg(PACK_ART[pack.id], 'pack-art-img', `<span class="pack-symbol-art">${symbol}</span>`)}
        <div class="pack-foil-shimmer"></div>
      </div>
      <div class="pack-info-wrap">
        <h4 class="pack-title">${pack.name}</h4>
        <span class="pack-tagline">${tagline}</span>
        <div class="pack-meta-row">
          <span class="pack-price-tag">${pack.price.toLocaleString()}원</span>
          <span class="pack-stock-badge ${isSoldOut ? 'sold-out' : ''}">
            ${isSoldOut ? '품절' : `재고 ${pack.stock}팩`}
          </span>
        </div>
      </div>
      <button class="btn primary-btn btn-buy-pack" ${isSoldOut || !canAfford ? 'disabled' : ''}>
        ${isSoldOut ? '품절' : !canAfford ? '골드 부족' : `구매 (${pack.price.toLocaleString()}원)`}
      </button>
    `;

    const buyBtn = packEl.querySelector('.btn-buy-pack');
    buyBtn?.addEventListener('click', async () => {
      try {
        audio.playCardPlayImpact();
        const result = engine.buyBoosterPack(pack.id);
        audio.playVictoryJingle();
        displayPackOpeningResultBanner(result.choices);
        renderCheckpointShopSubpage(engine.getSnapshot());
      } catch (err) {
        console.error('[Buy Pack Error]', err);
        await showGameAlert(err.message || '카드팩 구매에 실패했습니다.', { title: '구매 실패', danger: true });
      }
    });

    shelfContainer.appendChild(packEl);
  });

  // 2. 단품 낱장 카드 진열대 렌더링
  const singlesContainer = document.getElementById('checkpoint-shop-singles-container');
  if (singlesContainer) {
    singlesContainer.innerHTML = '';
    const singles = snap.checkpointShopSingles || [];
    singles.forEach((item) => {
      const cardDef = lookupCardDef(item.cardId);
      if (!cardDef) return;

      const isMonster = cardDef.type === 'MONSTER' || (cardDef.attack > 0 && cardDef.type !== 'SPELL');
      const itemEl = document.createElement('div');
      itemEl.className = `shop-single-card-item ${item.purchased ? 'is-purchased' : ''}`;

      const canAfford = (snap.gold ?? 0) >= item.price && !item.purchased;

      itemEl.innerHTML = `
        <div class="shop-single-card-frame">
          ${generateCompositeCardHtml(cardDef, cardDef.attack, cardDef.defense ?? cardDef.health, 0.85, false)}
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <h4 style="font-size:0.95rem; font-weight:800; color:#f1f5f9;">${cardDef.name}</h4>
          <span style="font-size:0.72rem; color:#f59e0b;">${isMonster ? `Lv.${cardDef.level || cardDef.cost} 몬스터` : '마법 카드'}</span>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:0.72rem; color:#94a3b8;">가격</span>
            <strong style="font-size:1.05rem; font-weight:900; color:#fde047;">${item.price.toLocaleString()}원</strong>
          </div>
        </div>
        <button class="btn secondary-btn btn-buy-shop-single" ${!canAfford ? 'disabled' : ''}>
          ${item.purchased ? '구매 완료' : !canAfford ? '골드 부족' : `구매 (${item.price.toLocaleString()}원)`}
        </button>
      `;

      const buyBtn = itemEl.querySelector('.btn-buy-shop-single');
      buyBtn?.addEventListener('click', async () => {
        try {
          audio.playCardPlayImpact();
          engine.buyShopSingleCard(item.cardId);
          audio.playVictoryJingle();
          renderCheckpointShopSubpage(engine.getSnapshot());
        } catch (err) {
          console.error('[Buy Shop Single Error]', err);
          await showGameAlert(err.message || '낱장 카드 구매에 실패했습니다.', { title: '구매 실패', danger: true });
        }
      });

      singlesContainer.appendChild(itemEl);
    });
  }
}

function displayPackOpeningResultBanner(choices) {
  const banner = document.getElementById('shop-pack-result-banner');
  const cardsContainer = document.getElementById('shop-pack-result-cards');
  if (!banner || !cardsContainer) return;

  cardsContainer.innerHTML = '';
  choices.forEach((cardId) => {
    const def = lookupCardDef(cardId);
    if (!def) return;

    const cardEl = document.createElement('div');
    cardEl.className = 'pack-result-card-frame';
    cardEl.innerHTML = generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.85, false);
    cardsContainer.appendChild(cardEl);
  });

  banner.classList.remove('is-hidden');
}

document.getElementById('btn-close-pack-result')?.addEventListener('click', () => {
  document.getElementById('shop-pack-result-banner')?.classList.add('is-hidden');
});

/** 4. 수상한 상인의 뒷골목 전용 페이지 (암시장 물물교환) */
let activeTradeDeal = null;
let activeSelectedCandidates = []; // { key: string, cardId: string, source: 'trunk' | 'deck', idx: number }
let activeSelectedTrunkIndices = []; // 하위 호환성 유지

function openTradeSelectModal(deal) {
  const snap = engine.getSnapshot();
  activeTradeDeal = deal;
  activeSelectedCandidates = [];
  activeSelectedTrunkIndices = [];

  const modal = document.getElementById('modal-trade-select');
  if (!modal) return;

  const titleEl = document.getElementById('trade-select-dialog-title');
  if (titleEl) titleEl.textContent = `카드 교환: ${deal.title}`;
  const subEl = document.getElementById('trade-select-dialog-sub');
  if (subEl) subEl.textContent = deal.flavor;

  const targetPreviewEl = document.getElementById('trade-target-preview');
  if (targetPreviewEl) {
    const rDef = deal.rewardDef || lookupCardDef(deal.rewardCardId);
    const isMonster = rDef ? (rDef.type === 'MONSTER' || (rDef.attack > 0 && rDef.type !== 'SPELL')) : false;
    const reqCount = deal.wantedCardIds ? deal.wantedCardIds.length : (deal.requiredCardCount || 1);

    targetPreviewEl.innerHTML = `
      <div style="font-size:0.8rem; font-weight:800; color:#c084fc; margin-bottom:4px;">획득 카드</div>
      <div style="width:130px; height:182px; display:flex; align-items:center; justify-content:center;">
        ${rDef ? generateCompositeCardHtml(rDef, rDef.attack, rDef.defense ?? rDef.health, 0.65, false) : ''}
      </div>
      <div style="text-align:center; margin-top:6px;">
        <h4 style="margin:0; font-size:1.02rem; color:#f8fafc; font-weight:800;">${rDef?.name || deal.cardName}</h4>
        <span style="font-size:0.75rem; color:#a855f7;">${isMonster ? `Lv.${rDef.level || rDef.cost} 몬스터` : '마법 카드'}</span>
      </div>

      <!-- 요구 카드 체크리스트 박스 -->
      <div class="modal-wanted-box">
        <div class="modal-wanted-header">
          <span>${svgIcon('target')} 요구 카드</span>
          <span style="font-size:0.68rem; color:#cbd5e1;">(${reqCount}장)</span>
        </div>
        <div id="modal-wanted-items-list">
          <!-- updateTradeModalState에서 동적 렌더링 -->
        </div>
      </div>
    `;
  }

  renderTradeTrunkCards(snap);
  updateTradeModalState(snap);

  modal.classList.add('active');
}

function closeTradeModal() {
  const modal = document.getElementById('modal-trade-select');
  if (modal) modal.classList.remove('active');
  activeTradeDeal = null;
  activeSelectedCandidates = [];
  activeSelectedTrunkIndices = [];
}

function renderTradeTrunkCards(snap) {
  const container = document.getElementById('trade-trunk-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const trunkCards = snap.playerTrunkCardIds || [];
  const deckCards = snap.playerDeckCardIds || [];
  const masterId = snap.playerDeckMasterCardId;

  // 플레이어가 보유한 모든 후보 카드 (가방 + 출전 덱)
  const candidates = [];
  trunkCards.forEach((cId, idx) => {
    candidates.push({ key: `trunk_${idx}`, cardId: cId, source: 'trunk', idx });
  });
  deckCards.forEach((cId, idx) => {
    if (cId !== masterId) {
      candidates.push({ key: `deck_${idx}`, cardId: cId, source: 'deck', idx });
    }
  });

  if (candidates.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 36px 16px; text-align: center; color: #94a3b8; font-size: 0.88rem;">
        ${svgIcon('bag')} 보유한 교환 가능한 카드가 없습니다!<br>
        <small style="color:#64748b; margin-top:6px; display:inline-block;">(상점에서 부스터팩이나 낱장 카드를 구매한 후 다시 찾아오세요.)</small>
      </div>
    `;
    return;
  }

  // 상인이 원하는 지정 카드를 맨 위로 우선 정렬
  const wantedList = activeTradeDeal?.wantedCardIds || [];
  candidates.sort((a, b) => {
    const aWanted = wantedList.includes(a.cardId) ? 1 : 0;
    const bWanted = wantedList.includes(b.cardId) ? 1 : 0;
    if (bWanted !== aWanted) return bWanted - aWanted;
    if (a.source !== b.source) return a.source === 'trunk' ? -1 : 1;
    return a.idx - b.idx;
  });

  candidates.forEach((cand) => {
    const cardDef = lookupCardDef(cand.cardId);
    if (!cardDef) return;

    const isWanted = wantedList.includes(cand.cardId);
    const selIdx = activeSelectedCandidates.findIndex((c) => c.key === cand.key);
    const isSelected = selIdx !== -1;
    const selectionOrder = isSelected ? selIdx + 1 : 0;

    const cardEl = document.createElement('div');
    cardEl.className = `trade-selectable-card ${isSelected ? 'is-selected' : ''} ${isWanted ? 'is-designated' : 'is-not-designated'}`;
    cardEl.setAttribute('data-cand-key', cand.key);

    const sourceLabel = cand.source === 'trunk' ? `${svgIcon('bag')} 가방` : `${svgIcon('sword')} 덱`;
    const sourceClass = cand.source === 'trunk' ? 'source-trunk' : 'source-deck';

    cardEl.innerHTML = `
      ${isSelected ? `<span class="trade-check-badge">${svgIcon('check')} 선택 #${selectionOrder}</span>` : ''}
      ${isWanted && !isSelected ? `<span class="trade-designated-target-badge">${svgIcon('target')} 요구 카드</span>` : ''}
      <span class="trade-source-badge ${sourceClass}">${sourceLabel}</span>
      <div class="trade-card-frame">
        ${generateCompositeCardHtml(cardDef, cardDef.attack, cardDef.defense ?? cardDef.health, 0.44, true)}
      </div>
      <div style="font-size: 0.72rem; color: #cbd5e1; margin-top: 4px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; pointer-events: none; font-weight: 700;">
        ${cardDef.name}
      </div>
    `;

    cardEl.addEventListener('click', () => {
      if (!activeTradeDeal) return;
      const expectedCount = activeTradeDeal.wantedCardIds ? activeTradeDeal.wantedCardIds.length : (activeTradeDeal.requiredCardCount || 1);

      if (isSelected) {
        // 선택 해제
        activeSelectedCandidates.splice(selIdx, 1);
        audio.playCardPickup();
      } else {
        // 이미 요구 수량을 채웠는지 검사
        if (activeSelectedCandidates.length >= expectedCount) {
          audio.playLightTap();
          return;
        }

        // 상인이 요구하는 카드인지 검사 (지정 카드 요구 조건이 있는 경우)
        if (wantedList.length > 0) {
          // 해당 카드가 요구 목록에 있고, 아직 요구된 수량만큼 선택되지 않았는지 확인
          const neededCount = wantedList.filter((id) => id === cand.cardId).length;
          const alreadySelectedCount = activeSelectedCandidates.filter((c) => c.cardId === cand.cardId).length;

          if (!isWanted || alreadySelectedCount >= neededCount) {
            audio.playLightTap();
            const hintEl = document.getElementById('trade-dialog-hint');
            if (hintEl) {
              hintEl.innerHTML = `<span style="color:#f87171;">${svgIcon('warn')} 요구 카드(${svgIcon('target')})만 선택할 수 있습니다.</span>`;
            }
            return;
          }
        }

        activeSelectedCandidates.push(cand);
        audio.playCardPlayImpact();
      }

      // 하위 호환성 인덱스 동기화
      activeSelectedTrunkIndices = activeSelectedCandidates
        .filter((c) => c.source === 'trunk')
        .map((c) => c.idx);

      renderTradeTrunkCards(engine.getSnapshot());
      updateTradeModalState(engine.getSnapshot());
    });

    container.appendChild(cardEl);
  });
}

function updateTradeModalState(snap) {
  if (!activeTradeDeal) return;

  const expectedCount = activeTradeDeal.wantedCardIds ? activeTradeDeal.wantedCardIds.length : (activeTradeDeal.requiredCardCount || 1);

  const countTextEl = document.getElementById('trade-select-count-text');
  if (countTextEl) {
    countTextEl.textContent = `${activeSelectedCandidates.length} / ${expectedCount}장`;
  }

  // 모달 좌측의 트레이더 지정 요구 조건 목록 동기화
  const listEl = document.getElementById('modal-wanted-items-list');
  if (listEl && activeTradeDeal.wantedCardIds) {
    const selectedCopy = [...activeSelectedCandidates];
    listEl.innerHTML = activeTradeDeal.wantedCardIds.map((wId) => {
      const matchIdx = selectedCopy.findIndex((c) => c.cardId === wId);
      const isSatisfied = matchIdx !== -1;
      let sourceTag = '';
      if (isSatisfied) {
        const item = selectedCopy.splice(matchIdx, 1)[0];
        sourceTag = item.source === 'trunk' ? ' [가방]' : ' [출전 덱]';
      }
      const wDef = lookupCardDef(wId);
      return `
        <div class="modal-wanted-item ${isSatisfied ? 'is-satisfied' : 'is-pending'}">
          <span>${isSatisfied ? svgIcon('check') : svgIcon('crystal')} ${wDef?.name || wId}</span>
          <span style="font-size:0.65rem; font-weight:800;">${isSatisfied ? `선택됨${sourceTag}` : '대기 중'}</span>
        </div>
      `;
    }).join('');
  }

  const fee = activeTradeDeal.goldFee || 0;
  const currentGold = snap.gold ?? 0;
  const feeHintEl = document.getElementById('trade-fee-hint');
  if (feeHintEl) {
    if (fee > 0) {
      feeHintEl.innerHTML = `${svgIcon('gold')} 추가 비용: <strong>${fee.toLocaleString()}원</strong> (보유: ${currentGold.toLocaleString()}원)`;
      feeHintEl.style.color = currentGold >= fee ? '#fde047' : '#ef4444';
    } else {
      feeHintEl.innerHTML = `<span style="color:#a3e635;">${svgIcon('gold')} 추가 비용 없음</span>`;
    }
  }

  const hintEl = document.getElementById('trade-dialog-hint');
  const confirmBtn = document.getElementById('btn-confirm-trade');

  const hasEnoughGold = currentGold >= fee;
  const hasSelectedAll = activeSelectedCandidates.length === expectedCount;

  if (hasSelectedAll) {
    if (hasEnoughGold) {
      // 엔진의 실제 거래 계획으로 안내문을 만든다. (가방 우선 차감, 덱 빈 슬롯은 보상 카드 + 가방 카드로 보충)
      let plan = null;
      let planError = null;
      try {
        plan = engine.planMerchantTrade(activeTradeDeal.dealId, activeSelectedCandidates.map((c) => c.cardId));
      } catch (err) {
        planError = err.message || '거래 조건을 충족하지 못했습니다.';
      }
      if (confirmBtn) confirmBtn.disabled = !plan;
      if (hintEl) {
        if (!plan) {
          hintEl.innerHTML = `<span style="color:#f87171; font-weight:700;">${svgIcon('warn')} ${planError}</span>`;
        } else if (plan.refillCardIds.length > 0) {
          const names = plan.refillCardIds
            .map((id) => `「${lookupCardDef(id)?.name || id}」`)
            .join(', ');
          hintEl.innerHTML = `<span style="color:#4ade80; font-weight:700;">${svgIcon('check')} 교환 준비 완료 · 덱 빈자리는 획득 카드와 가방의 ${names}로 자동 채워집니다.</span>`;
        } else if (plan.deckConsumed > 0) {
          hintEl.innerHTML = `<span style="color:#4ade80; font-weight:700;">${svgIcon('check')} 교환 준비 완료 · 덱 카드는 획득 카드로 자동 교체됩니다.</span>`;
        } else {
          hintEl.innerHTML = `<span style="color:#4ade80; font-weight:700;">${svgIcon('check')} 교환 준비 완료 · [교환 확정]을 눌러 거래를 완료하세요.</span>`;
        }
      }
    } else {
      if (confirmBtn) confirmBtn.disabled = true;
      if (hintEl) {
        hintEl.innerHTML = `<span style="color:#f87171; font-weight:700;">${svgIcon('warn')} 골드가 부족합니다. (보유: ${currentGold.toLocaleString()}원 / 필요: ${fee.toLocaleString()}원)</span>`;
      }
    }
  } else {
    if (confirmBtn) confirmBtn.disabled = true;
    const remaining = expectedCount - activeSelectedCandidates.length;
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#94a3b8;">목록에서 요구 카드(${svgIcon('target')})를 <strong>${remaining}장</strong> 더 선택해 주세요.</span>`;
    }
  }
}

function renderCheckpointMerchantSubpage(snap) {
  renderCheckpointEncounterSubpage(snap);

  const merchantIcon = document.querySelector('#merchant-dialogue-banner .merchant-npc-icon');
  if (merchantIcon) {
    const done = (snap.suspiciousMerchant?.deals || []).filter((d) => d.completed).length;
    const src = npcPortraitSrc('merchant', snap.roundNumber, done > 0 ? 3 : null);
    if (merchantIcon.dataset.src !== src) {
      merchantIcon.dataset.src = src;
      merchantIcon.innerHTML = artImg(src, 'npc-portrait-img', svgIcon('merchant'));
    }
  }
  const goldEl = document.getElementById('merchant-subpage-gold');
  if (goldEl) goldEl.textContent = (snap.gold ?? 0).toLocaleString();

  const container = document.getElementById('checkpoint-merchant-deals-container') ||
                    document.getElementById('checkpoint-merchant-shelf-container');
  if (!container) return;

  const dialogueText = document.getElementById('merchant-dialogue-text');
  const merchant = snap.suspiciousMerchant;

  if (!merchant || (!merchant.deals && (!merchant.items || merchant.items.length === 0))) {
    container.innerHTML = `
      <div class="merchant-empty-alley">
        <span class="alley-ghost-icon">${svgIcon('moon')}</span>
        <p>이번 라운드에는 거래상이 모습을 드러내지 않았습니다.</p>
      </div>
    `;
    if (dialogueText) {
      dialogueText.textContent = '"골목에 거래상의 기척이 없습니다."';
    }
    return;
  }

  if (dialogueText && merchant.dialogue) {
    dialogueText.textContent = merchant.dialogue;
  }

  container.innerHTML = '';

  // 1) 신규 암시장 물물교환(Trade Deals) 제안 목록 렌더링
  if (merchant.deals && merchant.deals.length > 0) {
    const trunkCards = snap.playerTrunkCardIds || [];
    const deckCards = (snap.playerDeckCardIds || []).filter((id) => id !== snap.playerDeckMasterCardId);

    merchant.deals.forEach((deal) => {
      const cardDef = deal.rewardDef || lookupCardDef(deal.rewardCardId);
      if (!cardDef) return;

      const isMonster = cardDef.type === 'MONSTER' || (cardDef.attack > 0 && cardDef.type !== 'SPELL');
      const dealCardEl = document.createElement('div');
      dealCardEl.className = `trade-deal-card ${deal.completed ? 'deal-completed' : ''}`;

      const isAsym = deal.dealType && deal.dealType.startsWith('ASYMMETRIC');
      const reqCount = deal.wantedCardIds ? deal.wantedCardIds.length : (deal.requiredCardCount || 1);

      // 플레이어가 요구 카드를 실제로 보유하고 있는지 체크 및 칩 생성
      let wantedHtml = '';
      let canFulfill = true;

      if (deal.wantedCardIds && deal.wantedCardIds.length > 0) {
        const tempTrunk = [...trunkCards];
        const tempDeck = [...deckCards];

        const chipsHtml = deal.wantedCardIds.map((wId) => {
          const wDef = lookupCardDef(wId);
          const tIdx = tempTrunk.indexOf(wId);
          let inTrunk = false;
          let inDeck = false;

          if (tIdx !== -1) {
            inTrunk = true;
            tempTrunk.splice(tIdx, 1);
          } else {
            const dIdx = tempDeck.indexOf(wId);
            if (dIdx !== -1) {
              inDeck = true;
              tempDeck.splice(dIdx, 1);
            }
          }

          if (!inTrunk && !inDeck) canFulfill = false;

          const statusClass = inTrunk ? 'in-trunk' : inDeck ? 'in-deck' : 'missing';
          const statusText = inTrunk
            ? `${svgIcon('bag')} 가방 보유`
            : inDeck
              ? `${svgIcon('swords')} 덱 장착`
              : `${svgIcon('cross')} 미보유`;

          return `
            <div class="wanted-chip">
              <div class="wanted-chip-left">
                <span style="font-size:0.75rem;">${svgIcon('target')}</span>
                <span>${wDef?.name || wId}</span>
              </div>
              <span class="wanted-status-pill ${statusClass}">${statusText}</span>
            </div>
          `;
        }).join('');

        wantedHtml = `<div class="deal-wanted-list">${chipsHtml}</div>`;
      } else {
        wantedHtml = `<div class="req-desc">${deal.flavor || '가방의 카드를 건네고 교환합니다.'}</div>`;
      }

      dealCardEl.innerHTML = `
        <div class="deal-offer-side">
          <div class="deal-preview-mini">
            ${generateCompositeCardHtml(cardDef, cardDef.attack, cardDef.defense ?? cardDef.health, 0.48, true)}
          </div>
          <div class="deal-info-wrap">
            <h4 class="deal-card-name">${cardDef.name}</h4>
            <span class="deal-card-type">${isMonster ? `Lv.${cardDef.level || cardDef.cost} 몬스터` : '마법 카드'}</span>
            <span style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">${deal.flavor || ''}</span>
          </div>
        </div>

        <div class="deal-direction-center">
          <span class="deal-ratio-badge ${isAsym ? 'asym-badge' : ''}">${deal.ratioBadge || `${reqCount}:1`}</span>
          <span class="deal-exchange-icon">⇄</span>
        </div>

        <div class="deal-req-side">
          <div class="req-title">요구 카드 <strong>(${reqCount}장)</strong></div>
          ${wantedHtml}
          ${(deal.goldFee || 0) > 0 ? `<div class="req-fee">${svgIcon('gold')} 추가 비용: <strong>${deal.goldFee.toLocaleString()}원</strong></div>` : `<div class="req-fee" style="color:#a3e635;">${svgIcon('gold')} 추가 비용 없음</div>`}
        </div>

        <div class="deal-action-side">
          <button class="btn btn-start-trade" ${deal.completed || !canFulfill ? 'disabled' : ''} data-deal-id="${deal.dealId}">
            ${deal.completed ? `${svgIcon('check')} 교환 완료` : !canFulfill ? `${svgIcon('cross')} 요구 카드 부족` : `${svgIcon('trade')} 교환하기`}
          </button>
        </div>
      `;

      const tradeBtn = dealCardEl.querySelector('.btn-start-trade');
      tradeBtn?.addEventListener('click', () => {
        if (deal.completed || !canFulfill) return;
        audio.playCardPickup();
        openTradeSelectModal(deal);
      });

      container.appendChild(dealCardEl);
    });
  } else if (merchant.items && merchant.items.length > 0) {
    // 2) 하위 호환: 기존 낱장 판매 목록
    merchant.items.forEach((item) => {
      const cardDef = lookupCardDef(item.cardId);
      if (!cardDef) return;

      const isMonster = cardDef.type === 'MONSTER' || (cardDef.attack > 0 && cardDef.type !== 'SPELL');
      const itemCardEl = document.createElement('div');
      itemCardEl.className = `merchant-item-card ${item.purchased ? 'is-purchased' : ''}`;
      const canAfford = (snap.gold ?? 0) >= item.price && !item.purchased;

      itemCardEl.innerHTML = `
        <div class="merchant-card-preview-mini">
          ${generateCompositeCardHtml(cardDef, cardDef.attack, cardDef.defense ?? cardDef.health, 0.52, true)}
        </div>
        <div class="merchant-item-details">
          <h4 class="merchant-card-name">${cardDef.name}</h4>
          <span class="merchant-card-type-sub">${isMonster ? `Lv.${cardDef.level || cardDef.cost} 몬스터` : '마법 카드'}</span>
          <div class="merchant-price-line">
            <span style="font-size:0.75rem; color:#94a3b8;">낱장 직거래가</span>
            <strong>${item.price.toLocaleString()}원</strong>
          </div>
        </div>
        <button class="btn secondary-btn btn-buy-single" ${!canAfford ? 'disabled' : ''}>
          ${item.purchased ? '구매 완료 (가방 보관 중)' : !canAfford ? '골드 부족' : `낱장 구매 (${item.price.toLocaleString()}원)`}
        </button>
      `;

      const buyBtn = itemCardEl.querySelector('.btn-buy-single');
      buyBtn?.addEventListener('click', async () => {
        try {
          audio.playCardPlayImpact();
          engine.buySuspiciousMerchantCard(item.cardId);
          audio.playVictoryJingle();
          renderCheckpointMerchantSubpage(engine.getSnapshot());
        } catch (err) {
          console.error('[Buy Merchant Card Error]', err);
          await showGameAlert(err.message || '카드 구매에 실패했습니다.', { title: '거래 실패', danger: true });
        }
      });

      container.appendChild(itemCardEl);
    });
  }
}

/** 5. 유희왕 콘솔 스타일 가방 & 덱 편집기 (트렁크) */
function renderCheckpointDeckEditorSubpage(snap) {
  const deckCards = snap.playerDeckCardIds || [];
  const trunkCards = snap.playerTrunkCardIds || [];
  const deckMasterId = snap.playerDeckMasterCardId;

  // 헤더 미터
  const currentCountEl = document.getElementById('editor-deck-current-count');
  const deckTitleCountEl = document.getElementById('editor-deck-title-count');
  if (currentCountEl) currentCountEl.textContent = deckCards.length;
  if (deckTitleCountEl) deckTitleCountEl.textContent = deckCards.length;

  const trunkCountEl = document.getElementById('editor-trunk-count');
  const bagTitleCountEl = document.getElementById('editor-bag-title-count');
  if (trunkCountEl) trunkCountEl.textContent = trunkCards.length;
  if (bagTitleCountEl) bagTitleCountEl.textContent = trunkCards.length;

  const meterPill = document.getElementById('editor-deck-meter-pill');
  const noticeEl = document.getElementById('editor-deck-validation-notice');

  if (deckCards.length === 30) {
    if (meterPill) { meterPill.className = 'meter-pill is-valid'; }
    if (noticeEl) {
      noticeEl.innerHTML = `${svgIcon('check')} 출전 덱(30장) 구성이 완료되었습니다.`;
      noticeEl.className = 'editor-status-notice';
    }
  } else if (deckCards.length < 30) {
    if (meterPill) { meterPill.className = 'meter-pill is-invalid'; }
    if (noticeEl) {
      noticeEl.innerHTML = `${svgIcon('warn')} 덱 매수가 부족합니다. (현재 ${deckCards.length}장 / 30장) 가방에서 ${30 - deckCards.length}장을 더 추가하세요.`;
      noticeEl.className = 'editor-status-notice is-error';
    }
  } else {
    if (meterPill) { meterPill.className = 'meter-pill is-invalid'; }
    if (noticeEl) {
      noticeEl.innerHTML = `${svgIcon('warn')} 덱 매수가 초과되었습니다. (현재 ${deckCards.length}장 / 30장) 덱에서 ${deckCards.length - 30}장을 빼 가방으로 보내세요.`;
      noticeEl.className = 'editor-status-notice is-error';
    }
  }

  // 중앙: 현재 듀얼 덱 (5×6 순수 카드 그래픽 렌더링)
  const deckGrid = document.getElementById('editor-deck-cards-grid');
  if (deckGrid) {
    deckGrid.innerHTML = '';
    deckCards.forEach((cardId) => {
      const def = lookupCardDef(cardId);
      if (!def) return;

      const isDeckMaster = cardId === deckMasterId;
      const isLv1Monster = def.type === 'MONSTER' && (def.level ?? def.cost ?? 1) === 1;
      const tileEl = document.createElement('div');
      tileEl.className = `trunk-card-tile ${isDeckMaster ? 'is-deckmaster' : ''}`;
      tileEl.title = isDeckMaster
        ? `${def.name} (현재 덱 마스터 · 클릭하여 변경)`
        : isLv1Monster
          ? `${def.name} (클릭: 가방 이동 · 우클릭: 덱 마스터 지정)`
          : def.name;

      tileEl.innerHTML = `
        <div class="trunk-card-frame">
          ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.38, true)}
        </div>
      `;

      tileEl.addEventListener('mouseenter', () => syncEditorInspectedCard(def, isDeckMaster));

      if (isLv1Monster && !isDeckMaster) {
        tileEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          applyDeckMasterChange(cardId);
        });
      }

      if (isDeckMaster) {
        tileEl.addEventListener('click', () => {
          syncEditorInspectedCard(def, true);
          audio.playCardPickup();
          openDeckMasterPickerModal();
        });
      } else {
        tileEl.addEventListener('click', () => {
          try {
            audio.playCardPickup();
            engine.moveCardDeckToTrunk(cardId);
            renderCheckpointDeckEditorSubpage(engine.getSnapshot());
            syncEditorInspectedCard(def, false);
          } catch (e) {
            console.error(e);
          }
        });
      }

      deckGrid.appendChild(tileEl);
    });
  }

  // 우측: 가방 (트렁크 - 순수 카드 그래픽 렌더링)
  const bagGrid = document.getElementById('editor-bag-cards-grid');
  if (bagGrid) {
    bagGrid.innerHTML = '';
    if (trunkCards.length === 0) {
      bagGrid.innerHTML = `
        <div style="color:#64748b; font-size:0.82rem; padding:40px 10px; text-align:center; grid-column:1/-1; line-height:1.6;">
          ${svgIcon('bag')} 가방이 비어 있습니다.<br>상점에서 부스터 팩이나 낱장 카드를 구매해 보세요.
        </div>
      `;
    } else {
      trunkCards.forEach((cardId) => {
        const def = lookupCardDef(cardId);
        if (!def) return;

        const tileEl = document.createElement('div');
        tileEl.className = 'trunk-card-tile';
        tileEl.title = def.name;

        tileEl.innerHTML = `
          <div class="trunk-card-frame">
            ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.42, true)}
          </div>
        `;

        tileEl.addEventListener('mouseenter', () => syncEditorInspectedCard(def, false));

        tileEl.addEventListener('click', () => {
          try {
            audio.playCardPlayImpact();
            engine.moveCardTrunkToDeck(cardId);
            renderCheckpointDeckEditorSubpage(engine.getSnapshot());
            syncEditorInspectedCard(def, false);
          } catch (e) {
            console.error(e);
          }
        });

        bagGrid.appendChild(tileEl);
      });
    }
  }

  // 초기 진입 시 덱 첫 번째 카드(덱 마스터 등)를 인스펙터에 기본 노출
  const initialPreviewDef = lookupCardDef(currentEditorInspectedCardId || deckMasterId || deckCards[0] || trunkCards[0]);
  if (initialPreviewDef) {
    syncEditorInspectedCard(initialPreviewDef, initialPreviewDef.id === deckMasterId);
  }
}

let currentEditorInspectedCardId = null;

function syncEditorInspectedCard(def, isDeckMaster = false) {
  if (!def) return;
  currentEditorInspectedCardId = def.id;
  updateCardInspector(def, null, null, { isDeckMaster });

  const labelEl = document.getElementById('editor-mastery-card-label');
  const selEl = document.getElementById('sel-editor-card-mastery-fx');
  if (labelEl) labelEl.textContent = def.name;
  if (selEl) {
    selEl.disabled = false;
    const override = masteryFxConfig.cardOverrides?.[def.id];
    selEl.value = override && override.preset ? override.preset : 'DEFAULT';
  }
}

document.getElementById('sel-editor-card-mastery-fx')?.addEventListener('change', (e) => {
  if (!currentEditorInspectedCardId) return;
  const preset = e.target.value;
  if (!masteryFxConfig.cardOverrides) masteryFxConfig.cardOverrides = {};
  if (preset === 'DEFAULT') {
    delete masteryFxConfig.cardOverrides[currentEditorInspectedCardId];
  } else {
    const info = MASTERY_FX_PRESETS[preset] || MASTERY_FX_PRESETS.NONE;
    masteryFxConfig.cardOverrides[currentEditorInspectedCardId] = {
      preset,
      glow: info.glow,
      foil: info.foil,
      tint: info.tint,
    };
  }
  saveMasteryFxConfig(masteryFxConfig);
  audio.playCardPickup();
  renderCheckpointDeckEditorSubpage(engine.getSnapshot());
  const def = lookupCardDef(currentEditorInspectedCardId);
  if (def) {
    syncEditorInspectedCard(def, def.id === engine.getSnapshot().playerDeckMasterCardId);
  }
});

function applyDeckMasterChange(cardId) {
  try {
    if (cardId === engine.state.playerDeckMasterCardId) return;
    audio.playCardPlayImpact();
    const updatedSnap = engine.setDeckMaster(cardId);
    renderCheckpointDeckEditorSubpage(updatedSnap);
    const def = lookupCardDef(cardId);
    if (def) {
      updateCardInspector(def, null, null, { isDeckMaster: true });
    }
  } catch (e) {
    showGameAlert(e.message || '덱 마스터를 변경할 수 없습니다.', {
      title: '덱 마스터 지정 불가',
      icon: 'warn',
    });
  }
}

let deckEditorBaseline = null;

function deckSignatureOf(deckIds, trunkIds, masterId) {
  const sortedDeck = [...(deckIds || [])].sort().join(',');
  const sortedTrunk = [...(trunkIds || [])].sort().join(',');
  return `${masterId || ''}|${sortedDeck}|${sortedTrunk}`;
}

function openCheckpointDeckEditor() {
  const snap = engine.getSnapshot();
  deckEditorBaseline = {
    deckCardIds: [...(snap.playerDeckCardIds || [])],
    trunkCardIds: [...(snap.playerTrunkCardIds || [])],
    deckMasterCardId: snap.playerDeckMasterCardId || null,
  };
  switchView('VIEW_CHECKPOINT_DECK_EDITOR');
  renderCheckpointDeckEditorSubpage(snap);
}

function hasDeckEditorChanges() {
  if (!deckEditorBaseline || !engine?.state) return false;
  const before = deckSignatureOf(
    deckEditorBaseline.deckCardIds,
    deckEditorBaseline.trunkCardIds,
    deckEditorBaseline.deckMasterCardId
  );
  const after = deckSignatureOf(
    engine.state.playerDeckCardIds,
    engine.state.playerTrunkCardIds,
    engine.state.playerDeckMasterCardId
  );
  return before !== after;
}

function commitDeckEditorChanges() {
  scheduleRunSave();
  deckEditorBaseline = null;
}

function revertDeckEditorChanges() {
  if (!deckEditorBaseline || !engine?.state) return;
  engine.state.playerDeckCardIds = [...deckEditorBaseline.deckCardIds];
  engine.state.playerTrunkCardIds = [...deckEditorBaseline.trunkCardIds];
  engine.state.playerDeckMasterCardId = deckEditorBaseline.deckMasterCardId;
  deckEditorBaseline = null;
}

async function attemptLeaveDeckEditor(onProceed) {
  if (!hasDeckEditorChanges()) {
    deckEditorBaseline = null;
    onProceed();
    return;
  }

  const choice = await openAppDialog({
    title: '변경 사항 저장',
    message: '덱 편성이 변경되었습니다. 저장하시겠습니까?',
    confirmText: '저장',
    neutralText: '저장 안 함',
    cancelText: '취소',
    icon: 'save',
  });

  if (choice === true) {
    const deckCount = (engine.state.playerDeckCardIds || []).length;
    if (deckCount !== 30) {
      await showGameAlert(`출전 덱은 정확히 30장이어야 저장할 수 있습니다. (현재 ${deckCount}장)`, {
        title: '덱 매수 확인',
        icon: 'warn',
        danger: true,
      });
      return;
    }
    commitDeckEditorChanges();
    onProceed();
  } else if (choice === 'neutral') {
    revertDeckEditorChanges();
    onProceed();
  }
}

function openDeckMasterPickerModal() {
  const modalEl = document.getElementById('modal-deckmaster-select');
  const bodyEl = document.getElementById('deckmaster-picker-body');
  if (!modalEl || !bodyEl) return;

  const snap = engine.getSnapshot();
  const currentMasterId = snap.playerDeckMasterCardId;
  const isLv1Monster = (id) => {
    const def = lookupCardDef(id);
    return !!def && def.type === 'MONSTER' && (def.level ?? def.cost ?? 1) === 1;
  };

  const uniqueDeckLv1 = [...new Set((snap.playerDeckCardIds || []).filter(isLv1Monster))];
  uniqueDeckLv1.sort((a, b) => (a === currentMasterId ? -1 : b === currentMasterId ? 1 : 0));

  const deckSet = new Set(uniqueDeckLv1);
  const uniqueTrunkLv1 = [...new Set((snap.playerTrunkCardIds || []).filter((id) => isLv1Monster(id) && !deckSet.has(id)))];

  const renderGroup = (titleHtml, ids, sourceLabel) => {
    if (ids.length === 0) return '';
    const cardsHtml = ids.map((cardId) => {
      const def = lookupCardDef(cardId);
      const isCurrent = cardId === currentMasterId;
      const badgeText = isCurrent ? '현재 덱 마스터' : sourceLabel;
      return `
        <div class="deckmaster-candidate-card ${isCurrent ? 'is-current-master' : ''}" data-dm-candidate="${cardId}">
          <div class="deckmaster-candidate-frame">
            ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 1, true)}
          </div>
          <span class="deckmaster-candidate-badge">${badgeText}</span>
        </div>
      `;
    }).join('');
    return `
      <div>
        <div class="deckmaster-group-title">${titleHtml}</div>
        <div class="deckmaster-picker-grid">${cardsHtml}</div>
      </div>
    `;
  };

  bodyEl.innerHTML = [
    renderGroup(`${svgIcon('pack')} 현재 덱의 레벨 1 몬스터`, uniqueDeckLv1, '덱 마스터로 지정'),
    renderGroup(`${svgIcon('bag')} 가방의 레벨 1 몬스터 (선택 시 덱으로 편성)`, uniqueTrunkLv1, '가방 → 마스터 지정'),
  ].filter(Boolean).join('') || '<p style="color:#94a3b8;text-align:center;padding:20px;">사용 가능한 레벨 1 몬스터가 없습니다.</p>';

  bodyEl.querySelectorAll('[data-dm-candidate]').forEach((el) => {
    el.addEventListener('click', () => {
      const targetId = el.getAttribute('data-dm-candidate');
      modalEl.classList.remove('active');
      applyDeckMasterChange(targetId);
    });
  });

  modalEl.classList.add('active');
}

document.getElementById('btn-change-deckmaster')?.addEventListener('click', () => {
  audio.playCardPickup();
  openDeckMasterPickerModal();
});

document.getElementById('btn-close-deckmaster-modal')?.addEventListener('click', () => {
  audio.playLightTap();
  document.getElementById('modal-deckmaster-select')?.classList.remove('active');
});

document.getElementById('modal-deckmaster-select')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-deckmaster-select') {
    e.target.classList.remove('active');
  }
});

// ============================================================================
// 체크포인트 허브 & 서브페이지 이벤트 리스너 바인딩
// ============================================================================
// 허브에서 서브페이지로 이동
document.getElementById('btn-checkpoint-nav-shop')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_SHOP');
  renderCheckpointShopSubpage(engine.getSnapshot());
});

document.getElementById('btn-checkpoint-nav-merchant')?.addEventListener('click', () => {
  audio.playCardPickup();
  document.getElementById('checkpoint-encounter-toast')?.classList.remove('is-visible');
  switchView('VIEW_CHECKPOINT_MERCHANT');
  renderCheckpointMerchantSubpage(engine.getSnapshot());
});

document.getElementById('checkpoint-encounter-toast')?.addEventListener('click', () => {
  const toast = document.getElementById('checkpoint-encounter-toast');
  if (toast) toast.classList.remove('is-visible');
  if (checkpointEncounterToastTimer) clearTimeout(checkpointEncounterToastTimer);
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_MERCHANT');
  renderCheckpointMerchantSubpage(engine.getSnapshot());
});

document.getElementById('btn-checkpoint-nav-deck')?.addEventListener('click', () => {
  audio.playCardPickup();
  openCheckpointDeckEditor();
});

// 서브페이지에서 허브로 복귀

document.getElementById('btn-shop-back-hub')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

document.getElementById('btn-merchant-back-hub')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

document.getElementById('btn-editor-back-hub')?.addEventListener('click', () => {
  audio.playCardPickup();
  attemptLeaveDeckEditor(() => {
    switchView('VIEW_CHECKPOINT');
    renderCheckpointView(engine.getSnapshot());
  });
});

document.getElementById('btn-editor-finish')?.addEventListener('click', async () => {
  audio.playCardPickup();
  const deckCount = (engine.state.playerDeckCardIds || []).length;
  if (deckCount !== 30) {
    await showGameAlert(`출전 덱은 정확히 30장이어야 저장할 수 있습니다. (현재 ${deckCount}장)`, {
      title: '덱 매수 확인',
      icon: 'warn',
      danger: true,
    });
    return;
  }
  commitDeckEditorChanges();
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

// 서브페이지 간 빠른 덱 편집실 바로가기
document.getElementById('btn-shop-to-editor')?.addEventListener('click', () => {
  audio.playCardPickup();
  openCheckpointDeckEditor();
});

document.getElementById('btn-merchant-to-editor')?.addEventListener('click', () => {
  audio.playCardPickup();
  openCheckpointDeckEditor();
});

document.getElementById('btn-encounter-to-editor')?.addEventListener('click', () => {
  audio.playCardPickup();
  openCheckpointDeckEditor();
});

// 듀얼 인카운터 출진 (인카운터 서브페이지)
document.getElementById('btn-start-encounter-from-subpage')?.addEventListener('click', async () => {
  const snap = engine.getSnapshot();
  if ((snap.playerDeckCardIds || []).length !== 30) {
    await showGameAlert(`덱이 정확히 30장이어야 결전에 나설 수 있습니다. (현재: ${snap.playerDeckCardIds.length}장)`, {
      title: '덱 편성 확인',
      icon: 'warn',
      danger: true,
    });
    return;
  }
  audio.playCardPlayImpact();
  engine.startRandomEncounter();
  syncRunPhaseView();
});

// 최종 보스 결전
document.getElementById('btn-checkpoint-challenge-boss')?.addEventListener('click', async () => {
  const snap = engine.getSnapshot();
  if ((snap.playerDeckCardIds || []).length !== 30) {
    await showGameAlert(`덱이 정확히 30장이어야 최종 보스전에 나설 수 있습니다. (현재: ${snap.playerDeckCardIds.length}장)`, {
      title: '덱 편성 확인',
      icon: 'warn',
      danger: true,
    });
    return;
  }
  const confirmed = await showGameConfirm('최종 보스에게 바로 도전하시겠습니까?\n패배 시 이번 런은 즉시 실패로 종료됩니다.', {
    title: '최종 보스 결전 경고',
    confirmText: '보스전 돌입',
    cancelText: '돌아가기',
    icon: 'skull',
    danger: true,
  });
  if (confirmed) {
    audio.playTurnBell();
    engine.challengeFinalBoss();
    syncRunPhaseView();
  }
});

// ============================================================================
// [수상한 상인: 암시장 물물교환 모달 제어 이벤트]
// ============================================================================
document.getElementById('btn-close-trade-modal')?.addEventListener('click', () => {
  audio.playCardPickup();
  closeTradeModal();
});

document.getElementById('btn-cancel-trade')?.addEventListener('click', () => {
  audio.playCardPickup();
  closeTradeModal();
});

const modalTradeSelect = document.getElementById('modal-trade-select');
modalTradeSelect?.addEventListener('click', (e) => {
  if (e.target === modalTradeSelect) {
    audio.playCardPickup();
    closeTradeModal();
  }
});

document.getElementById('btn-confirm-trade')?.addEventListener('click', async () => {
  if (!activeTradeDeal) return;
  const snap = engine.getSnapshot();
  const trunkCards = snap.playerTrunkCardIds || [];

  // 후보 목록에서 선택된 카드 ID 추출 (후보 목록이 비어있으면 기존 트렁크 인덱스 활용)
  const offeredCardIds = activeSelectedCandidates.length > 0
    ? activeSelectedCandidates.map((c) => c.cardId)
    : activeSelectedTrunkIndices.map((i) => trunkCards[i]);

  try {
    audio.playCardPlayImpact();
    engine.executeMerchantTrade(activeTradeDeal.dealId, offeredCardIds);
    audio.playVictoryJingle();
    closeTradeModal();
    renderCheckpointMerchantSubpage(engine.getSnapshot());
  } catch (err) {
    console.error('[Merchant Trade Error]', err);
    await showGameAlert(err.message || '물물교환 처리에 실패했습니다.', { title: '물물교환 실패', danger: true });
  }
});


// ============================================================================
// 5. VIEW_PACK_OPENING (보상 카드 팩 개봉)
// ============================================================================
function renderPackOpening(snap) {
  const container = document.getElementById('pack-cards-container');
  container.innerHTML = '';
  selectedCardInPack = null;
  const claimBtn = document.getElementById('btn-claim-pack-card');
  claimBtn.disabled = true;

  snap.currentRewardPackChoices.forEach((cardId) => {
    const def = lookupCardDef(cardId);
    if (!def) return;

    const cardEl = document.createElement('div');
    cardEl.className = 'pack-choice-card';
    cardEl.innerHTML = generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.79, false);

    cardEl.addEventListener('click', () => {
      audio.playCardPickup();
      document.querySelectorAll('.pack-choice-card').forEach((c) => c.classList.remove('selected'));
      cardEl.classList.add('selected');
      selectedCardInPack = cardId;
      claimBtn.disabled = false;
    });

    container.appendChild(cardEl);
  });
}

document.getElementById('btn-claim-pack-card')?.addEventListener('click', () => {
  if (selectedCardInPack) {
    audio.playCardPlayImpact();
    engine.pickRewardPackCard(selectedCardInPack);
    syncRunPhaseView();
  }
});

// ============================================================================
// 6. VIEW_MERCHANT_EVENT (상인 및 숙련도 연마)
// ============================================================================
function renderMerchantEvent(snap) {
  const offer = snap.currentMerchantOffer;
  if (!offer) return;

  const cardDef = lookupCardDef(offer.offerCardId);
  const masteryCardDef = lookupCardDef(offer.bonusMasteryCardId);

  const previewEl = document.getElementById('merchant-card-preview');
  previewEl.innerHTML = `<div class="merchant-offer-card-frame">${generateCompositeCardHtml(cardDef, cardDef.attack, cardDef.defense ?? cardDef.health, 0.85, false)}</div>`;

  document.getElementById('merchant-mastery-card-name').textContent = masteryCardDef?.name || '주력 카드';
}

document.getElementById('btn-merchant-acquire')?.addEventListener('click', () => {
  audio.playCardPlayImpact();
  engine.resolveMerchantEvent('ACQUIRE_CARD');
  syncRunPhaseView();
});

document.getElementById('btn-merchant-train')?.addEventListener('click', () => {
  audio.playVictoryJingle();
  engine.resolveMerchantEvent('TRAIN_MASTERY');
  syncRunPhaseView();
});

// ============================================================================
// 7. VIEW_RUN_SUMMARY (런 완주 / 명예의 전당)
// ============================================================================
function renderRunSummary(snap, isVictory) {
  document.body.classList.toggle('run-victory', !!isVictory);
  const badgeEl = document.getElementById('summary-badge');
  const titleEl = document.getElementById('summary-title');
  const descEl = document.getElementById('summary-desc');
  const deckListEl = document.getElementById('summary-deck-list');
  const payloadBox = document.getElementById('hall-payload-box');
  const seedBadgeEl = document.getElementById('summary-seed-badge');
  const isSeeded = Boolean(snap.isSeededRun);

  if (isVictory) {
    badgeEl.innerHTML = svgIcon('trophy');
    titleEl.textContent = 'VICTORY';
    titleEl.style.color = '#facc15';
    descEl.textContent = isSeeded
      ? '운명의 최종 보스를 물리쳤습니다! (시드 런 · 바인더 및 명예의 전당 기록 제외)'
      : '운명의 최종 보스를 물리치고 모든 시련을 완주했습니다!';
  } else {
    badgeEl.innerHTML = svgIcon('skull');
    titleEl.textContent = 'DEFEAT';
    titleEl.style.color = '#f87171';
    descEl.textContent = isSeeded
      ? '라이프 포인트가 0이 되어 여정이 종료되었습니다. (시드 런 · 기록 제외)'
      : '라이프 포인트가 0이 되어 여정이 종료되었습니다.';
  }

  if (seedBadgeEl) {
    const seedLabel = snap.seedText || String(snap.seed || '');
    seedBadgeEl.hidden = !seedLabel;
    seedBadgeEl.classList.toggle('is-seeded', isSeeded);
    seedBadgeEl.textContent = isSeeded
      ? `시드 런 (${seedLabel}) · 바인더 / 명예의 전당 미등록`
      : `시드: ${seedLabel}`;
  }

  deckListEl.innerHTML = '';
  snap.playerDeckCardIds.forEach((cardId) => {
    const def = lookupCardDef(cardId);
    if (!def) return;
    const isMaster = cardId === snap.playerDeckMasterCardId;
    const tile = document.createElement('div');
    tile.className = `trunk-card-tile summary-deck-tile ${isMaster ? 'is-deckmaster' : ''}`;
    tile.title = def.name;
    tile.innerHTML = `
      <div class="trunk-card-frame">
        ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.38, true)}
      </div>
    `;
    deckListEl.appendChild(tile);
  });

  if (payloadBox) {
    payloadBox.hidden = true;
    payloadBox.textContent = '';
  }
}

document.getElementById('btn-return-to-lobby')?.addEventListener('click', () => {
  engine.state = engine.createEmptyRunState('RUN_INIT', Date.now());
  resetRunUiTransitionState('IDLE');
  refreshContinueButton();
  switchView('VIEW_TITLE_LOBBY');
});

// ============================================================================
// 8. OVERLAY_BINDER_BOOK (3×3 실물 바인더 북 & 컬렉터 아카이브)
// ============================================================================
let currentBinderSelectedCardId = null;

function toggleBinderModal() {
  overlayBinderBook.classList.toggle('active');
  if (overlayBinderBook.classList.contains('active')) {
    syncBinderMasteryControls();
    renderBinderPage(currentBinderPage);
  }
}

// 모달 배경 클릭 시 닫기
overlayBinderBook?.addEventListener('click', (e) => {
  if (e.target === overlayBinderBook) {
    overlayBinderBook.classList.remove('active');
  }
});

function renderBinderPage(pageIndex, focusCardId = null) {
  const pageView = binder.getPageView(pageIndex);
  currentBinderPage = pageView.pageIndex;

  const pageIndicator = document.getElementById('binder-page-indicator');
  if (pageIndicator) {
    pageIndicator.textContent = `PAGE ${pageView.pageIndex + 1} / ${pageView.totalPages}`;
  }

  const gridEl = document.getElementById('binder-grid-page');
  if (!gridEl) return;
  gridEl.innerHTML = '';

  let pageOwnedCount = 0;
  let pageMasteredCount = 0;
  let cardToFocus = null;

  pageView.slots.forEach((slot, idx) => {
    const def = lookupCardDef(slot.cardId) || {
      id: slot.cardId,
      name: slot.cardName,
      cost: slot.cost,
      archetype: slot.archetype,
      type: slot.attack !== undefined ? 'MONSTER' : 'SPELL',
      attack: slot.attack,
      defense: slot.health,
    };

    if (slot.state >= BinderCardState.OWNED) pageOwnedCount++;
    if (slot.state === BinderCardState.MASTERED) pageMasteredCount++;

    const isMatchFocus = focusCardId
      ? slot.cardId === focusCardId
      : (currentBinderSelectedCardId ? slot.cardId === currentBinderSelectedCardId : idx === 0);
    if (isMatchFocus || !cardToFocus) {
      cardToFocus = { slot, def };
    }

    const slotEl = document.createElement('div');
    slotEl.className = `binder-slot status-${slot.state}`;
    slotEl.setAttribute('data-card-id', slot.cardId);
    slotEl.setAttribute('data-slot-idx', String(idx));

    let cardContentHtml = '';

    if (slot.state === BinderCardState.UNKNOWN) {
      cardContentHtml = `
        <div class="binder-card-viewport card-unknown">
          ${generateCardBackHtml(0.45)}
          <div class="unknown-mystery-overlay">
            <div class="mystery-seal-icon">?</div>
          </div>
        </div>
      `;
    } else if (slot.state === BinderCardState.DISCOVERED) {
      cardContentHtml = `
        <div class="binder-card-viewport card-discovered">
          ${generateCompositeCardHtml(def, def.attack, def.defense ?? (def.health ?? 0), 0.54, true)}
        </div>
      `;
    } else if (slot.state === BinderCardState.OWNED) {
      cardContentHtml = `
        <div class="binder-card-viewport card-owned">
          ${generateCompositeCardHtml(def, def.attack, def.defense ?? (def.health ?? 0), 0.54, true)}
        </div>
      `;
    } else if (slot.state === BinderCardState.MASTERED) {
      cardContentHtml = `
        <div class="holographic-foil-layer"></div>
        <div class="binder-card-viewport card-mastered">
          ${generateCompositeCardHtml(def, def.attack, def.defense ?? (def.health ?? 0), 0.54, true)}
        </div>
      `;
    }

    slotEl.innerHTML = `
      <div class="pocket-slit"></div>
      <div class="pocket-inner-wrap">
        ${cardContentHtml}
      </div>
      <div class="pocket-sheen"></div>
    `;

    // 마우스 호버 및 클릭 인터랙션
    slotEl.addEventListener('mouseenter', () => {
      document.querySelectorAll('.binder-slot').forEach((s) => s.classList.remove('selected-slot'));
      slotEl.classList.add('selected-slot');
      currentBinderSelectedCardId = slot.cardId;
      updateBinderDossier(slot, def);
    });

    slotEl.addEventListener('click', () => {
      audio.playCardPickup();
      document.querySelectorAll('.binder-slot').forEach((s) => s.classList.remove('selected-slot'));
      slotEl.classList.add('selected-slot');
      currentBinderSelectedCardId = slot.cardId;
      updateBinderDossier(slot, def);
    });

    gridEl.appendChild(slotEl);
  });

  // 전체 바인더 통계
  const totalSlots = binder.catalog.length;
  let totalOwned = 0;
  let totalMastered = 0;
  binder.catalog.forEach((c) => {
    const entry = binder.entries[c.id];
    if (entry) {
      if (entry.state >= BinderCardState.OWNED) totalOwned++;
      if (entry.state === BinderCardState.MASTERED) totalMastered++;
    }
  });

  const percentOwned = Math.round((totalOwned / totalSlots) * 100);
  const percentMastered = Math.round((totalMastered / totalSlots) * 100);
  const summaryEl = document.getElementById('binder-summary-stat');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="binder-stat-line">
        수집 현황: <strong>${totalOwned} / ${totalSlots}장 (${percentOwned}%)</strong> | 마스터: <strong>${totalMastered}장</strong> (현재 페이지: ${pageOwnedCount}/9 보유)
      </div>
      <div class="binder-progress-track">
        <div class="binder-progress-fill owned" style="width: ${percentOwned}%;"></div>
        <div class="binder-progress-fill mastered" style="width: ${percentMastered}%;"></div>
      </div>
    `;
  }

  // 초기 도감 포커스 동기화
  if (cardToFocus) {
    currentBinderSelectedCardId = cardToFocus.slot.cardId;
    updateBinderDossier(cardToFocus.slot, cardToFocus.def);
    const focusedSlot = gridEl.querySelector(`[data-card-id="${cardToFocus.slot.cardId}"]`);
    if (focusedSlot) focusedSlot.classList.add('selected-slot');
  }

  const prevBtn = document.getElementById('btn-binder-prev');
  if (prevBtn) prevBtn.disabled = pageView.pageIndex <= 0;
  const nextBtn = document.getElementById('btn-binder-next');
  if (nextBtn) nextBtn.disabled = pageView.pageIndex >= pageView.totalPages - 1;
}

/**
 * [우측 바인더 도감(Collector's Dossier) 실시간 갱신]
 */
function updateBinderDossier(slot, def) {
  const previewContainer = document.getElementById('binder-dossier-card-preview');
  const combatStatsContainer = document.getElementById('binder-dossier-combat-stats');
  const titleEl = document.getElementById('binder-dossier-card-title');
  const statusBadgeEl = document.getElementById('binder-dossier-status-badge');
  const metaEl = document.getElementById('binder-dossier-meta');
  const masteryBarEl = document.getElementById('binder-dossier-mastery-bar');
  const masteryValEl = document.getElementById('binder-dossier-mastery-val');
  const masterySubEl = document.getElementById('binder-dossier-mastery-sub');
  const statsEl = document.getElementById('binder-dossier-stats');
  const descEl = document.getElementById('binder-dossier-desc');

  if (!previewContainer) return;

  const entry = binder.entries[slot.cardId] || {
    timesSeen: 0,
    timesAcquired: 0,
    timesPlayed: 0,
    masteryPoints: slot.masteryPoints || 0,
  };

  const isUnknown = slot.state === BinderCardState.UNKNOWN;
  const isDiscovered = slot.state === BinderCardState.DISCOVERED;
  const isOwned = slot.state === BinderCardState.OWNED;
  const isMastered = slot.state === BinderCardState.MASTERED;

  const atk = def.attack ?? 0;
  const defStat = def.defense ?? (def.health ?? 0);
  const isMonster = def.type === 'MONSTER' || (atk > 0 && def.type !== 'SPELL');

  // 1. 대형 프리뷰 렌더링 (비율 유지 0.85 스케일 - 170px 컨테이너 정밀 맞춤)
  if (isUnknown) {
    previewContainer.innerHTML = generateCardBackHtml(0.85);
  } else {
    previewContainer.innerHTML = generateCompositeCardHtml(
      def,
      atk,
      defStat,
      0.85,
      false
    );
  }

  // 2. 카드 아래 공/수 전투 스탯 배너
  if (combatStatsContainer) {
    if (isUnknown) {
      combatStatsContainer.innerHTML = `<div class="dossier-stat-pill" style="background:#1e293b; color:#64748b; border:1px solid #334155;">${svgIcon('lock')} 정보 미확인</div>`;
    } else if (isMonster) {
      combatStatsContainer.innerHTML = `
        <div class="dossier-stat-pill stat-pill-atk">
          <span>공격력</span><strong>${atk}</strong>
        </div>
        <div class="dossier-stat-pill stat-pill-def">
          <span>수비력</span><strong>${defStat}</strong>
        </div>
      `;
    } else {
      const triggerLabel = '즉시 · 세트 공용 마법';
      combatStatsContainer.innerHTML = `
        <div class="dossier-stat-pill stat-pill-spell">
          <span>${svgIcon('scroll')} ${triggerLabel}</span>
        </div>
      `;
    }
  }

  // 3. 타이틀 & 상태 배지
  if (isUnknown) {
    if (titleEl) titleEl.textContent = '???';
    if (statusBadgeEl) {
      statusBadgeEl.className = 'dossier-badge badge-unk';
      statusBadgeEl.innerHTML = `${svgIcon('lock')} 미발견`;
    }
  } else {
    if (titleEl) titleEl.textContent = `${def.name} (#${String(slot.globalIndex + 1).padStart(2, '0')})`;
    if (statusBadgeEl) {
      if (isMastered) {
        statusBadgeEl.className = 'dossier-badge badge-mast';
        statusBadgeEl.innerHTML = `${svgIcon('star')} 마스터`;
      } else if (isOwned) {
        statusBadgeEl.className = 'dossier-badge badge-own';
        statusBadgeEl.textContent = '보유';
      } else {
        statusBadgeEl.className = 'dossier-badge badge-disc';
        statusBadgeEl.textContent = '발견';
      }
    }
  }

  // 4. 메타 배지 라인 (진영 한글 통일 · 코스트/카드종류 제거 · 키워드 제외 태그 표기)
  if (metaEl) {
    if (isUnknown) {
      metaEl.innerHTML = `<span class="meta-pill" style="background:#1e293b; color:#64748b;">정보: 미확인</span>`;
    } else {
      const factionMap = { BLUE: '정의', RED: '열의', PURPLE: '혼돈', NEUTRAL: '중립' };
      const factionStr = factionMap[def.faction] || '중립';
      const levelStr = isMonster ? `Lv.${def.level ?? def.cost ?? 1}` : '';
      const nonKwTags = (def.tags || []).map((tg) => {
        const formatted = `#${String(tg).replace(/^#+/, '')}`;
        return `<span class="meta-pill tag">${formatted}</span>`;
      }).join('');
      metaEl.innerHTML = `
        <span class="meta-pill archetype">${factionStr}</span>
        ${levelStr ? `<span class="meta-pill level">${levelStr}</span>` : ''}
        ${nonKwTags}
      `;
    }
  }

  // 5. 숙련도 진행바
  const mastery = entry.masteryPoints || 0;
  const masteryMax = binder.masteryThreshold || 100;
  const masteryPercent = Math.min(100, Math.round((mastery / masteryMax) * 100));

  if (masteryBarEl) {
    masteryBarEl.style.width = isUnknown ? '0%' : `${masteryPercent}%`;
  }
  if (masteryValEl) {
    masteryValEl.textContent = isUnknown ? '0 / 100 pt (0%)' : `${mastery} / ${masteryMax} pt (${masteryPercent}%)`;
  }
  if (masterySubEl) {
    if (isUnknown) {
      masterySubEl.innerHTML = '카드를 획득한 후 대전에서 사용하면 숙련도가 누적됩니다.';
    } else if (isMastered) {
      masterySubEl.innerHTML = `<strong style="color:#facc15;">${svgIcon('star')} 마스터 달성</strong> · 마스터 등급 이펙트를 사용할 수 있습니다.`;
    } else {
      const remaining = Math.max(0, masteryMax - mastery);
      masterySubEl.innerHTML = `대전에서 카드를 사용해 100pt를 달성하면 <strong>마스터 등급</strong>으로 승격됩니다. (남은 포인트: <strong>${remaining}pt</strong>)`;
    }
  }

  // 6. 수집 이력 통계 타일 (3개 지표)
  if (statsEl) {
    const seen = isUnknown ? 0 : (entry.timesSeen || 0);
    const acquired = isUnknown ? 0 : (entry.timesAcquired || 0);
    const played = isUnknown ? 0 : (entry.timesPlayed || 0);

    statsEl.innerHTML = `
      <div class="dossier-stat-tile">
        <span class="stat-tile-label">조우 횟수</span>
        <strong class="stat-tile-val">${seen}회</strong>
      </div>
      <div class="dossier-stat-tile">
        <span class="stat-tile-label">덱 획득</span>
        <strong class="stat-tile-val highlight-cyan">${acquired}회</strong>
      </div>
      <div class="dossier-stat-tile">
        <span class="stat-tile-label">실전 사용</span>
        <strong class="stat-tile-val highlight-gold">${played}회</strong>
      </div>
    `;
  }

  // 7. 상세 룰 & 효과 설명 (친절한 한글 안내 및 내부 개발 용어 완전 차단)
  if (descEl) {
    if (isUnknown) {
      descEl.innerHTML = `
        <div class="dossier-desc-unknown">
          <p><strong>${svgIcon('lock')} 아직 발견하지 못한 카드입니다.</strong></p>
          <p class="sub-hint">${svgIcon('bulb')} 상점에서 팩을 개봉하거나 대전에서 이 카드를 마주치면 도감 정보가 해금됩니다.</p>
        </div>
      `;
    } else {
      let effectKoreanText = def.description;
      if (!effectKoreanText || effectKoreanText.trim() === '') {
        const effectMap = {
          'SUMMON_UNIT': '필드에 아군 유닛을 즉시 소환하여 방어선 및 공격 거점을 형성합니다.',
          'DIRECT_DAMAGE': `적 유닛 또는 본체에 ${def.effectValue ?? def.attack ?? 0}의 마법 피해를 즉시 가합니다.`,
          'HEAL_HERO': `아군 듀얼리스트의 체력(LP)을 ${def.effectValue ?? 10}만큼 회복합니다.`,
          'BUFF_ATTACK': `지정한 아군 몬스터의 공격력을 +${def.effectValue ?? 2} 증가시킵니다.`,
          'DRAW_CARD': `덱에서 카드를 ${def.effectValue ?? 1}장 추가로 드로우합니다.`,
        };
        effectKoreanText = effectMap[def.effectType] || '특수 전술 마법 효과를 발동합니다.';
      }

      let structuredDescHtml = '';
      if (def.condition || def.effect) {
        if (def.condition) {
          structuredDescHtml += `<div class="dossier-clause-line"><span class="clause-tag cond">[조건]</span> ${def.condition}</div>`;
        }
        if (def.effect) {
          structuredDescHtml += `<div class="dossier-clause-line"><span class="clause-tag eff">[효과]</span> ${def.effect}</div>`;
        }
      } else {
        structuredDescHtml = `<div class="dossier-clause-line">${effectKoreanText.replace(/\n+/g, '<br>')}</div>`;
      }

      descEl.innerHTML = `
        <div class="dossier-effect-header"><strong>${svgIcon('scroll')} 카드 고유 효과</strong></div>
        <div class="dossier-desc-banner">${structuredDescHtml}</div>
      `;
    }
  }
}

function syncBinderMasteryControls() {
  const tierSel = document.getElementById('sel-binder-mastery-tier');
  const presetSel = document.getElementById('sel-binder-mastery-preset');
  if (!tierSel || !presetSel) return;
  const tier = tierSel.value || 'MASTERED';
  const cfg = masteryFxConfig.tierDefaults?.[tier];
  presetSel.value = cfg?.preset || 'NONE';
}

document.getElementById('sel-binder-mastery-tier')?.addEventListener('change', syncBinderMasteryControls);
document.getElementById('sel-binder-mastery-preset')?.addEventListener('change', (e) => {
  const tierSel = document.getElementById('sel-binder-mastery-tier');
  const tier = tierSel?.value || 'MASTERED';
  const preset = e.target.value;
  const info = MASTERY_FX_PRESETS[preset] || MASTERY_FX_PRESETS.NONE;
  if (!masteryFxConfig.tierDefaults) masteryFxConfig.tierDefaults = {};
  masteryFxConfig.tierDefaults[tier] = {
    preset,
    glow: info.glow,
    foil: info.foil,
    tint: info.tint,
  };
  saveMasteryFxConfig(masteryFxConfig);
  audio.playCardPickup();
  renderBinderPage(currentBinderPage, currentBinderSelectedCardId);
});

// 바인더 보기 필터 (진영 탭 · 보유만)
let binderFactionFilter = 'ALL';
function applyBinderFilter() {
  const ownedOnly = document.getElementById('binder-owned-only')?.checked;
  binder.setFilter(
    binderFactionFilter === 'ALL' && !ownedOnly
      ? null
      : (card, entry) =>
          (binderFactionFilter === 'ALL' || card.faction === binderFactionFilter) &&
          (!ownedOnly || (entry && entry.state >= BinderCardState.OWNED))
  );
  currentBinderSelectedCardId = null;
  renderBinderPage(0);
}
document.querySelectorAll('.binder-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.playCardPickup();
    binderFactionFilter = btn.getAttribute('data-faction');
    document.querySelectorAll('.binder-filter-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    applyBinderFilter();
  });
});
document.getElementById('binder-owned-only')?.addEventListener('change', applyBinderFilter);

document.getElementById('btn-binder-prev')?.addEventListener('click', () => {
  audio.playCardPickup();
  if (currentBinderPage > 0) renderBinderPage(currentBinderPage - 1);
});

document.getElementById('btn-binder-next')?.addEventListener('click', () => {
  audio.playCardPickup();
  if (currentBinderPage < binder.getTotalPages() - 1) renderBinderPage(currentBinderPage + 1);
});

let lastBinderWheelTime = 0;
overlayBinderBook?.addEventListener('wheel', (e) => {
  if (!overlayBinderBook.classList.contains('active')) return;
  // 우측 상세 설명 박스가 자체 스크롤이 필요한 경우 우선 스크롤 허용
  const dossierScroll = e.target.closest?.('.binder-dossier-wrapper');
  if (dossierScroll && dossierScroll.scrollHeight > dossierScroll.clientHeight + 2) {
    return;
  }
  if (Math.abs(e.deltaY) < 4) return;
  e.preventDefault();
  const now = Date.now();
  if (now - lastBinderWheelTime < 140) return;
  lastBinderWheelTime = now;
  if (e.deltaY > 0 && currentBinderPage < binder.getTotalPages() - 1) {
    audio.playCardPickup();
    renderBinderPage(currentBinderPage + 1);
  } else if (e.deltaY < 0 && currentBinderPage > 0) {
    audio.playCardPickup();
    renderBinderPage(currentBinderPage - 1);
  }
}, { passive: false });

// ============================================================================
// 9. LJack 내리치기 연출 수치별 테스트 룸 (Slam FX Playground)
// ============================================================================
const pgState = {
  atk: 14,
  cost: 2,
  hasPierce: true,
  targetHp: 12,
  targetId: 'center', // 'left' | 'center' | 'right' | 'avatar'
  targetCardHp: {
    left: 12,
    center: 12,
    right: 12,
    avatar: 100,
  },
  slamSpeed: 1.0,
  hitstopMs: 50,
  isAnimating: false,
};

function logPlaygroundTelemetry(msg) {
  const logEl = document.getElementById('pg-telemetry-log');
  if (logEl) logEl.textContent = msg;
}

function updatePlaygroundAttackerVisuals() {
  const cardEl = document.getElementById('pg-attacker-card');
  const atkText = document.getElementById('pg-attacker-atk-text');
  const tagsRow = document.getElementById('pg-attacker-tags');
  const titleEl = document.getElementById('pg-attacker-title');

  if (atkText) atkText.innerHTML = `${svgIcon('sword')}${pgState.atk}`;
  if (tagsRow) {
    tagsRow.innerHTML = pgState.hasPierce ? `<span class="card-tag tag-pierce">#관통</span>` : `<span class="card-tag">#기사</span>`;
  }
  if (titleEl) {
    titleEl.textContent =
      pgState.cost === 1
        ? '민첩한 도적'
        : pgState.cost === 2
        ? '진홍빛 기사'
        : pgState.cost === 3
        ? '파쇄의 거인'
        : '고대 거신';
  }

  if (cardEl) {
    cardEl.classList.remove('cost-light', 'cost-medium', 'cost-heavy');
    if (pgState.cost <= 1) cardEl.classList.add('cost-light');
    else if (pgState.cost === 2) cardEl.classList.add('cost-medium');
    else cardEl.classList.add('cost-heavy');
  }
}

function updatePlaygroundTargetVisuals() {
  const hpLeft = document.getElementById('pg-target-hp-left');
  const hpCenter = document.getElementById('pg-target-hp-center');
  const hpRight = document.getElementById('pg-target-hp-right');
  const hpAvatar = document.getElementById('pg-target-hp-avatar');

  if (hpLeft) hpLeft.innerHTML = `${svgIcon('heart')}${pgState.targetCardHp.left}`;
  if (hpCenter) hpCenter.innerHTML = `${svgIcon('heart')}${pgState.targetCardHp.center}`;
  if (hpRight) hpRight.innerHTML = `${svgIcon('heart')}${pgState.targetCardHp.right}`;
  if (hpAvatar) hpAvatar.textContent = pgState.targetCardHp.avatar;
}

function selectPlaygroundTarget(targetId) {
  pgState.targetId = targetId;

  // 라디오 버튼 활성화
  document.querySelectorAll('.pg-btn-target-select').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-target') === targetId);
  });

  // 슬롯 하이라이트
  document.querySelectorAll('.stage-target-slot').forEach((slot) => {
    slot.classList.toggle('selected', slot.getAttribute('data-target-id') === targetId);
  });

  const label = document.getElementById('label-pg-selected-target');
  const targetNames = {
    left: '좌측 가디언 (-30°)',
    center: '정면 골렘 (0°)',
    right: '우측 첨병 (+30°)',
    avatar: '상대 본체 아바타',
  };
  if (label) label.textContent = targetNames[targetId] || targetId;

  logPlaygroundTelemetry(`🎯 타겟 지정됨: [${targetNames[targetId]}]`);
}

function applyPlaygroundPreset(atk, cost, pierce, targetHp, targetId) {
  pgState.atk = atk;
  pgState.cost = cost;
  pgState.hasPierce = pierce;
  pgState.targetHp = targetHp;
  pgState.targetCardHp[targetId] = targetHp;

  // 슬라이더 및 라디오 동기화
  const sliderAtk = document.getElementById('slider-pg-atk');
  const valAtk = document.getElementById('val-pg-atk');
  if (sliderAtk) sliderAtk.value = atk;
  if (valAtk) valAtk.textContent = atk;

  const sliderHp = document.getElementById('slider-pg-target-hp');
  const valHp = document.getElementById('val-pg-target-hp');
  if (sliderHp) sliderHp.value = targetHp;
  if (valHp) valHp.textContent = targetHp;

  const checkP = document.getElementById('check-pg-pierce');
  if (checkP) checkP.checked = pierce;

  document.querySelectorAll('.pg-btn-pill').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.getAttribute('data-cost')) === cost);
  });
  const badge = document.getElementById('badge-pg-cost');
  if (badge) {
    badge.textContent =
      cost === 1 ? '1코스트 (가벼움)' : cost === 2 ? '2코스트 (보통)' : cost === 3 ? '3코스트 (묵직함)' : '4코스트 (거신/단단함)';
  }

  // 타겟 카드 시각 효과 초기화
  const targetEl =
    targetId === 'avatar' ? document.getElementById('pg-target-avatar-box') : document.getElementById(`pg-target-card-${targetId}`);
  if (targetEl) {
    targetEl.classList.remove('card-whiteout');
    targetEl.style.opacity = '1';
  }

  selectPlaygroundTarget(targetId);
  updatePlaygroundAttackerVisuals();
  updatePlaygroundTargetVisuals();

  logPlaygroundTelemetry(`⚡ 프리셋 로드 완료: ${atk}공 / ${cost}코스트 / ${pierce ? '관통보유' : '일반'} -> [${targetId}] 즉시 실행`);
  setTimeout(() => executePlaygroundSlam(), 150);
}

function executePlaygroundSlam() {
  if (pgState.isAnimating) return;
  pgState.isAnimating = true;

  const attackerEl = document.getElementById('pg-attacker-card');
  const targetEl =
    pgState.targetId === 'avatar'
      ? document.getElementById('pg-target-avatar-box')
      : document.getElementById(`pg-target-card-${pgState.targetId}`);

  if (!attackerEl || !targetEl) {
    pgState.isAnimating = false;
    return;
  }

  // 공격자 카드가 드래그 중이었다면 즉시 홈 슬롯 위치로 강제 스냅 (트랜지션 없이 좌표 정렬)
  attackerEl.style.transition = 'none';
  attackerEl.classList.remove('is-dragging-attacker');
  attackerEl.style.setProperty('--card-tx', '0px');
  attackerEl.style.setProperty('--card-ty', '0px');
  attackerEl.style.setProperty('--card-tz', '0px');
  attackerEl.style.setProperty('--slam-rot-z', '0deg');
  void attackerEl.offsetHeight; // 동기 리플로우로 (0,0) 좌표 확정
  attackerEl.style.transition = '';

  // 대상 사망 상태일 시 체력 자동 복원
  if (targetEl.classList.contains('card-whiteout')) {
    targetEl.classList.remove('card-whiteout');
    targetEl.style.opacity = '1';
    pgState.targetCardHp[pgState.targetId] = pgState.targetHp;
    updatePlaygroundTargetVisuals();
  }

  const atk = pgState.atk;
  const aRect = attackerEl.getBoundingClientRect();
  const tRect = targetEl.getBoundingClientRect();
  const ax = aRect.left + aRect.width / 2;
  const ay = aRect.top + aRect.height / 2;
  const tx = tRect.left + tRect.width / 2;
  const ty = tRect.top + tRect.height / 2;
  const dx = tx - ax;
  const dy = ty - ay;
  const rawDist = Math.hypot(dx, dy);
  const dist = Math.max(10, rawDist);
  const angleDeg = rawDist > 5 ? (Math.atan2(dy, dx) * 180 / Math.PI) + 90 : 0;

  const windupDist = 24;
  const nx = rawDist > 5 ? dx / rawDist : 0;
  const ny = rawDist > 5 ? dy / rawDist : -1;
  const wx = -nx * windupDist;
  const wy = -ny * windupDist;

  const windupTime = Math.max(70, 150 / pgState.slamSpeed);
  const slamTime = Math.max(50, 100 / pgState.slamSpeed);

  attackerEl.style.setProperty('--windup-tx', `${wx.toFixed(1)}px`);
  attackerEl.style.setProperty('--windup-ty', `${wy.toFixed(1)}px`);
  attackerEl.style.setProperty('--target-dx', `${dx.toFixed(1)}px`);
  attackerEl.style.setProperty('--target-dy', `${dy.toFixed(1)}px`);
  attackerEl.style.setProperty('--slam-rot-z', `${angleDeg.toFixed(1)}deg`);
  attackerEl.style.setProperty('--windup-duration', `${windupTime}ms`);
  attackerEl.style.setProperty('--slam-duration', `${slamTime}ms`);

  // 사운드
  if (atk <= 4) {
    audio.playLightTap();
  } else {
    audio.playHeavyImpact(atk);
  }

  // 1. Windup
  attackerEl.classList.add('slam-windup');
  logPlaygroundTelemetry(`[1. 치켜들기] 타겟 조준 각도: ${angleDeg.toFixed(1)}° | 뒤로 ${windupDist}px 반동 | 속도: ${pgState.slamSpeed.toFixed(1)}x`);

  setTimeout(() => {
    // 2. Direct Slam Down
    attackerEl.classList.remove('slam-windup');
    attackerEl.classList.add('slam-down');

    setTimeout(() => {
      // 3. 타격 임팩트 판정
      const targetHpBefore = pgState.targetCardHp[pgState.targetId];
      const isDead = atk >= targetHpBefore && pgState.targetId !== 'avatar';
      const pierceDamage = pgState.hasPierce && atk > targetHpBefore && pgState.targetId !== 'avatar' ? atk - targetHpBefore : 0;
      pgState.targetCardHp[pgState.targetId] = Math.max(0, targetHpBefore - atk);
      updatePlaygroundTargetVisuals();

      const canvasRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0 };
      const curTRect = targetEl.getBoundingClientRect();
      const cx = curTRect.left - canvasRect.left + curTRect.width / 2;
      const cy = curTRect.top - canvasRect.top + curTRect.height / 2;

      // 역경직 프리즈
      fxEngine.triggerHitstop(pgState.hitstopMs);

      // 충격파 및 스파크 버스트
      fxEngine.spawnShockwave(cx, cy, Math.min(130, 45 + atk * 3.5), '#ffffff');
      fxEngine.spawnImpactStarburst(cx, cy, Math.min(45, 16 + atk * 2), atk > 10 ? '#f59e0b' : '#38bdf8');

      // ★ [플레이어 본체 피격 특화] 주변 먼지 털림 효과
      if (pgState.targetId === 'avatar') {
        fxEngine.spawnPlayerDustPuff(cx, cy, curTRect.width, curTRect.height, 24);
        audio.playPlayerImpact(atk);
      }

      // 카메라 쉐이크 & 데미지 텍스트
      fxEngine.triggerScreenShake(Math.min(25, 4 + atk * 1.3));
      fxEngine.showFloatingText(cx, cy - 25, `-${atk}`, '#ef4444', 30);

      targetEl.classList.add('slam-hit-target');

      // 사망 시 크리스탈 파편 & 묘지행 3차 베지에 영혼 Wisp
      if (isDead) {
        targetEl.classList.add('card-whiteout');
        audio.playCardShatter();
        const cardLocalRect = {
          left: curTRect.left - canvasRect.left,
          top: curTRect.top - canvasRect.top,
          width: curTRect.width,
          height: curTRect.height,
        };
        fxEngine.spawnCardShatter(cardLocalRect, tunerSettings.shatterShards || 14);

        audio.playSoulWisp();
        const gyEl = document.getElementById('pg-graveyard-slot');
        const gyR = gyEl ? gyEl.getBoundingClientRect() : { left: 100, top: 100, width: 70, height: 90 };
        const gyLocalRect = {
          left: gyR.left - canvasRect.left,
          top: gyR.top - canvasRect.top,
          width: gyR.width,
          height: gyR.height,
        };
        fxEngine.spawnSoulWisp(cardLocalRect, gyLocalRect, () => {});
      }

      // 관통 시 본체로 가속 플라즈마 볼트 방출
      if (pierceDamage > 0) {
        audio.playPiercingBolt();
        const avatarEl = document.getElementById('pg-target-avatar-box');
        const avR = avatarEl ? avatarEl.getBoundingClientRect() : { left: 100, top: 50, width: 50, height: 50 };
        const cardLocalRect = {
          left: curTRect.left - canvasRect.left,
          top: curTRect.top - canvasRect.top,
          width: curTRect.width,
          height: curTRect.height,
        };
        const avLocalRect = {
          left: avR.left - canvasRect.left,
          top: avR.top - canvasRect.top,
          width: avR.width,
          height: avR.height,
        };

        fxEngine.spawnPiercingBolt(cardLocalRect, avLocalRect, pierceDamage, () => {
          avatarEl?.classList.add('slam-hit-target');
          setTimeout(() => avatarEl?.classList.remove('slam-hit-target'), 300);
          audio.playPlayerImpact(pierceDamage);
          pgState.targetCardHp.avatar = Math.max(0, pgState.targetCardHp.avatar - pierceDamage);
          updatePlaygroundTargetVisuals();
        });
      }

      logPlaygroundTelemetry(
        `[2. 강타 임팩트] 각도: ${angleDeg.toFixed(1)}° | 데미지: ${atk} | 역경직: ${pgState.hitstopMs}ms | ${
          isDead ? '파괴 및 영혼 배출!' : '생존'
        } ${pierceDamage > 0 ? `| 본체 초과 관통 +${pierceDamage}!` : ''}`
      );

      // 4. 원위치 복귀
      setTimeout(() => {
        attackerEl.classList.remove('slam-down');
        attackerEl.classList.add('slam-return');

        setTimeout(() => {
          attackerEl.classList.remove('slam-return');
          targetEl.classList.remove('slam-hit-target');
          attackerEl.style.setProperty('--card-tx', '0px');
          attackerEl.style.setProperty('--card-ty', '0px');
          attackerEl.style.setProperty('--card-tz', '0px');
          attackerEl.style.setProperty('--slam-rot-z', '0deg');
          pgState.isAnimating = false;
        }, 280);
      }, 350);
    }, slamTime);
  }, windupTime);
}

function bindPlaygroundAttackerDrag() {
  const attackerEl = document.getElementById('pg-attacker-card');
  if (!attackerEl) return;

  let isDragging = false;
  let startX = 0, startY = 0;
  let hasMoved = false;
  let hoveredTargetEl = null;

  attackerEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pgState.isAnimating) return;
    e.preventDefault();
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    hoveredTargetEl = null;
    attackerEl.setPointerCapture(e.pointerId);
    attackerEl.classList.add('is-dragging-attacker');
  });

  attackerEl.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 6) {
      hasMoved = true;
    }
    if (hasMoved) {
      attackerEl.style.setProperty('--card-tx', `${dx}px`);
      attackerEl.style.setProperty('--card-ty', `${dy}px`);
      attackerEl.style.setProperty('--card-tz', '50px');

      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      const foundTarget = elements.find(
        (el) => el.classList?.contains('test-target-card') || el.classList?.contains('test-target-avatar') || el.closest('.test-target-card') || el.closest('.test-target-avatar')
      );
      const actualTarget = foundTarget ? (foundTarget.closest('.test-target-card') || foundTarget.closest('.test-target-avatar') || foundTarget) : null;

      if (actualTarget !== hoveredTargetEl) {
        if (hoveredTargetEl) hoveredTargetEl.classList.remove('target-drag-hovered');
        hoveredTargetEl = actualTarget;
        if (hoveredTargetEl) {
          hoveredTargetEl.classList.add('target-drag-hovered');
        }
      }
      // 드래그 중에는 항상 정방향 유지 (미리 대상 방향으로 틀어지지 않음)
      attackerEl.style.setProperty('--slam-rot-z', '0deg');
    }
  });

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    if (attackerEl.hasPointerCapture(e.pointerId)) {
      attackerEl.releasePointerCapture(e.pointerId);
    }
    attackerEl.classList.remove('is-dragging-attacker');
    if (hoveredTargetEl) {
      hoveredTargetEl.classList.remove('target-drag-hovered');
    }

    if (hasMoved && hoveredTargetEl) {
      let targetId = 'center';
      if (hoveredTargetEl.id.includes('left')) targetId = 'left';
      else if (hoveredTargetEl.id.includes('right')) targetId = 'right';
      else if (hoveredTargetEl.id.includes('avatar')) targetId = 'avatar';

      selectPlaygroundTarget(targetId);

      // 홈 슬롯 위치로 70ms 신속 반동 후 즉시 풀 파워 내리치기 발동
      attackerEl.style.transition = 'transform 0.07s cubic-bezier(0.2, 0, 0.4, 1)';
      attackerEl.style.setProperty('--card-tx', '0px');
      attackerEl.style.setProperty('--card-ty', '0px');
      attackerEl.style.setProperty('--card-tz', '0px');
      attackerEl.style.setProperty('--slam-rot-z', '0deg');
      hoveredTargetEl = null;

      setTimeout(() => {
        attackerEl.style.transition = '';
        executePlaygroundSlam();
      }, 75);
    } else {
      attackerEl.style.transition = 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)';
      attackerEl.style.setProperty('--card-tx', '0px');
      attackerEl.style.setProperty('--card-ty', '0px');
      attackerEl.style.setProperty('--card-tz', '0px');
      attackerEl.style.setProperty('--slam-rot-z', '0deg');
      setTimeout(() => {
        attackerEl.style.transition = '';
      }, 200);
    }
  };

  attackerEl.addEventListener('pointerup', onPointerUp);
  attackerEl.addEventListener('pointercancel', onPointerUp);
}

function initSlamPlayground() {
  const overlay = document.getElementById('overlay-slam-playground');
  const btnToggle = document.getElementById('btn-toggle-playground');
  const btnClose = document.getElementById('btn-close-playground');

  const openPlayground = () => {
    overlay?.classList.add('active');
    updatePlaygroundAttackerVisuals();
    updatePlaygroundTargetVisuals();
    logPlaygroundTelemetry('💥 내리치기 연출 테스트 룸 활성화됨: 원하는 수치를 조절하거나 프리셋을 클릭하세요.');
  };

  const closePlayground = () => {
    overlay?.classList.remove('active');
  };

  const togglePlayground = () => {
    if (overlay?.classList.contains('active')) {
      closePlayground();
    } else {
      openPlayground();
    }
  };

  window.__TOGGLE_SLAM_PLAYGROUND = togglePlayground;
  btnToggle?.addEventListener('click', togglePlayground);
  btnClose?.addEventListener('click', closePlayground);

  // Esc 키 닫기 & Space 키 내리치기 실행
  window.addEventListener('keydown', (e) => {
    if (overlay?.classList.contains('active')) {
      if (e.key === 'Escape') {
        closePlayground();
      } else if (e.code === 'Space' && !e.target.matches('input')) {
        e.preventDefault();
        executePlaygroundSlam();
      }
    }
  });

  // 1. 공격자 수치 컨트롤 바인딩
  const sliderAtk = document.getElementById('slider-pg-atk');
  const valAtk = document.getElementById('val-pg-atk');
  sliderAtk?.addEventListener('input', (e) => {
    pgState.atk = Number(e.target.value);
    valAtk.textContent = pgState.atk;
    updatePlaygroundAttackerVisuals();
  });

  // 코스트 필
  document.querySelectorAll('.pg-btn-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pg-btn-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      pgState.cost = Number(btn.getAttribute('data-cost'));
      const badge = document.getElementById('badge-pg-cost');
      if (badge) {
        badge.textContent =
          pgState.cost === 1
            ? 'Lv.1 (가벼움)'
            : pgState.cost === 2
            ? 'Lv.2 (보통)'
            : pgState.cost === 3
            ? 'Lv.3 (묵직함)'
            : 'Lv.4+ (중량)';
      }
      updatePlaygroundAttackerVisuals();
    });
  });

  // 관통 체크박스
  const checkPierce = document.getElementById('check-pg-pierce');
  checkPierce?.addEventListener('change', (e) => {
    pgState.hasPierce = e.target.checked;
    updatePlaygroundAttackerVisuals();
  });

  // 2. 피격 대상 수치 컨트롤 바인딩
  const sliderTargetHp = document.getElementById('slider-pg-target-hp');
  const valTargetHp = document.getElementById('val-pg-target-hp');
  sliderTargetHp?.addEventListener('input', (e) => {
    pgState.targetHp = Number(e.target.value);
    valTargetHp.textContent = pgState.targetHp;
    if (pgState.targetId !== 'avatar') {
      pgState.targetCardHp[pgState.targetId] = pgState.targetHp;
    }
    updatePlaygroundTargetVisuals();
  });

  // 타겟 선택 버튼
  document.querySelectorAll('.pg-btn-target-select').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectPlaygroundTarget(btn.getAttribute('data-target'));
    });
  });

  // 스테이지 타겟 슬롯 클릭 선택
  ['left', 'center', 'right', 'avatar'].forEach((tId) => {
    const slot = document.getElementById(`pg-target-slot-${tId}`);
    slot?.addEventListener('click', () => {
      selectPlaygroundTarget(tId);
    });
  });

  // 3. 물리 속도 & 역경직 컨트롤
  const sliderSpeed = document.getElementById('slider-pg-slam-speed');
  const valSpeed = document.getElementById('val-pg-slam-speed');
  sliderSpeed?.addEventListener('input', (e) => {
    pgState.slamSpeed = Number(e.target.value);
    valSpeed.textContent = `${pgState.slamSpeed.toFixed(1)}x`;
  });

  const sliderHitstop = document.getElementById('slider-pg-hitstop');
  const valHitstop = document.getElementById('val-pg-hitstop');
  sliderHitstop?.addEventListener('input', (e) => {
    pgState.hitstopMs = Number(e.target.value);
    valHitstop.textContent = `${pgState.hitstopMs}ms`;
  });

  // 4. 프리셋 버튼 바인딩
  document.getElementById('btn-preset-tap')?.addEventListener('click', () => {
    applyPlaygroundPreset(3, 1, false, 12, 'center');
  });
  document.getElementById('btn-preset-heavy')?.addEventListener('click', () => {
    applyPlaygroundPreset(10, 3, false, 16, 'center');
  });
  document.getElementById('btn-preset-shatter')?.addEventListener('click', () => {
    applyPlaygroundPreset(14, 2, false, 6, 'center');
  });
  document.getElementById('btn-preset-pierce')?.addEventListener('click', () => {
    applyPlaygroundPreset(26, 4, true, 8, 'center');
  });

  // 타겟 체력 복원 버튼
  document.getElementById('btn-pg-reset-targets')?.addEventListener('click', () => {
    pgState.targetCardHp = { left: 12, center: 12, right: 12, avatar: 100 };
    document.querySelectorAll('.test-target-card').forEach((el) => {
      el.classList.remove('card-whiteout');
      el.style.opacity = '1';
    });
    updatePlaygroundTargetVisuals();
    logPlaygroundTelemetry('모든 타겟 카드의 체력과 상태가 완전히 복원되었습니다.');
  });

  // 실행 버튼
  document.getElementById('btn-pg-execute-slam')?.addEventListener('click', () => {
    executePlaygroundSlam();
  });

  // 공격자 카드 인터랙티브 드래그 바인딩 (테스트 스테이지 내에서도 자유 드래그 지원!)
  bindPlaygroundAttackerDrag();
}

// 연출 테스트 룸 초기화
initSlamPlayground();

// 정적 data-vicon 벡터 아이콘 일괄 하이드레이션
hydrateVectorIcons();

// 초기화: 타이틀 로비 화면 시작
switchView('VIEW_TITLE_LOBBY');

// 게임 실행 직후 모든 정적 SVG 벡터 그래픽 사전 베이킹(런타임 필터 렉 제거)
(async () => {
  const badgeEl = document.getElementById('vector-bake-badge');
  await bakeAllVectorAssets({
    onProgress: () => {},
  });
  upgradeDomSvgImages(document);
  if (badgeEl) {
    badgeEl.hidden = true;
    badgeEl.classList.add('is-ready');
  }
})();

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
import { DuelRogueEngine, DEFAULT_CARD_CATALOG, BINDER_CATALOG } from './src/duelRogueEngine.js';
import { getCardDef as lookupCardDef } from './src/cards/catalog.js';
import { t } from './src/i18n/strings.js';
import { keywordDesc } from './src/duel/keywords.js';
import { attackableTargets, canAttackHero } from './src/duel/duelCore.js';
import { RunSaveStore } from './src/runSave.js';
import { installBrowserInterferenceGuard, SafeCardPointerController } from './src/desktopHarness.js';
import { ProceduralAudioHarness } from './src/audioHarness.js';
import { SoundBank } from './src/audio/soundBank.js';
import { CanvasJuiceEngine } from './src/canvasJuiceEngine.js';
import { svgIcon, keywordIcon, magicCircleSvg, hydrateVectorIcons } from './src/ui/vectorIcons.js';
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

let rarityConfig = loadRarityConfig();
applyRarityConfigToRoot(rarityConfig);

// 1. 브라우저 개입 원천 차단기 (우클릭, F5, Ctrl+R, 줌 차단)
installBrowserInterferenceGuard(window);

// 2. 프로시저럴 사운드 엔진
// 효과음 파일이 있으면 파일을, 없으면 합성음을 재생한다 (src/audio/soundBank.js)
const audio = new SoundBank(new ProceduralAudioHarness());
audio.load();

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
  return `<img src="${src}" class="${className}" alt="" draggable="false" onerror="this.remove(); this.nextElementSibling && this.nextElementSibling.classList.remove('art-fallback-hidden');" onload="this.nextElementSibling && this.nextElementSibling.classList.add('art-fallback-hidden');" /><span class="art-fallback art-fallback-hidden">${fallbackHtml}</span>`;
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
    btn.title = `라운드 ${st.roundNumber || 1} · ${when.toLocaleString()}`;
  }
}

// 4. 화면(View) 맵핑 (SPEC.md 3)
const views = {
  VIEW_TITLE_LOBBY: document.getElementById('view-title-lobby'),
  VIEW_FORTUNE_TELLER: document.getElementById('view-fortune-teller'),
  VIEW_CHECKPOINT: document.getElementById('view-checkpoint'),
  VIEW_CHECKPOINT_ENCOUNTER: document.getElementById('view-checkpoint-encounter'),
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
    if (btnTitleEl) btnTitleEl.textContent = '턴 종료';

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
    if (btnTitleEl) btnTitleEl.textContent = '상대 턴';
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
  VIEW_CHECKPOINT_ENCOUNTER: 'BGM_HUB',
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
// 게임 내 공통 알림/확인 다이얼로그 (window.alert / window.confirm 대체)
// ============================================================================
let activeAppDialogResolver = null;

function openAppDialog({ title = '알림', message = '', confirmText = '확인', cancelText = null, icon = 'bulb', danger = false }) {
  const modal = document.getElementById('modal-app-dialog');
  const card = modal?.querySelector('.app-dialog-card');
  const titleEl = document.getElementById('app-dialog-title');
  const msgEl = document.getElementById('app-dialog-message');
  const iconEl = document.getElementById('app-dialog-icon');
  const okBtn = document.getElementById('btn-app-dialog-ok');
  const cancelBtn = document.getElementById('btn-app-dialog-cancel');
  const closeBtn = document.getElementById('btn-app-dialog-close');

  if (!modal || !okBtn) return Promise.resolve(false);

  if (activeAppDialogResolver) {
    activeAppDialogResolver(false);
    activeAppDialogResolver = null;
  }

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (iconEl) iconEl.innerHTML = svgIcon(icon);
  if (card) card.classList.toggle('is-danger', Boolean(danger));
  okBtn.textContent = confirmText;
  okBtn.className = danger ? 'btn btn-abandon-danger' : 'btn primary-btn';

  if (cancelBtn) {
    if (cancelText) {
      cancelBtn.textContent = cancelText;
      cancelBtn.style.display = '';
    } else {
      cancelBtn.style.display = 'none';
    }
  }

  modal.classList.add('active');
  okBtn.focus();

  return new Promise((resolve) => {
    const finish = (val) => {
      modal.classList.remove('active');
      okBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKeyDown);
      activeAppDialogResolver = null;
      resolve(val);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };

    activeAppDialogResolver = finish;
    okBtn.onclick = () => {
      audio.playCardPickup();
      finish(true);
    };
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        audio.playLightTap();
        finish(false);
      };
    }
    if (closeBtn) {
      closeBtn.onclick = () => {
        audio.playLightTap();
        finish(false);
      };
    }
    modal.onclick = (e) => {
      if (e.target === modal) {
        finish(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
  });
}

function showGameAlert(message, { title = '안내', icon = 'warn', danger = false } = {}) {
  return openAppDialog({ title, message, confirmText: '확인', cancelText: null, icon, danger });
}

function showGameConfirm(message, { title = '확인', confirmText = '확인', cancelText = '취소', icon = 'warn', danger = false } = {}) {
  return openAppDialog({ title, message, confirmText, cancelText, icon, danger });
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
  audio.playCardPickup();
  engine.state = engine.createEmptyRunState('RUN_INIT', Date.now());
  switchView('VIEW_TITLE_LOBBY');
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
document.getElementById('btn-start-run')?.addEventListener('click', async () => {
  if (runSaves.hasSave()) {
    const ok = await showGameConfirm(
      '이어서 할 수 있는 런이 있습니다.\n새로 시작하면 저장된 진행 상황이 사라집니다. 계속할까요?',
      { title: '새 런 시작 확인', confirmText: '새로 시작', cancelText: '유지하기', icon: 'warn', danger: true }
    );
    if (!ok) return;
  }
  runSaves.clear();
  audio.playCardPickup();
  engine.startNewRun(`RUN_${Date.now()}`, Date.now());
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
    syncRunPhaseView();
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
});

// 4. 로그 청소 버튼
btnClearCombatLog?.addEventListener('click', () => {
  const container = document.getElementById('combat-log-history');
  if (container) {
    container.innerHTML = `
      <div class="log-entry log-system">
        <span class="log-badge badge-sys">시스템</span>
        <span class="log-msg">전투 기록이 초기화되었습니다.</span>
      </div>
    `;
  }
});

// ============================================================================
// 상단 우측 유틸리티: 임시 게임 옵션 모달 토글 & 설정
// ============================================================================
const inGameOptionsModal = document.getElementById('in-game-options-modal');
const btnInGameOptions = document.getElementById('btn-in-game-options');
const btnCloseOptions = document.getElementById('btn-close-options');
const optionsModalBackdrop = document.getElementById('options-modal-backdrop');

function toggleInGameOptions(show) {
  if (!inGameOptionsModal) return;
  const isCurrentlyHidden = inGameOptionsModal.classList.contains('is-hidden');
  const shouldOpen = show !== undefined ? show : isCurrentlyHidden;

  if (shouldOpen) {
    audio.playCardPickup();
    inGameOptionsModal.classList.remove('is-hidden');
    btnInGameOptions?.classList.add('active');
  } else {
    audio.playCardPickup();
    inGameOptionsModal.classList.add('is-hidden');
    btnInGameOptions?.classList.remove('active');
  }
}

btnInGameOptions?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleInGameOptions();
});
btnCloseOptions?.addEventListener('click', () => toggleInGameOptions(false));
optionsModalBackdrop?.addEventListener('click', () => toggleInGameOptions(false));

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

function scheduleCpuTurnIfNeeded(snap) {
  const duel = snap?.activeDuel;
  if (!duel || duel.status !== 'ONGOING' || duel.activeSeat !== 1) {
    return;
  }
  if (isCpuTurnScheduled) return;
  isCpuTurnScheduled = true;

  const cpuTempo = Math.max(0.4, Number(tunerSettings?.cpuTempo ?? 1.0));

  // 상대는 한 수씩 둔다: 사전 좌표 캡처 → 행동 실행 → 화면 갱신 → 상대 이펙트 & 쇼케이스 재생
  const step = () => {
    const preDuel = engine.getSnapshot().activeDuel;
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
      const baseDelay = result.action?.type === 'ATTACK' ? 980 : 760;
      setTimeout(step, Math.round(baseDelay / cpuTempo));
    } else {
      isCpuTurnScheduled = false;
      syncRunPhaseView();
    }
  };
  setTimeout(step, Math.round(750 / cpuTempo));
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
function flushDuelEventsToLog(duel, { skipCombat = false } = {}) {
  if (!duel || !Array.isArray(duel.events)) return;
  if (lastEventDuelId !== duel.duelId + duel.seed) {
    lastEventDuelId = duel.duelId + duel.seed;
    lastEventIndex = 0;
  }
  for (let i = lastEventIndex; i < duel.events.length; i++) {
    const ev = duel.events[i];
    if (ev.kind === 'mood') continue;
    if (skipCombat && COMBAT_KINDS.has(ev.kind)) continue;
    appendCombatLog(EVENT_LOG_CATEGORY[ev.kind] || 'system', t(ev.key, ev.params));
  }
  lastEventIndex = duel.events.length;
}

let previousUiRunPhase = null;
let duelVictoryOverlayTimer = null;
const DUEL_COMBAT_PHASES = new Set(['DUEL_ENCOUNTER', 'STAGE_1_DUEL_1', 'STAGE_3_DUEL_2', 'STAGE_5_FINAL_BOSS']);

function triggerDuelVictoryFX(headline = 'VICTORY!', subtext = '결투에서 승리했습니다') {
  audio.playVictoryJingle();
  const rect = fxCanvas ? fxCanvas.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  fxEngine.spawnVictoryCelebration((rect.width || window.innerWidth) * 0.5, (rect.height || window.innerHeight) * 0.44);

  const overlay = document.getElementById('duel-victory-overlay');
  const titleEl = document.getElementById('duel-victory-title');
  const subEl = document.getElementById('duel-victory-sub');
  if (overlay) {
    if (titleEl) titleEl.textContent = headline;
    if (subEl) subEl.textContent = subtext;
    overlay.classList.remove('is-visible');
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
    if (duelVictoryOverlayTimer) clearTimeout(duelVictoryOverlayTimer);
    duelVictoryOverlayTimer = setTimeout(() => {
      overlay.classList.remove('is-visible');
    }, 1550);
  }
}

function syncRunPhaseView() {
  const snap = engine.getSnapshot();
  const wasDuelPhase = DUEL_COMBAT_PHASES.has(previousUiRunPhase);
  previousUiRunPhase = snap.phase;
  scheduleRunSave();

  switch (snap.phase) {
    case 'STAGE_0_FORTUNE':
      switchView('VIEW_FORTUNE_TELLER');
      break;

    case 'STAGE_CHECKPOINT':
      switchView('VIEW_CHECKPOINT');
      renderCheckpointView(snap);
      if (wasDuelPhase) {
        triggerDuelVictoryFX('VICTORY!', `인카운터 승리 · 라운드 ${snap.checkpointRound || 1} 도달`);
      }
      break;

    case 'DUEL_ENCOUNTER':
    case 'STAGE_1_DUEL_1':
    case 'STAGE_3_DUEL_2':
    case 'STAGE_5_FINAL_BOSS':
      switchView('VIEW_DUEL_ARENA');
      renderDuelArena(snap);
      scheduleCpuTurnIfNeeded(snap);
      break;

    case 'STAGE_2_REWARD_PACK':
      switchView('VIEW_PACK_OPENING');
      renderPackOpening(snap);
      if (wasDuelPhase) {
        triggerDuelVictoryFX('VICTORY!', '결투 승리 보상 획득!');
      }
      break;

    case 'STAGE_4_MERCHANT_EVENT':
      switchView('VIEW_MERCHANT_EVENT');
      renderMerchantEvent(snap);
      break;

    case 'RUN_VICTORY':
      switchView('VIEW_RUN_SUMMARY');
      renderRunSummary(snap, true);
      triggerDuelVictoryFX('CHAMPION VICTORY!', '최종 보스를 격파하고 런을 완주했습니다!');
      break;

    case 'RUN_FAILED':
      switchView('VIEW_RUN_SUMMARY');
      renderRunSummary(snap, false);
      break;

    case 'IDLE':
    default:
      switchView('VIEW_TITLE_LOBBY');
      break;
  }
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
    if (logEl) logEl.textContent = '[LJack] 캔버스 주스 & 손맛 튜너 설정이 디스크에 저장되었습니다! (F2)';
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
  if (logEl) logEl.textContent = '[LJack] 카드 레어도 비주얼 설정이 저장되었습니다.';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F4') {
    e.preventDefault();
    toggleRarityTunerModal();
  }
});

// ============================================================================
// 4. [Canvas 60FPS] 대상 카드 3색 오라 하이라이트 (초록/노랑/빨강)
// ============================================================================
function highlightTargets(cardDef) {
  clearTargetHighlights();
  if (!cardDef) return;

  // 필드 전체를 대상으로 하는 유닛 소환 및 전체 효과는 눈부신 필드 초록불 연출 생략
  if (cardDef.effectType === 'SUMMON_UNIT') {
    return;
  }

  const polarity = cardDef.targetPolarity || (cardDef.effectType === 'HEAL_AND_GUARD' ? 'BENEFICIAL' : cardDef.effectType === 'CHAOS_GAMBLE' ? 'MIXED' : 'HARMFUL');

  // 필드 전체가 아닌 특정 유닛 단일 타겟 카드일 때만 대상 유닛 하이라이트
  if (polarity === 'BENEFICIAL') {
    if (cardDef.targetType === 'SINGLE_UNIT') {
      const targets = Array.from(document.querySelectorAll('#player-board .unit-field-card'));
      if (targets.length > 0) fxEngine.setTargetAura(targets, 'GREEN');
    }
  } else if (polarity === 'MIXED') {
    const targets = Array.from(document.querySelectorAll('.unit-field-card'));
    if (targets.length > 0) fxEngine.setTargetAura(targets, 'YELLOW');
  } else {
    const targets = Array.from(document.querySelectorAll('#cpu-board .unit-field-card'));
    const cMeta = document.getElementById('cpu-hand-container') || document.getElementById('cpu-seat');
    if (cMeta && targets.length === 0) targets.push(cMeta);
    if (targets.length > 0) fxEngine.setTargetAura(targets, 'RED');
  }
}

function clearTargetHighlights() {
  fxEngine.clearTargetAura();
  document.querySelectorAll('.aura-beneficial, .aura-mixed, .aura-harmful').forEach((el) => {
    el.classList.remove('aura-beneficial', 'aura-mixed', 'aura-harmful');
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
  return svgIcon('spark');
}

/** 실시간 전투 상세 로그 추가 헬퍼 (스케치 2 우측 로그창) */
function appendCombatLog(category, message) {
  const logContainer = document.getElementById('combat-log-history');
  if (!logContainer) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

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

  entry.className = `log-entry ${categoryClass}`;
  entry.innerHTML = `
    <span class="log-badge ${badgeClass}">${badgeText}</span>
    <span class="log-msg">[${timeStr}] ${message}</span>
  `;

  // 최신 로그는 항상 맨 아래에 순차적으로 추가 (새로운 전투 기록이 하단에 누적)
  logContainer.appendChild(entry);
  requestAnimationFrame(() => {
    logContainer.scrollTop = logContainer.scrollHeight;
  });
}

/**
 * [할퀸 자국 레벨 렌더러] 5진법 탤리 마크 생성기 (우측 ➔ 좌측 정렬)
 */
function generateClawLevelHtml(level) {
  if (!level || level <= 0) return '';
  const bundles = Math.ceil(level / 5);
  let remaining = level;
  let html = '';

  for (let b = 0; b < bundles; b++) {
    const strokesInThisBundle = Math.min(remaining, 5);
    const verticalStrokes = Math.min(strokesInThisBundle, 4);

    let strokesHtml = '';
    for (let s = 0; s < verticalStrokes; s++) {
      strokesHtml += `<img src="assets/badges/level_claw_single.svg" class="claw-stroke" alt="claw" />`;
    }

    let crossHtml = '';
    if (strokesInThisBundle === 5) {
      crossHtml = `<img src="assets/badges/level_claw_cross.svg" class="claw-cross" alt="claw cross" />`;
    }

    html += `<div class="claw-tally-bundle">${strokesHtml}${crossHtml}</div>`;
    remaining -= strokesInThisBundle;
  }
  return `<div class="overlay-claw-level" title="레벨 ${level}">${html}</div>`;
}

/**
 * [카드 뒷면 (Card Back) HTML 생성기]
 * - 정교한 다크 그레이/메탈릭 아케인 슬레이트 프레임과 기하학 림
 * - CPU 패, 덱 더미, 세트된 마법 카드 등에 일관 적용
 */
function generateCardBackHtml(scaleFont = 1.0) {
  return `
    <div class="card-composite-wrapper card-back-wrapper" style="--card-scale-font: ${scaleFont};">
      <div class="card-back-inner">
        <img src="assets/ui/card_back.svg" class="card-back-svg-img" alt="" draggable="false" />
      </div>
    </div>
  `;
}

/**
 * [카드 원화 Layer 1 HTML 생성기]
 * - 실제 고화질 원화(WebP)가 있는 경우 이를 표시하고,
 * - 없는 경우 기하학적 아케인 소환진(Procedural Fallback SVG) + 아키타입 태그만 깔끔하게 표시합니다 (임시 이모지 전면 제거).
 */
function getCardArtHtml(def) {
  const customArtMap = {
    'C_BLUE_01': 'assets/cards/abyssal_golem_art.webp',
    'C_PURP_02': 'assets/cards/neon_overload_art.webp',
  };
  const artSrc = customArtMap[def?.id];
  if (artSrc) {
    return `<img src="${artSrc}" alt="${def.name}" onerror="this.onerror=null; this.src='assets/placeholders/procedural_fallback.svg';" />`;
  }
  const factionLabel = def?.faction ? t(`faction.${def.faction}`) : def?.archetype || '';
  return `
    <img src="assets/placeholders/procedural_fallback.svg" alt="${def?.name || ''}" style="width:100%; height:100%; object-fit:cover;" />
    <div class="procedural-art-overlay">
      <span class="procedural-archetype-pill">${factionLabel}</span>
    </div>
  `;
}

/**
 * [카드 이름 렌더러] 상단 바 전 영역 활용 및 글씨 좌우 폭 동적 압축(scaleX) 우겨넣기
 * - 레벨 표시 영역을 포함한 전체 가로폭(85.6%)을 활용
 * - ... 말줄임표 축약 없이 긴 텍스트 발생 시 scaleX를 계산하여 좌우 폭을 압축해 100% 온전하게 노출
 */
function formatCardNameHtml(name, isMonster, level = 1) {
  if (!name) return '';
  // 글자별 유닛 계산 (한글/전각 = 1.0, 영문/숫자 = 0.55, 공백 = 0.3)
  const charUnits = Array.from(name).reduce((acc, ch) => {
    if (ch === ' ') return acc + 0.3;
    return acc + (ch.charCodeAt(0) > 255 ? 1.0 : 0.55);
  }, 0);

  // 몬스터 카드는 우측 발톱자국 레벨 영역을 제외한 가로폭 기준 동적 압축
  const baseUnits = isMonster ? (level >= 5 ? 4.8 : 5.7) : 8.2;
  let scaleX = 1.0;
  let letterSpacing = 0.2;
  if (charUnits > baseUnits) {
    scaleX = Math.max(0.45, baseUnits / charUnits);
    letterSpacing = Math.max(-1.1, 0.2 - (charUnits - baseUnits) * 0.18);
  }

  const squeezerStyle = scaleX < 1.0 || letterSpacing < 0.2
    ? `display:inline-block; transform:scaleX(${scaleX.toFixed(3)}); transform-origin:left center; letter-spacing:${letterSpacing.toFixed(1)}px; white-space:nowrap;`
    : `display:inline-block; letter-spacing:0.2px; white-space:nowrap;`;

  const levelClass = isMonster ? (level >= 5 ? 'has-level-wide' : 'has-level') : 'spell';
  return `
    <div class="overlay-name ${levelClass}" title="${name}">
      <span class="card-name-text" style="${squeezerStyle}">${name}</span>
    </div>
  `;
}

/**
 * [3계층 카드 컴포지트 HTML 생성기]
 * - isBattlefield = true: 손패 및 필드용 (하단 좌측 공격력, 하단 우측 수비력 큼직하게 분리 표기)
 * - isBattlefield = false: 좌측 카드 상세 정보 인스펙터용 (기존 정통 프레임 및 공/수 양식 100% 유지)
 */
function generateCompositeCardHtml(cardOrDef, dynamicAtk = null, dynamicDef = null, scaleFont = 1.0, isBattlefield = false) {
  if (!cardOrDef) return '<div class="card-idle-placeholder" style="color:#64748b; font-size:0.85rem; padding:20px; text-align:center;">카드를 선택하세요</div>';
  const def = cardOrDef.cardId ? lookupCardDef(cardOrDef.cardId) || cardOrDef : cardOrDef;
  const isMonster = def.type === 'MONSTER' || (def.attack > 0 && def.type !== 'SPELL');
  const atk = dynamicAtk ?? cardOrDef.currentAttack ?? def.attack ?? 0;
  const defense = dynamicDef ?? cardOrDef.currentDefense ?? def.defense ?? (def.health ?? 0);
  const level = cardOrDef.level ?? def.level ?? def.cost ?? 1;
  const rarityKey = normalizeRarityKey(def.rarity);
  const rarityPreset = rarityConfig[rarityKey]?.preset || 'NONE';

  const frameSvg = isMonster ? 'assets/frames/card_frame_unit_blank.svg' : 'assets/frames/card_frame_spell_blank.svg';

  let bottomContentHtml = '';
  if (isBattlefield) {
    // [손패 & 필드 모드]: 하단 좌측 공격력, 하단 우측 수비력 대형 배지 표기 (마법 카드는 하단 효과 영역 공백 유지)
    if (isMonster) {
      bottomContentHtml = `
        <div class="overlay-stat-badge atk-badge" title="공격력 ${atk}">
          <span class="stat-badge-num">${atk}</span>
        </div>
        <div class="overlay-stat-badge def-badge" title="수비력 ${defense}">
          <span class="stat-badge-num">${defense}</span>
        </div>
      `;
    } else {
      // 마법 카드가 패 또는 필드에 있을 때는 요청대로 하단 효과 영역을 비워둠 (양피지 여백 유지)
      bottomContentHtml = '';
    }
  } else {
    // [상세 정보 모드]: 기존 정통 프레임 및 공/수 양식 100% 유지 (프레임 양각 박스에 맞춘 고정밀 정렬)
    if (isMonster) {
      const kwIds = def.kw || [];
      const allLabels = [
        ...(def.keywords || []).map((k, i) => `<span class="frame-tag-pill keyword-pill">${keywordIcon(kwIds[i] || k)}${k}</span>`),
        ...(def.tags || []).map((t) => `<span class="frame-tag-pill tag-pill">${t.startsWith('#') ? t : `#${t}`}</span>`),
      ];
      const formattedTagsHtml = allLabels.length > 0
        ? allLabels.join(' ')
        : '<span class="frame-tag-pill">#몬스터</span>';
      bottomContentHtml = `
        <div class="overlay-tags" title="${[...(def.keywords || []), ...(def.tags || [])].join(', ')}">${formattedTagsHtml}</div>
        <div class="overlay-attack-group" title="공격력">
          <span class="stat-label-atk">공 / </span><span>${atk}</span>
        </div>
        <div class="overlay-defense-group" title="수비력">
          <span class="stat-label-def">수 / </span><span>${defense}</span>
        </div>
      `;
    } else {
      const triggerHtml = def.spellTriggerType
        ? `<div style="font-size:calc(var(--card-unit, 0.5cqw) * 9); color:#047857; font-weight:800; margin-bottom:2px;">[${def.spellTriggerType}]</div>`
        : '';
      const spellSummary = def.target ? `[대상: ${def.target}] ${def.effect || def.description}` : (def.effect || def.description || def.effectType);
      bottomContentHtml = `
        <div class="overlay-spell-effect" title="${def.description || def.effectType}">
          ${triggerHtml}
          <div>${spellSummary}</div>
        </div>
      `;
    }
  }

  const wrapperClass = isBattlefield ? 'card-composite-wrapper battlefield-view' : 'card-composite-wrapper';

  return `
    <div class="${wrapperClass}" data-rarity="${rarityKey}" data-rarity-preset="${rarityPreset}" style="--card-scale-font: ${scaleFont};">
      <!-- LAYER 1: 원화 + 레어도 이펙트 오버레이 -->
      <div class="layer-1-art">
        ${getCardArtHtml(def)}
        <div class="rarity-art-fx-layer"></div>
      </div>
      <!-- LAYER 2: 프레임 (SVG 벡터) -->
      <div class="layer-2-frame">
        <img src="${frameSvg}" alt="${isMonster ? 'Monster Frame' : 'Spell Frame'}" />
      </div>
      <!-- LAYER 3: 동적 데이터 & 카드 이름 & 발톱자국 레벨 & 하단 스탯 -->
      <div class="layer-3-dynamic-labels">
        ${formatCardNameHtml(def.name, isMonster, level)}
        ${isMonster ? generateClawLevelHtml(level) : ''}
        ${bottomContentHtml}
      </div>
    </div>
  `;
}

/** 스케치 1: "평소" 카드 프레임 HTML 생성 헬퍼 (상세 정보 인스펙터용: isBattlefield = false) */
function generateIdleCardHtml(cardOrDef, dynamicAtk = null, dynamicDef = null) {
  return generateCompositeCardHtml(cardOrDef, dynamicAtk, dynamicDef, 1.0, false);
}

/** 스케치 2: 좌측 카드 상세 & 효과 확인창 동기화 (듀얼 인게임 + 덱 편집기 공용 렌더링) */
function updateCardInspector(cardOrDef, dynamicAtk = null, dynamicDef = null, options = {}) {
  if (!cardOrDef) return;
  const previewTargets = document.querySelectorAll('[data-inspector-preview]');
  const tagsTargets = document.querySelectorAll('[data-inspector-tags]');
  const effectTargets = document.querySelectorAll('[data-inspector-effect]');

  // 상대 세트 카드는 마법 카드가 아닌 '카드 뒷면'을 프리뷰로 렌더링하고 정보 은닉
  if (cardOrDef.isOpponentSecret || cardOrDef.isFacedown) {
    const backHtml = generateCardBackHtml(1.0);
    previewTargets.forEach((el) => { el.innerHTML = backHtml; });
    const secretEffectHtml = `
        <div class="rule-block secret-block">
          <span class="rule-badge-condition">[비공개 세트 카드]</span>
          <div class="rule-content-condition" style="margin-top: 4px;">상대 듀얼리스트가 전장에 뒤집어 세트한 비밀 카드입니다. 조건 충족 시 앞면으로 뒤집히며 효과가 발동됩니다.</div>
        </div>
      `;
    effectTargets.forEach((el) => { el.innerHTML = secretEffectHtml; });
    const secretTagsHtml = '<span class="badge-keyword">비공개</span> <span class="badge-race-tag">#세트카드</span>';
    tagsTargets.forEach((el) => { el.innerHTML = secretTagsHtml; });
    return;
  }

  const def = cardOrDef.cardId ? lookupCardDef(cardOrDef.cardId) || cardOrDef : cardOrDef;
  const atk = dynamicAtk ?? cardOrDef.currentAttack ?? def.attack ?? 0;
  const defense = dynamicDef ?? cardOrDef.currentDefense ?? def.defense ?? (def.health ?? 0);
  const keywords = def.keywords || [];
  const tags = def.tags || [];
  const isGod = def.isGod || def.level === 6;

  // 1. 상단 평소 카드 실물 프리뷰
  const idleCardHtml = generateIdleCardHtml(def, atk, defense);
  previewTargets.forEach((el) => {
    el.innerHTML = idleCardHtml;
    requestAnimationFrame(() => {
      const wEl = el.querySelector('.card-composite-wrapper');
      const w = wEl?.getBoundingClientRect().width;
      if (w && w > 10) {
        wEl.style.setProperty('--card-scale-font', (w / 200).toFixed(3));
      }
    });
  });

  // 2. 키워드(# 없음) 및 종족/소속표 태그(# 있음) 배지 렌더링
  let pillsHtml = '';
  if (options.isDeckMaster || cardOrDef.isDeckMaster) {
    pillsHtml += `<span class="badge-god-tier">${svgIcon('crown')} 덱 마스터</span> `;
  }
  if (isGod) {
    pillsHtml += `<span class="badge-god-tier">${svgIcon('crown')} 6성 신(神)</span> `;
  }

  const kwIds = cardOrDef.kw || def.kw || [];
  if (keywords.length > 0) {
    pillsHtml += keywords
      .map((kw, i) => `<span class="badge-keyword" title="${kwIds[i] ? keywordDesc(kwIds[i]) : '핵심 기능 키워드'}">${keywordIcon(kwIds[i] || kw)}${kw}</span>`)
      .join(' ') + ' ';
  }
  if (def.rarity) {
    pillsHtml += `<span class="badge-rarity rarity-${def.rarity}">${t(`rarity.${def.rarity}`)}</span> `;
  }
  if (tags.length > 0) {
    pillsHtml += tags
      .map((t) => {
        const formatted = t.startsWith('#') ? t : `#${t}`;
        return `<span class="badge-race-tag" title="종족 / 소속 표기">${formatted}</span>`;
      })
      .join(' ');
  }
  if (!pillsHtml.trim()) {
    pillsHtml = '<span class="badge-keyword">기본</span>';
  }
  tagsTargets.forEach((el) => { el.innerHTML = pillsHtml; });

  // 3. 하단 카드 상세 효과 (규칙 잡음 없이 오직 [대상], [조건], [효과]만 정갈하게 표기)
  let contentHtml = '';
  if (def.target) {
    contentHtml += `
      <div class="rule-block target-block">
        <span class="rule-badge-target">[대상]</span>
        <span class="rule-content-target">${def.target}</span>
      </div>
    `;
  }

  const kwList = cardOrDef.kw || def.kw || [];
  if (kwList.length > 0) {
    contentHtml += `
      <div class="rule-block keyword-block">
        <span class="rule-badge-condition">[키워드]</span>
        <span class="rule-content-condition">${kwList.map((id) => `${keywordIcon(id)}<strong>${t(`kw.${id}`)}</strong> — ${keywordDesc(id)}`).join('<br>')}</span>
      </div>
    `;
  }
  if (cardOrDef.silenced) {
    contentHtml += `<div class="rule-block"><span class="rule-badge-condition">[침묵]</span> <span class="rule-content-condition">키워드와 효과가 지워진 상태입니다.</span></div>`;
  }

  if (def.condition || def.effect) {
    contentHtml += `
      <div class="rule-block condition-block">
        <span class="rule-badge-condition">[조건]</span>
        <span class="rule-content-condition">${def.condition}</span>
      </div>
      <div class="rule-block effect-block">
        <span class="rule-badge-effect">[효과]</span>
        <span class="rule-content-effect">${def.effect}</span>
      </div>
    `;
  } else if (kwList.length === 0) {
    contentHtml += `<div class="rule-block effect-block"><span class="rule-content-effect">특수 효과가 없는 몬스터입니다.</span></div>`;
  }

  if (def.type === 'SPELL' && def.spellTriggerType && def.spellTriggerType !== 'INSTANT') {
    contentHtml += `<div class="rule-block"><span class="rule-badge-target">[사용법]</span> <span class="rule-content-target">필드에 세트해 두면 조건이 맞을 때 자동으로 발동합니다.</span></div>`;
  }
  if (def.type === 'SPELL') {
    contentHtml += `
      <div class="rule-fizzle-clause">
        <span class="fizzle-icon">${svgIcon('warn')}</span> 대상이 소멸·파괴되거나 존재하지 않을 경우(미아 상태) 대상 부재로 효과는 <strong>불발</strong> 처리되어 묘지로 보내집니다.
      </div>
    `;
  }

  effectTargets.forEach((el) => { el.innerHTML = contentHtml; });
}

// ============================================================================
// 5. [Canvas 2D Engine 연동] 방향별 직접 타격 / 역경직 / 파편 / 영혼 / 관통 시퀀스
// ============================================================================
/** 공격이 규칙상 가능한지 미리 확인한다. 불가능하면 사유를 돌려준다. */
function attackBlockReason(attacker, targetUnit) {
  const duel = engine.state.activeDuel;
  if (!duel) return '진행 중인 듀얼이 없습니다.';
  if (duel.turnNumber <= 2) return '첫 1바퀴(1~2턴)는 공격할 수 없습니다. 3턴부터 전투가 시작됩니다.';
  const live = duel.seats[0].board.find((u) => u.instanceId === attacker.instanceId);
  if (!live || !live.canAttack || live.attacksLeft <= 0) return '이 몬스터는 지금 공격할 수 없습니다.';
  if (!targetUnit) {
    return canAttackHero(duel, live) ? null : '🛡️ [수호벽] 상대 필드에 몬스터가 존재하여 본체를 직접 공격할 수 없습니다. 적 몬스터를 먼저 처치하세요!';
  }
  const legal = attackableTargets(duel, 0);
  if (legal.some((u) => u.instanceId === targetUnit.instanceId)) return null;
  if (legal.some((u) => u.kw.includes('TAUNT'))) return '🛡️ [도발] 상대의 도발 몬스터부터 공격해야 합니다.';
  return '🌫️ [은신] 은신한 몬스터는 공격 대상으로 지정할 수 없습니다.';
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
    appendCombatLog('turn', `--- [TURN ${duel.turnNumber}] ${isPlayerTurn ? '플레이어' : '상대'} 턴 개시 (소환권: ${isPlayerTurn ? (player.normalSummonsRemaining ?? 0) : (cpu.normalSummonsRemaining ?? 0)}/1) ---`);
    if (duel.turnNumber === 1 && duel.turnDecisionReason) {
      appendCombatLog('system', `👑 선공 결정: ${duel.turnDecisionReason}`);
      appendCombatLog('system', `🛡️ [규칙 안내] 첫 1바퀴(1~2턴)는 전개 및 세트 단계로 공격이 봉인됩니다.`);
    } else if (duel.turnNumber === 3) {
      appendCombatLog('system', `⚔️ [전투 개시] 3턴이 되어 양쪽 전장의 공격이 전면 해금되었습니다!`);
    }
  }

  // 플레이어 및 CPU 스탯 렌더링 (기본 체력 100)
  const playerHp = Math.max(0, player.lp);
  const cpuHp = Math.max(0, cpu.lp);
  document.getElementById('player-lp').textContent = playerHp;
  const playerSummonEl = document.getElementById('player-summon');
  if (playerSummonEl) playerSummonEl.textContent = `${player.normalSummonsRemaining ?? 0}/1`;
  const playerDestinyEl = document.getElementById('player-destiny-badge');
  if (playerDestinyEl) playerDestinyEl.textContent = `운명: ${snap.selectedDestiny || '-'}`;

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

  const turnPhaseLabel = duel.turnNumber <= 2 ? ' (1R 전개)' : '';
  const turnLeftEl = document.getElementById('duel-turn-left');
  if (turnLeftEl) turnLeftEl.textContent = `TURN ${duel.turnNumber}`;
  const turnRightEl = document.getElementById('duel-turn-right');
  if (turnRightEl) turnRightEl.textContent = `${duel.activeSeat === 0 ? '플레이어 턴' : '상대 턴'}${turnPhaseLabel}`;

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
      const title = isMine ? `[세트된 마법] ${setSpell.name}` : `[상대 세트 카드] ?`;
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

  renderSetSlot(document.getElementById('field-set-left'), duel.fieldSetSlots?.left, '중앙 좌측 세트');
  renderSetSlot(document.getElementById('field-set-right'), duel.fieldSetSlots?.right, '중앙 우측 세트');

  // 듀얼 개시 안내 (선/후공 결정 사유 안내)
  const narrativeEl = document.getElementById('duel-narrative-log');
  if (narrativeEl && duel.turnNumber === 1 && duel.turnDecisionReason && !selectedAttackerInstanceId) {
    narrativeEl.textContent = `👑 [선공 결정] ${duel.turnDecisionReason}`;
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
  cpu.board.forEach((unit) => {
    const unitEl = createUnitElement(unit, false, cpu.setSpells || []);
    if (selectedAttackerInstanceId && duel.activeSeat === 0) {
      unitEl.classList.add('aura-harmful');
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

  if (selectedAttackerInstanceId && duel.activeSeat === 0) {
    if (hasCpuMonsters) {
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
      }
      if (cpuBoardEl) {
        cpuBoardEl.style.cursor = 'crosshair';
        cpuBoardEl.onclick = handleDirectAttackClick;
      }
    }
  } else {
    if (cpuSeatEl) {
      cpuSeatEl.onclick = null;
      cpuSeatEl.style.cursor = '';
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

        // 적 유닛 타겟팅 안내 (적 필드가 비어있을 때만 적 본체 상단 중앙 하이라이트)
        document.querySelectorAll('#cpu-board .unit-field-card').forEach((el) => el.classList.add('aura-harmful'));
        if (!hasCpuMonsters) {
          document.getElementById('cpu-hand-container')?.classList.add('aura-harmful');
          document.getElementById('cpu-seat')?.classList.add('aura-harmful');
        }
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
          if (foundMonster) {
            actualTarget = foundMonster;
          } else if (!hasCpuMonsters) {
            // 적 필드에 몬스터가 단 한 마리도 없을 때만([수호벽] 해제) 상대 플레이어 본체 타겟팅 허용!
            const isOverCpuZone = elementsUnderPoint.some(
              (el) => el.id === 'cpu-seat' || el.closest('#cpu-seat') || el.id === 'cpu-board' || el.closest('#cpu-board') || el.id === 'cpu-meta' || el.closest('#cpu-meta')
            );
            if (isOverCpuZone || e.clientY < 280) {
              actualTarget = document.getElementById('cpu-seat');
            }
          }
          // hasCpuMonsters가 true이면 적 몬스터가 없는 허공/배경을 조준해도 actualTarget은 null로 엄격 격리됨

          if (actualTarget !== hoveredTargetEl) {
            if (hoveredTargetEl) hoveredTargetEl.classList.remove('target-drag-hovered');
            hoveredTargetEl = actualTarget;
            if (hoveredTargetEl) {
              hoveredTargetEl.classList.add('target-drag-hovered');
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
          document.querySelectorAll('#cpu-board .unit-field-card').forEach((el) => el.classList.add('aura-harmful'));
          if (!hasCpuMonsters) {
            document.getElementById('cpu-meta')?.classList.add('aura-harmful');
          }
          document.getElementById('duel-narrative-log').textContent = hasCpuMonsters
            ? `⚔️ [${unit.currentAttack}공] 대상 지정 중: 적 몬스터를 클릭하거나, 카드를 드래그하여 투척하세요!`
            : `⚔️ [${unit.currentAttack}공] 상대 필드가 비어있습니다! 상대 본체(상단 중앙)를 직접 공격할 수 있습니다!`;
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

    const tags = def.tags || [];
    const initialTagHtml = tags.length > 0 ? formatTagHtml(tags[0]) : '';
    const isMonster = def.type === 'MONSTER' || def.effectType === 'SUMMON_UNIT';
    const cardLevel = def.level ?? def.cost ?? 1;

    const badgeHtml = isMonster
      ? `<span class="level-pill" title="레벨 ${cardLevel}">★ Lv.${cardLevel}</span>`
      : `<span class="spell-pill" title="마법 카드">마법</span>`;

    const descText = isMonster
      ? `⚔️ ${def.attack} / 🛡️ ${def.defense ?? def.health ?? 10}`
      : `[마법] ${def.description || def.effectType}`;

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
        if (e.target.closest('.spell-action-popover')) return;

        if (def.type === 'SPELL') {
          if (cardEl.classList.contains('is-selected')) {
            closeSpellPopovers();
          } else {
            showSpellActionMenu(cardEl, cardInst, def, duel, player);
          }
        } else if (cardLevel === 1) {
          handlePlayCard(cardInst.instanceId);
        } else {
          if (cardEl.classList.contains('is-selected')) {
            closeTributeModal();
          } else {
            openTributeSelectionModal(cardInst, def, duel, player, cardEl);
          }
        }
      });

      // 2. PointerCapture 기반 정밀 드래그 앤 드롭 & 계단식 진화 투척 & 마법 세트 존 슬롯 판정
      new SafeCardPointerController(cardEl, cardInst.instanceId, def, {
        onCardHoldStart: (_id, d) => {
          highlightTargets(d);
          highlightPlayableDropZones(d, cardInst);
        },
        onCardHoldEnd: () => {
          clearTargetHighlights();
          clearPlayableDropZones();
        },
        onTiltUpdate: () => {
          arenaField.classList.add('drop-target-active');
        },
        onCardReset: () => {
          arenaField.classList.remove('drop-target-active');
          clearTargetHighlights();
          clearPlayableDropZones();
        },
        onCardDrop: (cardId, clientX, clientY) => {
          arenaField.classList.remove('drop-target-active');
          clearTargetHighlights();
          clearPlayableDropZones();
          closeSpellPopovers();

          const elementsUnder = document.elementsFromPoint(clientX, clientY);

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
              // 친선 몬스터 위에 드롭 -> 1단계 계단식 진화 즉시 발동!
              handlePlayCard(cardId, [targetUnitInstId]);
              return;
            }
          }

          // 2-4. 전장 일반 영역에 드롭
          const fieldRect = arenaField.getBoundingClientRect();
          if (clientY < fieldRect.bottom - 40) {
            if (def.type === 'SPELL') {
              if (def.spellTriggerType === 'INSTANT') {
                handlePlayCard(cardId);
              } else {
                showSpellActionMenu(cardEl, cardInst, def, duel, player);
              }
            } else if (cardLevel === 1) {
              handlePlayCard(cardId);
            } else {
              openTributeSelectionModal(cardInst, def, duel, player);
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
// 계층형 태그 포맷터 & 롤링 티커 (공백/루트: Level 0, #: Level 1, ##: Level 2)
// ============================================================================
function formatTagHtml(tagStr) {
  if (!tagStr) return '';
  const s = String(tagStr).trim();
  if (s.startsWith('##')) {
    const label = s.substring(2).trim();
    return `<span class="tag-badge level-2 tag-fade-in"><span class="tag-prefix">##</span>${label}</span>`;
  } else if (s.startsWith('#')) {
    const label = s.substring(1).trim();
    return `<span class="tag-badge level-1 tag-fade-in"><span class="tag-prefix">#</span>${label}</span>`;
  } else {
    return `<span class="tag-badge level-0 tag-fade-in"><span class="tag-prefix"> </span>${s}</span>`;
  }
}

// 2.4초마다 모든 카드의 계층형 태그를 순환 표시하는 글로벌 티커 루프
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
        ? '필드 중앙 좌측'
        : slotType === 'FIELD_RIGHT'
        ? '필드 중앙 우측'
        : '내 몬스터 앞';
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) {
      logEl.textContent = `🔮 마법 카드가 [${slotDesc}]에 세트되었습니다. (조건 만족 시 자동 발동)`;
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

  // 1. 즉시 발동 옵션 (즉시 발동형 마법만)
  if (def.spellTriggerType === 'INSTANT') {
    const btnInstant = document.createElement('button');
    btnInstant.className = 'spell-popover-btn';
    btnInstant.innerHTML = `${svgIcon('bolt')} 즉시 발동`;
    btnInstant.onclick = (e) => {
      e.stopPropagation();
      closeSpellPopovers();
      handlePlayCard(cardInst.instanceId);
    };
    popover.appendChild(btnInstant);
  }

  // 2. 내 몬스터 앞 세트 옵션 (내 필드에 몬스터가 존재할 때)
  if (player.board.length > 0) {
    const availableMonster = player.board.find(
      (u) => !player.setSpells.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === u.instanceId)
    );
    if (availableMonster) {
      const btnFront = document.createElement('button');
      btnFront.className = 'spell-popover-btn';
      btnFront.innerHTML = `${svgIcon('shield')} 몬스터 앞 세트 (${availableMonster.name})`;
      btnFront.onclick = (e) => {
        e.stopPropagation();
        closeSpellPopovers();
        handleSetSpell(cardInst.instanceId, 'MONSTER_FRONT', availableMonster.instanceId);
      };
      popover.appendChild(btnFront);
    }
  }

  // 3. 필드 중앙 좌측 세트 옵션 (비어있을 때)
  if (!duel.fieldSetSlots?.left) {
    const btnLeft = document.createElement('button');
    btnLeft.className = 'spell-popover-btn';
    btnLeft.innerHTML = `${svgIcon('crystal')} 중앙 좌측 세트`;
    btnLeft.onclick = (e) => {
      e.stopPropagation();
      closeSpellPopovers();
      handleSetSpell(cardInst.instanceId, 'FIELD_LEFT');
    };
    popover.appendChild(btnLeft);
  }

  // 4. 필드 중앙 우측 세트 옵션 (비어있을 때)
  if (!duel.fieldSetSlots?.right) {
    const btnRight = document.createElement('button');
    btnRight.className = 'spell-popover-btn';
    btnRight.innerHTML = `${svgIcon('crystal')} 중앙 우측 세트`;
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
    const title = isMine ? `[세트된 마법] ${frontSpell.name}` : `[상대 세트 카드] ?`;
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

function handlePlayCard(cardInstanceId, tributeInstanceIds = null) {
  try {
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

function closeTributeModal() {
  if (typeof window.__activeTributeModalCleanup === 'function') {
    window.__activeTributeModalCleanup();
  }
  document.querySelectorAll('.duel-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
}

function openTributeSelectionModal(cardInst, def, duel, player, cardEl = null) {
  closeSpellPopovers();
  closeTributeModal();

  if (cardEl) {
    cardEl.classList.add('is-selected');
  } else {
    const el = document.querySelector(`.duel-card[data-instance-id="${cardInst.instanceId}"]`);
    el?.classList.add('is-selected');
  }

  const cardLevel = def.level ?? def.cost ?? 1;

  if (player.board.length === 0) {
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = `⚠️ [제물 부족] 필드에 제물로 바칠 몬스터가 없습니다.`;
    return;
  }

  // 필드 몬스터 중 1단계 진화(단일 제물)가 가능한 후보 탐색
  const stepUpCandidates = player.board.filter((u) => cardLevel - (u.level || 1) <= 1);

  const modal = document.createElement('div');
  modal.className = 'tribute-select-popover';
  modal.id = 'tribute-select-modal';

  const selectedTributeIds = new Set();

  function updateModalView() {
    const selectedArray = Array.from(selectedTributeIds)
      .map((id) => player.board.find((u) => u.instanceId === id))
      .filter(Boolean);
    const sumLevel = selectedArray.reduce((acc, u) => acc + (u.level || 1), 0);
    const isStepUp = selectedArray.length === 1 && cardLevel - (selectedArray[0].level || 1) <= 1;
    const isSummationValid = selectedArray.length >= 2 && sumLevel >= cardLevel;
    const canSummon = isStepUp || isSummationValid;

    // 필드 몬스터 하이라이트 동기화
    document.querySelectorAll('#player-board .unit-field-card').forEach((el) => {
      const uId = el.getAttribute('data-instance-id');
      if (selectedTributeIds.has(uId)) {
        el.classList.add('tribute-selected');
      } else {
        el.classList.remove('tribute-selected');
      }
    });

    const statusText = isStepUp
      ? `✨ 1단계 계단식 진화 가능! (제물: ★Lv.${selectedArray[0].level} 1마리)`
      : isSummationValid
      ? `🔥 합산 릴리스 가능! (선택 합산: ★Lv.${sumLevel} / 필요: ★Lv.${cardLevel})`
      : selectedArray.length === 0
      ? `필드의 몬스터를 클릭하여 제물을 선택하세요.`
      : `레벨 부족: 현재 ★Lv.${sumLevel} / 필요 ★Lv.${cardLevel}`;

    const bodyEl = modal.querySelector('.tribute-select-body');
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="margin-bottom:8px;">소환 대상: <strong>${def.name} (★Lv.${cardLevel})</strong></div>
        <div class="tribute-select-status">
          <span>${statusText}</span>
        </div>
      `;
    }

    const confirmBtn = modal.querySelector('#btn-confirm-tribute');
    if (confirmBtn) {
      confirmBtn.disabled = !canSummon;
      confirmBtn.style.opacity = canSummon ? '1' : '0.4';
      confirmBtn.style.cursor = canSummon ? 'pointer' : 'not-allowed';
    }
  }

  modal.innerHTML = `
    <div class="tribute-select-header">
      <span>${svgIcon('crown')} 제물(릴리스) 소환 선택</span>
      <span style="font-size:0.85rem; color:#f59e0b;">★Lv.${cardLevel}</span>
    </div>
    <div class="tribute-select-body"></div>
    <div style="font-size:0.75rem; color:#94a3b8; line-height:1.3;">
      ${svgIcon('bulb')} <strong>진화 룰</strong>: 1단계 높은 레벨은 단일 제물 1마리만으로 진화 소환 가능하며, 2단계 이상은 레벨 합산이 필요합니다.
    </div>
    <div class="tribute-select-actions">
      <button id="btn-cancel-tribute" class="btn secondary-btn" style="padding:6px 14px; font-size:0.8rem;">취소</button>
      <button id="btn-confirm-tribute" class="btn primary-btn" style="padding:6px 16px; font-size:0.8rem; background:#f59e0b; border-color:#d97706; color:#000; font-weight:800;">제물 소환</button>
    </div>
  `;

  const boardClickHandler = (e) => {
    const unitEl = e.target.closest('.unit-field-card');
    if (!unitEl || !unitEl.closest('#player-board')) return;
    e.stopPropagation();
    const instId = unitEl.getAttribute('data-instance-id');
    if (selectedTributeIds.has(instId)) {
      selectedTributeIds.delete(instId);
    } else {
      selectedTributeIds.add(instId);
    }
    updateModalView();
  };

  const playerBoardEl = document.getElementById('player-board');
  playerBoardEl?.addEventListener('click', boardClickHandler);

  modal.querySelector('#btn-cancel-tribute').onclick = (e) => {
    e.stopPropagation();
    closeTributeModal();
  };

  modal.querySelector('#btn-confirm-tribute').onclick = (e) => {
    e.stopPropagation();
    const tributes = Array.from(selectedTributeIds);
    closeTributeModal();
    handlePlayCard(cardInst.instanceId, tributes);
  };

  // 1단계 진화 후보가 딱 1마리만 존재한다면 편의상 자동 프리셋
  if (player.board.length === 1 && stepUpCandidates.length === 1) {
    selectedTributeIds.add(player.board[0].instanceId);
  }

  document.body.appendChild(modal);
  updateModalView();

  window.__activeTributeModalCleanup = () => {
    playerBoardEl?.removeEventListener('click', boardClickHandler);
    document.querySelectorAll('#player-board .unit-field-card').forEach((el) => {
      el.classList.remove('tribute-selected', 'aura-tribute-ready');
    });
    modal.remove();
    document.querySelectorAll('.duel-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
    window.__activeTributeModalCleanup = null;
  };
}

// 턴 종료 버튼 (중앙 타이머 정지 및 차례 넘김)
document.getElementById('btn-end-turn')?.addEventListener('click', () => {
  audio.playTurnBell();
  duelTurnTimer.stop();
  selectedAttackerInstanceId = null;
  clearTargetHighlights();
  engine.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
  syncRunPhaseView();
});

// 듀얼 런 포기 및 메인 메뉴 복귀 버튼
document.getElementById('btn-abandon-run')?.addEventListener('click', async () => {
  const ok = await showGameConfirm('현재 진행 중인 듀얼 런을 포기하고 메인 메뉴로 돌아가시겠습니까?', {
    title: '런 포기 확인',
    confirmText: '런 포기',
    cancelText: '계속 진행',
    icon: 'flag',
    danger: true,
  });
  if (ok) {
    toggleInGameOptions(false);
    audio.playCardPickup();
    engine.state = engine.createEmptyRunState('RUN_INIT', Date.now());
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
  // 상단 헤더
  const roundTitleEl = document.getElementById('checkpoint-round-title');
  if (roundTitleEl) {
    roundTitleEl.textContent = `체크포인트 - 라운드 ${snap.roundNumber || 1}`;
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

  // 포털 1: 다음 듀얼 인카운터
  const enc = snap.nextEncounterInfo;
  if (enc) {
    const starsEl = document.getElementById('hub-encounter-stars');
    const avatarEl = document.getElementById('hub-encounter-avatar');
    const titleEl = document.getElementById('hub-encounter-opponent-title');
    const nameEl = document.getElementById('hub-encounter-opponent-name');
    const rewardEl = document.getElementById('hub-encounter-reward');

    if (starsEl) starsEl.textContent = `${enc.stars || '★☆☆☆☆'} · ${enc.difficultyLabel || '하'}`;
    if (titleEl) titleEl.textContent = enc.opponentTitle || enc.title || '도전자';
    if (nameEl) nameEl.textContent = enc.opponentName || enc.name || '상대 듀얼리스트';
    if (rewardEl) rewardEl.textContent = `+${(enc.rewardGold || 500).toLocaleString()}원`;

    if (avatarEl) {
      const avatars = ['swords', 'shield', 'crystal', 'flame', 'balance', 'crown'];
      avatarEl.innerHTML = svgIcon(avatars[Math.min(avatars.length - 1, (snap.roundNumber || 1) - 1)]);
    }
  }

  // 포털 2: 정발 카드팩 상점
  const totalStock = (snap.checkpointShopStock || []).reduce((acc, p) => acc + (p.stock || 0), 0);
  const packKinds = (snap.checkpointShopStock || []).length;
  const shopStockEl = document.getElementById('hub-shop-stock-count');
  if (shopStockEl) {
    shopStockEl.textContent = `${packKinds}종 (총 ${totalStock}팩 입고)`;
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
      merchantAvailDesc.textContent = unboughtCount > 0 ? `영업 중 (${unboughtCount}장 판매)` : '금일 상품 완판';
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
      merchantAvailDesc.textContent = '골목길 비어 있음';
      merchantAvailDesc.style.color = '#94a3b8';
    }
  }

  // 포털 4: 가방 & 덱 편집 (트렁크)
  const deckReadyStatus = document.getElementById('hub-deck-ready-status');
  if (deckReadyStatus) deckReadyStatus.textContent = `${deckCount} / 30장`;

  const trunkTotalStatus = document.getElementById('hub-trunk-total-status');
  if (trunkTotalStatus) trunkTotalStatus.textContent = `${trunkCount}장`;

  const deckValidityText = document.getElementById('hub-deck-validity-text');
  if (deckValidityText) {
    if (deckCount === 30) {
      deckValidityText.textContent = '출격 준비 완료';
      deckValidityText.style.color = '#4ade80';
    } else {
      deckValidityText.innerHTML = `${svgIcon('warn')} 편성 필요 (${deckCount}장)`;
      deckValidityText.style.color = '#f87171';
    }
  }
}

/** 2. 다음 듀얼 인카운터 상세 브리핑 페이지 */
function renderCheckpointEncounterSubpage(snap) {
  const deckCount = snap.playerDeckCardIds?.length || 30;
  const deckStatusEl = document.getElementById('encounter-subpage-deck-status');
  if (deckStatusEl) deckStatusEl.textContent = `${deckCount} / 30장`;

  const enc = snap.nextEncounterInfo;
  if (enc) {
    const avatarEl = document.getElementById('encounter-dossier-avatar');
    const starsEl = document.getElementById('encounter-dossier-stars');
    const titleEl = document.getElementById('encounter-dossier-title');
    const nameEl = document.getElementById('encounter-dossier-name');
    const descEl = document.getElementById('encounter-dossier-desc');
    const rewardEl = document.getElementById('encounter-dossier-reward');

    if (starsEl) starsEl.textContent = `${enc.stars || '★☆☆☆☆'} · ${enc.difficultyLabel || '하'}`;
    if (titleEl) titleEl.textContent = enc.opponentTitle || enc.title || '도전자';
    if (nameEl) nameEl.textContent = enc.opponentName || enc.name || '상대 듀얼리스트';
    if (descEl) {
      descEl.textContent = enc.description || '대결을 기다리는 상대입니다.';
    }
    if (rewardEl) rewardEl.textContent = `+${(enc.rewardGold || 500).toLocaleString()}원`;

    if (avatarEl) {
      const avatars = ['swords', 'shield', 'crystal', 'flame', 'balance', 'crown'];
      avatarEl.innerHTML = svgIcon(avatars[Math.min(avatars.length - 1, (snap.roundNumber || 1) - 1)]);
    }
  }

  const hintEl = document.getElementById('encounter-dossier-deck-hint');
  const duelBtn = document.getElementById('btn-start-encounter-from-subpage');
  if (deckCount === 30) {
    if (hintEl) {
      hintEl.innerHTML = `${svgIcon('check')} 덱 매수가 30장 규격을 충족하여 즉시 결전에 나설 수 있습니다.`;
      hintEl.className = 'dossier-deck-hint';
    }
    if (duelBtn) duelBtn.disabled = false;
  } else {
    if (hintEl) {
      hintEl.innerHTML = `${svgIcon('warn')} 덱이 30장이 아닙니다 (현재 ${deckCount}장). [가방 & 덱 편집]에서 덱을 먼저 30장으로 편성하십시오.`;
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
    let tagline = '컨트롤 & 성역 결계 테마';

    if (pack.id === 'PACK_RED') {
      visualClass = 'pack-visual-red';
      symbol = svgIcon('flame');
      tagline = '어그로 & 화룡 돌격 테마';
    } else if (pack.id === 'PACK_PURPLE') {
      visualClass = 'pack-visual-purple';
      symbol = svgIcon('dice');
      tagline = '혼돈 & 도박 룰렛 테마';
    } else if (pack.id === 'PACK_WILD') {
      visualClass = 'pack-visual-neutral';
      symbol = svgIcon('gear');
      tagline = '야수 · 기계 · 정령 · 언데드 · 용병';
    } else if (pack.id === 'PACK_LEGEND') {
      visualClass = 'pack-visual-legend';
      symbol = svgIcon('crown');
      tagline = '태초의 3대 신화 & 최고급 거신';
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
            ${isSoldOut ? '품절' : `남은 수량: ${pack.stock}팩`}
          </span>
        </div>
      </div>
      <button class="btn primary-btn btn-buy-pack" ${isSoldOut || !canAfford ? 'disabled' : ''}>
        ${isSoldOut ? '품절되었습니다' : !canAfford ? '골드 부족' : `개봉 구매 (${pack.price.toLocaleString()}원)`}
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
            <span style="font-size:0.72rem; color:#94a3b8;">단품 가격</span>
            <strong style="font-size:1.05rem; font-weight:900; color:#fde047;">${item.price.toLocaleString()}원</strong>
          </div>
        </div>
        <button class="btn secondary-btn btn-buy-shop-single" ${!canAfford ? 'disabled' : ''}>
          ${item.purchased ? '구매 완료 (가방 보관)' : !canAfford ? '골드 부족' : `낱장 구매 (${item.price.toLocaleString()}원)`}
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
  if (titleEl) titleEl.textContent = `암시장 물물교환: ${deal.title}`;
  const subEl = document.getElementById('trade-select-dialog-sub');
  if (subEl) subEl.textContent = deal.flavor;

  const targetPreviewEl = document.getElementById('trade-target-preview');
  if (targetPreviewEl) {
    const rDef = deal.rewardDef || lookupCardDef(deal.rewardCardId);
    const isMonster = rDef ? (rDef.type === 'MONSTER' || (rDef.attack > 0 && rDef.type !== 'SPELL')) : false;
    const reqCount = deal.wantedCardIds ? deal.wantedCardIds.length : (deal.requiredCardCount || 1);

    targetPreviewEl.innerHTML = `
      <div style="font-size:0.8rem; font-weight:800; color:#c084fc; margin-bottom:4px;">획득 대상 카드</div>
      <div style="width:130px; height:182px; display:flex; align-items:center; justify-content:center;">
        ${rDef ? generateCompositeCardHtml(rDef, rDef.attack, rDef.defense ?? rDef.health, 0.65, false) : ''}
      </div>
      <div style="text-align:center; margin-top:6px;">
        <h4 style="margin:0; font-size:1.02rem; color:#f8fafc; font-weight:800;">${rDef?.name || deal.cardName}</h4>
        <span style="font-size:0.75rem; color:#a855f7;">${isMonster ? `Lv.${rDef.level || rDef.cost} 몬스터` : '마법 카드'}</span>
      </div>

      <!-- 상인 지정 요구 카드 체크리스트 박스 -->
      <div class="modal-wanted-box">
        <div class="modal-wanted-header">
          <span>${svgIcon('target')} 트레이더 지정 요구 목록</span>
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
      ${isSelected ? `<span class="trade-check-badge">${svgIcon('check')} 제물 #${selectionOrder}</span>` : ''}
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
              hintEl.innerHTML = `<span style="color:#f87171;">${svgIcon('warn')} 트레이더가 요구한 지정 카드(${svgIcon('target')})만 선택할 수 있습니다.</span>`;
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
      feeHintEl.innerHTML = `${svgIcon('gold')} 제물 수수료: <strong>${fee.toLocaleString()}원</strong> (보유: ${currentGold.toLocaleString()}원)`;
      feeHintEl.style.color = currentGold >= fee ? '#fde047' : '#ef4444';
    } else {
      feeHintEl.innerHTML = `<span style="color:#a3e635;">${svgIcon('gold')} 수수료 무료 (0원)</span>`;
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
          hintEl.innerHTML = `<span style="color:#4ade80; font-weight:700;">${svgIcon('check')} 지정 카드 충족! 출전 덱 빈 슬롯은 획득 카드와 가방의 ${names}로 자동 보충되어 30장 정규 규격이 유지됩니다.</span>`;
        } else if (plan.deckConsumed > 0) {
          hintEl.innerHTML = `<span style="color:#4ade80; font-weight:700;">${svgIcon('check')} 지정 카드 충족! (출전 덱 카드는 획득 카드로 자동 교체되어 30장 정규 규격이 유지됩니다.)</span>`;
        } else {
          hintEl.innerHTML = `<span style="color:#4ade80; font-weight:700;">${svgIcon('check')} 지정 카드 충족! [물물교환 확정] 버튼을 눌러 교환을 완료하세요.</span>`;
        }
      }
    } else {
      if (confirmBtn) confirmBtn.disabled = true;
      if (hintEl) {
        hintEl.innerHTML = `<span style="color:#f87171; font-weight:700;">${svgIcon('warn')} 제물 수수료가 부족하여 거래를 체결할 수 없습니다. (보유: ${currentGold.toLocaleString()}원 / 필요: ${fee.toLocaleString()}원)</span>`;
      }
    }
  } else {
    if (confirmBtn) confirmBtn.disabled = true;
    const remaining = expectedCount - activeSelectedCandidates.length;
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#94a3b8;">오른쪽 카드 목록에서 트레이더가 요구하는 지정 카드(${svgIcon('target')})를 <strong>${remaining}장</strong> 더 선택해 주세요.</span>`;
    }
  }
}

function renderCheckpointMerchantSubpage(snap) {
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
        <p>수상한 상인의 뒷골목은 지금 쥐죽은 듯 조용합니다.<br><small style="color:#64748b;">(상인은 라운드마다 약 35% 확률로 드물게 찾아옵니다.)</small></p>
      </div>
    `;
    if (dialogueText) {
      dialogueText.textContent = '"...인적이 끊긴 골목이다. 바람 소리만이 차갑게 스쳐 지나간다."';
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
        wantedHtml = `<div class="req-desc">${deal.flavor || '가방의 잉여 카드를 제물로 바쳐 교환합니다.'}</div>`;
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
          <div class="req-title">필요 대가: 트레이더 지정 요구 카드 <strong>(${reqCount}장)</strong></div>
          ${wantedHtml}
          ${(deal.goldFee || 0) > 0 ? `<div class="req-fee">${svgIcon('gold')} 제물 수수료: <strong>${deal.goldFee.toLocaleString()}원</strong></div>` : `<div class="req-fee" style="color:#a3e635;">${svgIcon('gold')} 수수료 무료 (0원)</div>`}
        </div>

        <div class="deal-action-side">
          <button class="btn btn-start-trade" ${deal.completed || !canFulfill ? 'disabled' : ''} data-deal-id="${deal.dealId}">
            ${deal.completed ? `${svgIcon('check')} 교환 완료` : !canFulfill ? `${svgIcon('cross')} 요구 카드 부족` : `${svgIcon('trade')} 물물교환 제안`}
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
      noticeEl.innerHTML = `${svgIcon('check')} 덱이 정확히 30장이므로 인카운터에 바로 출격할 수 있습니다.`;
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
      const tileEl = document.createElement('div');
      tileEl.className = `trunk-card-tile ${isDeckMaster ? 'is-deckmaster' : ''}`;
      tileEl.title = isDeckMaster ? `${def.name} (덱 마스터)` : def.name;

      tileEl.innerHTML = `
        <div class="trunk-card-frame">
          ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.38, true)}
        </div>
      `;

      tileEl.addEventListener('mouseenter', () => updateCardInspector(def, null, null, { isDeckMaster }));

      if (isDeckMaster) {
        tileEl.addEventListener('click', () => {
          updateCardInspector(def, null, null, { isDeckMaster: true });
          showGameAlert('덱 마스터 몬스터는 가방으로 보낼 수 없습니다. (덱 마스터 보호 규칙)', {
            title: '덱 마스터 보호 규칙',
            icon: 'crown',
          });
        });
      } else {
        tileEl.addEventListener('click', () => {
          try {
            audio.playCardPickup();
            engine.moveCardDeckToTrunk(cardId);
            renderCheckpointDeckEditorSubpage(engine.getSnapshot());
            updateCardInspector(def);
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
          ${svgIcon('bag')} 가방이 비어 있습니다.<br>상점에서 부스터 팩을 구매하거나 암거래상 카드를 영입하세요!
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

        tileEl.addEventListener('mouseenter', () => updateCardInspector(def));

        tileEl.addEventListener('click', () => {
          try {
            audio.playCardPlayImpact();
            engine.moveCardTrunkToDeck(cardId);
            renderCheckpointDeckEditorSubpage(engine.getSnapshot());
            updateCardInspector(def);
          } catch (e) {
            console.error(e);
          }
        });

        bagGrid.appendChild(tileEl);
      });
    }
  }

  // 초기 진입 시 덱 첫 번째 카드(덱 마스터 등)를 인스펙터에 기본 노출
  const initialPreviewDef = lookupCardDef(deckMasterId || deckCards[0] || trunkCards[0]);
  if (initialPreviewDef) {
    updateCardInspector(initialPreviewDef, null, null, { isDeckMaster: initialPreviewDef.id === deckMasterId });
  }

  // 덱/가방 카드 실제 렌더링 폭 기반 --card-scale-font 정밀 보정
  requestAnimationFrame(() => {
    [deckGrid, bagGrid].forEach((grid) => {
      if (!grid) return;
      grid.querySelectorAll('.card-composite-wrapper').forEach((wEl) => {
        const w = wEl.getBoundingClientRect().width;
        if (w > 10) {
          wEl.style.setProperty('--card-scale-font', (w / 200).toFixed(3));
        }
      });
    });
  });
}

// ============================================================================
// 체크포인트 허브 & 서브페이지 이벤트 리스너 바인딩
// ============================================================================
// 허브에서 서브페이지로 이동
document.getElementById('btn-checkpoint-nav-encounter')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_ENCOUNTER');
  renderCheckpointEncounterSubpage(engine.getSnapshot());
});

document.getElementById('btn-checkpoint-nav-shop')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_SHOP');
  renderCheckpointShopSubpage(engine.getSnapshot());
});

document.getElementById('btn-checkpoint-nav-merchant')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_MERCHANT');
  renderCheckpointMerchantSubpage(engine.getSnapshot());
});

document.getElementById('btn-checkpoint-nav-deck')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_DECK_EDITOR');
  renderCheckpointDeckEditorSubpage(engine.getSnapshot());
});

// 서브페이지에서 허브로 복귀
document.getElementById('btn-encounter-back-hub')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

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
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

document.getElementById('btn-editor-finish')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

// 서브페이지 간 빠른 덱 편집실 바로가기
document.getElementById('btn-shop-to-editor')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_DECK_EDITOR');
  renderCheckpointDeckEditorSubpage(engine.getSnapshot());
});

document.getElementById('btn-merchant-to-editor')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_DECK_EDITOR');
  renderCheckpointDeckEditorSubpage(engine.getSnapshot());
});

document.getElementById('btn-encounter-to-editor')?.addEventListener('click', () => {
  audio.playCardPickup();
  switchView('VIEW_CHECKPOINT_DECK_EDITOR');
  renderCheckpointDeckEditorSubpage(engine.getSnapshot());
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

  if (isVictory) {
    badgeEl.innerHTML = svgIcon('trophy');
    titleEl.textContent = 'DUEL ROGUE CLIMAX';
    titleEl.style.color = '#facc15';
    descEl.textContent = '운명의 최종 보스를 꺾고 모든 시련을 완주했습니다!';
  } else {
    badgeEl.innerHTML = svgIcon('skull');
    titleEl.textContent = 'DUEL ROGUE DEFEAT';
    titleEl.style.color = '#f87171';
    descEl.textContent = '라이프 포인트가 0이 되어 런이 종료되었습니다.';
  }

  deckListEl.innerHTML = '';
  snap.playerDeckCardIds.forEach((cardId) => {
    const def = lookupCardDef(cardId);
    const li = document.createElement('li');
    li.textContent = def ? def.name : cardId;
    deckListEl.appendChild(li);
  });

  if (snap.hallOfFameSnapshot) {
    payloadBox.textContent = JSON.stringify(snap.hallOfFameSnapshot, null, 2);
  } else {
    payloadBox.textContent = '// 패배로 인해 명예의 전당 페이로드가 생성되지 않았습니다.';
  }
}

document.getElementById('btn-return-to-lobby')?.addEventListener('click', () => {
  switchView('VIEW_TITLE_LOBBY');
});

// ============================================================================
// 8. OVERLAY_BINDER_BOOK (3×3 실물 바인더 북 & 컬렉터 아카이브)
// ============================================================================
let currentBinderSelectedCardId = null;

function toggleBinderModal() {
  overlayBinderBook.classList.toggle('active');
  if (overlayBinderBook.classList.contains('active')) {
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
    let statusPillHtml = '';

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

  // 3×3 바인더 카드 실제 폭 기준 --card-scale-font 정밀 보정
  requestAnimationFrame(() => {
    gridEl.querySelectorAll('.binder-slot .card-composite-wrapper').forEach((wEl) => {
      const w = wEl.getBoundingClientRect().width;
      if (w > 10) {
        wEl.style.setProperty('--card-scale-font', (w / 200).toFixed(3));
      }
    });
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
        전체 수집: <strong>${totalOwned} / ${totalSlots}장 (${percentOwned}%)</strong> | 숙련 마스터: <strong>${totalMastered}장</strong> (현재 페이지: ${pageOwnedCount}/9 소유)
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
      const triggerLabel = def.spellTriggerType === 'SET' ? '트랩 / 세트 발동' : '즉시 발동 (INSTANT)';
      combatStatsContainer.innerHTML = `
        <div class="dossier-stat-pill stat-pill-spell">
          <span>${svgIcon('scroll')} ${triggerLabel}</span>
        </div>
      `;
    }
  }

  // 3. 타이틀 & 상태 배지
  if (isUnknown) {
    if (titleEl) titleEl.textContent = '??? [미지의 카드]';
    if (statusBadgeEl) {
      statusBadgeEl.className = 'dossier-badge badge-unk';
      statusBadgeEl.innerHTML = `${svgIcon('lock')} 미발견 (UNKNOWN)`;
    }
  } else {
    if (titleEl) titleEl.textContent = `${def.name} (#${String(slot.globalIndex + 1).padStart(2, '0')})`;
    if (statusBadgeEl) {
      if (isMastered) {
        statusBadgeEl.className = 'dossier-badge badge-mast';
        statusBadgeEl.innerHTML = `${svgIcon('star')} 숙련 마스터 (MASTERED)`;
      } else if (isOwned) {
        statusBadgeEl.className = 'dossier-badge badge-own';
        statusBadgeEl.textContent = '소유 완료 (OWNED)';
      } else {
        statusBadgeEl.className = 'dossier-badge badge-disc';
        statusBadgeEl.textContent = '발견 / 미소유 (SEEN)';
      }
    }
  }

  // 4. 메타 배지 라인
  if (metaEl) {
    if (isUnknown) {
      metaEl.innerHTML = `
        <span class="meta-pill" style="background:#1e293b; color:#64748b;">분류: 미확인</span>
        <span class="meta-pill" style="background:#1e293b; color:#64748b;">코스트: ?</span>
      `;
    } else {
      const typeStr = isMonster ? '몬스터 유닛' : '전술 마법';
      const costStr = `코스트: ${def.cost ?? def.level ?? 1}`;
      const levelStr = isMonster ? `Lv.${def.level ?? def.cost ?? 1}` : '';
      metaEl.innerHTML = `
        <span class="meta-pill archetype">${def.archetype || '중립'}</span>
        <span class="meta-pill type">${typeStr}</span>
        <span class="meta-pill cost">${costStr}</span>
        ${levelStr ? `<span class="meta-pill level">${levelStr}</span>` : ''}
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
      masterySubEl.innerHTML = '카드를 획득한 후 듀얼에서 사용하면 숙련도가 누적됩니다.';
    } else if (isMastered) {
      masterySubEl.innerHTML = `<strong style="color:#facc15;">${svgIcon('star')} 숙련도 마스터 완료!</strong> 바인더와 인게임 카드에 찬란한 무지개 홀로그램 포일 오라가 영구 각인되었습니다.`;
    } else {
      const remaining = Math.max(0, masteryMax - mastery);
      masterySubEl.innerHTML = `전투에서 이 카드를 플레이하여 100pt를 달성하면 <strong>홀로그램 포일 카드</strong>로 승급됩니다. (남은 포인트: <strong>${remaining}pt</strong>)`;
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
          <p><strong>${svgIcon('lock')} 아직 발견되지 않은 미지의 카드입니다.</strong></p>
          <p class="sub-hint">${svgIcon('bulb')} 던전 런(Duel Run)을 진행하며 새로운 보상 팩을 개봉하거나, 적 듀얼리스트와의 대전에서 이 카드를 마주치면 도감 정보가 해금됩니다.</p>
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

      let rulesListHtml = '';
      if (isMonster) {
        const isPierce = def.tags?.some((t) => t.includes('관통'));
        rulesListHtml = `
          <div class="dossier-rule-item">
            <span>${svgIcon('swords')} <strong>[전투 판정]</strong> 공격력(${atk}) > 상대 수비력일 때 상대 유닛을 <strong>전투 파괴</strong>합니다.</span>
          </div>
          <div class="dossier-rule-item">
            <span>${svgIcon('bolt')} <strong>[속공 룰]</strong> 소환된 턴에 대기 시간 없이 즉시 적 몬스터를 공격할 수 있습니다.</span>
          </div>
          <div class="dossier-rule-item">
            <span>${svgIcon('shield')} <strong>[수호 룰]</strong> 필드에 몬스터가 1마리라도 생존해 있으면 본체 직접 공격이 차단됩니다.</span>
          </div>
          <div class="dossier-rule-item">
            <span>${svgIcon('arrowPierce')} <strong>[관통 판정]</strong> ${isPierce ? '<span style="color:#f59e0b; font-weight:800;">관통 보유:</span> 수비력을 초과한 대미지가 적 본체 LP에 직격합니다.' : '<span style="color:#94a3b8;">일반 타격:</span> 관통이 없으므로 수비력을 초과해도 본체 피해가 없습니다.'}</span>
          </div>
        `;
      } else {
        const triggerDesc = def.spellTriggerType === 'SET'
          ? '몬스터 앞 / 필드 중앙에 세트되어 트리거 조건 충족 시 자동 격발됩니다.'
          : '손패에서 패 코스트를 지불하고 필드에 즉시 격발하여 전황을 바꿉니다.';
        rulesListHtml = `
          <div class="dossier-rule-item">
            <span>${svgIcon('scroll')} <strong>[발동 방식]</strong> ${triggerDesc}</span>
          </div>
          <div class="dossier-rule-item">
            <span>${svgIcon('balance')} <strong>[전술 제한]</strong> 마법 카드는 강력한 전황 역전력을 지니므로 덱당 엄선하여 편성합니다.</span>
          </div>
        `;
      }

      descEl.innerHTML = `
        <div class="dossier-effect-header"><strong>${svgIcon('scroll')} 카드 고유 효과</strong></div>
        <div class="dossier-desc-banner">${effectKoreanText}</div>
        <div class="dossier-rules-list">
          <div style="font-weight:800; color:#38bdf8; margin-bottom:2px;">${svgIcon('book')} 전술 & 교전 규정</div>
          ${rulesListHtml}
        </div>
      `;
    }
  }
}

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
            ? '1코스트 (가벼움/촐랑거림)'
            : pgState.cost === 2
            ? '2코스트 (보통)'
            : pgState.cost === 3
            ? '3코스트 (묵직한 강타)'
            : '4코스트 (거신/단단함)';
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

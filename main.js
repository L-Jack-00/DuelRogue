/**
 * @file main.js
 * @description 「듀얼 로그 (Duel Rogue)」 UI 레이어 컨트롤러
 * - SPEC.md 계층 3 (Desktop & UI Harness) 준수
 * - Pure Domain Core(binderCore.js, duelRogueEngine.js, desktopHarness.js) 연결
 * - 7가지 UI View FSM 전환 및 3x3 바인더 오버레이 모달 제어
 * - PointerCapture 기반 카드 드래그 앤 드롭 및 프로시저럴 사운드 연동
 */

import { BinderCardState } from './src/types.js';

// 정식 릴리즈 빌드 시 tools/prepare_tauri_dist.mjs가 true로 치환하여 디버그 UI/단축키/일시정지를 비활성화합니다.
const IS_RELEASE_BUILD = false;
const IS_DEBUG_TOOLS_ENABLED = !IS_RELEASE_BUILD;

if (!IS_DEBUG_TOOLS_ENABLED && typeof document !== 'undefined') {
  document.querySelectorAll('[data-debug-only]').forEach((el) => el.remove());
  const timerWrap = document.getElementById('turn-timer-container');
  if (timerWrap) timerWrap.setAttribute('title', '턴 타이머');
}
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
  getCardArtSrc,
  getCardArtHtml,
  formatCardNameHtml,
  fitCardNameTextBoxes,
  generateCompositeCardHtml,
  generateIdleCardHtml,
  updateCardInspector,
} from './src/ui/cardRenderer.js';
import {
  RARITY_TIERS,
  RARITY_LABELS_KO,
  RARITY_PRESET_INFO,
  CARD_NAME_FONT_PRESETS,
  DEFAULT_CARD_NAME_FONT_SETTINGS,
  loadRarityConfig,
  saveRarityConfig,
  cloneDefaultRarityConfig,
  applyRarityConfigToRoot,
  normalizeRarityKey,
} from './src/ui/raritySystem.js';
import {
  MASTERY_TIERS,
  MASTERY_TIER_META,
  MASTERY_FX_PRESETS,
  loadMasteryFxConfig,
  saveMasteryFxConfig,
  resolveCardMasteryVisual,
  isMasteryPresetUnlocked,
  getNextMasteryUnlockInfo,
  getMasteryTierFromPoints,
} from './src/ui/masterySystem.js';
import { filterAndSortBagCardIds, sortDeckListCardIds } from './src/ui/deckEditorFilter.js';
import {
  bakeAllVectorAssets,
  resolveBakedAsset,
  upgradeDomSvgImages,
  getVectorBakeStats,
  getVictoryDefeatBakeStats,
  upgradeVictoryDefeatDomAssets,
  bakeDynamicSvgAsset,
  resolveBakedDynamicAsset,
  hasBakedDynamicAsset,
} from './src/ui/vectorBaker.js';
import { applySceneBackdrop, sceneFor, probeImage, npcPortraitChain, npcDialogue, productWrapHtml } from './src/ui/sceneArt.js';
import {
  SLEEVE_PRESETS,
  MAT_PRESETS,
  MAT_RECOMMENDED_SIZE,
  CUSTOM_SLEEVE_OPTIONS,
  DEFAULT_CUSTOM_SLEEVE,
  normalizeCustomSleeve,
  dialColorToCss,
  buildCustomSleeveSvgDataUri,
  getSleeveBakeKey,
  getSleeveBakeSource,
  loadCosmeticsConfig,
  saveCosmeticsConfig,
  resolvePlayerSleeveSpec,
  applyDuelCosmetics,
} from './src/ui/cosmeticsSystem.js';

let rarityConfig = loadRarityConfig();
let masteryFxConfig = loadMasteryFxConfig();
let cosmeticsConfig = loadCosmeticsConfig();
applyRarityConfigToRoot(rarityConfig);
applyDuelCosmetics(cosmeticsConfig);
configureCardRenderer({
  rarityPresetResolver: (rarityKey) => rarityConfig[rarityKey]?.preset || 'NONE',
  masteryVisualResolver: (cardId, cardOrDef = null) => {
    if (cardOrDef && cardOrDef.ownerSeat === 1) {
      return resolveCardMasteryVisual(cardId, 0, 0, { tierDefaults: {}, cardOverrides: {} });
    }
    const entry = typeof binder !== 'undefined' ? binder?.entries?.[cardId] : null;
    return resolveCardMasteryVisual(cardId, entry?.masteryPoints || 0, entry?.state || 0, masteryFxConfig);
  },
  sleeveResolver: ({ compact = false } = {}) => resolvePlayerSleeveSpec(cosmeticsConfig, {
    compact,
    bakedUrlResolver: (key, isCompact) => resolveBakedDynamicAsset(key, { compact: isCompact }),
  }),
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

function getCardMasteryVisualFx(cardId, ownerSeat = 0) {
  if (!cardId || typeof binder === 'undefined' || ownerSeat === 1) {
    return { isMastered: false, hasEntranceFx: false, tint: '#38bdf8', glow: 0, foil: 0, preset: 'NONE', tier: 'UNMASTERED' };
  }
  const entry = binder?.entries?.[cardId] || null;
  const resolved = resolveCardMasteryVisual(cardId, entry?.masteryPoints || 0, entry?.state || 0, masteryFxConfig);
  const preset = resolved.preset || 'NONE';
  return {
    isMastered: resolved.tier === 'MASTERED',
    hasEntranceFx: preset !== 'NONE',
    tint: resolved.tint || '#38bdf8',
    glow: Number(resolved.glow) || 0,
    foil: Number(resolved.foil) || 0,
    preset,
    tier: resolved.tier,
  };
}

/**
 * 카드가 보드에 실제 안착한 뒤(배열 재배치 완료 후) 슬롯 중심 좌표를 측정해
 * 소유자의 숙련도 등장 연출과 슬램 애니메이션을 정확한 위치에 출력합니다.
 */
function triggerUnitSummonEntrance(unitEl, mFx) {
  if (!unitEl) return;
  requestAnimationFrame(() => {
    if (!unitEl.isConnected) return;
    const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0 };
    const sr = unitEl.getBoundingClientRect();
    const sx = sr.left - cRect.left + sr.width / 2;
    const sy = sr.top - cRect.top + sr.height / 2;
    if (mFx?.hasEntranceFx) unitEl.dataset.entrancePreset = mFx.preset;
    void unitEl.offsetWidth;
    unitEl.classList.add('summon-slam-enter');
    spawnCardMasteryEntranceVfx(sx, sy, mFx, false);
  });
}

/**
 * 카드에 설정된 숙련도 이펙트 프리셋에 맞춰 듀얼 등장(소환/마법 발동) 시각 연출을 출력합니다.
 */
function spawnCardMasteryEntranceVfx(x, y, mFx, isSpell = false) {
  const preset = mFx?.preset || 'NONE';
  const baseColor = isSpell ? '#34d399' : '#38bdf8';
  const tint = mFx?.tint || baseColor;
  switch (preset) {
    case 'SUBTLE_EDGE':
      fxEngine.spawnSummonBurst(x, y, tint, isSpell ? 136 : 118);
      fxEngine.spawnShockwave(x, y, isSpell ? 96 : 82, tint);
      break;
    case 'ARCANE_SPARK':
      fxEngine.spawnSummonBurst(x, y, tint, isSpell ? 148 : 132);
      fxEngine.spawnShockwave(x, y, isSpell ? 104 : 88, tint);
      fxEngine.spawnShockwave(x, y, isSpell ? 136 : 118, '#e9d5ff');
      fxEngine.spawnImpactStarburst(x, y, isSpell ? 30 : 24, tint);
      break;
    case 'HOLO_FOIL':
      fxEngine.spawnSummonBurst(x, y, tint, isSpell ? 164 : 148);
      fxEngine.spawnShockwave(x, y, isSpell ? 112 : 96, '#38bdf8');
      fxEngine.spawnShockwave(x, y, isSpell ? 144 : 126, tint);
      fxEngine.spawnImpactStarburst(x, y, isSpell ? 40 : 32, '#fef08a');
      break;
    case 'GOLDEN_CROWN':
      fxEngine.spawnSummonBurst(x, y, tint, isSpell ? 182 : 165);
      fxEngine.spawnShockwave(x, y, isSpell ? 122 : 108, '#fef08a');
      fxEngine.spawnShockwave(x, y, isSpell ? 158 : 142, tint);
      fxEngine.spawnImpactStarburst(x, y, isSpell ? 48 : 38, tint);
      break;
    default:
      fxEngine.spawnSummonBurst(x, y, baseColor, isSpell ? 130 : 105);
      break;
  }
}

/**
 * 숙련도 이펙트 프리셋 드롭다운을 해금 포인트 조건에 맞춰 일괄 구성합니다.
 */
function populateMasteryPresetSelect(selEl, points = 0, cardState = 0, { allowDefault = true, currentValue = 'DEFAULT', disabledAll = false } = {}) {
  if (!selEl) return;
  if (disabledAll) {
    selEl.disabled = true;
    selEl.value = allowDefault ? 'DEFAULT' : 'NONE';
    return;
  }
  selEl.disabled = false;
  Array.from(selEl.options).forEach((opt) => {
    if (opt.value === 'DEFAULT' || opt.value === 'NONE') {
      opt.disabled = false;
      return;
    }
    const info = MASTERY_FX_PRESETS[opt.value];
    if (!info) return;
    const unlocked = isMasteryPresetUnlocked(opt.value, points, cardState);
    opt.disabled = !unlocked;
    opt.textContent = unlocked
      ? info.label
      : `🔒 ${info.label} (${info.minPoints}pt 필요)`;
  });
  const fallbackVal = allowDefault ? 'DEFAULT' : 'NONE';
  selEl.value = (
    currentValue === 'DEFAULT' ||
    currentValue === 'NONE' ||
    (MASTERY_FX_PRESETS[currentValue] && isMasteryPresetUnlocked(currentValue, points, cardState))
  )
    ? currentValue
    : fallbackVal;
}

/**
 * 그림 파일이 있으면 그림을, 없으면 대체 표시(이모지 등)를 보여 주는 HTML.
 * 파일이 없어도 깨진 그림 아이콘이 나오지 않는다.
 */
function artImg(src, className, fallbackHtml) {
  if (!src) return fallbackHtml;
  const resolvedSrc = resolveBakedAsset(src);
  return `<img src="${resolvedSrc}" data-raw-src="${src}" class="${className}" alt="" draggable="false" onerror="var n = this.nextElementSibling; this.remove(); n && n.classList.remove('art-fallback-hidden');" onload="this.nextElementSibling && this.nextElementSibling.classList.add('art-fallback-hidden');" /><span class="art-fallback art-fallback-hidden">${fallbackHtml}</span>`;
}

const PACK_ART = {
  PACK_BLUE: 'assets/ui/pack_blue.svg',
  PACK_RED: 'assets/ui/pack_red.svg',
  PACK_PURPLE: 'assets/ui/pack_purple.svg',
  PACK_WILD: 'assets/ui/pack_neutral.svg',
  PACK_LEGEND: 'assets/ui/pack_legend.svg',
};

/** Image chain as nested artImg markup: the first file that loads is shown. */
function artChainHtml(chain, className, finalFallbackHtml) {
  return chain.reduceRight((fallback, src) => artImg(src, className, fallback), finalFallbackHtml);
}

/**
 * Shopkeeper or back-alley dealer for this encounter. A different person per
 * run and round; mood picks the expression, with the person's base picture
 * and then the vector portrait as fallbacks.
 * @returns {{ key: string, html: string }}
 */
function npcPortraitHtml(kind, round, mood = null) {
  const chain = npcPortraitChain(kind, engine?.state?.seed, round, mood);
  return { key: chain.join('|'), html: artChainHtml(chain, 'npc-portrait-img', svgIcon(kind === 'shop' ? 'shop' : 'merchant')) };
}

/**
 * Fills the art slots written in index.html ([data-art]).
 * data-art-fallback lists more files to try, separated by spaces.
 */
function hydrateStaticArt(root = document) {
  root.querySelectorAll('[data-art]').forEach((el) => {
    if (el.dataset.hydrated) return;
    el.dataset.hydrated = '1';
    const chain = [el.dataset.art, ...(el.dataset.artFallback || '').split(/\s+/).filter(Boolean)];
    el.innerHTML = artChainHtml(chain, el.dataset.artClass || 'static-art-img', el.innerHTML);
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

/** 진행 상황을 저장한다. 런이 끝났으면 저장본을 지운다. */
let saveTimer = null;
function saveRunNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const phase = engine?.state?.phase;
  if (!phase || phase === 'IDLE') return;
  if (phase === 'RUN_VICTORY' || phase === 'RUN_FAILED') {
    runSaves.clear();
  } else {
    runSaves.save(engine.exportSave());
  }
  refreshContinueButton();
}

function scheduleRunSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveRunNow();
  }, 250);
}

window.addEventListener('beforeunload', () => saveRunNow());
window.addEventListener('pagehide', () => saveRunNow());

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
    if (!IS_DEBUG_TOOLS_ENABLED) return;
    if (!this.active && !this.isPaused) return;
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  pause() {
    if (!IS_DEBUG_TOOLS_ENABLED) return;
    if (!this.isPlayerTurn || this.isPaused) return;
    this.isPaused = true;
    this.stopInterval();
    const popup = document.getElementById('timer-pause-popup');
    if (popup) openModalWithCrt(popup, { mode: 'hidden' });
    document.getElementById('turn-timer-container')?.classList.add('is-paused');
  }

  resume() {
    this.isPaused = false;
    const popup = document.getElementById('timer-pause-popup');
    if (popup) closeModalWithCrt(popup, { mode: 'hidden' });
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
    const popup = document.getElementById('timer-pause-popup');
    if (popup) closeModalWithCrt(popup, { mode: 'hidden' });
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
    const popup = document.getElementById('timer-pause-popup');
    if (popup) closeModalWithCrt(popup, { mode: 'hidden' });
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
    const popup = document.getElementById('timer-pause-popup');
    if (popup) closeModalWithCrt(popup, { mode: 'hidden' });
    document.getElementById('turn-timer-container')?.classList.remove('is-paused');
  }

  onTimeExpired() {
    const snap = engine.getSnapshot();
    if (snap.activeDuel && snap.activeDuel.activeSeat === 0) {
      audio.playTurnBell();
      selectedAttackerInstanceId = null;
      clearTargetHighlights();
      engine.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
      const postDuel = engine.getSnapshot().activeDuel;
      presentPendingSetTriggers(postDuel, () => syncRunPhaseView());
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
let switchViewSeqId = 0;
const preloadedResourceUrls = new Set();

function preloadResourceUrl(src, timeoutMs = 3500) {
  if (!src || typeof src !== 'string') return Promise.resolve();
  if (preloadedResourceUrls.has(src)) return Promise.resolve();
  if (typeof Image === 'undefined') {
    preloadedResourceUrls.add(src);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      preloadedResourceUrls.add(src);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    img.onload = async () => {
      try {
        if (typeof img.decode === 'function') await img.decode();
      } catch {
        // decode 오류는 무시하고 완료 처리
      }
      finish();
    };
    img.onerror = finish;
    img.src = src;
  });
}

function getCurrentSceneContext() {
  const phase = engine?.state?.phase;
  return {
    boss: phase === 'STAGE_5_FINAL_BOSS' ? engine.state.assignedFinalBoss : '',
    victory: phase === 'RUN_VICTORY',
    alleyMerchant: document.body.dataset.alleyMerchant === '1',
  };
}

function collectCardIdsArtUrls(cardIds = []) {
  const urls = [];
  const seenIds = new Set();
  for (const cid of cardIds) {
    if (!cid || seenIds.has(cid)) continue;
    seenIds.add(cid);
    const def = lookupCardDef(cid);
    if (!def) continue;
    const artSrc = getCardArtSrc(def, { compact: false });
    if (artSrc && !artSrc.endsWith('.svg') && !artSrc.startsWith('blob:') && !artSrc.startsWith('data:')) {
      urls.push(artSrc);
    }
  }
  return urls;
}

function collectViewAssetUrls(viewKey) {
  const urls = new Set();
  const ctx = getCurrentSceneContext();
  const scene = sceneFor(viewKey, ctx);
  if (scene?.src) urls.add(scene.src);

  const snap = typeof engine !== 'undefined' ? engine.getSnapshot?.() : null;
  if (viewKey === 'VIEW_TITLE_LOBBY') {
    urls.add('assets/ui/game_logo.webp');
    urls.add('assets/ui/app_icon.png');
  } else if (viewKey === 'VIEW_FORTUNE_TELLER') {
    urls.add('assets/ui/npc_fortune_base.webp');
  } else if (viewKey === 'VIEW_CHECKPOINT_SHOP') {
    urls.add('assets/ui/npc_shopkeeper.webp');
    const offerIds = (snap?.shopOffers || []).map((o) => o?.cardId).filter(Boolean);
    collectCardIdsArtUrls(offerIds).forEach((u) => urls.add(u));
  } else if (viewKey === 'VIEW_CHECKPOINT_MERCHANT') {
    urls.add('assets/ui/npc_merchant.webp');
    const merchIds = (snap?.merchantOffers || []).flatMap((o) => [o?.wantCardId, o?.giveCardId]).filter(Boolean);
    collectCardIdsArtUrls(merchIds).forEach((u) => urls.add(u));
  } else if (viewKey === 'VIEW_CHECKPOINT_DECK_EDITOR') {
    const editorIds = [
      snap?.playerDeckMasterCardId,
      ...(snap?.playerDeckCardIds || []),
      ...(snap?.trunkCardIds || []),
    ].filter(Boolean);
    collectCardIdsArtUrls(editorIds).forEach((u) => urls.add(u));
  } else if (viewKey === 'VIEW_DUEL_ARENA') {
    const mat = MAT_PRESETS[cosmeticsConfig?.matPreset];
    if (mat?.image) urls.add(mat.image);
    const duel = snap?.activeDuel;
    const duelCardIds = [];
    (duel?.seats || []).forEach((s) => {
      [...(s?.deck || []), ...(s?.hand || []), ...(s?.board || []), ...(s?.graveyard || [])].forEach((c) => {
        if (c?.cardId) duelCardIds.push(c.cardId);
      });
    });
    collectCardIdsArtUrls(duelCardIds).forEach((u) => urls.add(u));
  } else if (viewKey === 'VIEW_PACK_OPENING') {
    const packIds = (snap?.lastPackCards || []).filter(Boolean);
    collectCardIdsArtUrls(packIds).forEach((u) => urls.add(u));
  } else if (viewKey === 'VIEW_MERCHANT_EVENT') {
    urls.add('assets/ui/npc_merchant.webp');
  }

  return Array.from(urls);
}

async function bakePlayerAndPresetSleeves(bakeAllPresets = false) {
  if (bakeAllPresets) {
    const presetKeys = Object.keys(SLEEVE_PRESETS).filter((k) => k !== 'CUSTOM');
    await Promise.all(presetKeys.map((presetId) => {
      const info = getSleeveBakeSource({ ...cosmeticsConfig, sleevePreset: presetId });
      if (hasBakedDynamicAsset(info.bakeKey)) return Promise.resolve();
      return bakeDynamicSvgAsset(info.bakeKey, info.svgDataUri, {
        width: 640,
        height: 896,
        thumbWidth: 240,
        thumbHeight: 336,
      });
    }));
  }
  const active = getSleeveBakeSource(cosmeticsConfig);
  if (!hasBakedDynamicAsset(active.bakeKey)) {
    await bakeDynamicSvgAsset(active.bakeKey, active.svgDataUri, {
      width: 640,
      height: 896,
      thumbWidth: 240,
      thumbHeight: 336,
      revokePrefix: active.isCustom ? 'sleeve:CUSTOM:' : null,
    });
  }
}

function needsViewResourceLoad(viewKey) {
  if (!getVectorBakeStats().ready || !getVictoryDefeatBakeStats().ready) return true;
  const activeSleeveKey = getSleeveBakeKey(cosmeticsConfig);
  if ((viewKey === 'VIEW_DUEL_ARENA' || viewKey === 'VIEW_TITLE_LOBBY') && !hasBakedDynamicAsset(activeSleeveKey)) {
    return true;
  }
  const urls = collectViewAssetUrls(viewKey);
  return urls.some((u) => !preloadedResourceUrls.has(u));
}

async function ensureViewResourcesReady(viewKey) {
  const isInitialVectorBake = !getVectorBakeStats().ready;
  await bakeAllVectorAssets({ onProgress: () => {} });
  await bakePlayerAndPresetSleeves(isInitialVectorBake);
  const scene = sceneFor(viewKey, getCurrentSceneContext());
  const urls = collectViewAssetUrls(viewKey).filter((u) => !preloadedResourceUrls.has(u));
  await Promise.all([
    scene?.src ? probeImage(scene.src) : Promise.resolve(),
    ...urls.map((u) => preloadResourceUrl(u)),
  ]);
}

function upgradeBakedViewAssets(root = document) {
  upgradeDomSvgImages(root);
  upgradeVictoryDefeatDomAssets(root);
  if (typeof document === 'undefined' || !root?.querySelectorAll) return;
  root.querySelectorAll('.card-back-wrapper[data-player-sleeve="1"] .card-back-svg-img').forEach((img) => {
    const wrapper = img.closest('.card-back-wrapper');
    const compact = img.dataset.compact === '1'
      || Boolean(wrapper?.closest('.battlefield-view, .trunk-card-tile, .unit-field-card, .pile-slot, .sleeve-thumb'));
    const spec = resolvePlayerSleeveSpec(cosmeticsConfig, {
      compact,
      bakedUrlResolver: (key, isCompact) => resolveBakedDynamicAsset(key, { compact: isCompact }),
    });
    if (wrapper?.dataset.sleeve && wrapper.dataset.sleeve === spec.preset && spec.isBaked && img.src !== spec.src) {
      img.src = spec.src;
      wrapper.dataset.bakedSleeve = '1';
    }
  });
}

/** Background of the current view (see src/ui/sceneArt.js). */
function refreshSceneBackdrop(viewKey = currentViewKey) {
  if (!viewKey) return;
  applySceneBackdrop(viewKey, getCurrentSceneContext());
}

const VIEW_DEPTH = {
  VIEW_TITLE_LOBBY: 0,
  VIEW_FORTUNE_TELLER: 1,
  VIEW_CHECKPOINT: 2,
  VIEW_CHECKPOINT_SHOP: 3,
  VIEW_CHECKPOINT_MERCHANT: 3,
  VIEW_CHECKPOINT_DECK_EDITOR: 3,
  VIEW_DUEL_ARENA: 3,
  VIEW_PACK_OPENING: 4,
  VIEW_MERCHANT_EVENT: 4,
  VIEW_RUN_SUMMARY: 4,
};

function openModalWithCrt(modalEl, { mode = 'hidden' } = {}) {
  if (!modalEl) return;
  if (modalEl.__crtCloseTimer) {
    clearTimeout(modalEl.__crtCloseTimer);
    modalEl.__crtCloseTimer = null;
  }
  modalEl.classList.remove('modal-crt-closing');
  if (mode === 'active') {
    modalEl.classList.add('active');
  } else if (mode === 'collapsed') {
    modalEl.classList.remove('is-collapsed');
  } else {
    modalEl.classList.remove('is-hidden');
  }
  fitCardNameTextBoxes(modalEl);
}

function closeModalWithCrt(modalEl, { mode = 'hidden', onClosed = null } = {}) {
  if (!modalEl) return;
  const isAlreadyHidden = mode === 'active'
    ? !modalEl.classList.contains('active')
    : mode === 'collapsed'
      ? modalEl.classList.contains('is-collapsed')
      : modalEl.classList.contains('is-hidden');
  if (isAlreadyHidden) {
    modalEl.classList.remove('modal-crt-closing');
    if (onClosed) onClosed();
    return;
  }
  if (modalEl.__crtCloseTimer) clearTimeout(modalEl.__crtCloseTimer);
  modalEl.classList.add('modal-crt-closing');
  modalEl.__crtCloseTimer = setTimeout(() => {
    modalEl.__crtCloseTimer = null;
    if (mode === 'active') {
      modalEl.classList.remove('active');
    } else if (mode === 'collapsed') {
      modalEl.classList.add('is-collapsed');
    } else {
      modalEl.classList.add('is-hidden');
    }
    requestAnimationFrame(() => {
      modalEl.classList.remove('modal-crt-closing');
      if (onClosed) onClosed();
    });
  }, 190);
}

function switchView(viewKey, opts = {}) {
  const seq = ++switchViewSeqId;
  if (viewKey !== 'VIEW_DUEL_ARENA') {
    duelTurnTimer.stop();
  }
  const phase = engine?.state?.phase;
  let bgm = VIEW_BGM[viewKey];
  if (viewKey === 'VIEW_DUEL_ARENA') bgm = phase === 'STAGE_5_FINAL_BOSS' ? 'BGM_BOSS' : 'BGM_DUEL';
  if (viewKey === 'VIEW_RUN_SUMMARY') bgm = phase === 'RUN_VICTORY' ? 'BGM_VICTORY' : 'BGM_DEFEAT';
  if (bgm) audio.playBgm(bgm);

  const prevKey = currentViewKey;
  const prevEl = prevKey ? views[prevKey] : null;
  const isActualChange = Boolean(prevKey && prevKey !== viewKey);
  currentViewKey = viewKey;
  const transMs = Math.max(120, Number(tunerSettings?.transitionMs ?? 260));
  const collapseMs = Math.min(220, Math.max(150, Math.round(transMs * 0.8)));
  document.documentElement.style.setProperty('--view-transition-ms', `${transMs}ms`);

  const loadingScreen = document.getElementById('loading-blank-screen');
  if (viewTransitionTimerId) {
    clearTimeout(viewTransitionTimerId);
    viewTransitionTimerId = null;
  }

  const revealTargetView = (playEnterCrt = true) => {
    if (seq !== switchViewSeqId) return;
    loadingScreen?.classList.remove('is-active');

    // 배경은 진입 효과(CRT 켜짐)가 시작되는 이 시점에 맞춰 동시에 교체한다.
    const livePhase = engine?.state?.phase;
    document.body.dataset.view = viewKey;
    document.body.dataset.boss = livePhase === 'STAGE_5_FINAL_BOSS' ? engine.state.assignedFinalBoss || '' : '';
    refreshSceneBackdrop(viewKey);

    if (typeof opts.onBeforeReveal === 'function') {
      opts.onBeforeReveal();
    }

    Object.values(views).forEach((v) => v?.classList.remove('active', 'screen-entering', 'screen-crt-closing'));
    const targetView = views[viewKey];
    if (targetView) {
      targetView.classList.add('active');
      if (targetView.__enterCleanupTimer) {
        clearTimeout(targetView.__enterCleanupTimer);
        targetView.__enterCleanupTimer = null;
      }
      upgradeBakedViewAssets(targetView);
      if (playEnterCrt && transMs > 0) {
        void targetView.offsetWidth;
        targetView.classList.add('screen-entering');
        const finishEnter = () => {
          if (targetView.__enterCleanupTimer) {
            clearTimeout(targetView.__enterCleanupTimer);
            targetView.__enterCleanupTimer = null;
          }
          targetView.classList.remove('screen-entering');
          fitCardNameTextBoxes(targetView);
        };
        targetView.addEventListener('animationend', finishEnter, { once: true });
        targetView.__enterCleanupTimer = setTimeout(finishEnter, transMs + 60);
      } else {
        fitCardNameTextBoxes(targetView);
      }
    }

    if ((isActualChange || !prevEl) && viewKey === 'VIEW_DUEL_ARENA' && fxCanvas) {
      const r = fxCanvas.getBoundingClientRect();
      fxEngine.spawnSummonBurst(r.width * 0.5, r.height * 0.5, phase === 'STAGE_5_FINAL_BOSS' ? '#f43f5e' : '#38bdf8', 170);
    }

    if (typeof opts.onRevealed === 'function') {
      opts.onRevealed();
    }
  };

  const requiresLoad = Boolean(opts.forceLoading || needsViewResourceLoad(viewKey));

  // 동일 뷰 재진입(리로드 불필요) 시 애니메이션 없이 즉시 반영
  if (!isActualChange && prevEl && !requiresLoad) {
    loadingScreen?.classList.remove('is-active');
    revealTargetView(false);
    return;
  }

  // 리소스 로드가 필요한 전환: 현재 화면 CRT 축소 -> 아무 UI도 없는 빈 로딩 상태 -> 로드 완료 후 CRT 확장 오픈
  if (requiresLoad) {
    const beginBlankLoad = async () => {
      if (seq !== switchViewSeqId) return;
      Object.values(views).forEach((v) => v?.classList.remove('active', 'screen-entering', 'screen-crt-closing'));
      loadingScreen?.classList.add('is-active');
      try {
        await ensureViewResourcesReady(viewKey);
      } finally {
        if (seq === switchViewSeqId) {
          revealTargetView(true);
        }
      }
    };

    if (prevEl && isActualChange) {
      Object.values(views).forEach((v) => v?.classList.remove('active', 'screen-entering', 'screen-crt-closing'));
      prevEl.classList.add('screen-crt-closing');
      viewTransitionTimerId = setTimeout(() => {
        prevEl.classList.remove('screen-crt-closing');
        viewTransitionTimerId = null;
        beginBlankLoad();
      }, collapseMs);
    } else {
      beginBlankLoad();
    }
    return;
  }

  // 리소스 로드가 이미 완료된 일반 화면 전환: CRT 축소 -> 즉시 CRT 확장 전환
  loadingScreen?.classList.remove('is-active');
  if (isActualChange && prevEl && transMs > 0) {
    Object.values(views).forEach((v) => v?.classList.remove('active', 'screen-entering', 'screen-crt-closing'));
    prevEl.classList.add('screen-crt-closing');
    viewTransitionTimerId = setTimeout(() => {
      prevEl.classList.remove('screen-crt-closing');
      viewTransitionTimerId = null;
      revealTargetView(true);
    }, collapseMs);
  } else {
    revealTargetView(Boolean(!prevEl));
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

function showCardPlayShowcase(
  cardOrDef,
  {
    actorLabel = '카드 발동',
    isCpu = false,
    atk = null,
    def = null,
    effectText = '',
    isSetTrigger = false,
    isFizzled = false,
    durationMs = null,
  } = {}
) {
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
  const effectPillHtml = effectText
    ? `<div class="showcase-effect-pill ${isFizzled ? 'is-fizzled' : ''}">${effectText}</div>`
    : '';

  host.innerHTML = `
    <div class="showcase-banner-pill ${isCpu ? 'is-cpu' : ''}">
      ${svgIcon(iconName)} <span>${actorLabel}</span>
    </div>
    <div class="showcase-card-shell">
      ${generateCompositeCardHtml(cardDef, resolvedAtk, resolvedDef, 1.0, false)}
    </div>
    ${effectPillHtml}
  `;

  host.classList.toggle('is-set-trigger', Boolean(isSetTrigger));
  host.classList.remove('is-exiting', 'is-visible');
  void host.offsetWidth;
  host.classList.add('is-visible');

  const duration = Math.max(400, Number(durationMs ?? tunerSettings?.showcaseDurationMs ?? 1500));
  cardShowcaseFadeTimer = setTimeout(() => {
    host.classList.add('is-exiting');
    host.classList.remove('is-visible');
    cardShowcaseClearTimer = setTimeout(() => {
      host.classList.remove('is-exiting', 'is-set-trigger');
      host.innerHTML = '';
    }, 260);
  }, duration);
}

const SET_TRIGGER_PAUSE_MS = 1650;
let lastPresentedSetTriggerDuelId = null;
let lastPresentedSetTriggerSeq = 0;
let isSetTriggerPaused = false;
let setTriggerPauseTimers = [];

function clearSetTriggerPauseTimers() {
  for (const tid of setTriggerPauseTimers) {
    clearTimeout(tid);
  }
  setTriggerPauseTimers = [];
  isSetTriggerPaused = false;
}

function slotDisplayLabel(slotType) {
  if (slotType === 'FIELD_LEFT') return '중앙 좌측 세트';
  if (slotType === 'FIELD_RIGHT') return '중앙 우측 세트';
  if (slotType === 'MONSTER_FRONT') return '몬스터 앞 세트';
  return '세트 카드';
}

function presentSingleSetTrigger(trig, durationMs) {
  const trigDef = lookupCardDef(trig.cardId);
  if (!trigDef) return;
  const isCpu = trig.ownerSeat === 1;
  const ownerPrefix = isCpu ? '상대' : '내';
  const slotTxt = slotDisplayLabel(trig.slotType);
  const actorLabel = trig.fizzled
    ? `${ownerPrefix} ${slotTxt} 불발`
    : `${ownerPrefix} ${slotTxt} 발동!`;
  const effectBody = trigDef.effect || trigDef.description || '';
  const effectText = trig.fizzled
    ? `💨 불발: ${trig.fizzleReason || '발동 조건 미충족'}`
    : `⚡ 발동 효과: ${effectBody || `${trigDef.name} 효과 적용`}`;

  const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0, width: 1280, height: 800 };
  const slotEl = trig.slotType === 'FIELD_LEFT'
    ? document.getElementById('field-set-left')
    : trig.slotType === 'FIELD_RIGHT'
      ? document.getElementById('field-set-right')
      : document.getElementById('arena-field');
  if (slotEl) {
    const sr = slotEl.getBoundingClientRect();
    const bx = sr.left - cRect.left + sr.width * 0.5;
    const by = sr.top - cRect.top + sr.height * 0.5;
    fxEngine.spawnSummonBurst(bx, by, trig.fizzled ? '#94a3b8' : '#c084fc', 110);
  }
  audio.playCardPickup();

  const logEl = document.getElementById('duel-narrative-log');
  if (logEl) {
    logEl.textContent = trig.fizzled
      ? `💨 [${ownerPrefix} 세트 불발] 「${trigDef.name}」 — ${trig.fizzleReason || '조건 불일치'}`
      : `⚡ [${ownerPrefix} 세트 발동!] 「${trigDef.name}」 — ${effectBody}`;
  }

  showCardPlayShowcase(trigDef, {
    actorLabel,
    isCpu,
    effectText,
    isSetTrigger: true,
    isFizzled: Boolean(trig.fizzled),
    durationMs: Math.max(900, durationMs - 100),
  });
}

/**
 * 새로 격발된 세트 마법/함정이 있으면 카드·효과 문구를 보여주고 충분한 확인 텀을 둔 뒤 onDone을 호출한다.
 * @returns {boolean} 대기 텀이 발생했으면 true
 */
function presentPendingSetTriggers(duel, onDone = null, { initialDelayMs = 0 } = {}) {
  if (!duel) {
    onDone?.();
    return false;
  }
  if (lastPresentedSetTriggerDuelId !== duel.duelId) {
    lastPresentedSetTriggerDuelId = duel.duelId;
    lastPresentedSetTriggerSeq = 0;
  }
  const history = Array.isArray(duel.setTriggerHistory) ? duel.setTriggerHistory : [];
  const pending = history.filter((item) => Number(item?.seq) > lastPresentedSetTriggerSeq);
  if (pending.length === 0) {
    onDone?.();
    return false;
  }

  lastPresentedSetTriggerSeq = Number(pending[pending.length - 1].seq) || lastPresentedSetTriggerSeq;
  const epoch = runSessionEpoch;
  isSetTriggerPaused = true;
  const totalPauseMs = initialDelayMs + pending.length * SET_TRIGGER_PAUSE_MS;
  duelTransitionUntil = Math.max(duelTransitionUntil || 0, Date.now() + totalPauseMs);

  pending.forEach((trig, idx) => {
    const tId = setTimeout(() => {
      if (epoch !== runSessionEpoch) return;
      presentSingleSetTrigger(trig, SET_TRIGGER_PAUSE_MS);
    }, initialDelayMs + idx * SET_TRIGGER_PAUSE_MS);
    setTriggerPauseTimers.push(tId);
  });

  const doneId = setTimeout(() => {
    if (epoch !== runSessionEpoch) return;
    isSetTriggerPaused = false;
    onDone?.();
  }, totalPauseMs);
  setTriggerPauseTimers.push(doneId);
  return true;
}

// ============================================================================
// 타이틀바 & 윈도우 컨트롤 (Tauri v2 호환)
// ============================================================================
// 메인 메뉴(타이틀 화면) 바로가기
document.getElementById('btn-return-main-menu')?.addEventListener('click', () => {
  const goLobby = () => {
    audio.playCardPickup();
    saveRunNow();
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
  closeModalWithCrt(overlayBinderBook, { mode: 'active' });
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
  saveRunNow();
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
  const willOpen = combatLogDrawer?.classList.contains('is-collapsed') && !combatLogDrawer?.classList.contains('modal-crt-closing');
  if (willOpen) {
    openModalWithCrt(combatLogDrawer, { mode: 'collapsed' });
    updateLogToggleUI();
    const logContainer = document.getElementById('combat-log-history');
    if (logContainer) {
      requestAnimationFrame(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
      });
    }
  } else {
    closeModalWithCrt(combatLogDrawer, {
      mode: 'collapsed',
      onClosed: () => updateLogToggleUI(),
    });
    if (typeof hideLogCardHoverPreview === 'function') {
      hideLogCardHoverPreview();
    }
  }
});

btnCloseCombatLogPopup?.addEventListener('click', (e) => {
  e.stopPropagation();
  audio.playCardPickup();
  closeModalWithCrt(combatLogDrawer, {
    mode: 'collapsed',
    onClosed: () => updateLogToggleUI(),
  });
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

const UI_FONT_STORAGE_KEY = 'duel_rogue_ui_font_v1';

function applyUiFontMode(mode) {
  const normalized = mode === 'win2k-retro' ? 'win2k-retro' : 'modern';
  document.body.dataset.uiFont = normalized;
  const sel = document.getElementById('opt-ui-font');
  if (sel && sel.value !== normalized) {
    sel.value = normalized;
  }
  try {
    localStorage.setItem(UI_FONT_STORAGE_KEY, normalized);
  } catch { /* ignore */ }
}

function loadSavedUiFontMode() {
  try {
    return localStorage.getItem(UI_FONT_STORAGE_KEY) || 'modern';
  } catch {
    return 'modern';
  }
}

applyUiFontMode(loadSavedUiFontMode());

document.getElementById('opt-ui-font')?.addEventListener('change', (e) => {
  audio.playCardPickup();
  applyUiFontMode(e.target.value);
});

function toggleInGameOptions(show) {
  if (!inGameOptionsModal) return;
  const isCurrentlyHidden = inGameOptionsModal.classList.contains('is-hidden');
  const shouldOpen = show !== undefined ? show : isCurrentlyHidden;

  if (shouldOpen) {
    refreshOptionsModalContext();
    applyUiFontMode(loadSavedUiFontMode());
    audio.playCardPickup();
    openModalWithCrt(inGameOptionsModal, { mode: 'hidden' });
    btnInGameOptions?.classList.add('active');
    btnTitleOptions?.classList.add('active');
  } else {
    audio.playCardPickup();
    btnInGameOptions?.classList.remove('active');
    btnTitleOptions?.classList.remove('active');
    closeModalWithCrt(inGameOptionsModal, { mode: 'hidden' });
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
    openModalWithCrt(seedConfigModal, { mode: 'hidden' });
    btnTitleSeedConfig?.classList.add('active');
    setTimeout(() => seedConfigInput?.focus(), 40);
  } else {
    audio.playCardPickup();
    btnTitleSeedConfig?.classList.remove('active');
    closeModalWithCrt(seedConfigModal, { mode: 'hidden' });
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
    openModalWithCrt(rulebookModal, { mode: 'hidden' });
    btnTitleRulebook?.classList.add('active');
    hydrateVectorIcons(rulebookModal);
  } else {
    btnTitleRulebook?.classList.remove('active');
    closeModalWithCrt(rulebookModal, { mode: 'hidden' });
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
// [묘지(Graveyard) 상세 뷰어: YGOPRO 스타일 가로 나열 · 드래그 이동 · 비차단 배경]
// ============================================================================
const graveyardViewerModal = document.getElementById('graveyard-viewer-modal');
const graveyardModalCard = graveyardViewerModal?.querySelector('.graveyard-modal-card') || null;
const graveyardModalHeader = graveyardViewerModal?.querySelector('.graveyard-modal-header') || null;
const btnCloseGraveyard = document.getElementById('btn-close-graveyard');
const gyModalBackdrop = document.getElementById('gy-modal-backdrop');
let activeGraveyardSeat = null;

function renderGraveyardViewerCards(seatIndex) {
  const snap = engine.getSnapshot();
  if (!snap.activeDuel) return;
  const seat = snap.activeDuel.seats[seatIndex];
  if (!seat) return;

  const titleEl = document.getElementById('gy-modal-title');
  const container = document.getElementById('gy-modal-cards-container');
  if (!titleEl || !container) return;

  const isPlayer = seatIndex === 0;
  const gy = seat.graveyard || [];
  titleEl.innerHTML = `${svgIcon('skull')} ${isPlayer ? '플레이어' : '상대'} 묘지 <span class="gy-count-tag">(총 ${gy.length}장 · 최신순)</span>`;

  container.innerHTML = '';
  if (gy.length === 0) {
    container.innerHTML = `
      <div class="empty-gy-notice">
        <span class="empty-gy-icon">${svgIcon('tombstone')}</span>
        <p>묘지에 파괴되거나 소모된 카드가 없습니다.</p>
      </div>
    `;
    return;
  }

  // 가장 최근 파괴/사용된 카드부터 왼쪽에서 오른쪽으로 가로 나열 (YGOPRO 스타일)
  const reversedGy = [...gy].reverse();
  reversedGy.forEach((cardInst, idx) => {
    const def = lookupCardDef(cardInst.cardId) || cardInst;
    const orderNum = gy.length - idx;
    const tile = document.createElement('div');
    tile.className = `gy-card-tile ${idx === 0 ? 'is-latest' : ''}`;
    tile.title = `${def.name} (#${orderNum} · 호버/클릭: 좌측 상세 정보 확인)`;
    tile.innerHTML = `
      <div class="gy-card-tile-badge">#${orderNum}${idx === 0 ? ' <span class="latest-tag">최신</span>' : ''}</div>
      <div class="gy-card-tile-frame">
        ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.42, true)}
      </div>
    `;
    tile.addEventListener('mouseenter', () => updateCardInspector(def));
    tile.addEventListener('click', () => {
      audio.playCardPickup();
      updateCardInspector(def);
    });
    container.appendChild(tile);
  });
  fitCardNameTextBoxes(container);
  container.scrollLeft = 0;
}

function snapToDevicePixel(px) {
  const dpr = (typeof window !== 'undefined' && Number(window.devicePixelRatio) > 0) ? window.devicePixelRatio : 1;
  return Math.round(px * dpr) / dpr;
}

function positionGraveyardModalAtIntegerCenter() {
  if (!graveyardModalCard || typeof window === 'undefined') return;
  const w = graveyardModalCard.offsetWidth || 760;
  const h = graveyardModalCard.offsetHeight || 220;
  const centeredLeft = snapToDevicePixel(Math.max(8, (window.innerWidth - w) / 2));
  const centeredTop = snapToDevicePixel(Math.max(38, (window.innerHeight - h) / 2));
  graveyardModalCard.style.position = 'fixed';
  graveyardModalCard.style.margin = '0';
  graveyardModalCard.style.left = `${centeredLeft}px`;
  graveyardModalCard.style.top = `${centeredTop}px`;
}

function openGraveyardViewer(seatIndex) {
  const snap = engine.getSnapshot();
  if (!snap.activeDuel) return;
  const modal = document.getElementById('graveyard-viewer-modal');
  if (!modal) return;

  const isAlreadyOpen = !modal.classList.contains('is-hidden');
  if (isAlreadyOpen && activeGraveyardSeat === seatIndex) {
    closeGraveyardViewer();
    return;
  }

  audio.playCardPickup();
  hideLogCardHoverPreview();
  activeGraveyardSeat = seatIndex;
  renderGraveyardViewerCards(seatIndex);
  openModalWithCrt(modal, { mode: 'hidden' });

  if (!isAlreadyOpen && graveyardModalCard) {
    positionGraveyardModalAtIntegerCenter();
    fitCardNameTextBoxes(graveyardModalCard);
  }
}

function closeGraveyardViewer() {
  activeGraveyardSeat = null;
  if (graveyardViewerModal) {
    closeModalWithCrt(graveyardViewerModal, { mode: 'hidden' });
  }
}

(function initGraveyardModalDragAndScroll() {
  const cardsContainer = document.getElementById('gy-modal-cards-container');
  cardsContainer?.addEventListener('wheel', (e) => {
    if (cardsContainer.scrollWidth > cardsContainer.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      cardsContainer.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  if (!graveyardModalHeader || !graveyardModalCard) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  graveyardModalHeader.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('#btn-close-graveyard')) return;
    e.preventDefault();
    const rect = graveyardModalCard.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    graveyardModalCard.style.position = 'fixed';
    graveyardModalCard.style.margin = '0';
    graveyardModalCard.style.left = `${origLeft}px`;
    graveyardModalCard.style.top = `${origTop}px`;
    dragging = true;
    graveyardModalHeader.classList.add('is-dragging');
    try { graveyardModalHeader.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  graveyardModalHeader.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxLeft = Math.max(8, window.innerWidth - graveyardModalCard.offsetWidth - 8);
    const maxTop = Math.max(38, window.innerHeight - graveyardModalCard.offsetHeight - 8);
    const nextLeft = snapToDevicePixel(Math.max(8, Math.min(maxLeft, origLeft + dx)));
    const nextTop = snapToDevicePixel(Math.max(38, Math.min(maxTop, origTop + dy)));
    graveyardModalCard.style.left = `${nextLeft}px`;
    graveyardModalCard.style.top = `${nextTop}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    graveyardModalHeader.classList.remove('is-dragging');
    try { graveyardModalHeader.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  graveyardModalHeader.addEventListener('pointerup', endDrag);
  graveyardModalHeader.addEventListener('pointercancel', endDrag);
})();

const playerGyZoneEl = document.getElementById('player-graveyard');
const cpuGyZoneEl = document.getElementById('cpu-graveyard');
playerGyZoneEl?.addEventListener('click', () => openGraveyardViewer(0));
cpuGyZoneEl?.addEventListener('click', () => openGraveyardViewer(1));
playerGyZoneEl?.addEventListener('mouseenter', () => {
  const gy = engine.getSnapshot()?.activeDuel?.seats?.[0]?.graveyard;
  if (gy?.length) {
    const top = gy[gy.length - 1];
    updateCardInspector(lookupCardDef(top.cardId) || top);
  }
});
cpuGyZoneEl?.addEventListener('mouseenter', () => {
  const gy = engine.getSnapshot()?.activeDuel?.seats?.[1]?.graveyard;
  if (gy?.length) {
    const top = gy[gy.length - 1];
    updateCardInspector(lookupCardDef(top.cardId) || top);
  }
});
btnCloseGraveyard?.addEventListener('click', closeGraveyardViewer);
gyModalBackdrop?.addEventListener('click', closeGraveyardViewer);

// 4. 턴 타이머 일시정지 팝업 모달 이벤트
document.getElementById('btn-resume-timer-popup')?.addEventListener('click', () => {
  duelTurnTimer.resume();
});
document.getElementById('timer-pause-backdrop')?.addEventListener('click', () => {
  duelTurnTimer.resume();
});
document.getElementById('turn-timer-container')?.addEventListener('click', (e) => {
  if (!IS_DEBUG_TOOLS_ENABLED) return;
  // 턴 종료 버튼 자체가 아닌 타이머 링 영역 클릭 시 일시정지/재개 토글
  const endBtn = document.getElementById('btn-end-turn');
  if (endBtn && (e.target === endBtn || endBtn.contains(e.target))) return;
  duelTurnTimer.togglePause();
});

// ESC 키로 열려있는 모달들 닫기 & (디버그 전용) Space 키로 타이머 일시정지 토글
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const deckOverviewModal = document.getElementById('modal-deck-overview');
    if (deckOverviewModal && !deckOverviewModal.classList.contains('is-hidden')) {
      closeModalWithCrt(deckOverviewModal, { mode: 'hidden' });
    }
    const customSleeveModal = document.getElementById('modal-custom-sleeve');
    if (customSleeveModal && !customSleeveModal.classList.contains('is-hidden')) {
      closeModalWithCrt(customSleeveModal, { mode: 'hidden' });
    }
    if (rulebookModal && !rulebookModal.classList.contains('is-hidden')) {
      toggleRulebookModal(false);
    }
    if (seedConfigModal && !seedConfigModal.classList.contains('is-hidden')) {
      toggleSeedConfigModal(false);
    }
    if (inGameOptionsModal && !inGameOptionsModal.classList.contains('is-hidden')) {
      toggleInGameOptions(false);
    }
    if (graveyardViewerModal && !graveyardViewerModal.classList.contains('is-hidden')) {
      closeGraveyardViewer();
    }
    if (duelTurnTimer.isPaused) {
      duelTurnTimer.resume();
    }
  } else if (IS_DEBUG_TOOLS_ENABLED && e.code === 'Space' && !e.target.matches('input, textarea')) {
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

/**
 * 카드 파괴 시 즉시 산산조각 내지 않고 먼저 카드 전면에 균열(금)을 형성한 뒤 파편 폭발/영혼 궤적으로 이어집니다.
 */
function triggerUnitCrackThenShatter(unitEl, cardLocalRect, gyLocalRect, unitDef, gyElementId, shardsCount) {
  if (unitEl) {
    unitEl.classList.remove('slam-hit-target', 'slam-blocked-guard');
    unitEl.classList.add('card-cracking');
  }
  if (cardLocalRect) {
    fxEngine.spawnCardCrackEffect(cardLocalRect, '#7dd3fc', 0.25);
  }
  setTimeout(() => {
    if (unitEl) {
      unitEl.classList.remove('card-cracking');
      unitEl.classList.add('card-whiteout');
    }
    if (cardLocalRect) {
      fxEngine.spawnCardShatter(cardLocalRect, shardsCount);
      if (gyLocalRect) {
        fxEngine.spawnSoulWisp(cardLocalRect, gyLocalRect, () => {
          if (gyElementId && unitDef && document.getElementById(gyElementId)) {
            addGraveyardGhost(gyElementId, unitDef);
          }
        });
      }
    }
    audio.playCardShatter();
    audio.playSoulWisp?.();
  }, 220);
}

const duelCounterState = {
  duelId: null,
  lp: [null, null],
  lpDisplay: [null, null],
  lpAnimRaf: [null, null],
  units: new Map(), // instanceId -> { atk, def }
  unitAnimRaf: new Map(), // `${instanceId}:atk|def` -> rafId
};

function resetDuelCounterState(duelId = null) {
  duelCounterState.lpAnimRaf.forEach((raf) => { if (raf) cancelAnimationFrame(raf); });
  duelCounterState.unitAnimRaf.forEach((raf) => { if (raf) cancelAnimationFrame(raf); });
  duelCounterState.lpAnimRaf = [null, null];
  duelCounterState.unitAnimRaf.clear();
  duelCounterState.units.clear();
  duelCounterState.duelId = duelId;
  duelCounterState.lp = [null, null];
  duelCounterState.lpDisplay = [null, null];
}

/**
 * 유희왕 마스터 듀얼식 빠른 순차 숫자 롤링 연출.
 */
function animateRollingDigits(el, fromVal, toVal, {
  durationMs = 420,
  accentEl = null,
  upClass = 'stat-rolling-up',
  downClass = 'stat-rolling-down',
  onStep = null,
  onRaf = null,
  onDone = null,
} = {}) {
  if (!el) return null;
  const start = Math.round(fromVal);
  const end = Math.round(toVal);
  const targetCls = end > start ? upClass : downClass;
  if (accentEl) {
    accentEl.classList.remove(upClass, downClass);
    accentEl.classList.add(targetCls);
  }
  const t0 = performance.now();
  let lastShown = start;
  el.textContent = String(start);
  onStep?.(start);

  const tick = (now) => {
    const raw = Math.min(1, (now - t0) / durationMs);
    const eased = 1 - Math.pow(1 - raw, 2.2);
    const cur = raw >= 1 ? end : Math.round(start + (end - start) * eased);
    if (cur !== lastShown) {
      lastShown = cur;
      el.textContent = String(cur);
      onStep?.(cur);
    }
    if (raw < 1) {
      const id = requestAnimationFrame(tick);
      onRaf?.(id);
    } else {
      el.textContent = String(end);
      onStep?.(end);
      if (accentEl) {
        setTimeout(() => accentEl.classList.remove(upClass, downClass), 120);
      }
      onRaf?.(null);
      onDone?.();
    }
  };
  const firstId = requestAnimationFrame(tick);
  onRaf?.(firstId);
  return firstId;
}

function applyUnitStatRolling(unitEl, unit) {
  if (!unitEl || !unit?.instanceId) return;
  const curAtk = Number(unit.currentAttack ?? unit.attack ?? 0);
  const curDef = Number(unit.currentDefense ?? unit.currentHealth ?? unit.defense ?? unit.health ?? 0);
  const prev = duelCounterState.units.get(unit.instanceId);
  duelCounterState.units.set(unit.instanceId, { atk: curAtk, def: curDef });
  if (!prev) return;

  const rollBadge = (keySuffix, badgeSelector, fromVal, toVal) => {
    if (fromVal === toVal) return;
    const animKey = `${unit.instanceId}:${keySuffix}`;
    const oldRaf = duelCounterState.unitAnimRaf.get(animKey);
    if (oldRaf) cancelAnimationFrame(oldRaf);
    const badgeEl = unitEl.querySelector(badgeSelector);
    const numEl = badgeEl?.querySelector('.stat-badge-num');
    if (!numEl) return;

    animateRollingDigits(numEl, fromVal, toVal, {
      durationMs: 360,
      accentEl: badgeEl,
      upClass: 'stat-rolling-up',
      downClass: 'stat-rolling-down',
      onRaf: (id) => {
        if (id) duelCounterState.unitAnimRaf.set(animKey, id);
        else duelCounterState.unitAnimRaf.delete(animKey);
      },
    });
  };

  rollBadge('def', '.overlay-stat-badge.def-badge', prev.def, curDef);
  rollBadge('atk', '.overlay-stat-badge.atk-badge', prev.atk, curAtk);

  if (prev.def !== curDef || prev.atk !== curAtk) {
    requestAnimationFrame(() => {
      if (!unitEl.isConnected || !fxCanvas) return;
      const cRect = fxCanvas.getBoundingClientRect();
      if (prev.def !== curDef) {
        const dEl = unitEl.querySelector('.overlay-stat-badge.def-badge') || unitEl;
        const r = dEl.getBoundingClientRect();
        const diff = curDef - prev.def;
        fxEngine.showFloatingText(
          r.left - cRect.left + r.width / 2,
          r.top - cRect.top - 6,
          `수비 ${diff > 0 ? `+${diff}` : diff}`,
          diff > 0 ? '#4ade80' : '#f87171',
          20
        );
      }
      if (prev.atk !== curAtk) {
        const aEl = unitEl.querySelector('.overlay-stat-badge.atk-badge') || unitEl;
        const r = aEl.getBoundingClientRect();
        const diff = curAtk - prev.atk;
        fxEngine.showFloatingText(
          r.left - cRect.left + r.width / 2,
          r.top - cRect.top - 6,
          `공격 ${diff > 0 ? `+${diff}` : diff}`,
          diff > 0 ? '#38bdf8' : '#fb923c',
          20
        );
      }
    });
  }
}

function captureBoardRects(boardSelector) {
  const map = new Map();
  document.querySelectorAll(`${boardSelector} .unit-field-card[data-instance-id]`).forEach((el) => {
    map.set(el.getAttribute('data-instance-id'), el.getBoundingClientRect());
  });
  return map;
}

function getPlayerHandImpactElement() {
  return (
    document.getElementById('player-hand-row') ||
    document.querySelector('.player-interaction-tray') ||
    document.getElementById('player-seat')
  );
}

function animateCpuAttackerSlam(attackerEl, rawTargetRect, atkPower, onImpact, onReturnComplete) {
  if (!attackerEl || !rawTargetRect) {
    onImpact?.();
    onReturnComplete?.();
    return;
  }
  const atkRect = attackerEl.getBoundingClientRect();
  const ax = atkRect.left + atkRect.width / 2;
  const ay = atkRect.top + atkRect.height / 2;
  const tx = rawTargetRect.left + rawTargetRect.width / 2;
  const ty = rawTargetRect.top + rawTargetRect.height / 2;

  const dx = tx - ax;
  const dy = ty - ay;
  const rawDist = Math.hypot(dx, dy);
  const angleDeg = rawDist > 5 ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : 180;
  const windupDist = 24;
  const nx = rawDist > 5 ? dx / rawDist : 0;
  const ny = rawDist > 5 ? dy / rawDist : 1;
  const wx = -nx * windupDist;
  const wy = -ny * windupDist;

  const windupTime = Math.max(80, 160 / (tunerSettings.slamSpeed || 1));
  const slamTime = Math.max(60, 110 / (tunerSettings.slamSpeed || 1));

  attackerEl.closest('.board-zone')?.classList.add('has-dragging-attacker');
  attackerEl.closest('.duel-arena-field')?.classList.add('has-dragging-attacker');
  attackerEl.style.setProperty('--windup-tx', `${wx.toFixed(1)}px`);
  attackerEl.style.setProperty('--windup-ty', `${wy.toFixed(1)}px`);
  attackerEl.style.setProperty('--target-dx', `${dx.toFixed(1)}px`);
  attackerEl.style.setProperty('--target-dy', `${dy.toFixed(1)}px`);
  attackerEl.style.setProperty('--slam-rot-z', `${angleDeg.toFixed(1)}deg`);
  attackerEl.style.setProperty('--windup-duration', `${windupTime}ms`);
  attackerEl.style.setProperty('--slam-duration', `${slamTime}ms`);

  attackerEl.classList.add('slam-windup');
  if (atkPower <= 4) {
    audio.playLightTap();
  } else {
    audio.playHeavyImpact(atkPower);
  }

  setTimeout(() => {
    attackerEl.classList.remove('slam-windup');
    attackerEl.classList.add('slam-down');

    setTimeout(() => {
      onImpact?.();
      setTimeout(() => {
        attackerEl.classList.remove('slam-down');
        attackerEl.classList.add('slam-return');
        setTimeout(() => {
          attackerEl.classList.remove('slam-return');
          attackerEl.closest('.board-zone')?.classList.remove('has-dragging-attacker');
          attackerEl.closest('.duel-arena-field')?.classList.remove('has-dragging-attacker');
          ['--card-tx', '--card-ty', '--card-tz', '--target-dx', '--target-dy', '--windup-tx', '--windup-ty'].forEach((p) =>
            attackerEl.style.setProperty(p, '0px')
          );
          attackerEl.style.setProperty('--slam-rot-z', '0deg');
          attackerEl.style.setProperty('--slam-rot-x', '0deg');
          onReturnComplete?.();
        }, 280);
      }, 60);
    }, slamTime);
  }, windupTime);
}

function playCpuStepVisualEffects({ preCpuRects, prePlayerRects, preCpuIds, prePlayerIds, preLastSpell, act, liveDuel }) {
  const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0, width: 1280, height: 800 };
  const playerGyEl = document.getElementById('player-graveyard');
  const cpuGyEl = document.getElementById('cpu-graveyard');
  const pGyRect = playerGyEl ? toCanvasLocalRect(playerGyEl.getBoundingClientRect()) : { left: 100, top: 650, width: 70, height: 90 };
  const cGyRect = cpuGyEl ? toCanvasLocalRect(cpuGyEl.getBoundingClientRect()) : { left: 1100, top: 100, width: 70, height: 90 };

  // 1. 사라진 플레이어 유닛 파괴 파편 & 영혼 궤적 (세트 카드 발동 쇼케이스 및 텀은 presentPendingSetTriggers가 전담)
  if (act?.type !== 'ATTACK') {
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
  }

  if (!act) return;

  if (act.type === 'PLAY_CARD') {
    const cpuSeat = liveDuel?.seats?.[1];
    if (Array.isArray(act.tributeInstanceIds) && act.tributeInstanceIds.length > 0) {
      act.tributeInstanceIds.forEach((tid) => {
        const tRect = preCpuRects.get(tid);
        if (tRect) {
          const localTr = toCanvasLocalRect(tRect);
          fxEngine.spawnCardShatter(localTr, Math.max(8, Math.floor((tunerSettings.shatterShards || 18) * 0.6)));
          fxEngine.spawnSoulWisp(localTr, cGyRect, () => {});
        }
      });
    }
    const summonedUnit = (cpuSeat?.board || []).find((u) => !preCpuIds.has(u.instanceId));
    if (summonedUnit) {
      audio.playCardPlayImpact();
      const unitEl = document.querySelector(`#cpu-board .unit-field-card[data-instance-id="${summonedUnit.instanceId}"]`);
      if (unitEl) {
        const mFx = getCardMasteryVisualFx(summonedUnit.cardId, summonedUnit.ownerSeat ?? 1);
        triggerUnitSummonEntrance(unitEl, mFx);
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
      const mSpellFx = spellDef ? getCardMasteryVisualFx(spellDef.id, castCard?.ownerSeat ?? 1) : { hasEntranceFx: false, preset: 'NONE' };
      spawnCardMasteryEntranceVfx(sx, sy, mSpellFx, true);
      fxEngine.triggerScreenShake(7);
      if (act.chosenTarget?.targetInstanceId) {
        const tEl = document.querySelector(`.unit-field-card[data-instance-id="${act.chosenTarget.targetInstanceId}"]`);
        if (tEl) {
          const tr = tEl.getBoundingClientRect();
          fxEngine.spawnShockwave(tr.left - cRect.left + tr.width / 2, tr.top - cRect.top + tr.height / 2, 110, '#34d399');
        }
      }
      if (spellDef) {
        showCardPlayShowcase(spellDef, { actorLabel: '상대 마법 발동', isCpu: true });
      }
    }
  } else if (act.type === 'SET_SPELL') {
    audio.playCardPlayImpact();
    const slotEl = act.slotType === 'FIELD_RIGHT'
      ? document.getElementById('field-set-right')
      : act.slotType === 'FIELD_LEFT'
        ? document.getElementById('field-set-left')
        : document.querySelector(`#cpu-board .unit-field-card[data-instance-id="${act.targetMonsterInstanceId}"]`)
          || document.getElementById('cpu-board');
    if (slotEl) {
      const sr = slotEl.getBoundingClientRect();
      fxEngine.spawnSummonBurst(sr.left - cRect.left + sr.width / 2, sr.top - cRect.top + sr.height / 2, '#ffffff', 95);
    }
  }
}

function playCpuAttackVisualEffects({ preCpuRects, prePlayerRects, prePlayerHandRect, prePlayerIds, liveDuel, onComplete }) {
  const res = engine.lastAttackResult;
  if (!res) {
    syncRunPhaseView();
    onComplete?.();
    return;
  }
  const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0, width: 1280, height: 800 };
  const playerGyEl = document.getElementById('player-graveyard');
  const cpuGyEl = document.getElementById('cpu-graveyard');
  const pGyRect = playerGyEl ? toCanvasLocalRect(playerGyEl.getBoundingClientRect()) : { left: 100, top: 650, width: 70, height: 90 };
  const cGyRect = cpuGyEl ? toCanvasLocalRect(cpuGyEl.getBoundingClientRect()) : { left: 1100, top: 100, width: 70, height: 90 };

  const atkPower = res.attackerAttack || 6;
  const isHeroHit = res.targetType === 'HERO' || !res.targetInstanceId;
  const playerHandEl = getPlayerHandImpactElement();
  const handFallbackRect = playerHandEl ? playerHandEl.getBoundingClientRect() : prePlayerHandRect;
  const rawTargetRect = isHeroHit
    ? (handFallbackRect || prePlayerHandRect)
    : (prePlayerRects.get(res.targetInstanceId) || handFallbackRect);
  const attackerEl = document.querySelector(`#cpu-board .unit-field-card[data-instance-id="${res.attackerInstanceId}"]`);
  const cpuAttackerCardId = attackerEl?.querySelector?.('[data-card-id]')?.getAttribute('data-card-id') || null;
  const cpuAtkMastery = cpuAttackerCardId ? getCardMasteryVisualFx(cpuAttackerCardId, 1) : { hasEntranceFx: false };
  const playerTargetEl = res.targetInstanceId
    ? document.querySelector(`#player-board .unit-field-card[data-instance-id="${res.targetInstanceId}"]`)
    : null;
  const playerTargetCardId = playerTargetEl?.querySelector?.('[data-card-id]')?.getAttribute('data-card-id') || null;
  const playerDefMastery = playerTargetCardId ? getCardMasteryVisualFx(playerTargetCardId, 0) : { hasEntranceFx: false };

  animateCpuAttackerSlam(attackerEl, rawTargetRect, atkPower, () => {
    const postPlayerIds = new Set((liveDuel?.seats?.[0]?.board || []).map((u) => u.instanceId));
    if (rawTargetRect) {
      const tx = rawTargetRect.left - cRect.left + rawTargetRect.width / 2;
      const ty = rawTargetRect.top - cRect.top + rawTargetRect.height / 2;
      fxEngine.triggerHitstop(tunerSettings.hitstopMs || 50);
      fxEngine.triggerScreenShake(Math.min(25, 4 + atkPower * 1.25));

      if (isHeroHit) {
        audio.playPlayerImpact(atkPower);
        fxEngine.spawnShockwave(tx, ty, 240, cpuAtkMastery.hasEntranceFx ? cpuAtkMastery.tint : '#ffffff');
        fxEngine.spawnImpactStarburst(tx, ty, cpuAtkMastery.hasEntranceFx ? 76 : 65, cpuAtkMastery.hasEntranceFx ? cpuAtkMastery.tint : '#f43f5e');
        fxEngine.spawnPlayerDustPuff(tx, ty, Math.max(200, rawTargetRect.width * 0.75), Math.max(85, rawTargetRect.height), 48);
        fxEngine.showFloatingText(tx, ty - 26, `-${res.damageDealt}`, '#ef4444', 32);
        playerHandEl?.classList.add('slam-hit-target');
        setTimeout(() => playerHandEl?.classList.remove('slam-hit-target'), 320);
      } else {
        const targetNowEl = document.querySelector(`#player-board .unit-field-card[data-instance-id="${res.targetInstanceId}"]`);
        if (res.defenderDied) {
          audio.playDamageHit();
          const hitColor = cpuAtkMastery.hasEntranceFx
            ? cpuAtkMastery.tint
            : (atkPower > 10 ? '#f59e0b' : '#38bdf8');
          fxEngine.spawnShockwave(tx, ty, Math.min(130, 45 + atkPower * 3.5), cpuAtkMastery.hasEntranceFx ? cpuAtkMastery.tint : '#ffffff');
          fxEngine.spawnImpactStarburst(tx, ty, Math.min(54, 16 + atkPower * 2 + (cpuAtkMastery.hasEntranceFx ? 8 : 0)), hitColor);
          if (playerDefMastery.hasEntranceFx) {
            fxEngine.spawnShockwave(tx, ty, 90, playerDefMastery.tint);
          }
          if (targetNowEl) {
            targetNowEl.classList.add('slam-hit-target');
          }
        } else {
          audio.playLightTap();
          fxEngine.spawnGuardBlockEffect(tx, ty, '#60a5fa');
          if (targetNowEl) {
            targetNowEl.classList.add('slam-blocked-guard');
            setTimeout(() => targetNowEl.classList.remove('slam-blocked-guard'), 320);
          }
        }
      }
    }

    prePlayerIds.forEach((id) => {
      if (!postPlayerIds.has(id)) {
        const deadRect = prePlayerRects.get(id);
        const deadEl = document.querySelector(`#player-board .unit-field-card[data-instance-id="${id}"]`);
        if (deadRect) {
          triggerUnitCrackThenShatter(deadEl, toCanvasLocalRect(deadRect), pGyRect, null, null, tunerSettings.shatterShards);
        }
      }
    });

    if (res.attackerDied) {
      const deadCpuRect = preCpuRects.get(res.attackerInstanceId);
      const deadCpuEl = document.querySelector(`#cpu-board .unit-field-card[data-instance-id="${res.attackerInstanceId}"]`);
      if (deadCpuRect) {
        triggerUnitCrackThenShatter(deadCpuEl, toCanvasLocalRect(deadCpuRect), cGyRect, null, null, tunerSettings.shatterShards);
      }
    }

    if (res.recoilDamage > 0) {
      const cpuMetaEl = document.getElementById('cpu-hand-container') || document.getElementById('cpu-seat');
      if (cpuMetaEl) {
        const mr = cpuMetaEl.getBoundingClientRect();
        const mx = mr.left - cRect.left + mr.width / 2;
        const my = mr.top - cRect.top + mr.height / 2;
        audio.playPlayerImpact(res.recoilDamage);
        fxEngine.spawnShockwave(mx, my, 180, '#f97316');
        fxEngine.spawnPlayerDustPuff(mx, my, mr.width, mr.height, 36);
        fxEngine.showFloatingText(mx, my + 24, `💥 반사 -${res.recoilDamage}`, '#f97316', 28);
      }
    }

    if (res.pierceDamage > 0 && handFallbackRect) {
      audio.playPiercingBolt();
      fxEngine.spawnPiercingBolt(toCanvasLocalRect(rawTargetRect || handFallbackRect), toCanvasLocalRect(handFallbackRect), res.pierceDamage, () => {
        audio.playPlayerImpact(res.pierceDamage);
        playerHandEl?.classList.add('slam-hit-target');
        setTimeout(() => playerHandEl?.classList.remove('slam-hit-target'), 300);
      });
    }
  }, () => {
    presentPendingSetTriggers(liveDuel, () => {
      syncRunPhaseView();
      onComplete?.();
    });
  });
}

let cpuStepTimerId = null;
let runSessionEpoch = 0;

function scheduleCpuTurnIfNeeded(snap) {
  const duel = snap?.activeDuel;
  if (!duel || duel.status !== 'ONGOING' || duel.activeSeat !== 1) {
    return;
  }
  if (isSetTriggerPaused) return;
  if (isCpuTurnScheduled) return;
  isCpuTurnScheduled = true;

  const epoch = runSessionEpoch;
  const cpuTempo = Math.max(0.4, Number(tunerSettings?.cpuTempo ?? 1.0));

  // 상대는 한 수씩 둔다: 사전 좌표 캡처 → 행동 실행 → 동일 타격/발동 이펙트 재생 → 화면 갱신
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
    const prePlayerHandEl = getPlayerHandImpactElement();
    const prePlayerHandRect = prePlayerHandEl ? prePlayerHandEl.getBoundingClientRect() : null;
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

    const liveDuel = engine.getSnapshot().activeDuel;
    const scheduleNextOrFinish = (baseDelay) => {
      if (!result.done && liveDuel && liveDuel.status === 'ONGOING' && liveDuel.activeSeat === 1) {
        if (epoch !== runSessionEpoch) {
          isCpuTurnScheduled = false;
          return;
        }
        cpuStepTimerId = setTimeout(step, Math.round(baseDelay / cpuTempo));
      } else {
        isCpuTurnScheduled = false;
        if (epoch === runSessionEpoch) {
          syncRunPhaseView();
        }
      }
    };

    if (result.action?.type === 'ATTACK') {
      playCpuAttackVisualEffects({
        preCpuRects,
        prePlayerRects,
        prePlayerHandRect,
        prePlayerIds,
        liveDuel,
        onComplete: () => scheduleNextOrFinish(920),
      });
      return;
    }

    if (result.action?.type === 'END_TURN') {
      presentPendingSetTriggers(liveDuel, () => {
        if (epoch !== runSessionEpoch) {
          isCpuTurnScheduled = false;
          return;
        }
        isCpuTurnScheduled = false;
        syncRunPhaseView();
      });
      return;
    }

    syncRunPhaseView();
    playCpuStepVisualEffects({
      preCpuRects,
      prePlayerRects,
      preCpuIds,
      prePlayerIds,
      preLastSpell,
      act: result.action,
      liveDuel,
    });
    presentPendingSetTriggers(liveDuel, () => {
      scheduleNextOrFinish(780);
    });
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
      const kwIds = def.kw || [];
      const godPill = (def.isGod || def.level === 6)
        ? `<span class="badge-god-tier">${svgIcon('crown')} 신(神)</span>`
        : '';
      const kwPills = (def.keywords || []).map((k, i) => {
        const kwId = kwIds[i] || k;
        const desc = keywordDesc(kwId);
        return `<span class="badge-keyword log-hover-kw" title="${escapeLogHtml(desc || '')}">${keywordIcon(kwId)}${escapeLogHtml(k)}</span>`;
      });
      const tagPills = (def.tags || []).map((tg) => {
        const formatted = `#${String(tg).replace(/^#+/, '')}`;
        return `<span class="badge-race-tag tag-tier-1 log-hover-tag">${escapeLogHtml(formatted)}</span>`;
      });
      const pills = [godPill, ...kwPills, ...tagPills].filter(Boolean);
      const tagsHtml = pills.length > 0
        ? `<div class="log-hover-tags">${pills.join('')}</div>`
        : '';

      const condLine = def.condition
        ? `<span class="log-hover-cond">[${escapeLogHtml(def.condition)}]</span> `
        : '';
      const bodyText = def.effect
        ? `${condLine}${escapeLogHtml(def.effect)}`
        : kwIds.length > 0
          ? kwIds.map((id) => `${escapeLogHtml(t(`kw.${id}`))}: ${escapeLogHtml(keywordDesc(id))}`).join(' / ')
          : '';
      const effectHtml = bodyText
        ? `<div class="log-hover-effect">${bodyText}</div>`
        : '';
      return `<div class="log-hover-card-item">${cardHtml}${tagsHtml}${effectHtml}</div>`;
    })
    .join('');

  preview.classList.remove('is-hidden');
  fitCardNameTextBoxes(preview);

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

function bindWantedCardHoverDelegation() {
  const attachHover = (hostEl, selector) => {
    if (!hostEl || hostEl.dataset.wantedHoverBound) return;
    hostEl.dataset.wantedHoverBound = '1';
    hostEl.addEventListener('mouseover', (e) => {
      const chip = e.target.closest(selector);
      if (chip && chip.dataset.cardId) {
        showLogCardHoverPreview([chip.dataset.cardId], chip);
        return;
      }
      hideLogCardHoverPreview();
    });
    hostEl.addEventListener('mouseleave', hideLogCardHoverPreview);
    hostEl.addEventListener('scroll', hideLogCardHoverPreview, { passive: true });
  };
  const merchantSelector = '.wanted-chip[data-card-id], .deal-offer-side[data-card-id], .merchant-item-card[data-card-id]';
  attachHover(document.getElementById('checkpoint-merchant-deals-container'), merchantSelector);
  attachHover(document.getElementById('checkpoint-merchant-shelf-container'), merchantSelector);
  attachHover(document.getElementById('checkpoint-shop-singles-container'), '.shop-single-card-item[data-card-id]');
  attachHover(document.getElementById('modal-trade-select'), '.modal-wanted-item[data-card-id], .modal-trade-offer-preview[data-card-id]');
}
bindWantedCardHoverDelegation();

function bindDynamicCardNameFitter() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  let rafId = 0;
  const schedule = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      fitCardNameTextBoxes(document);
    });
  };
  window.addEventListener('resize', schedule, { passive: true });
  document.fonts?.ready?.then(schedule).catch(() => {});

  const appRoot = document.body || document.getElementById('game-app');
  if (appRoot && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && (node.matches?.('.card-composite-wrapper, .overlay-name') || node.querySelector?.('.overlay-name'))) {
            schedule();
            return;
          }
        }
      }
    });
    observer.observe(appRoot, { childList: true, subtree: true });
  }
}
bindDynamicCardNameFitter();

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
    clearSetTriggerPauseTimers();
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
  lastPresentedSetTriggerDuelId = null;
  lastPresentedSetTriggerSeq = 0;

  document.getElementById('view-duel-arena')?.classList.remove('is-arena-blurred', 'is-defeat-desaturate');
  const arenaResetEl = document.getElementById('view-duel-arena');
  if (arenaResetEl) arenaResetEl.dataset.activeTurn = 'none';
  document.getElementById('player-seat')?.classList.remove('is-active-turn');
  document.getElementById('cpu-seat')?.classList.remove('is-active-turn');
  document.getElementById('duel-victory-overlay')?.classList.remove('is-visible');
  document.getElementById('duel-defeat-overlay')?.classList.remove('is-visible');
  document.getElementById('duel-start-overlay')?.classList.remove('is-visible');
  closeGraveyardViewer();
  document.getElementById('checkpoint-encounter-toast')?.classList.remove('is-visible');
  hidePackOpeningResultBanner();
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
  if (subEl) subEl.textContent = `라운드 ${snap.roundNumber || 1} 도전자 출현 · [도전!]에서 대전을 시작할 수 있습니다.`;
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

function renderChancesHeartsHtml(remaining, max = 3) {
  const safeMax = Math.max(1, Number(max) || 3);
  const safeRem = Math.max(0, Math.min(safeMax, Number(remaining ?? safeMax)));
  const fullBaked = resolveBakedDynamicAsset('fx:chance:heart_full');
  const emptyBaked = resolveBakedDynamicAsset('fx:chance:heart_empty');
  let html = '';
  for (let i = 0; i < safeMax; i += 1) {
    const isFull = i < safeRem;
    if (isFull) {
      if (fullBaked) {
        html += `<img class="chance-heart-svg chance-heart-img is-full" data-chance-filled="true" src="${fullBaked}" alt="" draggable="false" />`;
      } else {
        html += `<svg class="chance-heart-svg is-full" data-chance-filled="true" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#ef4444" stroke="#7f1d1d" stroke-width="1.6"/></svg>`;
      }
    } else if (emptyBaked) {
      html += `<img class="chance-heart-svg chance-heart-img is-empty" data-chance-filled="false" src="${emptyBaked}" alt="" draggable="false" />`;
    } else {
      html += `<svg class="chance-heart-svg is-empty" data-chance-filled="false" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="none" stroke="#94a3b8" stroke-width="2.1"/></svg>`;
    }
  }
  return html;
}

function updateChancesElement(el, remaining, max = 3) {
  if (!el) return;
  const safeMax = Math.max(1, Number(max) || 3);
  const safeRem = Math.max(0, Math.min(safeMax, Number(remaining ?? safeMax)));
  el.innerHTML = renderChancesHeartsHtml(safeRem, safeMax);
  el.setAttribute('data-remaining-chances', String(safeRem));
  el.setAttribute('data-max-chances', String(safeMax));
  el.setAttribute('aria-label', `남은 기회 ${safeRem} / ${safeMax}`);
}

function triggerDuelDefeatFX(durationMs = 1750, snap = null) {
  const overlay = document.getElementById('duel-defeat-overlay');
  const titleEl = document.getElementById('duel-defeat-title');
  const subEl = document.getElementById('duel-defeat-subtext');
  const chancesEl = document.getElementById('duel-defeat-chances');
  const arenaEl = document.getElementById('view-duel-arena');
  const maxChances = snap?.maxChances ?? 3;
  const remaining = snap?.remainingChances ?? 0;

  if (arenaEl) {
    const r = arenaEl.getBoundingClientRect();
    const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0 };
    const cx = (r.left - cRect.left) + (r.width || window.innerWidth) * 0.5;
    const cy = (r.top - cRect.top) + (r.height || window.innerHeight) * 0.45;
    fxEngine.triggerScreenShake(14);
    fxEngine.spawnShockwave(cx, cy, 240, '#ef4444');
    fxEngine.spawnImpactStarburst(cx, cy, 48, '#ef4444');
  }
  audio.playPlayerImpact(20);

  if (titleEl) {
    titleEl.textContent = remaining > 0 ? 'ROUND DEFEAT' : 'DEFEAT';
  }
  if (subEl) {
    if (snap?.lastDefeatInfo?.wasBoss) {
      subEl.textContent = '최종 보스에게 패배하여 여정이 즉시 종료되었습니다';
    } else if (remaining > 0) {
      const nextRnd = snap?.roundNumber || snap?.lastDefeatInfo?.nextRoundNumber || 1;
      subEl.textContent = `기회 1개를 잃었습니다 · 앞으로 ${remaining}번의 기회가 남았습니다! (ROUND ${nextRnd} 이동 · 승리 보상 미지급)`;
    } else {
      subEl.textContent = '모든 기회를 소진해 여정이 종료되었습니다';
    }
  }
  if (chancesEl) {
    chancesEl.hidden = false;
    updateChancesElement(chancesEl, remaining, maxChances);
  }

  if (arenaEl) {
    arenaEl.classList.add('is-arena-blurred', 'is-defeat-desaturate');
  }
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
      const duelKey = snap.activeDuel ? `${snap.activeDuel.duelId}_${snap.activeDuel.seed}` : null;
      switchView('VIEW_DUEL_ARENA', {
        onBeforeReveal: () => {
          const latest = engine.getSnapshot();
          renderDuelArena(latest);
        },
        onRevealed: () => {
          const latest = engine.getSnapshot();
          if (duelKey && duelKey !== lastStartedDuelKey) {
            lastStartedDuelKey = duelKey;
            const cpuName = latest.activeDuel?.seats?.[1]?.duelistName || '상대 듀얼리스트';
            triggerDuelStartCutIn(cpuName, '플레이어');
          }
          scheduleCpuTurnIfNeeded(latest);
        },
      });
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
  saveRunNow();

  const duelEndedLost = snap.activeDuel?.status === 'SEAT_1_WIN';
  const isDefeatTransition = wasDuelPhase && (snap.phase === 'RUN_FAILED' || (snap.phase === 'STAGE_CHECKPOINT' && duelEndedLost));
  const isVictoryTransition = wasDuelPhase && !duelEndedLost && (snap.phase === 'STAGE_CHECKPOINT' || snap.phase === 'STAGE_2_REWARD_PACK' || snap.phase === 'RUN_VICTORY');

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
    const holdMs = triggerDuelDefeatFX(1750, snap);
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
  if (!IS_DEBUG_TOOLS_ENABLED || !overlayLiveTuner) return;
  if (overlayLiveTuner.classList.contains('active')) {
    closeModalWithCrt(overlayLiveTuner, { mode: 'active' });
  } else {
    openModalWithCrt(overlayLiveTuner, { mode: 'active' });
    syncTunerInputs();
  }
}

function saveTunerSettings() {
  if (!IS_DEBUG_TOOLS_ENABLED) return;
  try {
    localStorage.setItem('duel_rogue_tuner_settings_v1', JSON.stringify(tunerSettings));
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = '전투 연출 설정이 저장되었습니다.';
  } catch (e) {}
  if (overlayLiveTuner) closeModalWithCrt(overlayLiveTuner, { mode: 'active' });
}

if (IS_DEBUG_TOOLS_ENABLED) {
  window.__TOGGLE_LIVE_TUNER = toggleTunerModal;
  window.__SAVE_LIVE_TUNER = saveTunerSettings;
}

document.getElementById('btn-toggle-tuner')?.addEventListener('click', toggleTunerModal);
document.getElementById('btn-close-tuner')?.addEventListener('click', () => closeModalWithCrt(overlayLiveTuner, { mode: 'active' }));
document.getElementById('btn-tuner-to-playground')?.addEventListener('click', () => {
  closeModalWithCrt(overlayLiveTuner, { mode: 'active' });
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
let activeRarityPreviewCompact = true;

function populateCardNameFontSelect() {
  const fontSel = document.getElementById('sel-card-name-font');
  if (!fontSel || fontSel.options.length > 0) return;
  fontSel.innerHTML = Object.entries(CARD_NAME_FONT_PRESETS)
    .map(([key, meta]) => `<option value="${key}">${meta.label}</option>`)
    .join('');
}
populateCardNameFontSelect();

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
  mount.classList.toggle('is-compact-preview', activeRarityPreviewCompact);
  mount.innerHTML = generateCompositeCardHtml(
    sampleDef,
    sampleDef.attack,
    sampleDef.defense ?? sampleDef.health,
    activeRarityPreviewCompact ? 0.55 : 0.95,
    activeRarityPreviewCompact
  );
  requestAnimationFrame(() => fitCardNameTextBoxes(mount));
  if (caption) {
    const info = RARITY_PRESET_INFO[tierCfg.preset];
    const fontKey = rarityConfig.fontSettings?.fontPreset || 'NOTO_SANS';
    const fontLabel = CARD_NAME_FONT_PRESETS[fontKey]?.label?.split('(')[0]?.trim() || fontKey;
    caption.textContent = `${RARITY_LABELS_KO[activeRarityTab] || activeRarityTab} · ${info ? info.label : tierCfg.preset} · ${fontLabel}`;
  }
}

function syncRarityTunerControls() {
  populateCardNameFontSelect();
  const tierCfg = rarityConfig[activeRarityTab] || rarityConfig.COMMON;
  const sel = document.getElementById('sel-rarity-preset');
  const colorInput = document.getElementById('input-rarity-name-color');
  const artFxSlider = document.getElementById('slider-rarity-art-fx');
  const glowSlider = document.getElementById('slider-rarity-glow');
  const nameGlowSlider = document.getElementById('slider-rarity-name-glow');
  const fontSel = document.getElementById('sel-card-name-font');
  const weightSel = document.getElementById('sel-card-name-weight');
  const customInput = document.getElementById('input-card-name-custom');
  const compactBtn = document.getElementById('btn-rarity-preview-compact');

  if (sel) sel.value = tierCfg.preset || 'NONE';
  if (colorInput) colorInput.value = tierCfg.nameColor || '#1a0f05';
  if (artFxSlider) artFxSlider.value = String(tierCfg.artFx ?? 0);
  if (glowSlider) glowSlider.value = String(tierCfg.glow ?? 0);
  if (nameGlowSlider) nameGlowSlider.value = String(tierCfg.nameGlow ?? 0);

  const fs = rarityConfig.fontSettings || DEFAULT_CARD_NAME_FONT_SETTINGS;
  if (fontSel) fontSel.value = CARD_NAME_FONT_PRESETS[fs.fontPreset] ? fs.fontPreset : 'NOTO_SANS';
  if (weightSel) weightSel.value = String(fs.fontWeight || '400');
  if (customInput) {
    customInput.value = fs.customFont || '';
    customInput.hidden = (fs.fontPreset !== 'CUSTOM');
  }
  if (compactBtn) compactBtn.classList.toggle('active', activeRarityPreviewCompact);

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
  requestAnimationFrame(() => fitCardNameTextBoxes(document));
  document.fonts?.ready?.then(() => fitCardNameTextBoxes(document)).catch(() => {});
}

function toggleRarityTunerModal() {
  if (!IS_DEBUG_TOOLS_ENABLED || !overlayRarityTuner) return;
  if (overlayRarityTuner.classList.contains('active')) {
    closeModalWithCrt(overlayRarityTuner, { mode: 'active' });
  } else {
    openModalWithCrt(overlayRarityTuner, { mode: 'active' });
    syncRarityTunerControls();
  }
}

if (IS_DEBUG_TOOLS_ENABLED) {
  window.__TOGGLE_RARITY_TUNER = toggleRarityTunerModal;
}

document.getElementById('btn-toggle-rarity-tuner')?.addEventListener('click', toggleRarityTunerModal);
document.getElementById('btn-close-rarity-tuner')?.addEventListener('click', () => closeModalWithCrt(overlayRarityTuner, { mode: 'active' }));

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
document.getElementById('btn-rarity-preview-compact')?.addEventListener('click', () => {
  activeRarityPreviewCompact = !activeRarityPreviewCompact;
  syncRarityTunerControls();
});

document.getElementById('sel-card-name-font')?.addEventListener('change', (e) => {
  if (!rarityConfig.fontSettings) rarityConfig.fontSettings = { ...DEFAULT_CARD_NAME_FONT_SETTINGS };
  rarityConfig.fontSettings.fontPreset = e.target.value;
  syncRarityTunerControls();
});

document.getElementById('sel-card-name-weight')?.addEventListener('change', (e) => {
  if (!rarityConfig.fontSettings) rarityConfig.fontSettings = { ...DEFAULT_CARD_NAME_FONT_SETTINGS };
  rarityConfig.fontSettings.fontWeight = e.target.value;
  syncRarityTunerControls();
});

document.getElementById('input-card-name-custom')?.addEventListener('input', (e) => {
  if (!rarityConfig.fontSettings) rarityConfig.fontSettings = { ...DEFAULT_CARD_NAME_FONT_SETTINGS };
  rarityConfig.fontSettings.fontPreset = 'CUSTOM';
  rarityConfig.fontSettings.customFont = e.target.value;
  syncRarityTunerControls();
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
  closeModalWithCrt(overlayRarityTuner, { mode: 'active' });
  const logEl = document.getElementById('duel-narrative-log');
  if (logEl) logEl.textContent = '카드 비주얼 설정이 저장되었습니다.';
});

document.addEventListener('keydown', (e) => {
  if (!IS_DEBUG_TOOLS_ENABLED) return;
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
  const zoneEl = document.getElementById(graveyardId === 'cpu-graveyard' ? 'cpu-graveyard' : 'player-graveyard');
  const stack = document.getElementById(graveyardId === 'cpu-graveyard' ? 'cpu-gy-stack' : 'player-gy-stack');
  if (!stack || !cardDef) return;
  const def = cardDef.cardId ? lookupCardDef(cardDef.cardId) || cardDef : cardDef;
  zoneEl?.classList.add('has-cards');
  const prevCount = stack.querySelector('.gy-count-badge')?.textContent;
  stack.innerHTML = `
    <div class="gy-top-card-frame">
      ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.34, true)}
    </div>
    ${prevCount ? `<div class="deck-count-badge gy-count-badge">${prevCount}</div>` : ''}
  `;
  fitCardNameTextBoxes(stack);
}

/**
 * [묘지(Graveyard) 맨 위 카드 렌더링 헬퍼]
 * - 필드의 카드처럼 가장 최근에 파괴/소모된 카드를 바로 앞면으로 표시하고 호버 시 상세 확인 가능
 */
function renderGraveyardStack(zoneEl, stackEl, graveyardCards = []) {
  if (!stackEl) return;
  const count = Array.isArray(graveyardCards) ? graveyardCards.length : 0;
  if (count === 0) {
    zoneEl?.classList.remove('has-cards');
    if (zoneEl) {
      delete zoneEl.dataset.topCardId;
      zoneEl.title = zoneEl.id === 'cpu-graveyard' ? '상대 묘지 (비어 있음)' : '내 묘지 (비어 있음)';
    }
    stackEl.innerHTML = '';
    return;
  }

  const topInst = graveyardCards[count - 1];
  const def = lookupCardDef(topInst.cardId) || topInst;
  zoneEl?.classList.add('has-cards');
  if (zoneEl && def?.name) {
    zoneEl.dataset.topCardId = def.id || '';
    zoneEl.title = `${def.name} (묘지 ${count}장 · 호버: 상세 확인 · 클릭: 묘지 전체 보기)`;
  }
  stackEl.innerHTML = `
    <div class="gy-top-card-frame">
      ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.34, true)}
    </div>
    <div class="deck-count-badge gy-count-badge">${count}</div>
  `;
  fitCardNameTextBoxes(stackEl);
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
  document.getElementById('player-board')?.classList.remove('has-dragging-attacker');
  document.getElementById('arena-field')?.classList.remove('has-dragging-attacker');
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

      // ★ 2. 캔버스 가산 발광 충격파 링 & 스파크 버스트 (소유자 숙련도 프리셋 반영 · 상황별 분기)
      const atkMastery = getCardMasteryVisualFx(attackerDef?.id, 0);
      const defMastery = targetUnit ? getCardMasteryVisualFx(targetUnit.cardId, targetUnit.ownerSeat ?? 1) : { hasEntranceFx: false };
      if (isTargetLeader) {
        fxEngine.spawnShockwave(cx, cy, 240, atkMastery.hasEntranceFx ? atkMastery.tint : '#ffffff');
        fxEngine.spawnImpactStarburst(cx, cy, atkMastery.hasEntranceFx ? 76 : 65, atkMastery.hasEntranceFx ? atkMastery.tint : '#f43f5e');
        fxEngine.spawnPlayerDustPuff(cx, cy, 260, 90, 48);
        fxEngine.showFloatingText(cx, cy - 25, `-${res.damageDealt}`, '#ef4444', 32);
        audio.playPlayerImpact(atk);
        appendCombatLog('attack', `🩸 상대 본체에 ${res.damageDealt}의 직접 타격 피해를 입혔습니다!`);
      } else if (res.defenderDied) {
        const sparkColor = atkMastery.hasEntranceFx ? atkMastery.tint : (atk > 10 ? '#f59e0b' : '#38bdf8');
        fxEngine.spawnShockwave(cx, cy, Math.min(130, 45 + atk * 3.5), atkMastery.hasEntranceFx ? atkMastery.tint : '#ffffff');
        fxEngine.spawnImpactStarburst(cx, cy, Math.min(54, 16 + atk * 2 + (atkMastery.hasEntranceFx ? 8 : 0)), sparkColor);
        if (defMastery.hasEntranceFx) {
          fxEngine.spawnShockwave(cx, cy, 90, defMastery.tint);
        }
      } else {
        // 파괴 실패 시 막힌 듯한 방어 이펙트 (공격력 수치 텍스트 미출력)
        audio.playLightTap();
        fxEngine.spawnGuardBlockEffect(cx, cy, '#60a5fa');
        if (defMastery.hasEntranceFx) {
          fxEngine.spawnShockwave(cx, cy, 80, defMastery.tint);
        }
      }

      // ★ 2-C. [세트 마법 트리거 격발 및 불발 피드백 + 확인 텀]
      let pendingAttackSetTrigger = false;
      if (res.triggeredSpell) {
        pendingAttackSetTrigger = presentPendingSetTriggers(engine.getSnapshot().activeDuel, () => {
          if (!isAttackAnimating) {
            onComplete?.();
          }
        });
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

      // ★ 3. 물리 카메라 쉐이크 & 피격/방어 막힘 반응
      fxEngine.triggerScreenShake(Math.min(25, 4 + atk * (isTargetLeader || res.defenderDied ? 1.3 : 0.75)));
      if (isTargetLeader || res.defenderDied) {
        targetEl.classList.add('slam-hit-target');
      } else {
        targetEl.classList.add('slam-blocked-guard');
        setTimeout(() => targetEl.classList.remove('slam-blocked-guard'), 320);
      }

      // ★ 4. 카드 파괴 시퀀스 (먼저 금이 가고 → 이후 산산조각 Shatter + 영혼 Wisp)
      if (res.defenderDied) {
        const defenderDef = lookupCardDef(res.defenderCardId);
        audio.playDamageHit();
        appendCombatLog('destroy', `💀 [전투 파괴!] 공격력이 수비력을 상회하여 「${defenderDef?.name || targetUnit?.name || '적 유닛'}」이(가) 파괴되어 묘지로 이송되었습니다!`);

        const cardLocalRect = {
          left: currentTargetRect.left - canvasRect.left,
          top: currentTargetRect.top - canvasRect.top,
          width: currentTargetRect.width,
          height: currentTargetRect.height,
        };
        const gyEl = document.getElementById('cpu-graveyard') || document.getElementById('pg-graveyard-slot');
        const gyR = gyEl ? gyEl.getBoundingClientRect() : { left: 100, top: 100, width: 70, height: 90 };
        const gyLocalRect = {
          left: gyR.left - canvasRect.left,
          top: gyR.top - canvasRect.top,
          width: gyR.width,
          height: gyR.height,
        };
        triggerUnitCrackThenShatter(targetEl, cardLocalRect, gyLocalRect, defenderDef, 'cpu-graveyard', tunerSettings.shatterShards);
      } else if (!isTargetLeader) {
        if (res.recoilDamage > 0) {
          audio.playPlayerImpact(res.recoilDamage);
          appendCombatLog('damage', `💥 [수비 반사 피해!] 상대 수비력(${targetUnit?.currentDefense ?? targetUnit?.defense})이 공격력(${atk})보다 높아 공격 플레이어가 차이만큼 반사 피해 -${res.recoilDamage}를 입었습니다!`);
          const logEl = document.getElementById('duel-narrative-log');
          if (logEl) logEl.textContent = `💥 [수비 반사 피해!] 적 수비력이 공격력보다 높아 -${res.recoilDamage}의 본체 반사 피해를 입었습니다!`;

          // 공격자 본체 위에 반사 데미지 텍스트 팝업 및 피격 반응 (내 패 쪽 직접 타격)
          const playerLeaderEl = getPlayerHandImpactElement();
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
          appendCombatLog('attack', `🛡️ 「${targetUnit?.name || '적 유닛'}」이(가) 수비력으로 공격을 막아냈습니다.`);
        }
        if (res.attackerDied) {
          const atkRect = attackerEl.getBoundingClientRect();
          const pGyEl = document.getElementById('player-graveyard');
          const pGyR = pGyEl ? pGyEl.getBoundingClientRect() : { left: 100, top: 650, width: 70, height: 90 };
          triggerUnitCrackThenShatter(attackerEl, toCanvasLocalRect(atkRect), toCanvasLocalRect(pGyR), attackerDef, 'player-graveyard', tunerSettings.shatterShards);
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
          if (!pendingAttackSetTrigger || !isSetTriggerPaused) {
            onComplete?.();
          }
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
function renderDeckStack(stackEl, count, usePlayerCosmetic = false) {
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
      ${generateCardBackHtml(0.36, { usePlayerCosmetic })}
      <div class="deck-count-badge">${count}</div>
    </div>
  `;
}

function renderDuelArena(snap) {
  const duel = snap.activeDuel;
  if (!duel) return;
  applyDuelCosmetics(cosmeticsConfig);
  if (duel.status !== 'ONGOING' || duel.activeSeat !== 0) {
    closeTributeModal();
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

  // 플레이어 및 CPU 스탯 렌더링 (유희왕 마스터 듀얼식 빠른 순차 숫자 롤링)
  if (duelCounterState.duelId !== duel.duelId) {
    resetDuelCounterState(duel.duelId);
  }

  const playerHp = Math.max(0, player.lp);
  const cpuHp = Math.max(0, cpu.lp);
  const playerLpEl = document.getElementById('player-lp');
  const cpuLpEl = document.getElementById('cpu-lp');
  updateChancesElement(document.getElementById('duel-player-chances'), snap.remainingChances ?? 3, snap.maxChances ?? 3);
  const playerSummonEl = document.getElementById('player-summon');
  if (playerSummonEl) playerSummonEl.textContent = `${player.normalSummonsRemaining ?? 0}/1`;

  document.getElementById('cpu-name').textContent = cpu.duelistName;
  flushDuelEventsToLog(duel);
  const cpuSummonEl = document.getElementById('cpu-summon');
  if (cpuSummonEl) cpuSummonEl.textContent = `${cpu.normalSummonsRemaining ?? 0}/1`;
  const cpuBadgeEl = document.getElementById('cpu-badge');
  if (cpuBadgeEl) cpuBadgeEl.textContent = cpu.duelistId;

  // 라이프포인트 게이지바 동적 구간별 색상 헬퍼
  const updateLpGaugeBar = (fillEl, hp, disableTransition = false) => {
    if (!fillEl) return;
    fillEl.style.transition = disableTransition ? 'none' : '';
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

  const playerLpBar = document.getElementById('player-lp-bar');
  const cpuLpBar = document.getElementById('cpu-lp-bar');
  const syncLpWithRoll = (seatIdx, lpEl, barEl, targetHp) => {
    const startVal = duelCounterState.lpDisplay[seatIdx] ?? duelCounterState.lp[seatIdx];
    duelCounterState.lp[seatIdx] = targetHp;
    if (startVal === null || startVal === undefined || startVal === targetHp) {
      duelCounterState.lpDisplay[seatIdx] = targetHp;
      if (lpEl) lpEl.textContent = String(targetHp);
      updateLpGaugeBar(barEl, targetHp, false);
      return;
    }
    if (duelCounterState.lpAnimRaf[seatIdx]) {
      cancelAnimationFrame(duelCounterState.lpAnimRaf[seatIdx]);
      duelCounterState.lpAnimRaf[seatIdx] = null;
    }
    animateRollingDigits(lpEl, startVal, targetHp, {
      durationMs: 420,
      accentEl: lpEl,
      upClass: 'lp-rolling-up',
      downClass: 'lp-rolling-down',
      onStep: (curVal) => {
        duelCounterState.lpDisplay[seatIdx] = curVal;
        updateLpGaugeBar(barEl, curVal, true);
      },
      onRaf: (id) => {
        duelCounterState.lpAnimRaf[seatIdx] = id;
      },
      onDone: () => {
        duelCounterState.lpDisplay[seatIdx] = targetHp;
        updateLpGaugeBar(barEl, targetHp, false);
      },
    });
  };
  syncLpWithRoll(0, playerLpEl, playerLpBar, playerHp);
  syncLpWithRoll(1, cpuLpEl, cpuLpBar, cpuHp);

  renderTurnButtonTitle(duel);

  // 현재 턴 플레이어 시트 그라데이션 발광 동기화 (내 턴 = 파랑, 상대 턴 = 빨강)
  const isOngoingTurn = duel.status === 'ONGOING';
  const isPlayerActiveTurn = isOngoingTurn && duel.activeSeat === 0;
  const isCpuActiveTurn = isOngoingTurn && duel.activeSeat === 1;
  document.getElementById('player-seat')?.classList.toggle('is-active-turn', isPlayerActiveTurn);
  document.getElementById('cpu-seat')?.classList.toggle('is-active-turn', isCpuActiveTurn);
  const arenaViewEl = document.getElementById('view-duel-arena');
  if (arenaViewEl) {
    arenaViewEl.dataset.activeTurn = isPlayerActiveTurn ? 'player' : (isCpuActiveTurn ? 'cpu' : 'none');
  }

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
            ${generateCardBackHtml(0.70, { usePlayerCosmetic: isMine })}
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
  renderDeckStack(cpuDeckStack, cpu.deck.length, false);
  const cpuDeckTooltip = document.getElementById('cpu-deck-tooltip');
  if (cpuDeckTooltip) cpuDeckTooltip.innerHTML = `상대 덱: <strong id="cpu-deck-count-text">${cpu.deck.length}</strong>장 남음`;

  // 플레이어 덱 & 묘지 맨 위 카드 렌더링
  const playerDeckStack = document.getElementById('player-deck-stack');
  renderDeckStack(playerDeckStack, player.deck.length, true);
  const playerDeckTooltip = document.getElementById('player-deck-tooltip');
  if (playerDeckTooltip) playerDeckTooltip.innerHTML = `내 덱: <strong id="player-deck-count-text">${player.deck.length}</strong>장 남음`;

  renderGraveyardStack(
    document.getElementById('cpu-graveyard'),
    document.getElementById('cpu-gy-stack'),
    cpu.graveyard || []
  );
  renderGraveyardStack(
    document.getElementById('player-graveyard'),
    document.getElementById('player-gy-stack'),
    player.graveyard || []
  );
  if (
    graveyardViewerModal &&
    !graveyardViewerModal.classList.contains('is-hidden') &&
    activeGraveyardSeat !== null
  ) {
    renderGraveyardViewerCards(activeGraveyardSeat);
  }

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
    applyUnitStatRolling(unitEl, unit);
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
  const arenaFieldEl = document.getElementById('arena-field');
  playerBoardEl.classList.remove('has-dragging-attacker');
  arenaFieldEl?.classList.remove('has-dragging-attacker');
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
        if (e.button !== 0 || isAttackAnimating || window.__activeTributeModalCleanup || activeFieldTargetCleanup) return;
        e.preventDefault();
        isDragging = true;
        hasMovedFar = false;
        startX = e.clientX;
        startY = e.clientY;
        hoveredTargetEl = null;
        unitEl.setPointerCapture(e.pointerId);
        unitEl.classList.add('is-dragging-attacker');
        playerBoardEl.classList.add('has-dragging-attacker');
        arenaFieldEl?.classList.add('has-dragging-attacker');

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
        playerBoardEl.classList.remove('has-dragging-attacker');
        arenaFieldEl?.classList.remove('has-dragging-attacker');
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
    applyUnitStatRolling(unitEl, unit);
  });

  // 퇴장한 유닛의 롤링 스탯 캐시 정리
  const liveBoardUnitIds = new Set([
    ...(cpu.board || []).map((u) => u.instanceId),
    ...(player.board || []).map((u) => u.instanceId),
  ]);
  for (const cachedId of Array.from(duelCounterState.units.keys())) {
    if (!liveBoardUnitIds.has(cachedId)) {
      duelCounterState.units.delete(cachedId);
    }
  }

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
    const fanTiltX = 0;

    const cardEl = document.createElement('div');
    cardEl.className = 'duel-card';
    cardEl.setAttribute('data-card-instance-id', cardInst.instanceId);
    cardEl.style.setProperty('--fan-rz', `${fanRotZ}deg`);
    cardEl.style.setProperty('--fan-ty', `${fanArchY}px`);
    cardEl.style.setProperty('--fan-rx', `${fanTiltX}deg`);
    if (idx < handCount - 1) {
      cardEl.style.marginRight = `${dynamicMarginRight.toFixed(1)}px`;
    }
    // 맨 왼쪽 카드가 제일 위로 올라오도록 좌에서 우 순으로 순차적 z-index 배치 (평소 3D 깊이 오프셋 미적용)
    const cardDepth = (handCount - idx) * 10;
    const fanDepthZ = 0;
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

  // 전장·패 카드 실제 텍스트박스 폭 기반 동적 이름 압축
  fitCardNameTextBoxes(document.getElementById('view-duel-arena'));
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
  if (!e.target.closest('.spell-action-popover') && !e.target.closest('.duel-card')) {
    closeSpellPopovers();
  }
  if (
    window.__activeTributeModalCleanup &&
    !e.target.closest('#tribute-select-modal') &&
    !e.target.closest('.duel-card') &&
    !e.target.closest('#player-board .unit-field-card')
  ) {
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
    const cRect = fxCanvas ? fxCanvas.getBoundingClientRect() : { left: 0, top: 0 };
    const slotEl = slotType === 'FIELD_RIGHT'
      ? document.getElementById('field-set-right')
      : slotType === 'FIELD_LEFT'
        ? document.getElementById('field-set-left')
        : document.querySelector(`#player-board .unit-field-card[data-instance-id="${targetMonsterInstanceId}"]`)
          || document.getElementById('player-board');
    if (slotEl) {
      const sr = slotEl.getBoundingClientRect();
      fxEngine.spawnSummonBurst(sr.left - cRect.left + sr.width / 2, sr.top - cRect.top + sr.height / 2, '#ffffff', 95);
    }
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
        ${generateCardBackHtml(0.58, { usePlayerCosmetic: isMine })}
        <span class="front-set-pill">${isMine ? frontSpell.name : `${svgIcon('lock')} ?`}</span>
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
    closeTributeModal();
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
      const mFx = getCardMasteryVisualFx(playedDef.id, playedInst?.ownerSeat ?? 0);
      if (isMonster) {
        const summonedEl = document.querySelector(`#player-board .unit-field-card[data-instance-id="${cardInstanceId}"]`);
        triggerUnitSummonEntrance(summonedEl, mFx);
      } else {
        const arenaEl = document.getElementById('arena-field');
        const ar = arenaEl ? arenaEl.getBoundingClientRect() : cRect;
        const sx = ar.left - cRect.left + ar.width / 2;
        const sy = ar.top - cRect.top + ar.height * 0.56;
        spawnCardMasteryEntranceVfx(sx, sy, mFx, true);
      }
      showCardPlayShowcase(playedInst || playedDef, {
        actorLabel: isMonster ? '내 몬스터 소환' : '내 마법 발동',
        isCpu: false,
      });
    }
    presentPendingSetTriggers(postDuel, null, { initialDelayMs: playedDef ? 420 : 0 });
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
  if (typeof window.__activeTributeModalCleanup === 'function') {
    const fn = window.__activeTributeModalCleanup;
    window.__activeTributeModalCleanup = null;
    fn();
  }
  document.querySelectorAll('#tribute-select-modal, .tribute-select-popover').forEach((el) => el.remove());
  document.querySelectorAll('.duel-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
}

/**
 * 하스스톤식 "카드를 먼저 필드에 내려놓은 뒤 대상 지정" 컨트롤러.
 * - mode: 'MANUAL_TARGET' (단일 대상 지정), 'SET_MONSTER_FRONT' (몬스터 앞 세트 대상 선택), 'TRIBUTE_SUMMON'
 */
function startFieldTargetMode({ mode, cardInst, cardDef, duel, tributeIds = [] }) {
  closeSpellPopovers();
  closeTributeModal();
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
  let arrowColor = mode === 'SET_MONSTER_FRONT' ? 'WHITE' : mode === 'TRIBUTE_SUMMON' ? 'YELLOW' : 'RED';

  function refreshTargetVisuals() {
    clearTargetHighlights();
    document.querySelectorAll('.targeting-valid-choice, .valid-evolution-target, .valid-spell-set-target, .aura-tribute-ready, .tribute-selected').forEach((el) => {
      el.classList.remove('targeting-valid-choice', 'valid-evolution-target', 'valid-spell-set-target', 'aura-tribute-ready', 'tribute-selected');
    });

    if (mode === 'SET_MONSTER_FRONT') {
      arrowColor = 'WHITE';
      const validEls = [];
      playerBoardEl?.querySelectorAll('.unit-field-card:not(.field-pending-unit)').forEach((el) => {
        const uId = el.getAttribute('data-instance-id');
        const occupied = player.setSpells?.some((s) => s.slotType === 'MONSTER_FRONT' && s.targetMonsterInstanceId === uId);
        if (!occupied) {
          el.classList.add('valid-spell-set-target', 'targeting-valid-choice');
          validEls.push(el);
        }
      });
      if (validEls.length > 0) fxEngine.setTargetAura(validEls, 'WHITE', true);
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
  closeSpellPopovers();
  closeFieldTargetMode();
  closeTributeModal();

  const latestDuel = engine.getSnapshot()?.activeDuel || duel;
  const activePlayer = latestDuel?.seats?.[0] || player;
  if (!latestDuel || latestDuel.status !== 'ONGOING' || latestDuel.activeSeat !== 0 || !activePlayer) return;

  const targetHandEl = cardEl || document.querySelector(`.duel-card[data-card-instance-id="${cardInst.instanceId}"]`);
  targetHandEl?.classList.add('is-selected');

  const cardLevel = def.level ?? def.cost ?? 1;
  if ((activePlayer.board || []).length === 0) {
    const logEl = document.getElementById('duel-narrative-log');
    if (logEl) logEl.textContent = '⚠️ [제물 부족] 필드에 제물로 바칠 몬스터가 없습니다.';
    targetHandEl?.classList.remove('is-selected');
    return;
  }

  const stepUpCandidates = activePlayer.board.filter((u) => cardLevel - (u.level || 1) <= 1);
  const modal = document.createElement('div');
  modal.className = 'tribute-select-popover';
  modal.id = 'tribute-select-modal';

  const selectedTributeIds = new Set();

  function updateModalView() {
    const selectedArray = Array.from(selectedTributeIds)
      .map((id) => activePlayer.board.find((u) => u.instanceId === id))
      .filter(Boolean);
    const sumLevel = selectedArray.reduce((acc, u) => acc + (u.level || 1), 0);
    const isStepUp = selectedArray.length === 1 && cardLevel - (selectedArray[0].level || 1) <= 1;
    const isSummationValid = selectedArray.length >= 2 && sumLevel >= cardLevel;
    const canSummon = isStepUp || isSummationValid;

    const selectedEls = [];
    document.querySelectorAll('#player-board .unit-field-card').forEach((el) => {
      const uId = el.getAttribute('data-instance-id');
      const unit = activePlayer.board.find((u) => u.instanceId === uId);
      if (!unit) return;
      el.classList.remove('tribute-selected', 'aura-tribute-ready', 'valid-evolution-target');
      if (selectedTributeIds.has(uId)) {
        el.classList.add('tribute-selected');
        selectedEls.push(el);
      } else if (cardLevel - (unit.level || 1) <= 1) {
        el.classList.add('valid-evolution-target');
      } else {
        el.classList.add('aura-tribute-ready');
      }
    });
    if (selectedEls.length > 0) {
      fxEngine.setTargetAura(selectedEls, 'GREEN', false);
    } else {
      fxEngine.clearTargetAura();
    }

    const statusText = isStepUp
      ? `✨ 1단계 계단식 진화 가능! (제물: ★Lv.${selectedArray[0].level} 1마리)`
      : isSummationValid
      ? `🔥 합산 릴리스 가능! (선택 합산: ★Lv.${sumLevel} / 필요: ★Lv.${cardLevel})`
      : selectedArray.length === 0
      ? '필드의 몬스터를 클릭하여 제물을 선택하세요.'
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

  const boardClickCapture = (e) => {
    if (e.target.closest('#tribute-select-modal')) return;
    const unitEl = e.target.closest('#player-board .unit-field-card');
    if (!unitEl) return;
    e.stopPropagation();
    e.preventDefault();
    const instId = unitEl.getAttribute('data-instance-id');
    if (!instId) return;
    if (selectedTributeIds.has(instId)) {
      selectedTributeIds.delete(instId);
    } else {
      selectedTributeIds.add(instId);
    }
    audio.playLightTap();
    updateModalView();
  };

  const onRightClickCancel = (e) => {
    e.preventDefault();
    closeTributeModal();
  };

  const onEscapeCancel = (e) => {
    if (e.key === 'Escape') {
      closeTributeModal();
    }
  };

  document.addEventListener('click', boardClickCapture, true);
  document.addEventListener('contextmenu', onRightClickCancel);
  document.addEventListener('keydown', onEscapeCancel);

  modal.querySelector('#btn-cancel-tribute').onclick = (e) => {
    e.stopPropagation();
    closeTributeModal();
  };

  modal.querySelector('#btn-confirm-tribute').onclick = (e) => {
    e.stopPropagation();
    const tributes = Array.from(selectedTributeIds);
    const chosenUnits = tributes.map((id) => activePlayer.board.find((u) => u.instanceId === id)).filter(Boolean);
    const sumLevel = chosenUnits.reduce((acc, u) => acc + (u.level || 1), 0);
    const ok =
      (chosenUnits.length === 1 && cardLevel - (chosenUnits[0].level || 1) <= 1) ||
      (chosenUnits.length >= 2 && sumLevel >= cardLevel);
    if (!ok) return;

    const spec = getManualTargetSpec(latestDuel, def, 0, tributes);
    closeTributeModal();
    if (spec && (spec.unitIds.length > 0 || spec.heroSeats.length > 0)) {
      startFieldTargetMode({ mode: 'MANUAL_TARGET', cardInst, cardDef: def, duel: latestDuel, tributeIds: tributes });
    } else {
      handlePlayCard(cardInst.instanceId, tributes);
    }
  };

  if (activePlayer.board.length === 1 && stepUpCandidates.length === 1) {
    selectedTributeIds.add(activePlayer.board[0].instanceId);
  }

  document.body.appendChild(modal);
  updateModalView();

  window.__activeTributeModalCleanup = () => {
    document.removeEventListener('click', boardClickCapture, true);
    document.removeEventListener('contextmenu', onRightClickCancel);
    document.removeEventListener('keydown', onEscapeCancel);
    fxEngine.clearTargetAura();
    document.querySelectorAll('#player-board .unit-field-card').forEach((el) => {
      el.classList.remove('tribute-selected', 'aura-tribute-ready', 'valid-evolution-target');
    });
    modal.remove();
    document.querySelectorAll('.duel-card.is-selected').forEach((el) => el.classList.remove('is-selected'));
  };
}

// 턴 종료 버튼 (중앙 타이머 정지 및 차례 넘김)
document.getElementById('btn-end-turn')?.addEventListener('click', () => {
  closeTributeModal();
  closeFieldTargetMode();
  audio.playTurnBell();
  duelTurnTimer.stop();
  selectedAttackerInstanceId = null;
  clearTargetHighlights();
  updateTurnHudLastAction('내 턴 종료');
  engine.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
  const postDuel = engine.getSnapshot().activeDuel;
  presentPendingSetTriggers(postDuel, () => syncRunPhaseView());
});

// 진행 저장 후 메인 메뉴 복귀 버튼
document.getElementById('btn-abandon-run')?.addEventListener('click', async () => {
  const ok = await showGameConfirm('현재 진행 상황을 저장하고 메인 메뉴로 돌아가시겠습니까?', {
    title: '저장하고 나가기',
    confirmText: '저장하고 나가기',
    cancelText: '계속 진행',
    icon: 'home',
    danger: false,
  });
  if (ok) {
    saveRunNow();
    toggleInGameOptions(false);
    audio.playCardPickup();
    engine.state = engine.createEmptyRunState('RUN_INIT', Date.now());
    resetRunUiTransitionState('IDLE');
    refreshContinueButton();
    switchView('VIEW_TITLE_LOBBY');
  }
});

// 빠른 흐름 점검용 [테스트] 즉시 승리 (디버그 전용)
if (IS_DEBUG_TOOLS_ENABLED) {
  document.getElementById('btn-instant-win-test')?.addEventListener('click', () => {
    const snap = engine.getSnapshot();
    if (snap.activeDuel) {
      audio.playDamageHit();
      snap.activeDuel.seats[1].lp = 0;
      engine.evaluateDuelOutcome(snap.activeDuel);
      syncRunPhaseView();
    }
  });
}

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
  updateChancesElement(
    document.getElementById('checkpoint-chances-hearts'),
    snap.remainingChances ?? 3,
    snap.maxChances ?? 3
  );

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

  // 포털 1: 다음 듀얼 인카운터 (다음 라운드 난이도 및 보상 명시)
  const enc = snap.nextEncounterInfo;
  if (enc) {
    const starsEl = document.getElementById('hub-encounter-stars');
    const rewardEl = document.getElementById('hub-encounter-reward');

    if (starsEl) starsEl.textContent = `다음 라운드 난이도: ${enc.stars || '★☆☆☆☆'}`;
    if (rewardEl) rewardEl.textContent = `+${(enc.rewardGold || 500).toLocaleString()}원`;
  }

  // 포털 2: 듀얼 숍 (미확인 시 NEW! 강조 배지, 확인 후 재고 요약 표시)
  const currentRound = snap.roundNumber || 1;
  const shopVisited = (snap.shopVisitedRound ?? engine?.state?.shopVisitedRound) === currentRound;
  const shopNewBadge = document.getElementById('hub-shop-new-badge');
  const totalStock = (snap.checkpointShopStock || []).reduce((acc, p) => acc + (p.stock || 0), 0);
  const packKinds = (snap.checkpointShopStock || []).length;
  const shopStockEl = document.getElementById('hub-shop-stock-count');
  if (shopNewBadge) shopNewBadge.hidden = shopVisited;
  if (shopStockEl) {
    shopStockEl.hidden = !shopVisited;
    shopStockEl.textContent = `${packKinds}종 · ${totalStock}팩`;
  }

  // 포털 3: 도전! (수상한 거래상 또는 골목 돌발 이벤트 존재 시 인기척 배지 표시)
  const presencePill = document.getElementById('hub-alley-presence-pill');
  const hasMerchant = Boolean(snap.suspiciousMerchant?.deals?.length || snap.suspiciousMerchant?.items?.length);
  const hasAlleyEvent = Boolean(snap.alleySpecialEvent || snap.hasAlleyEncounterEvent);
  if (presencePill) {
    const hasPresence = hasMerchant || hasAlleyEvent;
    presencePill.hidden = !hasPresence;
    if (hasPresence) {
      presencePill.textContent = '누군가의 인기척이 느껴집니다...';
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

  const defeatRuleEl = document.getElementById('encounter-defeat-rule-text');
  if (defeatRuleEl) {
    const rem = snap.remainingChances ?? 3;
    const maxC = snap.maxChances ?? 3;
    if (rem <= 1) {
      defeatRuleEl.innerHTML = `${svgIcon('warn')} 마지막 기회! 패배 시 여정 종료`;
    } else {
      defeatRuleEl.textContent = `기회 1 감소 (남은 기회 ${rem - 1}/${maxC}) · 다음 라운드`;
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
let shopTiredReaction = null; // { reason: 'noGold' | 'soldOut' | 'purchased', round: number }
let shopTiredTimer = null;

function clearShopTiredReaction() {
  shopTiredReaction = null;
  if (shopTiredTimer) {
    clearTimeout(shopTiredTimer);
    shopTiredTimer = null;
  }
}

function updateShopkeeperBanner(snap) {
  const shopPortrait = document.getElementById('shopkeeper-portrait');
  if (!shopPortrait) return;
  const allSold = (snap.checkpointShopStock || []).every((p) => p.stock <= 0);
  const hasLegend = (snap.checkpointShopStock || []).some((p) => p.faction === 'ALL' && p.stock > 0);
  const cantBuyReason = shopTiredReaction?.reason || null;
  const mood = cantBuyReason ? 3 : hasLegend ? 2 : null;
  const portrait = npcPortraitHtml('shop', snap.roundNumber, mood);
  if (shopPortrait.dataset.src !== portrait.key) {
    shopPortrait.dataset.src = portrait.key;
    shopPortrait.innerHTML = portrait.html;
  }
  const speechEl = document.getElementById('shop-speech-bubble');
  if (speechEl) {
    speechEl.textContent = npcDialogue('shop', engine?.state?.seed, snap.roundNumber, { allSold, hasLegend, cantBuyReason });
  }
}

function triggerShopTiredReaction(reason, roundNumber) {
  shopTiredReaction = { reason, round: roundNumber };
  if (shopTiredTimer) clearTimeout(shopTiredTimer);
  if (engine?.getSnapshot) {
    updateShopkeeperBanner(engine.getSnapshot());
  }
  shopTiredTimer = setTimeout(() => {
    shopTiredReaction = null;
    shopTiredTimer = null;
    if (currentViewKey === 'VIEW_CHECKPOINT_SHOP' && engine?.getSnapshot) {
      updateShopkeeperBanner(engine.getSnapshot());
    }
  }, 3800);
}

function renderCheckpointShopSubpage(snap) {
  if (shopTiredReaction && shopTiredReaction.round !== snap.roundNumber) {
    clearShopTiredReaction();
  }
  updateShopkeeperBanner(snap);
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
        ${productWrapHtml(pack, artImg(PACK_ART[pack.id], 'pack-art-img', `<span class="pack-symbol-art">${symbol}</span>`))}
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
      <button class="btn primary-btn btn-buy-pack ${isSoldOut || !canAfford ? 'is-disabled' : ''}" ${isSoldOut || !canAfford ? 'aria-disabled="true"' : ''}>
        ${isSoldOut ? '품절' : !canAfford ? '골드 부족' : `구매 (${pack.price.toLocaleString()}원)`}
      </button>
    `;

    const buyBtn = packEl.querySelector('.btn-buy-pack');
    buyBtn?.addEventListener('click', async () => {
      if (isSoldOut || !canAfford) {
        audio.playLightTap();
        triggerShopTiredReaction(isSoldOut ? 'soldOut' : 'noGold', snap.roundNumber);
        return;
      }
      try {
        clearShopTiredReaction();
        audio.playCardPlayImpact();
        const result = engine.buyBoosterPack(pack.id);
        saveRunNow();
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
    hideLogCardHoverPreview();
    singlesContainer.innerHTML = '';
    const singles = snap.checkpointShopSingles || [];
    singles.forEach((item) => {
      const cardDef = lookupCardDef(item.cardId);
      if (!cardDef) return;

      const isMonster = cardDef.type === 'MONSTER' || (cardDef.attack > 0 && cardDef.type !== 'SPELL');
      const itemEl = document.createElement('div');
      itemEl.className = `shop-single-card-item ${item.purchased ? 'is-purchased' : ''}`;
      itemEl.dataset.cardId = item.cardId;

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
        <button class="btn secondary-btn btn-buy-shop-single ${!canAfford ? 'is-disabled' : ''}" ${!canAfford ? 'aria-disabled="true"' : ''}>
          ${item.purchased ? '구매 완료' : !canAfford ? '골드 부족' : `구매 (${item.price.toLocaleString()}원)`}
        </button>
      `;

      const buyBtn = itemEl.querySelector('.btn-buy-shop-single');
      buyBtn?.addEventListener('click', async () => {
        if (!canAfford) {
          audio.playLightTap();
          triggerShopTiredReaction(item.purchased ? 'purchased' : 'noGold', snap.roundNumber);
          return;
        }
        try {
          clearShopTiredReaction();
          audio.playCardPlayImpact();
          engine.buyShopSingleCard(item.cardId);
          saveRunNow();
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

function hidePackOpeningResultBanner() {
  const banner = document.getElementById('shop-pack-result-banner');
  const cardsContainer = document.getElementById('shop-pack-result-cards');
  if (banner) banner.classList.add('is-hidden');
  if (cardsContainer) cardsContainer.innerHTML = '';
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
  hidePackOpeningResultBanner();
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
      <div class="modal-trade-offer-preview" ${rDef ? `data-card-id="${rDef.id}"` : ''}>
        <div style="font-size:0.8rem; font-weight:800; color:#c084fc; margin-bottom:4px; text-align:center;">획득 카드</div>
        <div style="width:130px; height:182px; display:flex; align-items:center; justify-content:center; margin:0 auto;">
          ${rDef ? generateCompositeCardHtml(rDef, rDef.attack, rDef.defense ?? rDef.health, 0.65, false) : ''}
        </div>
        <div style="text-align:center; margin-top:6px;">
          <h4 style="margin:0; font-size:1.02rem; color:#f8fafc; font-weight:800;">${rDef?.name || deal.cardName}</h4>
          <span style="font-size:0.75rem; color:#a855f7;">${isMonster ? `Lv.${rDef.level || rDef.cost} 몬스터` : '마법 카드'}</span>
        </div>
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

  openModalWithCrt(modal, { mode: 'active' });
}

function closeTradeModal() {
  hideLogCardHoverPreview();
  const modal = document.getElementById('modal-trade-select');
  if (modal) closeModalWithCrt(modal, { mode: 'active' });
  activeTradeDeal = null;
  activeSelectedCandidates = [];
  activeSelectedTrunkIndices = [];
}

function renderTradeTrunkCards(snap) {
  const container = document.getElementById('trade-trunk-cards-container');
  if (!container) return;
  hideLogCardHoverPreview();
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
        <div class="modal-wanted-item ${isSatisfied ? 'is-satisfied' : 'is-pending'}" data-card-id="${wId}">
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

  const merchantHere = Boolean(snap.suspiciousMerchant?.deals?.length || snap.suspiciousMerchant?.items?.length);
  const alleyFlag = merchantHere ? '1' : '';
  if (document.body.dataset.alleyMerchant !== alleyFlag) {
    document.body.dataset.alleyMerchant = alleyFlag;
    if (currentViewKey === 'VIEW_CHECKPOINT_MERCHANT') refreshSceneBackdrop();
  }

  const merchantIcon = document.querySelector('#merchant-dialogue-banner .merchant-npc-icon');
  if (merchantIcon) {
    if (!merchantHere) {
      merchantIcon.style.display = 'none';
      merchantIcon.dataset.src = '';
    } else {
      merchantIcon.style.display = '';
      const done = (snap.suspiciousMerchant?.deals || []).filter((d) => d.completed).length;
      const portrait = npcPortraitHtml('merchant', snap.roundNumber, done > 0 ? 3 : null);
      if (merchantIcon.dataset.src !== portrait.key) {
        merchantIcon.dataset.src = portrait.key;
        merchantIcon.innerHTML = portrait.html;
      }
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

  if (dialogueText) {
    const dealsList = merchant.deals || [];
    const doneCount = dealsList.filter((d) => d.completed).length;
    const sampleCardName = dealsList[0]?.wantedCardNames?.[0] || '카드';
    dialogueText.textContent = npcDialogue('merchant', engine?.state?.seed, snap.roundNumber, {
      sampleCardName,
      doneCount,
      totalCount: dealsList.length,
    }) || merchant.dialogue || '';
  }

  hideLogCardHoverPreview();
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
            <div class="wanted-chip" data-card-id="${wId}">
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
        wantedHtml = `<div class="req-desc">가방의 카드를 건네고 교환합니다.</div>`;
      }

      dealCardEl.innerHTML = `
        <div class="deal-offer-side" data-card-id="${cardDef.id}">
          <div class="deal-preview-mini">
            ${generateCompositeCardHtml(cardDef, cardDef.attack, cardDef.defense ?? cardDef.health, 0.48, true)}
          </div>
          <div class="deal-info-wrap">
            <h4 class="deal-card-name">${cardDef.name}</h4>
            <span class="deal-card-type">${isMonster ? `Lv.${cardDef.level || cardDef.cost} 몬스터` : '마법 카드'}</span>
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
      itemCardEl.dataset.cardId = item.cardId;
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
          saveRunNow();
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

const PLAYER_DECK_NAME_KEY = 'duel_rogue_deck_name_v1';

function getPlayerDeckName() {
  const fromState = typeof engine?.state?.playerDeckName === 'string' ? engine.state.playerDeckName.trim() : '';
  if (fromState) return fromState;
  try {
    const saved = (localStorage.getItem(PLAYER_DECK_NAME_KEY) || '').trim();
    if (saved) return saved;
  } catch { /* ignore */ }
  return 'PLAYER';
}

function setPlayerDeckName(nextName) {
  const normalized = String(nextName || '').trim().slice(0, 24) || 'PLAYER';
  if (engine?.state) {
    engine.state.playerDeckName = normalized;
    if (engine.state.phase && engine.state.phase !== 'IDLE') saveRunNow();
  }
  try {
    localStorage.setItem(PLAYER_DECK_NAME_KEY, normalized);
  } catch { /* ignore */ }
  const textEl = document.getElementById('editor-deck-name-text');
  const inputEl = document.getElementById('input-edit-deck-name');
  if (textEl) textEl.textContent = normalized;
  if (inputEl && inputEl.value !== normalized) inputEl.value = normalized;
  return normalized;
}

function sortDeckMasterFirst(cardIds, deckMasterCardId) {
  return sortDeckListCardIds(cardIds, deckMasterCardId, lookupCardDef);
}

(function initEditableDeckNameUi() {
  const btn = document.getElementById('btn-edit-deck-name');
  const input = document.getElementById('input-edit-deck-name');
  if (!btn || !input) return;

  const commit = () => {
    setPlayerDeckName(input.value);
    input.hidden = true;
    btn.hidden = false;
  };
  const cancel = () => {
    input.value = getPlayerDeckName();
    input.hidden = true;
    btn.hidden = false;
  };

  btn.addEventListener('click', () => {
    audio.playCardPickup();
    input.value = getPlayerDeckName();
    btn.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      audio.playLightTap();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  });
  input.addEventListener('blur', commit);
})();

/** 5. 유희왕 콘솔 스타일 가방 & 덱 편집기 (트렁크) */
const deckEditorFilterState = {
  query: '',
  sortBy: 'DEFAULT',
};
let editorSelectedTileKey = null;

function updateEditorBagToolbarUi() {
  const searchInput = document.getElementById('input-editor-bag-search');
  const clearBtn = document.getElementById('btn-editor-bag-search-clear');
  const sortSel = document.getElementById('sel-editor-bag-sort');
  if (searchInput && searchInput.value !== deckEditorFilterState.query) {
    searchInput.value = deckEditorFilterState.query;
  }
  if (clearBtn) {
    clearBtn.hidden = !deckEditorFilterState.query;
  }
  if (sortSel && sortSel.value !== deckEditorFilterState.sortBy) {
    sortSel.value = deckEditorFilterState.sortBy;
  }
}

(function initDeckEditorFilterToolbar() {
  const searchInput = document.getElementById('input-editor-bag-search');
  const clearBtn = document.getElementById('btn-editor-bag-search-clear');
  const sortSel = document.getElementById('sel-editor-bag-sort');

  searchInput?.addEventListener('input', (e) => {
    deckEditorFilterState.query = e.target.value || '';
    updateEditorBagToolbarUi();
    if (engine?.getSnapshot) {
      renderCheckpointDeckEditorSubpage(engine.getSnapshot());
    }
  });
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deckEditorFilterState.query) {
      e.preventDefault();
      e.stopPropagation();
      deckEditorFilterState.query = '';
      updateEditorBagToolbarUi();
      if (engine?.getSnapshot) {
        renderCheckpointDeckEditorSubpage(engine.getSnapshot());
      }
    }
  });
  clearBtn?.addEventListener('click', () => {
    deckEditorFilterState.query = '';
    updateEditorBagToolbarUi();
    audio.playLightTap();
    if (engine?.getSnapshot) {
      renderCheckpointDeckEditorSubpage(engine.getSnapshot());
    }
    searchInput?.focus();
  });
  sortSel?.addEventListener('change', (e) => {
    deckEditorFilterState.sortBy = e.target.value || 'DEFAULT';
    audio.playLightTap();
    if (engine?.getSnapshot) {
      renderCheckpointDeckEditorSubpage(engine.getSnapshot());
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && currentViewKey === 'VIEW_CHECKPOINT_DECK_EDITOR') {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
  });
})();

function renderCheckpointDeckEditorSubpage(snap) {
  const rawDeckCards = snap.playerDeckCardIds || [];
  const trunkCards = snap.playerTrunkCardIds || [];
  const deckMasterId = snap.playerDeckMasterCardId;
  const deckCards = sortDeckMasterFirst(rawDeckCards, deckMasterId);
  const filteredBagCards = filterAndSortBagCardIds(
    trunkCards,
    { ...deckEditorFilterState, acquisitionOrder: snap.cardAcquisitionOrder },
    lookupCardDef
  );
  const hasSearchQuery = Boolean(String(deckEditorFilterState.query || '').trim());

  updateEditorBagToolbarUi();

  const deckNameTextEl = document.getElementById('editor-deck-name-text');
  const deckNameInputEl = document.getElementById('input-edit-deck-name');
  const deckName = getPlayerDeckName();
  if (deckNameTextEl) deckNameTextEl.textContent = deckName;
  if (deckNameInputEl && deckNameInputEl.hidden) deckNameInputEl.value = deckName;

  // 헤더 미터
  const currentCountEl = document.getElementById('editor-deck-current-count');
  const deckTitleCountEl = document.getElementById('editor-deck-title-count');
  if (currentCountEl) currentCountEl.textContent = deckCards.length;
  if (deckTitleCountEl) deckTitleCountEl.textContent = deckCards.length;

  const trunkCountEl = document.getElementById('editor-trunk-count');
  const bagTitleCountEl = document.getElementById('editor-bag-title-count');
  if (trunkCountEl) trunkCountEl.textContent = trunkCards.length;
  if (bagTitleCountEl) {
    bagTitleCountEl.textContent = hasSearchQuery
      ? `${filteredBagCards.length} / ${trunkCards.length}`
      : String(trunkCards.length);
  }

  const meterPill = document.getElementById('editor-deck-meter-pill');
  const noticeEl = document.getElementById('editor-deck-validation-notice');

  if (deckCards.length === 30) {
    if (meterPill) { meterPill.className = 'meter-pill is-valid'; }
    if (noticeEl) {
      noticeEl.innerHTML = `${svgIcon('check')} 30/30장 완료`;
      noticeEl.className = 'editor-status-notice';
    }
  } else if (deckCards.length < 30) {
    if (meterPill) { meterPill.className = 'meter-pill is-invalid'; }
    if (noticeEl) {
      noticeEl.innerHTML = `${svgIcon('warn')} ${deckCards.length}/30장 (+${30 - deckCards.length}장 필요)`;
      noticeEl.className = 'editor-status-notice is-error';
    }
  } else {
    if (meterPill) { meterPill.className = 'meter-pill is-invalid'; }
    if (noticeEl) {
      noticeEl.innerHTML = `${svgIcon('warn')} ${deckCards.length}/30장 (-${deckCards.length - 30}장 초과)`;
      noticeEl.className = 'editor-status-notice is-error';
    }
  }

  const selectEditorTile = (tileEl, tileKey, def, isDeckMaster) => {
    editorSelectedTileKey = tileKey;
    document.querySelectorAll('#view-checkpoint-deck-editor .trunk-card-tile.is-selected')
      .forEach((el) => el.classList.remove('is-selected'));
    tileEl?.classList.add('is-selected');
    syncEditorInspectedCard(def, isDeckMaster);
  };

  // 중앙: 현재 듀얼 덱 (5×6 순수 카드 그래픽 렌더링)
  const deckGrid = document.getElementById('editor-deck-cards-grid');
  if (deckGrid) {
    deckGrid.innerHTML = '';
    deckCards.forEach((cardId, idx) => {
      const def = lookupCardDef(cardId);
      if (!def) return;

      const isDeckMaster = cardId === deckMasterId;
      const tileKey = `deck:${cardId}:${idx}`;
      const tileEl = document.createElement('div');
      tileEl.className = `trunk-card-tile ${isDeckMaster ? 'is-deckmaster' : ''} ${editorSelectedTileKey === tileKey ? 'is-selected' : ''}`.trim();
      tileEl.title = isDeckMaster
        ? `${def.name} (현재 덱 마스터 · 좌클릭: 선택 · 우클릭: 변경)`
        : `${def.name} (좌클릭: 선택 · 우클릭: 가방 이동)`;

      tileEl.innerHTML = `
        <div class="trunk-card-frame">
          ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.38, true)}
        </div>
      `;

      tileEl.addEventListener('mouseenter', () => {
        if (!editorSelectedTileKey) syncEditorInspectedCard(def, isDeckMaster);
      });

      // 왼쪽 클릭: 카드 선택 (상세/숙련도 편집 고정)
      tileEl.addEventListener('click', () => {
        audio.playLightTap();
        selectEditorTile(tileEl, tileKey, def, isDeckMaster);
      });

      // 오른쪽 클릭: 기존 왼쪽 클릭 동작 (덱 마스터 변경 모달 or 가방 이동)
      tileEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (isDeckMaster) {
          selectEditorTile(tileEl, tileKey, def, true);
          audio.playCardPickup();
          openDeckMasterPickerModal();
          return;
        }
        try {
          audio.playCardPickup();
          if (editorSelectedTileKey === tileKey) editorSelectedTileKey = null;
          engine.moveCardDeckToTrunk(cardId);
          renderCheckpointDeckEditorSubpage(engine.getSnapshot());
          syncEditorInspectedCard(def, false);
        } catch (err) {
          console.error(err);
        }
      });

      deckGrid.appendChild(tileEl);
    });
  }

  // 우측: 가방 (트렁크 - 통합 검색 필터링 + 정렬 압축 표시)
  const bagGrid = document.getElementById('editor-bag-cards-grid');
  if (bagGrid) {
    bagGrid.innerHTML = '';
    if (trunkCards.length === 0) {
      bagGrid.innerHTML = `
        <div style="color:#64748b; font-size:0.82rem; padding:40px 10px; text-align:center; grid-column:1/-1; line-height:1.6;">
          ${svgIcon('bag')} 가방이 비어 있습니다.<br>상점에서 부스터 팩이나 낱장 카드를 구매해 보세요.
        </div>
      `;
    } else if (filteredBagCards.length === 0) {
      bagGrid.innerHTML = `
        <div style="color:#64748b; font-size:0.82rem; padding:36px 10px; text-align:center; grid-column:1/-1; line-height:1.6;">
          ${svgIcon('search')} 검색 조건과 일치하는 카드가 없습니다.<br>
          <small style="opacity:0.8;">카드 이름, #태그, 키워드, 효과를 다시 확인해 주세요.</small>
        </div>
      `;
    } else {
      filteredBagCards.forEach((cardId, idx) => {
        const def = lookupCardDef(cardId);
        if (!def) return;

        const tileKey = `bag:${cardId}:${idx}`;
        const tileEl = document.createElement('div');
        tileEl.className = `trunk-card-tile ${editorSelectedTileKey === tileKey ? 'is-selected' : ''}`.trim();
        tileEl.title = `${def.name} (좌클릭: 선택 · 우클릭: 덱 편성)`;

        tileEl.innerHTML = `
          <div class="trunk-card-frame">
            ${generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.42, true)}
          </div>
        `;

        tileEl.addEventListener('mouseenter', () => {
          if (!editorSelectedTileKey) syncEditorInspectedCard(def, false);
        });

        // 왼쪽 클릭: 카드 선택 (상세/숙련도 편집 고정)
        tileEl.addEventListener('click', () => {
          audio.playLightTap();
          selectEditorTile(tileEl, tileKey, def, false);
        });

        // 오른쪽 클릭: 기존 왼쪽 클릭 동작 (덱으로 편성)
        tileEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          try {
            audio.playCardPlayImpact();
            if (editorSelectedTileKey === tileKey) editorSelectedTileKey = null;
            engine.moveCardTrunkToDeck(cardId);
            renderCheckpointDeckEditorSubpage(engine.getSnapshot());
            syncEditorInspectedCard(def, false);
          } catch (err) {
            console.error(err);
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
  syncEditorCosmeticsUi();
}

function syncEditorCosmeticsUi() {
  const sleeveSel = document.getElementById('sel-editor-sleeve-preset');
  const sleevePreview = document.getElementById('editor-sleeve-preview');
  const sleeveCustomBtn = document.getElementById('btn-editor-sleeve-custom');
  const matSel = document.getElementById('sel-editor-mat-preset');
  const matPreview = document.getElementById('editor-mat-preview');

  if (sleeveSel) {
    sleeveSel.value = SLEEVE_PRESETS[cosmeticsConfig.sleevePreset]
      ? cosmeticsConfig.sleevePreset
      : 'DEFAULT';
  }
  if (sleevePreview) {
    sleevePreview.innerHTML = generateCardBackHtml(0.24, { usePlayerCosmetic: true });
  }
  if (sleeveCustomBtn) {
    sleeveCustomBtn.hidden = cosmeticsConfig.sleevePreset !== 'CUSTOM';
  }

  if (matSel) {
    if (matSel.options.length !== Object.keys(MAT_PRESETS).length) {
      matSel.innerHTML = Object.values(MAT_PRESETS)
        .map((m) => `<option value="${m.id}">${m.label}</option>`)
        .join('');
    }
    matSel.value = MAT_PRESETS[cosmeticsConfig.matPreset]
      ? cosmeticsConfig.matPreset
      : 'GRAY_SOLID';
  }
  if (matPreview) {
    const mat = MAT_PRESETS[cosmeticsConfig.matPreset] || MAT_PRESETS.GRAY_SOLID;
    matPreview.style.backgroundImage = mat.image ? `url("${mat.image}")` : 'none';
    matPreview.style.backgroundColor = mat.color;
    matPreview.style.borderColor = `${mat.borderTop} ${mat.borderBottom} ${mat.borderBottom} ${mat.borderTop}`;
  }

  applyDuelCosmetics(cosmeticsConfig);
}

document.getElementById('sel-editor-sleeve-preset')?.addEventListener('change', (e) => {
  const next = e.target.value;
  cosmeticsConfig.sleevePreset = SLEEVE_PRESETS[next] ? next : 'DEFAULT';
  saveCosmeticsConfig(cosmeticsConfig);
  audio.playCardPickup();
  syncEditorCosmeticsUi();
});

document.getElementById('btn-editor-sleeve-custom')?.addEventListener('click', () => {
  audio.playCardPickup();
  openCustomSleeveModal();
});

document.getElementById('sel-editor-mat-preset')?.addEventListener('change', (e) => {
  const next = e.target.value;
  cosmeticsConfig.matPreset = MAT_PRESETS[next] ? next : 'GRAY_SOLID';
  saveCosmeticsConfig(cosmeticsConfig);
  audio.playCardPickup();
  syncEditorCosmeticsUi();
});

// ================= 커스텀 카드 슬리브 빌더 모달 =================
let draftCustomSleeve = null;

function renderCustomSleevePreviews() {
  if (!draftCustomSleeve) return;
  const uri = buildCustomSleeveSvgDataUri(draftCustomSleeve);
  const liveBox = document.getElementById('custom-sleeve-live-preview');
  const miniBox = document.getElementById('custom-sleeve-mini-preview');
  const html = `
    <div class="card-composite-wrapper card-back-wrapper" data-sleeve="CUSTOM">
      <div class="card-back-inner">
        <img src="${uri}" class="card-back-svg-img" alt="커스텀 슬리브" draggable="false" />
      </div>
    </div>
  `;
  if (liveBox) liveBox.innerHTML = html;
  if (miniBox) miniBox.innerHTML = html;
}

function buildCustomSleeveDialsUi() {
  const grid = document.getElementById('custom-sleeve-dials-grid');
  if (!grid || !draftCustomSleeve) return;
  const dialDefs = [
    { key: 'c1', label: '색깔 1 · 배경' },
    { key: 'c2', label: '색깔 2 · 테두리' },
    { key: 'c3', label: '색깔 3 · 문양 1' },
    { key: 'c4', label: '색깔 4 · 문양 2' },
  ];

  grid.innerHTML = dialDefs.map(({ key, label }) => {
    const c = draftCustomSleeve[key];
    const cssColor = dialColorToCss(c);
    return `
      <div class="cs-dial-card" data-dial-key="${key}">
        <div class="cs-dial-head">
          <span class="cs-dial-title">${label}</span>
          <span class="cs-dial-swatch" style="background:${cssColor};" title="${cssColor}"></span>
        </div>
        <div class="cs-dial-body">
          <div class="cs-hue-wheel" data-wheel-key="${key}" title="드래그하여 색조 회전">
            <div class="cs-hue-needle" style="transform: rotate(${c.h}deg);"></div>
            <div class="cs-hue-center" style="background:${cssColor};">${c.h}°</div>
          </div>
          <div class="cs-sliders-col">
            <label class="cs-slider-row">
              <span>색조</span>
              <input type="range" class="cs-hue-range" data-hue-key="${key}" min="0" max="359" value="${c.h}" />
            </label>
            <label class="cs-slider-row">
              <span>채도</span>
              <input type="range" class="cs-sat-range" data-sat-key="${key}" min="0" max="100" value="${c.s}" />
            </label>
            <label class="cs-slider-row">
              <span>명도</span>
              <input type="range" class="cs-lum-range" data-lum-key="${key}" min="10" max="88" value="${c.l}" />
            </label>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const syncSingleDialVisual = (key) => {
    const c = draftCustomSleeve[key];
    const cssColor = dialColorToCss(c);
    const card = grid.querySelector(`.cs-dial-card[data-dial-key="${key}"]`);
    if (!card) return;
    const swatch = card.querySelector('.cs-dial-swatch');
    const needle = card.querySelector('.cs-hue-needle');
    const center = card.querySelector('.cs-hue-center');
    const hueInput = card.querySelector('.cs-hue-range');
    if (swatch) { swatch.style.background = cssColor; swatch.title = cssColor; }
    if (needle) needle.style.transform = `rotate(${c.h}deg)`;
    if (center) { center.style.background = cssColor; center.textContent = `${c.h}°`; }
    if (hueInput && Number(hueInput.value) !== c.h) hueInput.value = String(c.h);
    renderCustomSleevePreviews();
  };

  grid.querySelectorAll('.cs-hue-wheel').forEach((wheelEl) => {
    const key = wheelEl.dataset.wheelKey;
    const applyPointerAngle = (clientX, clientY) => {
      const rect = wheelEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const deg = (Math.round(Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90) + 360) % 360;
      draftCustomSleeve[key].h = deg;
      syncSingleDialVisual(key);
    };
    wheelEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      wheelEl.setPointerCapture?.(e.pointerId);
      applyPointerAngle(e.clientX, e.clientY);
      const onMove = (ev) => applyPointerAngle(ev.clientX, ev.clientY);
      const onUp = () => {
        wheelEl.removeEventListener('pointermove', onMove);
        wheelEl.removeEventListener('pointerup', onUp);
        wheelEl.removeEventListener('pointercancel', onUp);
      };
      wheelEl.addEventListener('pointermove', onMove);
      wheelEl.addEventListener('pointerup', onUp);
      wheelEl.addEventListener('pointercancel', onUp);
    });
  });

  grid.querySelectorAll('.cs-hue-range').forEach((inp) => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.hueKey;
      draftCustomSleeve[key].h = Number(inp.value) || 0;
      syncSingleDialVisual(key);
    });
  });
  grid.querySelectorAll('.cs-sat-range').forEach((inp) => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.satKey;
      draftCustomSleeve[key].s = Number(inp.value) || 0;
      syncSingleDialVisual(key);
    });
  });
  grid.querySelectorAll('.cs-lum-range').forEach((inp) => {
    inp.addEventListener('input', () => {
      const key = inp.dataset.lumKey;
      draftCustomSleeve[key].l = Number(inp.value) || 50;
      syncSingleDialVisual(key);
    });
  });
}

function populateCustomSleevePartSelects() {
  const map = [
    { id: 'sel-cs-bg-pattern', key: 'bgPattern' },
    { id: 'sel-cs-border-style', key: 'borderStyle' },
    { id: 'sel-cs-emblem1', key: 'emblem1' },
    { id: 'sel-cs-emblem2', key: 'emblem2' },
  ];
  map.forEach(({ id, key }) => {
    const sel = document.getElementById(id);
    if (!sel || !draftCustomSleeve) return;
    if (sel.options.length === 0) {
      sel.innerHTML = CUSTOM_SLEEVE_OPTIONS[key]
        .map((opt) => `<option value="${opt.id}">${opt.label}</option>`)
        .join('');
      sel.addEventListener('change', () => {
        if (!draftCustomSleeve) return;
        draftCustomSleeve[key] = sel.value;
        audio.playLightTap();
        renderCustomSleevePreviews();
      });
    }
    sel.value = draftCustomSleeve[key];
  });
}

function openCustomSleeveModal() {
  const modal = document.getElementById('modal-custom-sleeve');
  if (!modal) return;
  draftCustomSleeve = normalizeCustomSleeve(cosmeticsConfig.customSleeve);
  populateCustomSleevePartSelects();
  buildCustomSleeveDialsUi();
  renderCustomSleevePreviews();
  openModalWithCrt(modal, { mode: 'hidden' });
}

function closeCustomSleeveModal() {
  closeModalWithCrt(document.getElementById('modal-custom-sleeve'), { mode: 'hidden' });
}

document.getElementById('btn-close-custom-sleeve')?.addEventListener('click', closeCustomSleeveModal);
document.getElementById('btn-cs-cancel')?.addEventListener('click', closeCustomSleeveModal);
document.getElementById('custom-sleeve-backdrop')?.addEventListener('click', closeCustomSleeveModal);

document.getElementById('btn-cs-reset')?.addEventListener('click', () => {
  draftCustomSleeve = normalizeCustomSleeve(DEFAULT_CUSTOM_SLEEVE);
  populateCustomSleevePartSelects();
  buildCustomSleeveDialsUi();
  renderCustomSleevePreviews();
  audio.playLightTap();
});

document.getElementById('btn-cs-apply')?.addEventListener('click', () => {
  if (draftCustomSleeve) {
    cosmeticsConfig.customSleeve = normalizeCustomSleeve(draftCustomSleeve);
    cosmeticsConfig.sleevePreset = 'CUSTOM';
    saveCosmeticsConfig(cosmeticsConfig);
    audio.playCardPlayImpact();
    syncEditorCosmeticsUi();
  }
  closeCustomSleeveModal();
});

let currentEditorInspectedCardId = null;

function syncEditorInspectedCard(def, isDeckMaster = false) {
  if (!def) return;
  currentEditorInspectedCardId = def.id;
  updateCardInspector(def, null, null, { isDeckMaster });

  const entry = binder?.entries?.[def.id] || null;
  const pts = entry?.masteryPoints || 0;
  const state = entry?.state || 0;
  const tier = getMasteryTierFromPoints(pts, state);
  const tierLabel = MASTERY_TIER_META[tier]?.shortLabel || '미숙련';
  const nextUnlock = getNextMasteryUnlockInfo(pts, state);

  const labelEl = document.getElementById('editor-mastery-card-label');
  const progressEl = document.getElementById('editor-mastery-progress-info');
  const selEl = document.getElementById('sel-editor-card-mastery-fx');

  if (labelEl) labelEl.textContent = def.name;
  if (progressEl) {
    progressEl.textContent = nextUnlock.nextMilestone
      ? `${nextUnlock.currentPoints}pt (${tierLabel}) · ${nextUnlock.nextPresetLabel} 해금까지 ${nextUnlock.remainingPoints}pt`
      : `${nextUnlock.currentPoints}pt (마스터) · 모든 이펙트 해금 완료`;
  }
  if (selEl) {
    const override = masteryFxConfig.cardOverrides?.[def.id];
    const desired = override && override.preset ? override.preset : 'DEFAULT';
    populateMasteryPresetSelect(selEl, pts, state, { allowDefault: true, currentValue: desired });
  }
}

document.getElementById('sel-editor-card-mastery-fx')?.addEventListener('change', (e) => {
  if (!currentEditorInspectedCardId) return;
  const preset = e.target.value;
  const entry = binder?.entries?.[currentEditorInspectedCardId] || null;
  const pts = entry?.masteryPoints || 0;
  const state = entry?.state || 0;

  if (preset !== 'DEFAULT' && !isMasteryPresetUnlocked(preset, pts, state)) {
    audio.playLightTap();
    const def = lookupCardDef(currentEditorInspectedCardId);
    if (def) syncEditorInspectedCard(def, def.id === engine.getSnapshot().playerDeckMasterCardId);
    return;
  }

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
  editorSelectedTileKey = null;
  currentEditorInspectedCardId = null;
  deckEditorFilterState.query = '';
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
  saveRunNow();
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
      closeModalWithCrt(modalEl, { mode: 'active' });
      applyDeckMasterChange(targetId);
    });
  });

  openModalWithCrt(modalEl, { mode: 'active' });
}

document.getElementById('btn-change-deckmaster')?.addEventListener('click', () => {
  audio.playCardPickup();
  openDeckMasterPickerModal();
});

document.getElementById('btn-close-deckmaster-modal')?.addEventListener('click', () => {
  audio.playLightTap();
  closeModalWithCrt(document.getElementById('modal-deckmaster-select'), { mode: 'active' });
});

document.getElementById('modal-deckmaster-select')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-deckmaster-select') {
    closeModalWithCrt(e.target, { mode: 'active' });
  }
});

// ============================================================================
// 체크포인트 허브 & 서브페이지 이벤트 리스너 바인딩
// ============================================================================
// 허브에서 서브페이지로 이동
document.getElementById('btn-checkpoint-nav-shop')?.addEventListener('click', () => {
  audio.playCardPickup();
  clearShopTiredReaction();
  hidePackOpeningResultBanner();
  if (engine?.state) {
    engine.state.shopVisitedRound = engine.state.roundNumber || 1;
    saveRunNow();
  }
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
  hidePackOpeningResultBanner();
  switchView('VIEW_CHECKPOINT');
  renderCheckpointView(engine.getSnapshot());
});

document.getElementById('btn-merchant-back-hub')?.addEventListener('click', () => {
  audio.playCardPickup();
  hideLogCardHoverPreview();
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
  hidePackOpeningResultBanner();
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
    saveRunNow();
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
  hideLogCardHoverPreview();
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
    badgeEl.innerHTML = svgIcon('whiteSkull');
    titleEl.textContent = 'DEFEAT';
    titleEl.style.color = '#f87171';
    if (snap.lastDefeatInfo?.wasBoss) {
      descEl.textContent = isSeeded
        ? '최종 보스에게 패배하여 여정이 즉시 종료되었습니다. (시드 런 · 기록 제외)'
        : '최종 보스에게 패배하여 여정이 즉시 종료되었습니다.';
    } else {
      descEl.textContent = isSeeded
        ? '기회 3회를 모두 소진하여 여정이 종료되었습니다. (시드 런 · 기록 제외)'
        : '기회 3회를 모두 소진하여 여정이 종료되었습니다.';
    }
  }

  const summaryChancesEl = document.getElementById('summary-chances-badge');
  if (summaryChancesEl) {
    const rem = snap.remainingChances ?? 0;
    const max = snap.maxChances ?? 3;
    summaryChancesEl.innerHTML = `<span>남은 기회</span> ${renderChancesHeartsHtml(rem, max)}`;
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
  sortDeckMasterFirst(snap.playerDeckCardIds, snap.playerDeckMasterCardId).forEach((cardId) => {
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
  switchView('VIEW_TITLE_LOBBY', { direction: 'back' });
});

// ============================================================================
// 7-B. 전체 덱 보기 팝업 & 클립보드 이미지 캡처
// ============================================================================
let currentDeckOverviewState = {
  cardIds: [],
  deckMasterCardId: null,
  title: '전체 덱 보기',
};

function loadImageForCanvas(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function fitCanvasText(ctx, text, maxW) {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxW) return s;
  let trimmed = s;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxW) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function openDeckOverviewModal({ cardIds = [], deckMasterCardId = null, title = getPlayerDeckName() } = {}) {
  const modal = document.getElementById('modal-deck-overview');
  const titleEl = document.getElementById('deck-overview-title');
  const statsEl = document.getElementById('deck-overview-stats');
  const statusEl = document.getElementById('deck-overview-status');
  const gridEl = document.getElementById('deck-overview-grid');
  if (!modal || !gridEl) return;

  const list = sortDeckMasterFirst(cardIds, deckMasterCardId);
  currentDeckOverviewState = {
    cardIds: list,
    deckMasterCardId: deckMasterCardId || null,
    title: String(title || getPlayerDeckName()),
  };

  if (titleEl) {
    titleEl.innerHTML = `${svgIcon('scroll')} ${title}`;
  }
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.classList.remove('is-warn');
  }

  let monsterCount = 0;
  let spellCount = 0;
  list.forEach((cid) => {
    const def = lookupCardDef(cid);
    if (!def) return;
    if (def.type === 'SPELL') spellCount += 1;
    else monsterCount += 1;
  });
  const masterDef = deckMasterCardId ? lookupCardDef(deckMasterCardId) : null;
  if (statsEl) {
    const masterTxt = masterDef ? ` · 덱 마스터: ${masterDef.name}` : '';
    statsEl.textContent = `총 ${list.length}장 (몬스터 ${monsterCount} / 마법 ${spellCount})${masterTxt}`;
  }

  gridEl.innerHTML = '';
  list.forEach((cardId) => {
    const def = lookupCardDef(cardId);
    if (!def) return;
    const isMaster = Boolean(deckMasterCardId && cardId === deckMasterCardId);
    const slot = document.createElement('div');
    slot.className = `card-slot ${isMaster ? 'is-deckmaster' : ''}`;
    slot.title = def.name;
    slot.innerHTML = generateCompositeCardHtml(def, def.attack, def.defense ?? def.health, 0.44, true);
    slot.addEventListener('mouseenter', () => updateCardInspector(def, null, null, { isDeckMaster: isMaster }));
    slot.addEventListener('click', () => {
      audio.playCardPickup();
      updateCardInspector(def, null, null, { isDeckMaster: isMaster });
    });
    gridEl.appendChild(slot);
  });

  openModalWithCrt(modal, { mode: 'hidden' });
}

async function captureDeckOverviewToClipboard() {
  const statusEl = document.getElementById('deck-overview-status');
  const btn = document.getElementById('btn-capture-deck-clipboard');
  const { cardIds = [], deckMasterCardId = null, title = '전체 덱 보기' } = currentDeckOverviewState;
  if (!cardIds.length) {
    if (statusEl) {
      statusEl.textContent = '캡처할 카드가 없습니다.';
      statusEl.classList.add('is-warn');
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.textContent = '덱 이미지 생성 중...';
    statusEl.classList.remove('is-warn');
  }

  try {
    const cols = 5;
    const rows = Math.max(1, Math.ceil(cardIds.length / cols));
    const padOuter = 14;
    const headerH = 38;
    const toolbarH = 40;
    const padGrid = 10;
    const gap = 8;
    const cardW = 152;
    const cardH = Math.round(cardW * (560 / 400)); // exact 400:560 aspect (213px)
    const gridW = cols * cardW + (cols - 1) * gap + padGrid * 2;
    const gridH = rows * cardH + (rows - 1) * gap + padGrid * 2;
    const canvasW = padOuter * 2 + gridW;
    const canvasH = headerH + 10 + toolbarH + 10 + gridH + padOuter;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    // W2K outer dialog frame (#d4d0c8)
    ctx.fillStyle = '#d4d0c8';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
    ctx.strokeStyle = '#404040';
    ctx.beginPath();
    ctx.moveTo(canvasW - 1, 1);
    ctx.lineTo(canvasW - 1, canvasH - 1);
    ctx.lineTo(1, canvasH - 1);
    ctx.stroke();

    // W2K active caption strip
    const headerGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
    headerGrad.addColorStop(0, '#0a246a');
    headerGrad.addColorStop(0.58, '#2b6ed3');
    headerGrad.addColorStop(1, '#7ac4fa');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(4, 4, canvasW - 8, headerH - 4);

    const uiFontStack = document.body.dataset.uiFont === 'win2k-retro'
      ? '"DuelRogueFixedsys", "DuelRogueRetroKR", monospace'
      : '"Tahoma", "Noto Sans KR", sans-serif';
    const cardNameFont = '"Noto Serif KR", "Cinzel", "Noto Sans KR", serif';
    const cardStatFont = '"Cinzel", "Noto Serif KR", serif';

    ctx.fillStyle = '#ffffff';
    ctx.font = `900 18px ${uiFontStack}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 16, 4 + (headerH - 4) * 0.5);

    // Toolbar strip matching #modal-deck-overview
    const tbY = headerH + 10;
    ctx.fillStyle = '#e6e3dc';
    ctx.fillRect(padOuter, tbY, gridW, toolbarH);
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 1;
    ctx.strokeRect(padOuter + 0.5, tbY + 0.5, gridW - 1, toolbarH - 1);

    let monsterCount = 0;
    let spellCount = 0;
    cardIds.forEach((cid) => {
      const def = lookupCardDef(cid);
      if (!def) return;
      if (def.type === 'SPELL') spellCount += 1;
      else monsterCount += 1;
    });
    const masterDef = deckMasterCardId ? lookupCardDef(deckMasterCardId) : null;
    ctx.fillStyle = '#0a246a';
    ctx.font = `800 15px ${uiFontStack}`;
    ctx.fillText(
      `총 ${cardIds.length}장 (몬스터 ${monsterCount} / 마법 ${spellCount})${masterDef ? ` · 덱 마스터: ${masterDef.name}` : ''}`,
      padOuter + 12,
      tbY + toolbarH * 0.5
    );
    ctx.fillStyle = '#475569';
    ctx.font = `700 13px ${uiFontStack}`;
    ctx.textAlign = 'right';
    ctx.fillText('DUEL ROGUE', padOuter + gridW - 12, tbY + toolbarH * 0.5);
    ctx.textAlign = 'left';

    // Recessed grid box (#f1efe9)
    const gridX = padOuter;
    const gridY = tbY + toolbarH + 10;
    ctx.fillStyle = '#f1efe9';
    ctx.fillRect(gridX, gridY, gridW, gridH);
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 2;
    ctx.strokeRect(gridX, gridY, gridW, gridH);

    // Inline SVG data URLs matching generateClawLevelHtml strokes
    const clawSingleDataUri = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 44"><g transform="rotate(16, 12, 22)"><path d="M 9,1 C 11,8 15,18 16,30 C 16.5,36 14,41 12,43 C 9,41 7,37 6,32 C 4,24 4,12 7,3 Z" fill="#ffeded" opacity="0.92"/><path d="M 10,3 C 12,9 15,19 15,29 C 15.5,35 13.5,39 12,41 C 9.5,39 8,35 7,30 C 5.5,23 5.5,13 8,5 Z" fill="#b51726"/><path d="M 10,6 C 12.5,16 13,26 11,38" stroke="#1f0205" stroke-width="2.4" stroke-linecap="round" fill="none"/></g></svg>')}`;
    const clawCrossDataUri = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 74 44"><g><path d="M 2,34 C 16,28 38,18 71,7 C 73,9 71,13 68,14 C 42,23 20,33 4,39 Z" fill="#ffeded" opacity="0.88"/><path d="M 4,33 C 18,27 40,17 69,9 C 69,11 67,13 65,14 C 41,22 21,31 6,37 Z" fill="#cc1e30"/><path d="M 5,34 C 24,25 46,15 67,10" stroke="#1f0205" stroke-width="2.5" stroke-linecap="round" fill="none"/></g></svg>')}`;

    const assetSet = new Set([
      'assets/frames/card_frame_unit_blank.svg',
      'assets/frames/card_frame_spell_blank.svg',
      'assets/placeholders/procedural_fallback.svg',
      clawSingleDataUri,
      clawCrossDataUri,
    ]);
    cardIds.forEach((cid) => {
      const def = lookupCardDef(cid);
      if (def) assetSet.add(getCardArtSrc(def, { compact: true }));
    });
    const loadedEntries = await Promise.all(
      Array.from(assetSet).map(async (src) => [src, await loadImageForCanvas(src)])
    );
    const imgCache = new Map(loadedEntries);
    const clawSingleImg = imgCache.get(clawSingleDataUri);
    const clawCrossImg = imgCache.get(clawCrossDataUri);

    const RARITY_BORDER = {
      COMMON: null,
      RARE: '#38bdf8',
      EPIC: '#f59e0b',
      UNIQUE: '#a855f7',
      LEGEND: '#facc15',
    };

    cardIds.forEach((cardId, idx) => {
      const def = lookupCardDef(cardId);
      if (!def) return;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = gridX + padGrid + col * (cardW + gap);
      const y = gridY + padGrid + row * (cardH + gap);
      const isMonster = def.type === 'MONSTER' || (def.attack > 0 && def.type !== 'SPELL');
      const isMaster = Boolean(deckMasterCardId && cardId === deckMasterCardId);
      const rarityKey = normalizeRarityKey(def.rarity);
      const rCfg = rarityConfig?.[rarityKey];
      const rarityPreset = rCfg?.preset || 'NONE';

      // Optional deckmaster frame border (카드 외곽 레어도 오오라 제거)
      if (isMaster) {
        ctx.save();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.4;
        drawRoundedRectPath(ctx, x - 1, y - 1, cardW + 2, cardH + 2, 7);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      drawRoundedRectPath(ctx, x, y, cardW, cardH, 6);
      ctx.clip();

      // Layer 1: Art inside SVG window (x:22..378, y:70..420 in 400x560)
      const artX = x + cardW * (22 / 400);
      const artY = y + cardH * (70 / 560);
      const artW = cardW * (356 / 400);
      const artH = cardH * (350 / 560);
      ctx.fillStyle = '#090e1a';
      ctx.fillRect(artX, artY, artW, artH);

      const artSrc = getCardArtSrc(def, { compact: true });
      const artImg = imgCache.get(artSrc);
      if (artImg) {
        ctx.drawImage(artImg, artX, artY, artW, artH);
      }

      // Procedural archetype pill top-right inside art when not custom hero art
      if (!artSrc.includes('assets/cards/')) {
        const factionLabel = def.faction ? t(`faction.${def.faction}`) : (def.archetype || '');
        if (factionLabel) {
          ctx.font = `800 9px ${uiFontStack}`;
          const tw = ctx.measureText(factionLabel).width;
          const pw = tw + 10;
          const ph = 15;
          const px = artX + artW - pw - 5;
          const py = artY + 5;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          drawRoundedRectPath(ctx, px, py, pw, ph, 4);
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#38bdf8';
          ctx.textBaseline = 'middle';
          ctx.fillText(factionLabel, px + 5, py + ph * 0.5 + 0.5);
        }
      }

      // Layer 2: Unobscured SVG frame (leaves carved cream nameplate & stat boxes clean)
      const frameSrc = isMonster
        ? 'assets/frames/card_frame_unit_blank.svg'
        : 'assets/frames/card_frame_spell_blank.svg';
      const frameImg = imgCache.get(frameSrc);
      if (frameImg) {
        ctx.drawImage(frameImg, x, y, cardW, cardH);
      }

      // Layer 3: Header Name & Claw Level (inside x:30..374, y:14..64 of 400x560)
      const lv = Math.max(1, Number(def.level ?? def.cost ?? 1));
      const barLeft = x + cardW * (28 / 400);
      const barRight = x + cardW * (372 / 400);
      const barMidY = y + cardH * (39 / 560);
      let clawTotalW = 0;

      if (isMonster && clawSingleImg) {
        const bundles = Math.ceil(lv / 5);
        const clawH = cardH * (26 / 560);
        const strokeW = clawH * (24 / 44) * 0.68;
        const stepX = strokeW * 0.65;
        const bundleGap = 3;
        let bundleWidths = [];
        let rem = lv;
        for (let b = 0; b < bundles; b++) {
          const n = Math.min(rem, 5);
          const v = Math.min(n, 4);
          bundleWidths.push(Math.max(strokeW, (v - 1) * stepX + strokeW));
          rem -= n;
        }
        clawTotalW = bundleWidths.reduce((a, b) => a + b, 0) + Math.max(0, bundles - 1) * bundleGap + 4;
        let cursorX = barRight - clawTotalW + 2;
        rem = lv;
        for (let b = 0; b < bundles; b++) {
          const n = Math.min(rem, 5);
          const v = Math.min(n, 4);
          const bw = bundleWidths[b];
          for (let s = 0; s < v; s++) {
            ctx.drawImage(clawSingleImg, cursorX + s * stepX, barMidY - clawH * 0.5, strokeW, clawH);
          }
          if (n === 5 && clawCrossImg) {
            ctx.drawImage(clawCrossImg, cursorX - 2, barMidY - clawH * 0.48, bw + 6, clawH * 0.96);
          }
          cursorX += bw + bundleGap;
          rem -= n;
        }
      }

      const nameAvailW = Math.max(24, (barRight - barLeft) - clawTotalW - 2);
      ctx.save();
      ctx.font = `900 ${Math.round(cardW * 0.082)}px ${cardNameFont}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const rawNameW = Math.max(1, ctx.measureText(def.name).width);
      const squeezeX = rawNameW > nameAvailW ? Math.max(0.55, nameAvailW / rawNameW) : 1;
      ctx.translate(barLeft, barMidY + 0.5);
      ctx.scale(squeezeX, 1);
      if (rarityPreset !== 'NONE') {
        if ((rCfg?.nameGlow ?? 0) > 0) {
          ctx.shadowColor = rCfg?.accentColor || RARITY_BORDER[rarityKey] || '#facc15';
          ctx.shadowBlur = Math.max(1, (rCfg?.nameGlow ?? 0) * 3.5);
        }
        ctx.fillStyle = rCfg?.nameColor || (isMonster ? '#110903' : '#033d2e');
      } else {
        ctx.fillStyle = isMonster ? '#110903' : '#033d2e';
      }
      ctx.fillText(def.name, 0, 0);
      ctx.restore();

      // Layer 3 Bottom: Monster ATK & DEF inside SVG stat slots (x:24..192 & 208..376, y:430..542)
      if (isMonster) {
        const atk = def.attack ?? 0;
        const hp = def.defense ?? def.health ?? 0;
        const statY = y + cardH * (487 / 560);
        const atkX = x + cardW * (108 / 400);
        const defX = x + cardW * (292 / 400);
        ctx.font = `900 ${Math.round(cardW * 0.195)}px ${cardStatFont}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(String(atk), atkX, statY);
        ctx.fillStyle = '#8c1d22';
        ctx.fillText(String(atk), atkX, statY);

        ctx.strokeText(String(hp), defX, statY);
        ctx.fillStyle = '#0c4a6e';
        ctx.fillText(String(hp), defX, statY);
        ctx.textAlign = 'left';
      }

      ctx.restore();
    });

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG_ENCODE_FAILED');

    let copiedImage = false;
    if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        copiedImage = true;
      } catch {
        copiedImage = false;
      }
    }

    if (copiedImage) {
      audio.playCardPlayImpact();
      if (statusEl) {
        statusEl.textContent = '클립보드에 덱 이미지가 복사되었습니다!';
        statusEl.classList.remove('is-warn');
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `duel-rogue-deck-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (statusEl) {
        statusEl.textContent = '덱 PNG 이미지로 다운로드되었습니다 (클립보드 미허용 환경)';
        statusEl.classList.add('is-warn');
      }
    }
  } catch (err) {
    console.warn('Deck capture failed:', err);
    if (statusEl) {
      statusEl.textContent = '덱 이미지 생성에 실패했습니다.';
      statusEl.classList.add('is-warn');
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.getElementById('btn-editor-deck-overview')?.addEventListener('click', () => {
  audio.playCardPickup();
  const snap = engine.getSnapshot();
  openDeckOverviewModal({
    cardIds: snap.playerDeckCardIds || [],
    deckMasterCardId: snap.playerDeckMasterCardId,
    title: getPlayerDeckName(),
  });
});

document.getElementById('btn-summary-deck-overview')?.addEventListener('click', () => {
  audio.playCardPickup();
  const snap = engine.getSnapshot();
  openDeckOverviewModal({
    cardIds: snap.playerDeckCardIds || [],
    deckMasterCardId: snap.playerDeckMasterCardId,
    title: getPlayerDeckName(),
  });
});

document.getElementById('btn-close-deck-overview')?.addEventListener('click', () => {
  audio.playLightTap();
  closeModalWithCrt(document.getElementById('modal-deck-overview'), { mode: 'hidden' });
});

document.getElementById('deck-overview-backdrop')?.addEventListener('click', () => {
  closeModalWithCrt(document.getElementById('modal-deck-overview'), { mode: 'hidden' });
});

document.getElementById('btn-capture-deck-clipboard')?.addEventListener('click', () => {
  captureDeckOverviewToClipboard();
});

// ============================================================================
// 8. OVERLAY_BINDER_BOOK (3×3 실물 바인더 북 & 컬렉터 아카이브)
// ============================================================================
let currentBinderSelectedCardId = null;

function toggleBinderModal() {
  if (overlayBinderBook.classList.contains('active')) {
    closeModalWithCrt(overlayBinderBook, { mode: 'active' });
  } else {
    openModalWithCrt(overlayBinderBook, { mode: 'active' });
    syncBinderMasteryControls();
    renderBinderPage(currentBinderPage);
  }
}

// 모달 배경 클릭 시 닫기
overlayBinderBook?.addEventListener('click', (e) => {
  if (e.target === overlayBinderBook) {
    closeModalWithCrt(overlayBinderBook, { mode: 'active' });
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

  // 4. 메타 배지 라인 (진영 · 레벨 · 레어도 / 키워드 / 태그 순)
  if (metaEl) {
    if (isUnknown) {
      metaEl.innerHTML = `<span class="meta-pill" style="background:#1e293b; color:#64748b;">정보: 미확인</span>`;
    } else {
      const factionMap = { BLUE: '정의', RED: '열의', PURPLE: '혼돈', NEUTRAL: '중립' };
      const factionStr = factionMap[def.faction] || '중립';
      const levelStr = isMonster ? `Lv.${def.level ?? def.cost ?? 1}` : '';
      const rarityHtml = def.rarity
        ? `<span class="badge-rarity rarity-${def.rarity}">${t(`rarity.${def.rarity}`)}</span>`
        : '';
      const kwIds = def.kw || [];
      const kwHtml = (def.keywords || []).map((kw, i) => (
        `<span class="meta-pill keyword" title="${kwIds[i] ? keywordDesc(kwIds[i]) : '핵심 키워드'}">${keywordIcon(kwIds[i] || kw)}${kw}</span>`
      )).join('');
      const nonKwTags = (def.tags || []).map((tg) => {
        const formatted = `#${String(tg).replace(/^#+/, '')}`;
        return `<span class="meta-pill tag">${formatted}</span>`;
      }).join('');
      metaEl.innerHTML = `
        <span class="meta-pill archetype">${factionStr}</span>
        ${levelStr ? `<span class="meta-pill level">${levelStr}</span>` : ''}
        ${rarityHtml}
        ${kwHtml}
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
      if (def.kw && def.kw.length > 0) {
        structuredDescHtml += `<div class="dossier-clause-line"><span class="clause-tag cond">[키워드]</span> ${def.kw.map((id) => `${keywordIcon(id)}<strong>${t(`kw.${id}`)}</strong> — ${keywordDesc(id)}`).join(' · ')}</div>`;
      }
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

  // 8. 바인더 선택 카드 개별 숙련도 이펙트 동기화 (숙련도 해금 게이트 동일 적용)
  const cardLabelEl = document.getElementById('binder-mastery-card-label');
  const cardProgressEl = document.getElementById('binder-mastery-progress-info');
  const cardSelEl = document.getElementById('sel-binder-card-mastery-preset');
  const cardPts = entry.masteryPoints || 0;
  const cardState = slot.state || 0;
  const cardTier = getMasteryTierFromPoints(cardPts, cardState);
  const cardTierLabel = MASTERY_TIER_META[cardTier]?.shortLabel || '미숙련';
  const nextUnlock = getNextMasteryUnlockInfo(cardPts, cardState);

  if (cardLabelEl) cardLabelEl.textContent = isUnknown ? '???' : def.name;
  if (cardProgressEl) {
    if (isUnknown) {
      cardProgressEl.textContent = '미발견 카드입니다. 카드를 발견하면 숙련도별 이펙트를 설정할 수 있습니다.';
    } else {
      cardProgressEl.textContent = nextUnlock.nextMilestone
        ? `${nextUnlock.currentPoints}pt (${cardTierLabel}) · ${nextUnlock.nextPresetLabel} 해금까지 ${nextUnlock.remainingPoints}pt`
        : `${nextUnlock.currentPoints}pt (마스터) · 모든 이펙트 해금 완료`;
    }
  }
  if (cardSelEl) {
    const override = masteryFxConfig.cardOverrides?.[def.id];
    const desired = override && override.preset ? override.preset : 'DEFAULT';
    populateMasteryPresetSelect(cardSelEl, cardPts, cardState, {
      allowDefault: true,
      currentValue: desired,
      disabledAll: isUnknown,
    });
  }
}

function syncBinderMasteryControls() {
  const tierSel = document.getElementById('sel-binder-mastery-tier');
  const presetSel = document.getElementById('sel-binder-mastery-preset');
  if (!tierSel || !presetSel) return;
  const tier = tierSel.value || 'MASTERED';
  const cfg = masteryFxConfig.tierDefaults?.[tier];
  const tierMinPts = MASTERY_TIER_META[tier]?.minPoints ?? 0;
  const tierState = tier === 'MASTERED' ? 3 : 2;
  populateMasteryPresetSelect(presetSel, tierMinPts, tierState, {
    allowDefault: false,
    currentValue: cfg?.preset || 'NONE',
  });
}

document.getElementById('sel-binder-mastery-tier')?.addEventListener('change', syncBinderMasteryControls);
document.getElementById('sel-binder-mastery-preset')?.addEventListener('change', (e) => {
  const tierSel = document.getElementById('sel-binder-mastery-tier');
  const tier = tierSel?.value || 'MASTERED';
  const preset = e.target.value;
  const tierMinPts = MASTERY_TIER_META[tier]?.minPoints ?? 0;
  const tierState = tier === 'MASTERED' ? 3 : 2;
  if (!isMasteryPresetUnlocked(preset, tierMinPts, tierState)) {
    audio.playLightTap();
    syncBinderMasteryControls();
    return;
  }
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

document.getElementById('sel-binder-card-mastery-preset')?.addEventListener('change', (e) => {
  if (!currentBinderSelectedCardId) return;
  const preset = e.target.value;
  const entry = binder?.entries?.[currentBinderSelectedCardId] || null;
  const pts = entry?.masteryPoints || 0;
  const state = entry?.state || 0;
  if (state === BinderCardState.UNKNOWN) {
    audio.playLightTap();
    return;
  }
  if (preset !== 'DEFAULT' && !isMasteryPresetUnlocked(preset, pts, state)) {
    audio.playLightTap();
    renderBinderPage(currentBinderPage, currentBinderSelectedCardId);
    return;
  }
  if (!masteryFxConfig.cardOverrides) masteryFxConfig.cardOverrides = {};
  if (preset === 'DEFAULT') {
    delete masteryFxConfig.cardOverrides[currentBinderSelectedCardId];
  } else {
    const info = MASTERY_FX_PRESETS[preset] || MASTERY_FX_PRESETS.NONE;
    masteryFxConfig.cardOverrides[currentBinderSelectedCardId] = {
      preset,
      glow: info.glow,
      foil: info.foil,
      tint: info.tint,
    };
  }
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
  if (!IS_DEBUG_TOOLS_ENABLED) return;
  const overlay = document.getElementById('overlay-slam-playground');
  const btnToggle = document.getElementById('btn-toggle-playground');
  const btnClose = document.getElementById('btn-close-playground');

  const openPlayground = () => {
    if (overlay) openModalWithCrt(overlay, { mode: 'active' });
    updatePlaygroundAttackerVisuals();
    updatePlaygroundTargetVisuals();
    logPlaygroundTelemetry('💥 내리치기 연출 테스트 룸 활성화됨: 원하는 수치를 조절하거나 프리셋을 클릭하세요.');
  };

  const closePlayground = () => {
    if (overlay) closeModalWithCrt(overlay, { mode: 'active' });
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

// 초기화: 빈 CRT 로딩 화면 상태에서 벡터·슬리브·초기 리소스를 모두 굽고 로비 화면 진입
switchView('VIEW_TITLE_LOBBY', { forceLoading: true });

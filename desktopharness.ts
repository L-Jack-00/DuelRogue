/**
 * @file desktopHarness.ts
 * @description Tauri v2 데스크톱 최적화 및 브라우저 개입 원천 차단 하네스 (기둥 6)
 * - 우클릭 컨텍스트 메뉴, F5/Ctrl+R 새로고침, Ctrl+휠 줌, 텍스트 드래그 하이라이트 원천 차단
 * - HTML5 Drag 대신 Pointer Events + setPointerCapture 기반 창 외부 이탈 안전 카드 드래그 & 물리 틸트(Tilt)
 * - 커스텀 다크 타이틀바(최소화/최대화/닫기 및 창 드래그) 어댑터
 */

export interface TiltTransformOutput {
  readonly rotateXDeg: number;
  readonly rotateYDeg: number;
  readonly glareXPercent: number;
  readonly glareYPercent: number;
  readonly translateX: number;
  readonly translateY: number;
}

export interface RectBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 순수 수학 함수: 포인터 좌표와 카드 경계 박스를 기반으로 3D 물리 틸트 각도 및 광택(Glare) 좌표를 계산합니다.
 * Headless 환경에서도 단위 테스트가 가능하도록 DOM 의존성을 분리했습니다.
 */
export function computeCardTiltTransform(
  pointerX: number,
  pointerY: number,
  cardRect: RectBounds,
  dragOriginX: number | null = null,
  dragOriginY: number | null = null,
  maxTiltDeg = 15
): TiltTransformOutput {
  const halfW = Math.max(1, cardRect.width / 2);
  const halfH = Math.max(1, cardRect.height / 2);
  const centerX = cardRect.left + halfW;
  const centerY = cardRect.top + halfH;

  const normX = Math.max(-1, Math.min(1, (pointerX - centerX) / halfW));
  const normY = Math.max(-1, Math.min(1, (pointerY - centerY) / halfH));

  const rotateXDeg = Number((-normY * maxTiltDeg).toFixed(2));
  const rotateYDeg = Number((normX * maxTiltDeg).toFixed(2));
  const glareXPercent = Number(((normX + 1) * 50).toFixed(1));
  const glareYPercent = Number(((normY + 1) * 50).toFixed(1));

  const translateX = dragOriginX !== null ? pointerX - dragOriginX : 0;
  const translateY = dragOriginY !== null ? pointerY - dragOriginY : 0;

  return {
    rotateXDeg,
    rotateYDeg,
    glareXPercent,
    glareYPercent,
    translateX,
    translateY,
  };
}

/**
 * 1. 브라우저 기본 개입 원천 차단기 (우클릭, 새로고침, 확대/축소, 텍스트 선택/네이티브 드래그 방어)
 */
export function installBrowserInterferenceGuard(targetWindow: Window): () => void {
  const blockEvent = (e: Event): void => {
    e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    const isReload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && key === 'r');
    const isBrowserZoom =
      (e.ctrlKey || e.metaKey) && (key === '+' || key === '-' || key === '=' || key === '0');
    const isDevSaveOrPrint = (e.ctrlKey || e.metaKey) && (key === 's' || key === 'p');

    if (isReload || isBrowserZoom || isDevSaveOrPrint) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
  };

  targetWindow.addEventListener('contextmenu', blockEvent, { capture: true });
  targetWindow.addEventListener('selectstart', blockEvent, { capture: true });
  targetWindow.addEventListener('dragstart', blockEvent, { capture: true });
  targetWindow.addEventListener('keydown', onKeyDown, { capture: true });
  targetWindow.addEventListener('wheel', onWheel, { passive: false, capture: true });

  return () => {
    targetWindow.removeEventListener('contextmenu', blockEvent, { capture: true });
    targetWindow.removeEventListener('selectstart', blockEvent, { capture: true });
    targetWindow.removeEventListener('dragstart', blockEvent, { capture: true });
    targetWindow.removeEventListener('keydown', onKeyDown, { capture: true });
    targetWindow.removeEventListener('wheel', onWheel, { capture: true });
  };
}

/**
 * 2. Pointer Events + setPointerCapture 기반 정밀 카드 드래그/틸트 컨트롤러
 * 마우스가 Tauri 창 밖으로 벗어나더라도 포인터 캡처를 유지하고, 해제/취소 시 즉시 안전 복원합니다.
 */
export interface CardPointerCallbacks {
  onTiltUpdate?: (cardId: string, transform: TiltTransformOutput) => void;
  onCardDrop?: (cardId: string, clientX: number, clientY: number) => void;
  onCardReset?: (cardId: string) => void;
}

export class SafeCardPointerController {
  private activePointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private readonly element: HTMLElement;
  private readonly cardId: string;
  private readonly callbacks: CardPointerCallbacks;

  constructor(element: HTMLElement, cardId: string, callbacks: CardPointerCallbacks) {
    this.element = element;
    this.cardId = cardId;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.element.style.touchAction = 'none';
    this.element.style.userSelect = 'none';

    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);
    this.element.addEventListener('lostpointercapture', this.handlePointerCancel);
    this.element.addEventListener('pointerleave', this.handlePointerLeave);
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // 좌클릭만 드래그 허용
    e.preventDefault();
    this.activePointerId = e.pointerId;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.element.setPointerCapture(e.pointerId);
    this.updateTransform(e.clientX, e.clientY, true);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const isDragging = this.activePointerId === e.pointerId;
    this.updateTransform(e.clientX, e.clientY, isDragging);
  };

  private handlePointerUp = (e: PointerEvent): void => {
    if (this.activePointerId !== e.pointerId) return;
    if (this.element.hasPointerCapture(e.pointerId)) {
      this.element.releasePointerCapture(e.pointerId);
    }
    this.activePointerId = null;
    this.callbacks.onCardDrop?.(this.cardId, e.clientX, e.clientY);
    this.resetCardVisual();
  };

  private handlePointerCancel = (): void => {
    if (this.activePointerId === null) return;
    this.activePointerId = null;
    this.resetCardVisual();
  };

  private handlePointerLeave = (): void => {
    if (this.activePointerId === null) {
      this.resetCardVisual();
    }
  };

  private updateTransform(clientX: number, clientY: number, isDragging: boolean): void {
    const rect = this.element.getBoundingClientRect();
    const tilt = computeCardTiltTransform(
      clientX,
      clientY,
      rect,
      isDragging ? this.dragStartX : null,
      isDragging ? this.dragStartY : null
    );

    this.element.style.setProperty('--card-tx', `${tilt.translateX}px`);
    this.element.style.setProperty('--card-ty', `${tilt.translateY}px`);
    this.element.style.setProperty('--card-rx', `${tilt.rotateXDeg}deg`);
    this.element.style.setProperty('--card-ry', `${tilt.rotateYDeg}deg`);
    this.element.style.setProperty('--glare-x', `${tilt.glareXPercent}%`);
    this.element.style.setProperty('--glare-y', `${tilt.glareYPercent}%`);
    this.callbacks.onTiltUpdate?.(this.cardId, tilt);
  }

  private resetCardVisual(): void {
    this.element.style.setProperty('--card-tx', '0px');
    this.element.style.setProperty('--card-ty', '0px');
    this.element.style.setProperty('--card-rx', '0deg');
    this.element.style.setProperty('--card-ry', '0deg');
    this.callbacks.onCardReset?.(this.cardId);
  }
}

/**
 * 3. 커스텀 다크 타이틀바 어댑터 (Tauri v2 Window API 및 웹 폴백 호환)
 */
export interface TauriWindowBridge {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export function mountCustomDarkTitlebar(
  container: HTMLElement,
  windowBridge: TauriWindowBridge
): void {
  container.innerHTML = `
    <header class="duel-rogue-titlebar" data-tauri-drag-region style="
      display:flex; align-items:center; justify-content:space-between;
      height:32px; padding:0 12px; background:#0b0e14; color:#e2e8f0;
      border-bottom:1px solid #1e293b; user-select:none; -webkit-app-region:drag;
    ">
      <div class="titlebar-brand" data-tauri-drag-region style="font-size:12px; font-weight:700; letter-spacing:0.08em;">
        DUEL ROGUE // TAURI v2 DESKTOP
      </div>
      <div class="titlebar-controls" style="display:flex; gap:6px; -webkit-app-region:no-drag;">
        <button id="tb-min" type="button" aria-label="Minimize" style="background:#1e293b; color:#cbd5e1; border:none; width:24px; height:20px; cursor:pointer;">_</button>
        <button id="tb-max" type="button" aria-label="Maximize" style="background:#1e293b; color:#cbd5e1; border:none; width:24px; height:20px; cursor:pointer;">□</button>
        <button id="tb-close" type="button" aria-label="Close" style="background:#7f1d1d; color:#fecaca; border:none; width:24px; height:20px; cursor:pointer;">×</button>
      </div>
    </header>
  `;

  container.querySelector('#tb-min')?.addEventListener('click', () => void windowBridge.minimize());
  container
    .querySelector('#tb-max')
    ?.addEventListener('click', () => void windowBridge.toggleMaximize());
  container.querySelector('#tb-close')?.addEventListener('click', () => void windowBridge.close());
}
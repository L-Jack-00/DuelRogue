/**
 * @file desktopHarness.js
 * @description Tauri v2 데스크톱 최적화 및 브라우저 개입 원천 차단 하네스 (기둥 6)
 * - 우클릭 컨텍스트 메뉴, F5/Ctrl+R 새로고침, Ctrl+휠 줌, 텍스트 드래그 하이라이트 원천 차단
 * - HTML5 Drag 대신 Pointer Events + setPointerCapture 기반 창 외부 이탈 안전 카드 드래그 & 물리 틸트(Tilt)
 * - 커스텀 다크 타이틀바 어댑터
 */

/**
 * 순수 수학 함수: 포인터 좌표와 카드 경계 박스를 기반으로 3D 물리 틸트 각도 및 광택(Glare) 좌표를 계산합니다.
 */
export function computeCardTiltTransform(
  pointerX,
  pointerY,
  cardRect,
  dragOriginX = null,
  dragOriginY = null,
  maxTiltDeg = 15
) {
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
export function installBrowserInterferenceGuard(targetWindow) {
  const blockEvent = (e) => {
    e.preventDefault();
  };

  const onKeyDown = (e) => {
    const key = e.key.toLowerCase();
    const isReload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && key === 'r');
    const isBrowserZoom =
      (e.ctrlKey || e.metaKey) && (key === '+' || key === '-' || key === '=' || key === '0');
    const isDevSaveOrPrint = (e.ctrlKey || e.metaKey) && (key === 's' || key === 'p');

    if (e.key === 'F1') {
      e.preventDefault();
      window.__TOGGLE_LIVE_TUNER?.();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      window.__SAVE_LIVE_TUNER?.();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      window.__TOGGLE_SLAM_PLAYGROUND?.();
      return;
    }

    if (isReload || isBrowserZoom || isDevSaveOrPrint) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onWheel = (e) => {
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
 * 2. Pointer Events + setPointerCapture 기반 정밀 카드 드래그/틸트 & 롱프레스 오라 컨트롤러
 */
export class SafeCardPointerController {
  constructor(element, cardId, cardDef, callbacks) {
    this.element = element;
    this.cardId = cardId;
    this.cardDef = cardDef;
    this.callbacks = callbacks || {};
    this.activePointerId = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.holdTimer = null;

    // 패 카드 중앙(50% 50%) 앵커 중심의 수직 속도 연동 피치 진동 물리 상태
    this.lastPointerY = null;
    this.lastPointerTime = null;
    this.wobbleX = 0;
    this.targetWobbleX = 0;
    this.wobbleRaf = null;

    // 코스트 비례 물리 매개변수 (코스트가 클수록 묵직하고 단단함, 낮을수록 촐랑거림)
    const cost = cardDef?.cost ?? 1;
    if (cost <= 1) {
      this.maxTilt = 20; // 가벼운 휘어짐
      this.costWeight = 1.0;
      this.element.classList.add('cost-light');
    } else if (cost === 2) {
      this.maxTilt = 14;
      this.costWeight = 0.72;
      this.element.classList.add('cost-medium');
    } else {
      this.maxTilt = 8; // 단단하고 묵직한 카드
      this.costWeight = 0.45;
      this.element.classList.add('cost-heavy');
    }

    this.bindEvents();
  }

  startWobbleLoop() {
    const loop = () => {
      if (this.activePointerId === null) return;
      // 스프링 완충 보간 (Spring interpolation toward target)
      this.wobbleX += (this.targetWobbleX - this.wobbleX) * 0.28;
      // 마우스가 정지하면 목표 각도를 점진적으로 0으로 수렴 감쇠
      this.targetWobbleX *= 0.86;

      this.element.style.setProperty('--wobble-rx', `${this.wobbleX.toFixed(2)}deg`);
      this.wobbleRaf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.wobbleRaf);
    this.wobbleRaf = requestAnimationFrame(loop);
  }

  stopWobbleLoop() {
    if (this.wobbleRaf) {
      cancelAnimationFrame(this.wobbleRaf);
      this.wobbleRaf = null;
    }
    this.wobbleX = 0;
    this.targetWobbleX = 0;
    this.element.style.setProperty('--wobble-rx', '0deg');
  }

  bindEvents() {
    this.element.style.touchAction = 'none';
    this.element.style.userSelect = 'none';

    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);
    this.element.addEventListener('lostpointercapture', this.handlePointerCancel);
    this.element.addEventListener('pointerleave', this.handlePointerLeave);
  }

  handlePointerDown = (e) => {
    if (e.button !== 0) return; // 좌클릭만 허용
    if (e.target.closest('.spell-action-popover')) return;
    e.preventDefault();
    this.activePointerId = e.pointerId;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.didDrag = false;
    this.lastPointerY = e.clientY;
    this.lastPointerTime = performance.now();
    this.element.setPointerCapture(e.pointerId);
    this.element.classList.add('is-dragging');

    // 수직 이동 진동 물리 루프 개시
    this.startWobbleLoop();

    // 마우스를 꾹 누르고 있는 중일 때 대상 카드 오라 발동 (롱프레스 감지)
    this.callbacks.onCardHoldStart?.(this.cardId, this.cardDef);
    this.holdTimer = setTimeout(() => {
      this.callbacks.onCardHoldStart?.(this.cardId, this.cardDef);
    }, 100);

    this.updateTransform(e.clientX, e.clientY, true);
  };

  handlePointerMove = (e) => {
    const isDragging = this.activePointerId === e.pointerId;
    if (isDragging) {
      if (!this.didDrag && Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) >= 8) {
        this.didDrag = true;
      }
      const now = performance.now();
      const dt = Math.max(1, now - (this.lastPointerTime || now));
      const dy = e.clientY - (this.lastPointerY ?? e.clientY);
      const vy = dy / dt; // pixels per ms
      this.lastPointerY = e.clientY;
      this.lastPointerTime = now;

      // 패 카드를 쥘 때 카드 중앙(50% 50%)을 중심으로 위아래가 흔들리는 효과
      // 위로 당길 때 윗부분이 뒤로 넘어가고, 아래로 당길 때 윗부분이 앞으로 숙여지는 관성 피치
      const maxW = 24 * this.costWeight;
      this.targetWobbleX = Math.max(-maxW, Math.min(maxW, -vy * 16 * this.costWeight));

      this.callbacks.onCardHoldStart?.(this.cardId, this.cardDef);
    }
    this.updateTransform(e.clientX, e.clientY, isDragging);
  };

  handlePointerUp = (e) => {
    if (this.activePointerId !== e.pointerId) return;
    if (this.element.hasPointerCapture(e.pointerId)) {
      this.element.releasePointerCapture(e.pointerId);
    }
    const didDrag = this.didDrag;
    this.activePointerId = null;
    this.didDrag = false;
    clearTimeout(this.holdTimer);
    this.stopWobbleLoop();
    this.element.classList.remove('is-dragging');
    if (didDrag) {
      this.element.dataset.suppressNextClick = '1';
      setTimeout(() => {
        delete this.element.dataset.suppressNextClick;
      }, 80);
    }
    this.callbacks.onCardHoldEnd?.(this.cardId);
    this.callbacks.onCardDrop?.(this.cardId, e.clientX, e.clientY, didDrag);
    this.resetCardVisual();
  };

  handlePointerCancel = () => {
    if (this.activePointerId === null) return;
    this.activePointerId = null;
    this.didDrag = false;
    clearTimeout(this.holdTimer);
    this.stopWobbleLoop();
    this.element.classList.remove('is-dragging');
    this.callbacks.onCardHoldEnd?.(this.cardId);
    this.resetCardVisual();
  };

  handlePointerLeave = () => {
    if (this.activePointerId === null) {
      clearTimeout(this.holdTimer);
      this.stopWobbleLoop();
      this.callbacks.onCardHoldEnd?.(this.cardId);
      this.resetCardVisual();
    }
  };

  updateTransform(clientX, clientY, isDragging) {
    const rect = this.element.getBoundingClientRect();
    const tilt = computeCardTiltTransform(
      clientX,
      clientY,
      rect,
      isDragging ? this.dragStartX : null,
      isDragging ? this.dragStartY : null,
      this.maxTilt
    );

    if (isDragging) {
      this.element.style.setProperty('--card-tx', `${tilt.translateX}px`);
      this.element.style.setProperty('--card-ty', `${tilt.translateY}px`);
      this.element.style.setProperty('--card-rx', '0deg');
      this.element.style.setProperty('--card-ry', '0deg');
    } else {
      this.element.style.setProperty('--card-tx', '0px');
      this.element.style.setProperty('--card-ty', '0px');
      this.element.style.setProperty('--card-rx', '0deg');
      this.element.style.setProperty('--card-ry', '0deg');
    }
    this.element.style.setProperty('--glare-x', `${tilt.glareXPercent}%`);
    this.element.style.setProperty('--glare-y', `${tilt.glareYPercent}%`);
    this.callbacks.onTiltUpdate?.(this.cardId, tilt, isDragging);
  }

  resetCardVisual() {
    this.stopWobbleLoop();
    this.element.style.setProperty('--card-tx', '0px');
    this.element.style.setProperty('--card-ty', '0px');
    this.element.style.setProperty('--card-rx', '0deg');
    this.element.style.setProperty('--card-ry', '0deg');
    this.element.style.setProperty('--wobble-rx', '0deg');
    this.callbacks.onCardReset?.(this.cardId);
  }
}

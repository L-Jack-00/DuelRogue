/*
  [LJack Pillar 6: 물리적 입력 안전망 & 브라우저 개입 100% 차단]
  Desktop Game Input Controller:
  - 우클릭 컨텍스트 메뉴 무력화
  - 브라우저 기본 단축키 (F5, Ctrl+R, Ctrl+F, Ctrl+W, Ctrl+P) 차단
  - 휠 줌 (Ctrl+Wheel) 차단
  - 텍스트/이미지 선택 및 기본 dragstart 차단
  - Pointer Events 기반 정밀 카드 드래그 & 물리 반응 (setPointerCapture)
*/

export class DesktopInputSafetyRig {
  constructor(options = {}) {
    this.onCardPlay = options.onCardPlay || (() => {});
    this.isDragging = false;
    this.activePointerId = null;
    this.draggedCard = null;
    this.startX = 0;
    this.startY = 0;
    this.dropZone = null;

    this.initBrowserLockdowns();
  }

  // 1. 브라우저 개입 원천 차단 (우클릭, 단축키, 선택, 기본 드래그)
  initBrowserLockdowns() {
    // 우클릭 방지
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    }, { capture: true });

    // 브라우저 단축키 가로채기 (F5, Ctrl+R, Ctrl+W, Ctrl+F, Ctrl+U 등)
    window.addEventListener('keydown', (e) => {
      const blockedKeys = ['F5', 'F3'];
      const ctrlBlocked = ['r', 'R', 'f', 'F', 'w', 'W', 'p', 'P', 'u', 'U', 's', 'S'];

      if (blockedKeys.includes(e.key) || (e.ctrlKey && ctrlBlocked.includes(e.key))) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }, { capture: true });

    // 휠 줌(Ctrl + Wheel) 차단
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    }, { passive: false });

    // 브라우저 기본 드래그(텍스트/이미지 잔상) 차단
    window.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    });

    // 전역 포인터 이탈 방지 자가 치유 (창 밖으로 나가거나 포커스 잃을 때 강제 해제)
    window.addEventListener('pointercancel', () => this.cancelDrag());
    window.addEventListener('blur', () => this.cancelDrag());
  }

  // 2. 포인터 기반 정밀 카드 드래그 시스템
  bindDraggableCard(cardEl, cardIndex, getFieldDropZone) {
    cardEl.addEventListener('pointerdown', (e) => {
      // 좌클릭만 허용
      if (e.button !== 0) return;

      this.isDragging = true;
      this.activePointerId = e.pointerId;
      this.draggedCard = cardEl;
      this.cardIndex = cardIndex;
      this.dropZone = getFieldDropZone();

      // 마우스가 카드를 벗어나도 끝까지 추적 (Stuck 방지)
      cardEl.setPointerCapture(e.pointerId);

      this.startX = e.clientX;
      this.startY = e.clientY;

      cardEl.classList.add('is-dragging');
      cardEl.style.zIndex = '9999';
    });

    cardEl.addEventListener('pointermove', (e) => {
      if (!this.isDragging || this.draggedCard !== cardEl) return;

      const deltaX = e.clientX - this.startX;
      const deltaY = e.clientY - this.startY;

      // 3D 가속 틸트 및 이동
      const tilt = Math.max(-20, Math.min(20, deltaX * 0.1));
      cardEl.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${tilt}deg) scale(1.15)`;

      // 드롭 영역 도달 시 시각 피드백
      if (this.dropZone) {
        const dropRect = this.dropZone.getBoundingClientRect();
        if (e.clientY < dropRect.bottom) {
          this.dropZone.classList.add('drop-target-active');
        } else {
          this.dropZone.classList.remove('drop-target-active');
        }
      }
    });

    const finishDrag = (e) => {
      if (!this.isDragging || this.draggedCard !== cardEl) return;

      if (cardEl.hasPointerCapture(e.pointerId)) {
        cardEl.releasePointerCapture(e.pointerId);
      }

      let played = false;
      if (this.dropZone) {
        const dropRect = this.dropZone.getBoundingClientRect();
        // 전장 영역으로 끌어올렸을 때 카드 발동 판정
        if (e.clientY < dropRect.bottom) {
          played = true;
          this.onCardPlay(this.cardIndex);
        }
        this.dropZone.classList.remove('drop-target-active');
      }

      this.resetCardTransform(cardEl);
      this.isDragging = false;
      this.draggedCard = null;
      this.activePointerId = null;
    };

    cardEl.addEventListener('pointerup', finishDrag);
  }

  cancelDrag() {
    if (this.draggedCard) {
      if (this.activePointerId !== null && this.draggedCard.hasPointerCapture(this.activePointerId)) {
        this.draggedCard.releasePointerCapture(this.activePointerId);
      }
      this.resetCardTransform(this.draggedCard);
    }
    if (this.dropZone) {
      this.dropZone.classList.remove('drop-target-active');
    }
    this.isDragging = false;
    this.draggedCard = null;
    this.activePointerId = null;
  }

  resetCardTransform(cardEl) {
    cardEl.classList.remove('is-dragging');
    cardEl.style.transform = '';
    cardEl.style.zIndex = '';
  }
}

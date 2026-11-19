import { svgIcon } from './vectorIcons.js';

let activeAppDialogResolver = null;
let dialogCallbacks = {
  playOkSound: () => {},
  playCancelSound: () => {},
};

/**
 * 다이얼로그 확인/취소 시 재생할 오디오 콜백을 연결합니다.
 */
export function configureAppDialog(callbacks = {}) {
  dialogCallbacks = { ...dialogCallbacks, ...callbacks };
}

/**
 * OS 기본 alert/confirm 대신 게임 내 벡터 모달 다이얼로그를 표시합니다.
 */
export function openAppDialog({
  title = '알림',
  message = '',
  confirmText = '확인',
  neutralText = null,
  cancelText = null,
  icon = 'bulb',
  danger = false,
}) {
  const modal = document.getElementById('modal-app-dialog');
  const card = modal?.querySelector('.app-dialog-card');
  const titleEl = document.getElementById('app-dialog-title');
  const msgEl = document.getElementById('app-dialog-message');
  const iconEl = document.getElementById('app-dialog-icon');
  const okBtn = document.getElementById('btn-app-dialog-ok');
  const neutralBtn = document.getElementById('btn-app-dialog-neutral');
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

  if (neutralBtn) {
    if (neutralText) {
      neutralBtn.textContent = neutralText;
      neutralBtn.style.display = '';
    } else {
      neutralBtn.style.display = 'none';
    }
  }

  if (cancelBtn) {
    if (cancelText) {
      cancelBtn.textContent = cancelText;
      cancelBtn.style.display = '';
    } else {
      cancelBtn.style.display = 'none';
    }
  }

  modal.classList.remove('modal-crt-closing');
  modal.classList.add('active');
  okBtn.focus();

  return new Promise((resolve) => {
    let closed = false;
    const finish = (val) => {
      if (closed) return;
      closed = true;
      okBtn.onclick = null;
      if (neutralBtn) neutralBtn.onclick = null;
      if (cancelBtn) cancelBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener('keydown', onKeyDown);
      activeAppDialogResolver = null;
      modal.classList.add('modal-crt-closing');
      window.setTimeout(() => {
        if (activeAppDialogResolver) return;
        modal.classList.remove('modal-crt-closing');
        modal.classList.remove('active');
      }, 190);
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
      dialogCallbacks.playOkSound();
      finish(true);
    };
    if (neutralBtn) {
      neutralBtn.onclick = () => {
        dialogCallbacks.playCancelSound();
        finish('neutral');
      };
    }
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        dialogCallbacks.playCancelSound();
        finish(false);
      };
    }
    if (closeBtn) {
      closeBtn.onclick = () => {
        dialogCallbacks.playCancelSound();
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

export function showGameAlert(message, { title = '안내', icon = 'warn', danger = false } = {}) {
  return openAppDialog({ title, message, confirmText: '확인', cancelText: null, icon, danger });
}

export function showGameConfirm(
  message,
  { title = '확인', confirmText = '확인', cancelText = '취소', icon = 'warn', danger = false } = {},
) {
  return openAppDialog({ title, message, confirmText, cancelText, icon, danger });
}

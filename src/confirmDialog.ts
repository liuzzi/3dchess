const CONFIRM_MODAL_ID = 'confirm-modal';
const CONFIRM_TITLE_ID = 'confirm-title';
const CONFIRM_MESSAGE_ID = 'confirm-message';
const CONFIRM_OK_ID = 'confirm-ok-btn';
const CONFIRM_CLOSE_ID = 'confirm-close-btn';

let active = false;

interface ConfirmOptions {
  title?: string;
  message?: string;
  okLabel?: string;
}

function showConfirm(opts: ConfirmOptions = {}): Promise<boolean> {
  const modal = document.getElementById(CONFIRM_MODAL_ID);
  const titleEl = document.getElementById(CONFIRM_TITLE_ID);
  const messageEl = document.getElementById(CONFIRM_MESSAGE_ID);
  const okBtn = document.getElementById(CONFIRM_OK_ID) as HTMLButtonElement | null;
  const closeBtn = document.getElementById(CONFIRM_CLOSE_ID) as HTMLButtonElement | null;

  const title = opts.title ?? 'Are you sure?';
  const message = opts.message ?? 'Current progress will be lost.';
  const okLabel = opts.okLabel ?? 'OK';

  if (!modal || !messageEl || !okBtn || !closeBtn) {
    return Promise.resolve(window.confirm(message));
  }

  if (active) {
    return Promise.resolve(false);
  }
  active = true;

  return new Promise((resolve) => {
    if (titleEl) titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okLabel;
    modal.classList.remove('modal-hidden');
    okBtn.focus();

    const cleanup = (): void => {
      modal.classList.add('modal-hidden');
      okBtn.removeEventListener('click', onConfirm);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdropClick);
      window.removeEventListener('keydown', onKeydown);
      active = false;
    };

    const finish = (result: boolean): void => {
      cleanup();
      resolve(result);
    };

    const onConfirm = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onBackdropClick = (event: MouseEvent): void => {
      if (event.target === modal) finish(false);
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };

    okBtn.addEventListener('click', onConfirm);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdropClick);
    window.addEventListener('keydown', onKeydown);
  });
}

export function confirmNewGame(): Promise<boolean> {
  return showConfirm({
    title: 'Start New Game?',
    message: 'Current progress will be lost.',
    okLabel: 'Start',
  });
}

export function confirmLeaveGame(): Promise<boolean> {
  return showConfirm({
    title: 'Leave Game?',
    message: 'Your current game will end.',
    okLabel: 'Leave',
  });
}

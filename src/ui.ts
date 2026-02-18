import { Game, GameEvent } from './game';
import { PieceColor, PieceType } from './types';
import { BoardView } from './boardView';

const PIECE_SYMBOLS: Record<PieceType, { white: string; black: string }> = {
  [PieceType.King]:   { white: '\u2654', black: '\u265A' },
  [PieceType.Queen]:  { white: '\u2655', black: '\u265B' },
  [PieceType.Rook]:   { white: '\u2656', black: '\u265C' },
  [PieceType.Bishop]: { white: '\u2657', black: '\u265D' },
  [PieceType.Knight]: { white: '\u2658', black: '\u265E' },
  [PieceType.Pawn]:   { white: '\u2659', black: '\u265F' },
};

const PROMO_CHOICES: { type: PieceType; label: string }[] = [
  { type: PieceType.Queen, label: 'queen' },
  { type: PieceType.Rook, label: 'rook' },
  { type: PieceType.Bishop, label: 'bishop' },
  { type: PieceType.Knight, label: 'knight' },
];

export class UI {
  private turnEl: HTMLElement;
  private statusEl: HTMLElement;
  private capturedWhiteEl: HTMLElement;
  private capturedBlackEl: HTMLElement;
  private newGameBtn: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private promoModal: HTMLElement;

  constructor(private game: Game, private boardView?: BoardView) {
    this.turnEl = document.getElementById('turn-indicator')!;
    this.statusEl = document.getElementById('game-status')!;
    this.capturedWhiteEl = document.getElementById('captured-white')!;
    this.capturedBlackEl = document.getElementById('captured-black')!;
    this.newGameBtn = document.getElementById('new-game-btn')!;
    this.undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
    this.promoModal = document.getElementById('promo-modal')!;

    this.newGameBtn.addEventListener('click', () => this.game.reset());
    this.undoBtn.addEventListener('click', () => this.game.undo());
    this.game.on((e) => this.handleEvent(e));

    this.setupPromoButtons();
    this.setupFrostingSlider();
    this.updateTurn();
    this.updateCaptured();
    this.updateUndoBtn();

    if (this.game.mode.type !== 'online') {
      this.undoBtn.style.display = '';
    } else {
      this.undoBtn.style.display = 'none';
    }
  }

  private setupPromoButtons(): void {
    const buttons = this.promoModal.querySelectorAll<HTMLButtonElement>('.promo-btn');
    buttons.forEach(btn => {
      const pieceLabel = btn.dataset.piece;
      const choice = PROMO_CHOICES.find(c => c.label === pieceLabel);
      if (!choice) return;

      btn.addEventListener('click', () => {
        this.game.completePromotion(choice.type);
        this.hidePromoModal();
      });
    });
  }

  private showPromoModal(color: PieceColor): void {
    const buttons = this.promoModal.querySelectorAll<HTMLButtonElement>('.promo-btn');
    buttons.forEach(btn => {
      const pieceLabel = btn.dataset.piece;
      const choice = PROMO_CHOICES.find(c => c.label === pieceLabel);
      if (!choice) return;
      const sym = color === PieceColor.White
        ? PIECE_SYMBOLS[choice.type].white
        : PIECE_SYMBOLS[choice.type].black;
      const iconEl = btn.querySelector('.promo-icon');
      if (iconEl) iconEl.textContent = sym;
    });

    this.promoModal.classList.remove('modal-hidden');
  }

  private hidePromoModal(): void {
    this.promoModal.classList.add('modal-hidden');
  }

  private setupFrostingSlider(): void {
    const slider = document.getElementById('frosting-slider') as HTMLInputElement;
    if (!slider || !this.boardView) return;
    slider.addEventListener('input', () => {
      this.boardView!.setFrosting(Number(slider.value) / 100);
    });
  }

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'turnChange':
        this.updateTurn();
        break;
      case 'reset':
        this.updateTurn();
        this.updateCaptured();
        this.statusEl.textContent = '';
        this.hidePromoModal();
        break;
      case 'capture':
        this.updateCaptured();
        break;
      case 'check': {
        const inCheck = this.game.currentTurn;
        const checkColor = inCheck === PieceColor.White ? 'White' : 'Black';
        if (this.game.mode.type === 'online' && this.game.mode.localColor) {
          const isYou = inCheck === this.game.mode.localColor;
          this.statusEl.textContent = isYou ? `You are in CHECK!` : `Opponent is in CHECK!`;
        } else {
          this.statusEl.textContent = `${checkColor} is in CHECK!`;
        }
        break;
      }
      case 'checkmate': {
        const loser = this.game.currentTurn;
        const winnerColor = loser === PieceColor.White ? 'Black' : 'White';
        this.turnEl.textContent = 'Checkmate!';
        if (this.game.mode.type === 'online' && this.game.mode.localColor) {
          const youWon = loser !== this.game.mode.localColor;
          this.statusEl.textContent = youWon ? 'You win!' : 'You lose!';
        } else {
          this.statusEl.textContent = `${winnerColor} wins!`;
        }
        break;
      }
      case 'stalemate':
        this.turnEl.textContent = 'Stalemate!';
        this.statusEl.textContent = 'Draw!';
        break;
      case 'move':
        this.statusEl.textContent = '';
        break;
      case 'promotionPrompt': {
        const { piece } = event.data as { piece: { color: PieceColor } };
        this.showPromoModal(piece.color);
        break;
      }
      case 'promotion':
        this.hidePromoModal();
        break;
      case 'undo':
        this.updateTurn();
        this.updateCaptured();
        this.statusEl.textContent = '';
        this.hidePromoModal();
        break;
    }
    this.updateUndoBtn();
  }

  private updateTurn(): void {
    if (!this.game.gameOver) {
      const color = this.game.currentTurn === PieceColor.White ? 'White' : 'Black';
      if (this.game.mode.type === 'online' && this.game.mode.localColor) {
        const isYours = this.game.currentTurn === this.game.mode.localColor;
        this.turnEl.textContent = isYours ? `Your Turn (${color})` : `Opponent's Turn (${color})`;
      } else {
        this.turnEl.textContent = `${color}'s Turn`;
      }
    }
  }

  private updateUndoBtn(): void {
    this.undoBtn.disabled = !this.game.canUndo();
  }

  private updateCaptured(): void {
    if (this.game.capturedWhite.length) {
      this.capturedWhiteEl.textContent = this.game.capturedWhite
        .map(p => PIECE_SYMBOLS[p.type].white).join('');
      this.capturedWhiteEl.style.display = '';
    } else {
      this.capturedWhiteEl.style.display = 'none';
    }

    if (this.game.capturedBlack.length) {
      this.capturedBlackEl.textContent = this.game.capturedBlack
        .map(p => PIECE_SYMBOLS[p.type].black).join('');
      this.capturedBlackEl.style.display = '';
    } else {
      this.capturedBlackEl.style.display = 'none';
    }
  }
}

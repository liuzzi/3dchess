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

export type LayerToggleCallback = (layer: number, visible: boolean) => void;

export class UI {
  private turnEl: HTMLElement;
  private statusEl: HTMLElement;
  private capturedWhiteEl: HTMLElement;
  private capturedBlackEl: HTMLElement;
  private newGameBtn: HTMLElement;
  private promoModal: HTMLElement;
  private onLayerToggle: LayerToggleCallback | null = null;

  constructor(private game: Game, private boardView?: BoardView) {
    this.turnEl = document.getElementById('turn-indicator')!;
    this.statusEl = document.getElementById('game-status')!;
    this.capturedWhiteEl = document.getElementById('captured-white')!;
    this.capturedBlackEl = document.getElementById('captured-black')!;
    this.newGameBtn = document.getElementById('new-game-btn')!;
    this.promoModal = document.getElementById('promo-modal')!;

    this.newGameBtn.addEventListener('click', () => this.game.reset());
    this.game.on((e) => this.handleEvent(e));

    this.setupPromoButtons();
    this.buildLayerToggles();
    this.setupFrostingSlider();
    this.updateTurn();
    this.updateCaptured();
  }

  setLayerToggleCallback(cb: LayerToggleCallback): void {
    this.onLayerToggle = cb;
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

  private buildLayerToggles(): void {
    const container = document.getElementById('layer-toggles')!;
    for (let z = 7; z >= 0; z--) {
      const row = document.createElement('label');
      row.className = 'layer-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', () => {
        if (this.onLayerToggle) {
          this.onLayerToggle(z, cb.checked);
        }
      });

      const label = document.createTextNode(`Layer ${z + 1}`);
      row.appendChild(cb);
      row.appendChild(label);
      container.appendChild(row);
    }
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
      case 'check':
        this.statusEl.textContent = `${this.game.currentTurn === PieceColor.White ? 'White' : 'Black'} is in CHECK!`;
        break;
      case 'checkmate': {
        const winner = this.game.currentTurn === PieceColor.White ? 'Black' : 'White';
        this.turnEl.textContent = `Checkmate!`;
        this.statusEl.textContent = `${winner} wins!`;
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
    }
  }

  private updateTurn(): void {
    if (!this.game.gameOver) {
      const color = this.game.currentTurn === PieceColor.White ? 'White' : 'Black';
      this.turnEl.textContent = `${color}'s Turn`;
    }
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

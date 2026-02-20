import { Game, GameEvent } from './game';
import { Piece, PieceColor, PieceType, Position3D, posKey } from './types';
import { BoardView } from './boardView';
import { confirmNewGame } from './confirmDialog';

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

interface UIOptions {
  onMoveHover?: (pos: Position3D | null) => void;
  onAttackPreviewToggle?: (enabled: boolean) => void;
  onMyThreatsToggle?: (enabled: boolean) => void;
}

export class UI {
  private turnEl: HTMLElement;
  private statusEl: HTMLElement;
  private capturedWhiteEl: HTMLElement;
  private capturedBlackEl: HTMLElement;
  private newGameBtn: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private promoModal: HTMLElement;
  private movePanelEl: HTMLElement | null;
  private movePanelEmptyEl: HTMLElement | null;
  private moveOptionsEl: HTMLElement | null;
  private attackPreviewCheckbox: HTMLInputElement | null;
  private myThreatsCheckbox: HTMLInputElement | null;
  private onMoveHover: (pos: Position3D | null) => void;
  private onAttackPreviewToggle: (enabled: boolean) => void;
  private onMyThreatsToggle: (enabled: boolean) => void;
  private moveOptionButtons = new Map<string, HTMLButtonElement>();
  private hoveredMoveKey: string | null = null;
  private ac = new AbortController();

  constructor(
    private game: Game,
    private boardView?: BoardView,
    options?: UIOptions,
  ) {
    this.turnEl = document.getElementById('turn-indicator')!;
    this.statusEl = document.getElementById('game-status')!;
    this.capturedWhiteEl = document.getElementById('captured-white')!;
    this.capturedBlackEl = document.getElementById('captured-black')!;
    this.newGameBtn = document.getElementById('new-game-btn')!;
    this.undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
    this.promoModal = document.getElementById('promo-modal')!;
    this.movePanelEl = document.getElementById('move-panel');
    this.movePanelEmptyEl = document.getElementById('move-panel-empty');
    this.moveOptionsEl = document.getElementById('move-options');
    this.attackPreviewCheckbox = document.getElementById('attack-preview-checkbox') as HTMLInputElement | null;
    this.myThreatsCheckbox = document.getElementById('my-threats-checkbox') as HTMLInputElement | null;
    this.onMoveHover = options?.onMoveHover ?? (() => {});
    this.onAttackPreviewToggle = options?.onAttackPreviewToggle ?? (() => {});
    this.onMyThreatsToggle = options?.onMyThreatsToggle ?? (() => {});

    const signal = this.ac.signal;
    this.newGameBtn.addEventListener('click', () => {
      void this.handleNewGameClick();
    }, { signal });
    this.undoBtn.addEventListener('click', () => this.game.undo(), { signal });
    this.game.on((e) => this.handleEvent(e));

    this.setupPromoButtons();
    this.setupFrostingSlider();
    this.setupOutlineBrightnessSlider();
    this.setupAttackPreviewButton();
    this.setupMyThreatsButton();
    this.updateTurn();
    this.updateCaptured();
    this.updateUndoBtn();
    this.clearMoveOptions();

    if (this.game.mode.type !== 'online') {
      this.undoBtn.style.display = '';
    } else {
      this.undoBtn.style.display = 'none';
    }
  }

  private async handleNewGameClick(): Promise<void> {
    const confirmed = await confirmNewGame();
      if (!confirmed) return;
      this.onMoveHover(null);
      this.game.reset();
  }

  private setupPromoButtons(): void {
    const signal = this.ac.signal;
    const buttons = this.promoModal.querySelectorAll<HTMLButtonElement>('.promo-btn');
    buttons.forEach(btn => {
      const pieceLabel = btn.dataset.piece;
      const choice = PROMO_CHOICES.find(c => c.label === pieceLabel);
      if (!choice) return;

      btn.addEventListener('click', () => {
        this.game.completePromotion(choice.type);
        this.hidePromoModal();
      }, { signal });
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
    }, { signal: this.ac.signal });
  }

  private setupOutlineBrightnessSlider(): void {
    const slider = document.getElementById('outline-brightness-slider') as HTMLInputElement;
    if (!slider || !this.boardView) return;
    slider.addEventListener('input', () => {
      this.boardView!.setOutlineBrightness(Number(slider.value) / 100);
    }, { signal: this.ac.signal });
  }

  private setupAttackPreviewButton(): void {
    const checkbox = this.attackPreviewCheckbox;
    if (!checkbox) return;
    const signal = this.ac.signal;
    checkbox.addEventListener('change', () => {
      this.onAttackPreviewToggle(checkbox.checked);
    }, { signal });
  }

  setAttackPreviewEnabled(enabled: boolean): void {
    if (!this.attackPreviewCheckbox) return;
    this.attackPreviewCheckbox.checked = enabled;
  }

  private setupMyThreatsButton(): void {
    const checkbox = this.myThreatsCheckbox;
    if (!checkbox) return;
    const signal = this.ac.signal;
    checkbox.addEventListener('change', () => {
      this.onMyThreatsToggle(checkbox.checked);
    }, { signal });
  }

  setMyThreatsEnabled(enabled: boolean): void {
    if (!this.myThreatsCheckbox) return;
    this.myThreatsCheckbox.checked = enabled;
  }

  private formatPos(pos: Position3D): string {
    return `X${pos.x + 1} Y${pos.y + 1} Z${pos.z + 1}`;
  }

  private moveLabel(piece: Piece, to: Position3D): string {
    const target = this.game.board.getPieceAt(to);
    const base = `${piece.type.toUpperCase()} -> ${this.formatPos(to)}`;
    if (target && target.color !== piece.color) return `${base} (capture ${target.type})`;
    return base;
  }

  private clearMoveOptions(emptyText = 'Select a piece to see moves'): void {
    if (!this.moveOptionsEl || !this.movePanelEmptyEl || !this.movePanelEl) return;
    this.moveOptionButtons.clear();
    this.hoveredMoveKey = null;
    this.moveOptionsEl.replaceChildren();
    this.movePanelEmptyEl.textContent = emptyText;
    this.movePanelEmptyEl.style.display = '';
    this.movePanelEl.style.display = 'none';
    this.onMoveHover(null);
  }

  private renderMoveOptions(piece: Piece, moves: Position3D[]): void {
    if (!this.moveOptionsEl || !this.movePanelEmptyEl || !this.movePanelEl) return;
    this.moveOptionsEl.replaceChildren();
    this.onMoveHover(null);
    this.movePanelEl.style.display = 'flex';

    if (moves.length === 0) {
      this.movePanelEmptyEl.textContent = 'No legal moves';
      this.movePanelEmptyEl.style.display = '';
      return;
    }

    this.movePanelEmptyEl.style.display = 'none';
    for (const to of moves) {
      const key = posKey(to);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'move-option-btn';
      const target = this.game.board.getPieceAt(to);
      if (target && target.color !== piece.color) btn.classList.add('is-capture');
      btn.textContent = this.moveLabel(piece, to);
      btn.addEventListener('mouseenter', () => this.onMoveHover(to));
      btn.addEventListener('focus', () => this.onMoveHover(to));
      btn.addEventListener('mouseleave', () => this.onMoveHover(null));
      btn.addEventListener('blur', () => this.onMoveHover(null));
      btn.addEventListener('click', () => {
        this.onMoveHover(null);
        this.game.handleCellClick(to);
      });
      this.moveOptionsEl.appendChild(btn);
      this.moveOptionButtons.set(key, btn);
    }
  }

  setHoveredMove(pos: Position3D | null): void {
    if (this.hoveredMoveKey) {
      const prev = this.moveOptionButtons.get(this.hoveredMoveKey);
      prev?.classList.remove('is-hovered');
      this.hoveredMoveKey = null;
    }
    if (!pos) return;

    const key = posKey(pos);
    const next = this.moveOptionButtons.get(key);
    if (!next) return;

    next.classList.add('is-hovered');
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.hoveredMoveKey = key;
  }

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'select': {
        const { piece, moves } = event.data;
        this.renderMoveOptions(piece, moves);
        break;
      }
      case 'deselect':
        this.clearMoveOptions();
        break;
      case 'turnChange':
        this.updateTurn();
        break;
      case 'reset':
        this.updateTurn();
        this.updateCaptured();
        this.statusEl.textContent = '';
        this.hidePromoModal();
        this.clearMoveOptions();
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
        this.clearMoveOptions();
        break;
      case 'promotionPrompt': {
        const { piece } = event.data;
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
        this.clearMoveOptions();
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
    const order: PieceType[] = [
      PieceType.Pawn,
      PieceType.Knight,
      PieceType.Bishop,
      PieceType.Rook,
      PieceType.Queen,
      PieceType.King,
    ];
    const sortByType = (a: Piece, b: Piece): number => order.indexOf(a.type) - order.indexOf(b.type);
    const capturedSymbol = (piece: Piece): string => (
      piece.color === PieceColor.White
        ? PIECE_SYMBOLS[piece.type].black
        : PIECE_SYMBOLS[piece.type].white
    );

    // White row: pieces captured by White (i.e. Black pieces taken)
    this.capturedWhiteEl.textContent = this.game.capturedBlack
      .slice()
      .sort(sortByType)
      .map(capturedSymbol)
      .join(' ');

    // Black row: pieces captured by Black (i.e. White pieces taken)
    this.capturedBlackEl.textContent = this.game.capturedWhite
      .slice()
      .sort(sortByType)
      .map(capturedSymbol)
      .join(' ');
  }

  dispose(): void {
    this.ac.abort();
  }
}

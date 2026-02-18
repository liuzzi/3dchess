import { Board } from './board';
import { getLegalMoves, isCheckmate, isStalemate, isKingInCheck } from './movement';
import { Piece, PieceColor, PieceType, Position3D, posEqual, GameMode } from './types';

export type GameEventCallback = (event: GameEvent) => void;

export interface GameEvent {
  type: 'move' | 'capture' | 'check' | 'checkmate' | 'stalemate' | 'turnChange' | 'select' | 'deselect' | 'promotion' | 'promotionPrompt' | 'botTurn' | 'reset';
  data?: unknown;
}

export class Game {
  board: Board;
  currentTurn: PieceColor = PieceColor.White;
  selectedPiece: Piece | null = null;
  validMoves: Position3D[] = [];
  capturedWhite: Piece[] = [];
  capturedBlack: Piece[] = [];
  gameOver = false;
  awaitingPromotion: Piece | null = null;
  botThinking = false;
  mode: GameMode = { type: 'local' };

  private listeners: GameEventCallback[] = [];

  constructor() {
    this.board = new Board();
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
  }

  on(cb: GameEventCallback): void {
    this.listeners.push(cb);
  }

  private emit(event: GameEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  reset(): void {
    this.board.reset();
    this.currentTurn = PieceColor.White;
    this.selectedPiece = null;
    this.validMoves = [];
    this.capturedWhite = [];
    this.capturedBlack = [];
    this.gameOver = false;
    this.awaitingPromotion = null;
    this.botThinking = false;
    this.emit({ type: 'reset' });
  }

  isBotTurn(): boolean {
    return this.mode.type === 'bot' && this.currentTurn === PieceColor.Black;
  }

  handleCellClick(pos: Position3D): void {
    if (this.gameOver || this.awaitingPromotion || this.botThinking) return;
    if (this.isBotTurn()) return;

    if (this.selectedPiece) {
      const isValidTarget = this.validMoves.some(m => posEqual(m, pos));
      if (isValidTarget) {
        this.executeMove(this.selectedPiece, pos);
        return;
      }
    }

    const piece = this.board.getPieceAt(pos);

    if (piece && piece.color === this.currentTurn) {
      this.selectPiece(piece);
    } else {
      this.deselect();
    }
  }

  /** Public entry point for the bot to make a move */
  makeMove(piece: Piece, to: Position3D): void {
    this.executeMove(piece, to);
  }

  private selectPiece(piece: Piece): void {
    this.selectedPiece = piece;
    this.validMoves = getLegalMoves(this.board, piece);
    this.emit({ type: 'select', data: { piece, moves: this.validMoves } });
  }

  deselect(): void {
    this.selectedPiece = null;
    this.validMoves = [];
    this.emit({ type: 'deselect' });
  }

  private executeMove(piece: Piece, to: Position3D): void {
    const from = { ...piece.position };
    const captured = this.board.movePiece(piece, to);

    if (captured) {
      if (captured.color === PieceColor.White) {
        this.capturedWhite.push(captured);
      } else {
        this.capturedBlack.push(captured);
      }
      this.emit({ type: 'capture', data: { captured } });
    }

    this.emit({ type: 'move', data: { piece, from, to, captured } });
    this.deselect();

    if (piece.type === PieceType.Pawn) {
      const promoRow = piece.color === PieceColor.White ? 7 : 0;
      if (piece.position.y === promoRow) {
        // Bot always auto-promotes to queen
        if (this.mode.type === 'bot' && piece.color === PieceColor.Black) {
          piece.type = PieceType.Queen;
          this.emit({ type: 'promotion', data: { piece } });
        } else {
          this.awaitingPromotion = piece;
          this.emit({ type: 'promotionPrompt', data: { piece } });
          return;
        }
      }
    }

    this.endTurn();
  }

  completePromotion(chosenType: PieceType): void {
    const piece = this.awaitingPromotion;
    if (!piece) return;

    piece.type = chosenType;
    this.awaitingPromotion = null;
    this.emit({ type: 'promotion', data: { piece } });
    this.endTurn();
  }

  private endTurn(): void {
    this.currentTurn = this.currentTurn === PieceColor.White ? PieceColor.Black : PieceColor.White;
    this.emit({ type: 'turnChange', data: { turn: this.currentTurn } });

    if (isKingInCheck(this.board, this.currentTurn)) {
      this.emit({ type: 'check', data: { color: this.currentTurn } });
    }

    if (isCheckmate(this.board, this.currentTurn)) {
      this.gameOver = true;
      this.emit({ type: 'checkmate', data: { loser: this.currentTurn } });
    } else if (isStalemate(this.board, this.currentTurn)) {
      this.gameOver = true;
      this.emit({ type: 'stalemate' });
    }

    if (!this.gameOver && this.isBotTurn()) {
      this.botThinking = true;
      this.emit({ type: 'botTurn' });
    }
  }
}

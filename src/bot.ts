import { Board } from './board';
import { getLegalMoves, isKingInCheck, isCheckmate, isStalemate } from './movement';
import { Piece, PieceColor, PieceType, Position3D, Difficulty } from './types';

const PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.Pawn]: 100,
  [PieceType.Knight]: 320,
  [PieceType.Bishop]: 330,
  [PieceType.Rook]: 500,
  [PieceType.Queen]: 900,
  [PieceType.King]: 20000,
};

const DEPTH_MAP: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

function centerBonus(pos: Position3D): number {
  const cx = Math.abs(pos.x - 3.5);
  const cy = Math.abs(pos.y - 3.5);
  const cz = Math.abs(pos.z - 3.5);
  const maxDist = 3.5 * 3; // max Manhattan distance from center
  const dist = cx + cy + cz;
  return ((maxDist - dist) / maxDist) * 30;
}

function evaluate(board: Board, botColor: PieceColor): number {
  const opponentColor = botColor === PieceColor.White ? PieceColor.Black : PieceColor.White;

  if (isCheckmate(board, opponentColor)) return 100000;
  if (isCheckmate(board, botColor)) return -100000;
  if (isStalemate(board, botColor) || isStalemate(board, opponentColor)) return 0;

  let score = 0;

  for (const piece of board.pieces) {
    const value = PIECE_VALUE[piece.type];
    const center = centerBonus(piece.position);
    const pieceScore = value + center;

    if (piece.color === botColor) {
      score += pieceScore;
    } else {
      score -= pieceScore;
    }
  }

  if (isKingInCheck(board, opponentColor)) score += 50;
  if (isKingInCheck(board, botColor)) score -= 50;

  return score;
}

interface ScoredMove {
  piece: Piece;
  to: Position3D;
  score: number;
}

function getAllMoves(board: Board, color: PieceColor): { piece: Piece; to: Position3D }[] {
  const moves: { piece: Piece; to: Position3D }[] = [];
  for (const piece of board.getPiecesOfColor(color)) {
    for (const to of getLegalMoves(board, piece)) {
      moves.push({ piece, to });
    }
  }
  return moves;
}

function orderMoves(board: Board, moves: { piece: Piece; to: Position3D }[]): { piece: Piece; to: Position3D }[] {
  return moves.sort((a, b) => {
    const capA = board.getPieceAt(a.to);
    const capB = board.getPieceAt(b.to);
    const scoreA = capA ? PIECE_VALUE[capA.type] : 0;
    const scoreB = capB ? PIECE_VALUE[capB.type] : 0;
    return scoreB - scoreA;
  });
}

function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  botColor: PieceColor,
): number {
  const currentColor = maximizing ? botColor : (botColor === PieceColor.White ? PieceColor.Black : PieceColor.White);

  if (depth === 0) {
    return evaluate(board, botColor);
  }

  const moves = getAllMoves(board, currentColor);

  if (moves.length === 0) {
    if (isKingInCheck(board, currentColor)) {
      return maximizing ? -100000 + (10 - depth) : 100000 - (10 - depth);
    }
    return 0;
  }

  const ordered = orderMoves(board, moves);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of ordered) {
      const sim = board.clone();
      const simPiece = sim.getPieceAt(move.piece.position)!;
      sim.movePiece(simPiece, move.to);
      if (simPiece.type === PieceType.Pawn) {
        const promoRow = simPiece.color === PieceColor.White ? 7 : 0;
        if (simPiece.position.y === promoRow) simPiece.type = PieceType.Queen;
      }
      const ev = minimax(sim, depth - 1, alpha, beta, false, botColor);
      maxEval = Math.max(maxEval, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of ordered) {
      const sim = board.clone();
      const simPiece = sim.getPieceAt(move.piece.position)!;
      sim.movePiece(simPiece, move.to);
      if (simPiece.type === PieceType.Pawn) {
        const promoRow = simPiece.color === PieceColor.White ? 7 : 0;
        if (simPiece.position.y === promoRow) simPiece.type = PieceType.Queen;
      }
      const ev = minimax(sim, depth - 1, alpha, beta, true, botColor);
      minEval = Math.min(minEval, ev);
      beta = Math.min(beta, ev);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export class Bot {
  private depth: number;
  private noisy: boolean;

  constructor(public color: PieceColor, public difficulty: Difficulty) {
    this.depth = DEPTH_MAP[difficulty];
    this.noisy = difficulty === 'easy';
  }

  async pickMove(board: Board): Promise<{ piece: Piece; to: Position3D }> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const result = this.search(board);
        resolve(result);
      }, 0);
    });
  }

  private search(board: Board): { piece: Piece; to: Position3D } {
    const moves = getAllMoves(board, this.color);
    if (moves.length === 0) throw new Error('Bot has no legal moves');

    const ordered = orderMoves(board, moves);
    const scored: ScoredMove[] = [];

    for (const move of ordered) {
      const sim = board.clone();
      const simPiece = sim.getPieceAt(move.piece.position)!;
      sim.movePiece(simPiece, move.to);
      if (simPiece.type === PieceType.Pawn) {
        const promoRow = simPiece.color === PieceColor.White ? 7 : 0;
        if (simPiece.position.y === promoRow) simPiece.type = PieceType.Queen;
      }

      let score = minimax(sim, this.depth - 1, -Infinity, Infinity, false, this.color);

      if (this.noisy) {
        score += (Math.random() - 0.5) * 80;
      }

      scored.push({ piece: move.piece, to: move.to, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return { piece: scored[0].piece, to: scored[0].to };
  }
}

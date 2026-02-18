import { Board } from './board';
import { getLegalMoves, isKingInCheck } from './movement';
import { Piece, PieceColor, PieceType, Position3D, Difficulty } from './types';

const PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.Pawn]: 100,
  [PieceType.Knight]: 320,
  [PieceType.Bishop]: 330,
  [PieceType.Rook]: 500,
  [PieceType.Queen]: 900,
  [PieceType.King]: 20000,
};

const TIME_LIMIT: Record<Difficulty, number> = {
  easy: 0,
  medium: 3000,
  hard: 8000,
};

const MAX_DEPTH: Record<Difficulty, number> = {
  easy: 1,
  medium: 6,
  hard: 10,
};

class SearchAborted extends Error {}

let nodesSearched = 0;
let searchDeadline = 0;

function checkTime(): void {
  if (++nodesSearched % 2048 === 0 && searchDeadline > 0 && Date.now() >= searchDeadline) {
    throw new SearchAborted();
  }
}

function centerBonus(pos: Position3D): number {
  const cx = Math.abs(pos.x - 3.5);
  const cy = Math.abs(pos.y - 3.5);
  const cz = Math.abs(pos.z - 3.5);
  const maxDist = 3.5 * 3;
  const dist = cx + cy + cz;
  return ((maxDist - dist) / maxDist) * 30;
}

function evaluate(board: Board, botColor: PieceColor): number {
  const opponentColor = botColor === PieceColor.White ? PieceColor.Black : PieceColor.White;

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
  checkTime();

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

interface ScoredMove {
  fromPos: Position3D;
  to: Position3D;
  score: number;
}

function searchAtDepth(board: Board, color: PieceColor, depth: number, noisy: boolean): ScoredMove[] {
  const moves = getAllMoves(board, color);
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

    let score = minimax(sim, depth - 1, -Infinity, Infinity, false, color);

    if (noisy) {
      score += (Math.random() - 0.5) * 80;
    }

    scored.push({ fromPos: move.piece.position, to: move.to, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function iterativeSearch(board: Board, color: PieceColor, difficulty: Difficulty): { fromPos: Position3D; to: Position3D } {
  const noisy = difficulty === 'easy';
  const maxDepth = MAX_DEPTH[difficulty];
  const timeLimit = TIME_LIMIT[difficulty];

  if (timeLimit > 0) {
    searchDeadline = Date.now() + timeLimit;
  } else {
    searchDeadline = 0;
  }

  let bestResult: ScoredMove[] | null = null;

  for (let depth = 1; depth <= maxDepth; depth++) {
    nodesSearched = 0;
    try {
      const result = searchAtDepth(board, color, depth, noisy);
      bestResult = result;
    } catch (e) {
      if (e instanceof SearchAborted) break;
      throw e;
    }
  }

  if (!bestResult || bestResult.length === 0) {
    throw new Error('Bot has no legal moves');
  }

  return { fromPos: bestResult[0].fromPos, to: bestResult[0].to };
}

export interface WorkerRequest {
  pieces: Piece[];
  color: PieceColor;
  difficulty: Difficulty;
}

export interface WorkerResponse {
  type: 'result' | 'error';
  fromPos?: Position3D;
  to?: Position3D;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { pieces, color, difficulty } = e.data;
  try {
    const board = Board.deserialize(pieces);
    const move = iterativeSearch(board, color, difficulty);
    const resp: WorkerResponse = { type: 'result', fromPos: move.fromPos, to: move.to };
    self.postMessage(resp);
  } catch (err) {
    const resp: WorkerResponse = { type: 'error', error: String(err) };
    self.postMessage(resp);
  }
};

import { Board } from './board';
import { Piece, PieceColor, PieceType, Position3D } from './types';

type Dir = [number, number, number];

const ROOK_DIRS: Dir[] = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
];

const BISHOP_DIRS: Dir[] = [
  [1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],
  [1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],
  [0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1],
];

const QUEEN_DIRS: Dir[] = [
  ...ROOK_DIRS,
  ...BISHOP_DIRS,
  // 3-axis diagonals
  [1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],
  [-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1],
];

const KING_DIRS: Dir[] = QUEEN_DIRS;

function generateKnightMoves(): Dir[] {
  const moves: Dir[] = [];
  const vals = [-2, -1, 1, 2];
  for (const a of vals) {
    for (const b of vals) {
      if (Math.abs(a) === Math.abs(b)) continue;
      moves.push([a, b, 0]);
      moves.push([a, 0, b]);
      moves.push([0, a, b]);
    }
  }
  return moves;
}

const KNIGHT_MOVES: Dir[] = generateKnightMoves();

function slideMoves(board: Board, piece: Piece, dirs: Dir[]): Position3D[] {
  const results: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    let { x, y, z } = piece.position;
    while (true) {
      x += dx; y += dy; z += dz;
      const pos: Position3D = { x, y, z };
      if (!board.isInBounds(pos)) break;
      const occupant = board.getPieceAt(pos);
      if (occupant) {
        if (occupant.color !== piece.color) results.push(pos);
        break;
      }
      results.push(pos);
    }
  }
  return results;
}

function stepMoves(board: Board, piece: Piece, dirs: Dir[]): Position3D[] {
  const results: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    const pos: Position3D = {
      x: piece.position.x + dx,
      y: piece.position.y + dy,
      z: piece.position.z + dz,
    };
    if (!board.isInBounds(pos)) continue;
    const occupant = board.getPieceAt(pos);
    if (occupant && occupant.color === piece.color) continue;
    results.push(pos);
  }
  return results;
}

function pawnMoves(board: Board, piece: Piece): Position3D[] {
  const results: Position3D[] = [];
  const fwdDir = piece.color === PieceColor.White ? 1 : -1;
  const { x, y, z } = piece.position;

  // Forward on same layer (+y for white, -y for black)
  const fwd: Position3D = { x, y: y + fwdDir, z };
  if (board.isInBounds(fwd) && !board.getPieceAt(fwd)) {
    results.push(fwd);
    if (!piece.hasMoved) {
      const fwd2: Position3D = { x, y: y + fwdDir * 2, z };
      if (board.isInBounds(fwd2) && !board.getPieceAt(fwd2)) {
        results.push(fwd2);
      }
    }
  }

  // Layer movement: pawns can move one layer up OR down (both sides share center)
  for (const dz of [-1, 1]) {
    const layerMove: Position3D = { x, y, z: z + dz };
    if (board.isInBounds(layerMove) && !board.getPieceAt(layerMove)) {
      results.push(layerMove);
    }
  }

  // Captures: diagonal forward on same layer (x +/- 1, y forward)
  for (const dx of [-1, 1]) {
    const cap: Position3D = { x: x + dx, y: y + fwdDir, z };
    if (board.isInBounds(cap)) {
      const occ = board.getPieceAt(cap);
      if (occ && occ.color !== piece.color) results.push(cap);
    }
  }

  // Captures: diagonal into adjacent layers (forward + layer change, or sideways + layer change)
  for (const dz of [-1, 1]) {
    // Forward + layer change
    const cap1: Position3D = { x, y: y + fwdDir, z: z + dz };
    if (board.isInBounds(cap1)) {
      const occ = board.getPieceAt(cap1);
      if (occ && occ.color !== piece.color) results.push(cap1);
    }
    // Sideways + layer change
    for (const dx of [-1, 1]) {
      const cap2: Position3D = { x: x + dx, y, z: z + dz };
      if (board.isInBounds(cap2)) {
        const occ = board.getPieceAt(cap2);
        if (occ && occ.color !== piece.color) results.push(cap2);
      }
      // Forward + sideways + layer change (full 3D diagonal capture)
      const cap3: Position3D = { x: x + dx, y: y + fwdDir, z: z + dz };
      if (board.isInBounds(cap3)) {
        const occ = board.getPieceAt(cap3);
        if (occ && occ.color !== piece.color) results.push(cap3);
      }
    }
  }

  return results;
}

export function getValidMoves(board: Board, piece: Piece): Position3D[] {
  let candidates: Position3D[];

  switch (piece.type) {
    case PieceType.Rook:
      candidates = slideMoves(board, piece, ROOK_DIRS);
      break;
    case PieceType.Bishop:
      candidates = slideMoves(board, piece, BISHOP_DIRS);
      break;
    case PieceType.Queen:
      candidates = slideMoves(board, piece, QUEEN_DIRS);
      break;
    case PieceType.King:
      candidates = stepMoves(board, piece, KING_DIRS);
      break;
    case PieceType.Knight:
      candidates = stepMoves(board, piece, KNIGHT_MOVES);
      break;
    case PieceType.Pawn:
      candidates = pawnMoves(board, piece);
      break;
  }

  return candidates;
}

export function isKingInCheck(board: Board, color: PieceColor): boolean {
  const king = board.findKing(color);
  if (!king) return false;

  const enemy = color === PieceColor.White ? PieceColor.Black : PieceColor.White;
  for (const p of board.getPiecesOfColor(enemy)) {
    const moves = getRawMoves(board, p);
    if (moves.some(m => m.x === king.position.x && m.y === king.position.y && m.z === king.position.z)) {
      return true;
    }
  }
  return false;
}

/** Raw moves without filtering for self-check (to avoid infinite recursion) */
function getRawMoves(board: Board, piece: Piece): Position3D[] {
  switch (piece.type) {
    case PieceType.Rook: return slideMoves(board, piece, ROOK_DIRS);
    case PieceType.Bishop: return slideMoves(board, piece, BISHOP_DIRS);
    case PieceType.Queen: return slideMoves(board, piece, QUEEN_DIRS);
    case PieceType.King: return stepMoves(board, piece, KING_DIRS);
    case PieceType.Knight: return stepMoves(board, piece, KNIGHT_MOVES);
    case PieceType.Pawn: return pawnMoves(board, piece);
  }
}

export function getLegalMoves(board: Board, piece: Piece): Position3D[] {
  const candidates = getValidMoves(board, piece);
  return candidates.filter(to => {
    const sim = board.clone();
    const simPiece = sim.getPieceAt(piece.position);
    if (!simPiece) return false;
    sim.movePiece(simPiece, to);
    return !isKingInCheck(sim, piece.color);
  });
}

export function isCheckmate(board: Board, color: PieceColor): boolean {
  if (!isKingInCheck(board, color)) return false;
  for (const p of board.getPiecesOfColor(color)) {
    if (getLegalMoves(board, p).length > 0) return false;
  }
  return true;
}

export function isStalemate(board: Board, color: PieceColor): boolean {
  if (isKingInCheck(board, color)) return false;
  for (const p of board.getPiecesOfColor(color)) {
    if (getLegalMoves(board, p).length > 0) return false;
  }
  return true;
}

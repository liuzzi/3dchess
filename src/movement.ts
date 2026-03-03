import { Board } from './board';
import { Piece, PieceColor, PieceType, Position3D, posKeyXYZ } from './types';

type Dir = [number, number, number];

const ROOK_DIRS: Dir[] = [
  // Axis-aligned (straight slides)
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  // xz-plane diagonals (stays in same row — y unchanged)
  [1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],
  // yz-plane diagonals (stays in same column — x unchanged)
  [0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1],
];

const BISHOP_DIRS: Dir[] = [
  // 2-axis diagonals (xy-plane only — always changes row AND column)
  [1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],
  // 3-axis (space) diagonals
  [1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],
  [-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1],
];

const QUEEN_DIRS: Dir[] = [...ROOK_DIRS, ...BISHOP_DIRS];

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

const POS_CACHE: Position3D[] = (() => {
  const arr: Position3D[] = new Array(512);
  for (let z = 0; z < 8; z++) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        arr[posKeyXYZ(x, y, z)] = Object.freeze({ x, y, z });
      }
    }
  }
  return arr;
})();

function cachedPos(x: number, y: number, z: number): Position3D {
  return POS_CACHE[posKeyXYZ(x, y, z)];
}

function slideMoves(board: Board, piece: Piece, dirs: Dir[]): Position3D[] {
  const results: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    let { x, y, z } = piece.position;
    while (true) {
      x += dx; y += dy; z += dz;
      if (!board.isInBoundsXYZ(x, y, z)) break;
      const occupant = board.getPieceAtXYZ(x, y, z);
      if (occupant) {
        if (occupant.color !== piece.color) results.push(cachedPos(x, y, z));
        break;
      }
      results.push(cachedPos(x, y, z));
    }
  }
  return results;
}

function stepMoves(board: Board, piece: Piece, dirs: Dir[]): Position3D[] {
  const results: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    const x = piece.position.x + dx;
    const y = piece.position.y + dy;
    const z = piece.position.z + dz;
    if (!board.isInBoundsXYZ(x, y, z)) continue;
    const occupant = board.getPieceAtXYZ(x, y, z);
    if (occupant && occupant.color === piece.color) continue;
    results.push(cachedPos(x, y, z));
  }
  return results;
}

function pawnMoves(board: Board, piece: Piece): Position3D[] {
  const results: Position3D[] = [];
  const fwdDir = piece.color === PieceColor.White ? 1 : -1;
  const { x, y, z } = piece.position;

  const moveDirs: Dir[] = [
    [0, fwdDir, 0],   // forward
    [0, 0, 1],        // layer up
    [0, 0, -1],       // layer down
    [0, fwdDir, 1],   // forward staircase up
    [0, fwdDir, -1],  // forward staircase down
  ];

  for (const [dx, dy, dz] of moveDirs) {
    const x1 = x + dx; const y1 = y + dy; const z1 = z + dz;
    if (!board.isInBoundsXYZ(x1, y1, z1) || board.getPieceAtXYZ(x1, y1, z1)) continue;
    results.push(cachedPos(x1, y1, z1));
    if (!piece.hasMoved) {
      const x2 = x + dx * 2; const y2 = y + dy * 2; const z2 = z + dz * 2;
      if (board.isInBoundsXYZ(x2, y2, z2) && !board.getPieceAtXYZ(x2, y2, z2)) {
        results.push(cachedPos(x2, y2, z2));
      }
    }
  }

  // Captures: only forward diagonals (same layer, one layer up, one layer down)
  for (const dz of [-1, 0, 1]) {
    for (const dx of [-1, 1]) {
      const cx = x + dx; const cy = y + fwdDir; const cz = z + dz;
      if (!board.isInBoundsXYZ(cx, cy, cz)) continue;
      const occ = board.getPieceAtXYZ(cx, cy, cz);
      if (occ && occ.color !== piece.color) results.push(cachedPos(cx, cy, cz));
    }
  }

  return results;
}

export function getAttackedSquares(board: Board, piece: Piece): Position3D[] {
  const candidates: Position3D[] = [];
  forEachAttackedSquare(board, piece, (x, y, z) => {
    candidates.push({ x, y, z });
  });
  return candidates;
}

export function forEachAttackedSquare(
  board: Board,
  piece: Piece,
  visit: (x: number, y: number, z: number) => void,
): void {
  switch (piece.type) {
    case PieceType.Rook:
    case PieceType.Bishop:
    case PieceType.Queen: {
      const dirs = piece.type === PieceType.Rook
        ? ROOK_DIRS
        : piece.type === PieceType.Bishop
          ? BISHOP_DIRS
          : QUEEN_DIRS;
      for (const [dx, dy, dz] of dirs) {
        let x = piece.position.x;
        let y = piece.position.y;
        let z = piece.position.z;
        while (true) {
          x += dx; y += dy; z += dz;
          if (!board.isInBoundsXYZ(x, y, z)) break;
          visit(x, y, z);
          if (board.getPieceAtXYZ(x, y, z)) break;
        }
      }
      return;
    }
    case PieceType.King:
    case PieceType.Knight: {
      const dirs = piece.type === PieceType.King ? KING_DIRS : KNIGHT_MOVES;
      for (const [dx, dy, dz] of dirs) {
        const x = piece.position.x + dx;
        const y = piece.position.y + dy;
        const z = piece.position.z + dz;
        if (!board.isInBoundsXYZ(x, y, z)) continue;
        visit(x, y, z);
      }
      return;
    }
    case PieceType.Pawn: {
      const fwdDir = piece.color === PieceColor.White ? 1 : -1;
      const x = piece.position.x;
      const y = piece.position.y;
      const z = piece.position.z;
      for (const dz of [-1, 0, 1]) {
        for (const dx of [-1, 1]) {
          const cx = x + dx;
          const cy = y + fwdDir;
          const cz = z + dz;
          if (!board.isInBoundsXYZ(cx, cy, cz)) continue;
          visit(cx, cy, cz);
        }
      }
      return;
    }
  }
}

function slideAttacks(board: Board, piece: Piece, dirs: Dir[]): Position3D[] {
  const results: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    let { x, y, z } = piece.position;
    while (true) {
      x += dx; y += dy; z += dz;
      if (!board.isInBoundsXYZ(x, y, z)) break;
      results.push(cachedPos(x, y, z));
      if (board.getPieceAtXYZ(x, y, z)) break;
    }
  }
  return results;
}

function stepAttacks(board: Board, piece: Piece, dirs: Dir[]): Position3D[] {
  const results: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    const x = piece.position.x + dx;
    const y = piece.position.y + dy;
    const z = piece.position.z + dz;
    if (!board.isInBoundsXYZ(x, y, z)) continue;
    results.push(cachedPos(x, y, z));
  }
  return results;
}

function pawnAttacks(board: Board, piece: Piece): Position3D[] {
  const results: Position3D[] = [];
  const fwdDir = piece.color === PieceColor.White ? 1 : -1;
  const { x, y, z } = piece.position;

  for (const dz of [-1, 0, 1]) {
    for (const dx of [-1, 1]) {
      const cx = x + dx; const cy = y + fwdDir; const cz = z + dz;
      if (!board.isInBoundsXYZ(cx, cy, cz)) continue;
      results.push(cachedPos(cx, cy, cz));
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

function slideAttacksKing(board: Board, kingPos: Position3D, attacker: Piece, dirs: Dir[]): boolean {
  for (const [dx, dy, dz] of dirs) {
    let { x, y, z } = attacker.position;
    while (true) {
      x += dx; y += dy; z += dz;
      if (x === kingPos.x && y === kingPos.y && z === kingPos.z) return true;
      if (x < 0 || x > 7 || y < 0 || y > 7 || z < 0 || z > 7) break;
      if (board.getPieceAtXYZ(x, y, z)) break;
    }
  }
  return false;
}

function stepAttacksKing(kingPos: Position3D, attacker: Piece, dirs: Dir[]): boolean {
  const ax = attacker.position.x;
  const ay = attacker.position.y;
  const az = attacker.position.z;
  for (const [dx, dy, dz] of dirs) {
    if (ax + dx === kingPos.x && ay + dy === kingPos.y && az + dz === kingPos.z) return true;
  }
  return false;
}

function pawnAttacksKing(kingPos: Position3D, attacker: Piece): boolean {
  const fwdDir = attacker.color === PieceColor.White ? 1 : -1;
  const ax = attacker.position.x;
  const ay = attacker.position.y;
  const az = attacker.position.z;
  
  if (ay + fwdDir !== kingPos.y) return false;
  
  const dx = Math.abs(ax - kingPos.x);
  const dz = Math.abs(az - kingPos.z);
  
  return dx === 1 && dz <= 1;
}

export function isKingInCheck(board: Board, color: PieceColor): boolean {
  const king = board.findKing(color);
  if (!king) return false;
  
  const kp = king.position;
  const enemy = color === PieceColor.White ? PieceColor.Black : PieceColor.White;
  
  const pieces = Array.from(board.getPiecesOfColor(enemy));
  for (const p of pieces) {
    switch (p.type) {
      case PieceType.Rook:
        if (slideAttacksKing(board, kp, p, ROOK_DIRS)) return true;
        break;
      case PieceType.Bishop:
        if (slideAttacksKing(board, kp, p, BISHOP_DIRS)) return true;
        break;
      case PieceType.Queen:
        if (slideAttacksKing(board, kp, p, QUEEN_DIRS)) return true;
        break;
      case PieceType.Knight:
        if (stepAttacksKing(kp, p, KNIGHT_MOVES)) return true;
        break;
      case PieceType.King:
        if (stepAttacksKing(kp, p, KING_DIRS)) return true;
        break;
      case PieceType.Pawn:
        if (pawnAttacksKing(kp, p)) return true;
        break;
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
    case PieceType.Pawn: return pawnAttackSquares(board, piece);
  }
}

function pawnAttackSquares(board: Board, piece: Piece): Position3D[] {
  const attacks: Position3D[] = [];
  const fwdDir = piece.color === PieceColor.White ? 1 : -1;
  const { x, y, z } = piece.position;
  for (const dz of [-1, 0, 1]) {
    for (const dx of [-1, 1]) {
      const pos = cachedPos(x + dx, y + fwdDir, z + dz);
      if (board.isInBounds(pos)) attacks.push(pos);
    }
  }
  return attacks;
}

export function getLegalMoves(board: Board, piece: Piece): Position3D[] {
  const candidates = getValidMoves(board, piece);
  const legal: Position3D[] = [];
  for (const to of candidates) {
    const applied = board.applyMove(piece, to);
    const inCheck = isKingInCheck(board, piece.color);
    board.unapplyMove(applied);
    if (!inCheck) legal.push(to);
  }
  return legal;
}

export function getCheckPath(board: Board, color: PieceColor): Position3D[] {
  const king = board.findKing(color);
  if (!king) return [];

  const enemy = color === PieceColor.White ? PieceColor.Black : PieceColor.White;
  const path: Position3D[] = [{ ...king.position }];

  for (const p of board.getPiecesOfColor(enemy)) {
    const moves = getRawMoves(board, p);
    const kp = king.position;
    if (!moves.some(m => m.x === kp.x && m.y === kp.y && m.z === kp.z)) continue;

    path.push({ ...p.position });

    if (p.type === PieceType.Rook || p.type === PieceType.Bishop || p.type === PieceType.Queen) {
      const dx = Math.sign(kp.x - p.position.x);
      const dy = Math.sign(kp.y - p.position.y);
      const dz = Math.sign(kp.z - p.position.z);
      let cx = p.position.x + dx;
      let cy = p.position.y + dy;
      let cz = p.position.z + dz;
      while (cx !== kp.x || cy !== kp.y || cz !== kp.z) {
        path.push({ x: cx, y: cy, z: cz });
        cx += dx;
        cy += dy;
        cz += dz;
      }
    }
  }

  return path;
}

function hasAnyLegalMove(board: Board, piece: Piece): boolean {
  const candidates = getValidMoves(board, piece);
  for (const to of candidates) {
    const applied = board.applyMove(piece, to);
    const inCheck = isKingInCheck(board, piece.color);
    board.unapplyMove(applied);
    if (!inCheck) return true;
  }
  return false;
}

export function isCheckmate(board: Board, color: PieceColor, inCheck?: boolean): boolean {
  if (inCheck === undefined) inCheck = isKingInCheck(board, color);
  if (!inCheck) return false;
  const pieces = Array.from(board.getPiecesOfColor(color));
  for (const p of pieces) {
    if (hasAnyLegalMove(board, p)) return false;
  }
  return true;
}

export function isStalemate(board: Board, color: PieceColor, inCheck?: boolean): boolean {
  if (inCheck === undefined) inCheck = isKingInCheck(board, color);
  if (inCheck) return false;
  const pieces = Array.from(board.getPiecesOfColor(color));
  for (const p of pieces) {
    if (hasAnyLegalMove(board, p)) return false;
  }
  return true;
}

export interface PiecePaths {
  clear: Position3D[];
  blocked: Position3D[];
}

function slidePathCells(board: Board, piece: Piece, dirs: Dir[]): PiecePaths {
  const clear: Position3D[] = [];
  const blocked: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    let { x, y, z } = piece.position;
    while (true) {
      x += dx; y += dy; z += dz;
      const pos: Position3D = { x, y, z };
      if (!board.isInBounds(pos)) break;
      const occupant = board.getPieceAt(pos);
      if (occupant) {
        if (occupant.color !== piece.color) blocked.push(pos);
        break;
      }
      clear.push(pos);
    }
  }
  return { clear, blocked };
}

function stepPathCells(board: Board, piece: Piece, dirs: Dir[]): PiecePaths {
  const clear: Position3D[] = [];
  const blocked: Position3D[] = [];
  for (const [dx, dy, dz] of dirs) {
    const pos: Position3D = {
      x: piece.position.x + dx,
      y: piece.position.y + dy,
      z: piece.position.z + dz,
    };
    if (!board.isInBounds(pos)) continue;
    const occupant = board.getPieceAt(pos);
    if (occupant) {
      if (occupant.color !== piece.color) blocked.push(pos);
    } else {
      clear.push(pos);
    }
  }
  return { clear, blocked };
}

function pawnPathCells(board: Board, piece: Piece): PiecePaths {
  const clear: Position3D[] = [];
  const blocked: Position3D[] = [];
  const fwdDir = piece.color === PieceColor.White ? 1 : -1;
  const { x, y, z } = piece.position;

  const classifyCapture = (pos: Position3D) => {
    if (!board.isInBounds(pos)) return;
    const occ = board.getPieceAt(pos);
    if (occ) {
      if (occ.color !== piece.color) blocked.push(pos);
    } else {
      clear.push(pos);
    }
  };

  const moveDirs: Dir[] = [
    [0, fwdDir, 0],   // forward
    [0, 0, 1],        // layer up
    [0, 0, -1],       // layer down
    [0, fwdDir, 1],   // forward staircase up
    [0, fwdDir, -1],  // forward staircase down
  ];

  for (const [dx, dy, dz] of moveDirs) {
    const step1: Position3D = { x: x + dx, y: y + dy, z: z + dz };
    if (!board.isInBounds(step1) || board.getPieceAt(step1)) continue;
    clear.push(step1);
    if (!piece.hasMoved) {
      const step2: Position3D = { x: x + dx * 2, y: y + dy * 2, z: z + dz * 2 };
      if (board.isInBounds(step2) && !board.getPieceAt(step2)) {
        clear.push(step2);
      }
    }
  }

  // Captures: only forward diagonals (same layer, one layer up, one layer down)
  for (const dz of [-1, 0, 1]) {
    for (const dx of [-1, 1]) {
      classifyCapture({ x: x + dx, y: y + fwdDir, z: z + dz });
    }
  }

  return { clear, blocked };
}

export function getPiecePaths(board: Board, piece: Piece): PiecePaths {
  switch (piece.type) {
    case PieceType.Rook:   return slidePathCells(board, piece, ROOK_DIRS);
    case PieceType.Bishop: return slidePathCells(board, piece, BISHOP_DIRS);
    case PieceType.Queen:  return slidePathCells(board, piece, QUEEN_DIRS);
    case PieceType.King:   return stepPathCells(board, piece, KING_DIRS);
    case PieceType.Knight: return stepPathCells(board, piece, KNIGHT_MOVES);
    case PieceType.Pawn:   return pawnPathCells(board, piece);
  }
}

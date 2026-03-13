export enum PieceType {
  King = 'king',
  Queen = 'queen',
  Rook = 'rook',
  Bishop = 'bishop',
  Knight = 'knight',
  Pawn = 'pawn',
}

export enum PieceColor {
  White = 'white',
  Black = 'black',
}

export interface Position3D {
  x: number; // column 0-7
  y: number; // row 0-7
  z: number; // layer 0-7
}

export interface Piece {
  type: PieceType;
  color: PieceColor;
  position: Position3D;
  hasMoved: boolean;
}

export interface Move {
  from: Position3D;
  to: Position3D;
  captured?: Piece;
}

export function posEqual(a: Position3D, b: Position3D): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function posKey(p: Position3D): number {
  return (p.x & 7) | ((p.y & 7) << 3) | ((p.z & 7) << 6);
}

export function posKeyXYZ(x: number, y: number, z: number): number {
  return (x & 7) | ((y & 7) << 3) | ((z & 7) << 6);
}

/**
 * Convert board coordinates to Three.js render coordinates.
 * Board y (row, the direction armies face) → 3D z (depth / front-back)
 * Board z (layer) → 3D y (vertical / up-down)
 * This makes armies face each other across the board horizontally.
 */
export function boardToWorld(p: Position3D): [number, number, number] {
  return [p.x, p.z, p.y];
}

export interface HistoryEntry {
  pieces: Piece[];
  currentTurn: PieceColor;
  capturedWhite: Piece[];
  capturedBlack: Piece[];
  lastMove?: { from: Position3D; to: Position3D };
}

export type Difficulty = 'easy' | 'medium' | 'hard';
export type SetupMode = 'classic' | 'barricade' | 'pawnWall';

export interface GameMode {
  type: 'bot' | 'online';
  setup?: SetupMode;
  difficulty?: Difficulty;
  localColor?: PieceColor;
}

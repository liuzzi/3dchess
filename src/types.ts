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

export function posKey(p: Position3D): string {
  return `${p.x},${p.y},${p.z}`;
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

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameMode {
  type: 'local' | 'bot';
  difficulty?: Difficulty;
}

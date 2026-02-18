import { Piece, PieceColor, PieceType, Position3D, posKey } from './types';

const BACK_RANK: PieceType[] = [
  PieceType.Rook, PieceType.Knight, PieceType.Bishop, PieceType.Queen,
  PieceType.King, PieceType.Bishop, PieceType.Knight, PieceType.Rook,
];

export class Board {
  pieces: Piece[] = [];

  private pieceMap = new Map<string, Piece>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.pieces = [];
    this.pieceMap.clear();

    const centerZ = 3; // layer 4 (1-indexed) — center of cube

    // White: back rank at y=0, pawns at y=1, on center layer
    for (let x = 0; x < 8; x++) {
      this.addPiece({ type: BACK_RANK[x], color: PieceColor.White, position: { x, y: 0, z: centerZ }, hasMoved: false });
      this.addPiece({ type: PieceType.Pawn, color: PieceColor.White, position: { x, y: 1, z: centerZ }, hasMoved: false });
    }

    // Black: back rank at y=7, pawns at y=6, same center layer — facing White across y
    for (let x = 0; x < 8; x++) {
      this.addPiece({ type: BACK_RANK[x], color: PieceColor.Black, position: { x, y: 7, z: centerZ }, hasMoved: false });
      this.addPiece({ type: PieceType.Pawn, color: PieceColor.Black, position: { x, y: 6, z: centerZ }, hasMoved: false });
    }
  }

  private addPiece(piece: Piece): void {
    this.pieces.push(piece);
    this.pieceMap.set(posKey(piece.position), piece);
  }

  getPieceAt(pos: Position3D): Piece | undefined {
    return this.pieceMap.get(posKey(pos));
  }

  movePiece(piece: Piece, to: Position3D): Piece | undefined {
    const captured = this.getPieceAt(to);
    if (captured) {
      this.removePiece(captured);
    }

    this.pieceMap.delete(posKey(piece.position));
    piece.position = { ...to };
    piece.hasMoved = true;
    this.pieceMap.set(posKey(piece.position), piece);

    return captured;
  }

  removePiece(piece: Piece): void {
    this.pieceMap.delete(posKey(piece.position));
    const idx = this.pieces.indexOf(piece);
    if (idx >= 0) this.pieces.splice(idx, 1);
  }

  isInBounds(pos: Position3D): boolean {
    return pos.x >= 0 && pos.x < 8 && pos.y >= 0 && pos.y < 8 && pos.z >= 0 && pos.z < 8;
  }

  getPiecesOfColor(color: PieceColor): Piece[] {
    return this.pieces.filter(p => p.color === color);
  }

  findKing(color: PieceColor): Piece | undefined {
    return this.pieces.find(p => p.type === PieceType.King && p.color === color);
  }

  clone(): Board {
    const b = new Board();
    b.pieces = [];
    b.pieceMap.clear();
    for (const p of this.pieces) {
      const copy: Piece = { type: p.type, color: p.color, position: { ...p.position }, hasMoved: p.hasMoved };
      b.pieces.push(copy);
      b.pieceMap.set(posKey(copy.position), copy);
    }
    return b;
  }

  serialize(): Piece[] {
    return this.pieces.map(p => ({
      type: p.type,
      color: p.color,
      position: { ...p.position },
      hasMoved: p.hasMoved,
    }));
  }

  static deserialize(data: Piece[]): Board {
    const b = new Board();
    b.pieces = [];
    b.pieceMap.clear();
    for (const p of data) {
      const piece: Piece = { type: p.type, color: p.color, position: { ...p.position }, hasMoved: p.hasMoved };
      b.pieces.push(piece);
      b.pieceMap.set(posKey(piece.position), piece);
    }
    return b;
  }
}

import { Piece, PieceColor, PieceType, Position3D, SetupMode, posKey } from './types';

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

  reset(setup: SetupMode = 'classic'): void {
    this.pieces = [];
    this.pieceMap.clear();

    const centerZ = 3; // layer 4 (1-indexed) — center of cube

    // White back rank on center layer.
    for (let x = 0; x < 8; x++) {
      this.addPiece({ type: BACK_RANK[x], color: PieceColor.White, position: { x, y: 0, z: centerZ }, hasMoved: false });
    }

    // Black back rank on center layer.
    for (let x = 0; x < 8; x++) {
      this.addPiece({ type: BACK_RANK[x], color: PieceColor.Black, position: { x, y: 7, z: centerZ }, hasMoved: false });
    }

    // Classic pawn rows on center layer.
    for (let x = 0; x < 8; x++) {
      this.addPiece({ type: PieceType.Pawn, color: PieceColor.White, position: { x, y: 1, z: centerZ }, hasMoved: false });
      this.addPiece({ type: PieceType.Pawn, color: PieceColor.Black, position: { x, y: 6, z: centerZ }, hasMoved: false });
    }

    if (setup !== 'barricade') return;

    // Barricade adds extra pawn rows around main pieces.
    const whiteBarricadeRows = [
      { y: 0, z: 4 }, // L5,1
      { y: 1, z: 4 }, // L5,2
      { y: 0, z: 2 }, // L3,1
      { y: 1, z: 2 }, // L3,2
    ];
    const blackBarricadeRows = [
      { y: 7, z: 4 }, // L5,8
      { y: 6, z: 4 }, // L5,7
      { y: 7, z: 2 }, // L3,8
      { y: 6, z: 2 }, // L3,7
    ];

    for (let x = 0; x < 8; x++) {
      for (const row of whiteBarricadeRows) {
        this.addPiece({
          type: PieceType.Pawn,
          color: PieceColor.White,
          position: { x, y: row.y, z: row.z },
          hasMoved: false,
        });
      }
      for (const row of blackBarricadeRows) {
        this.addPiece({
          type: PieceType.Pawn,
          color: PieceColor.Black,
          position: { x, y: row.y, z: row.z },
          hasMoved: false,
        });
      }
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

  applyMove(piece: Piece, to: Position3D): AppliedMove {
    const from = { ...piece.position };
    const previousHasMoved = piece.hasMoved;
    const previousType = piece.type;
    let captured = this.getPieceAt(to);
    let capturedIndex = -1;

    if (captured) {
      capturedIndex = this.pieces.indexOf(captured);
      this.removePiece(captured);
    }

    this.pieceMap.delete(posKey(piece.position));
    piece.position = { ...to };
    piece.hasMoved = true;
    this.pieceMap.set(posKey(piece.position), piece);

    return {
      piece,
      from,
      to: { ...to },
      captured,
      capturedIndex,
      previousHasMoved,
      previousType,
    };
  }

  unapplyMove(applied: AppliedMove): void {
    const { piece, from, captured, capturedIndex, previousHasMoved, previousType } = applied;
    this.pieceMap.delete(posKey(piece.position));
    piece.position = { ...from };
    piece.hasMoved = previousHasMoved;
    piece.type = previousType;
    this.pieceMap.set(posKey(piece.position), piece);

    if (captured) {
      const restorePos = { ...applied.to };
      captured.position = restorePos;
      this.pieceMap.set(posKey(restorePos), captured);
      if (capturedIndex >= 0 && capturedIndex <= this.pieces.length) {
        this.pieces.splice(capturedIndex, 0, captured);
      } else {
        this.pieces.push(captured);
      }
    }
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

export interface AppliedMove {
  piece: Piece;
  from: Position3D;
  to: Position3D;
  captured?: Piece;
  capturedIndex: number;
  previousHasMoved: boolean;
  previousType: PieceType;
}

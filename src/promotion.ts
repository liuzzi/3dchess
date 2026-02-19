import { Piece, PieceColor, PieceType } from './types';

export function isPromotionSquare(piece: Piece): boolean {
  if (piece.type !== PieceType.Pawn) return false;
  const promoRow = piece.color === PieceColor.White ? 7 : 0;
  return piece.position.y === promoRow;
}

export function autoPromoteToQueen(piece: Piece): boolean {
  if (!isPromotionSquare(piece)) return false;
  piece.type = PieceType.Queen;
  return true;
}

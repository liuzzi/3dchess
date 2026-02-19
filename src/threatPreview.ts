import { Board } from './board';
import { getValidMoves } from './movement';
import { Piece, PieceColor, Position3D } from './types';

export interface ThreatPair {
  from: Position3D;
  to: Position3D;
}

function collectThreatPairs(
  board: Board,
  attackerColor: PieceColor,
  victimColor: PieceColor,
): ThreatPair[] {
  const pairs: ThreatPair[] = [];
  for (const attacker of board.getPiecesOfColor(attackerColor)) {
    const attacks = getValidMoves(board, attacker);
    for (const attackPos of attacks) {
      const occ = board.getPieceAt(attackPos);
      if (occ && occ.color === victimColor) {
        pairs.push({ from: { ...attacker.position }, to: { ...attackPos } });
      }
    }
  }
  return pairs;
}

export function computeThreatLinesAfterMove(
  board: Board,
  moverColor: PieceColor,
): ThreatPair[] {
  const targetColor = moverColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  return collectThreatPairs(board, moverColor, targetColor);
}

export function computeHoverThreatPreview(
  board: Board,
  selectedPiece: Piece,
  hoverPos: Position3D,
): { dangerPairs: ThreatPair[]; threatPairs: ThreatPair[] } | null {
  const myColor = selectedPiece.color;
  const enemyColor = myColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  const sim = board.clone();
  const simPiece = sim.getPieceAt(selectedPiece.position);
  if (!simPiece) return null;
  sim.movePiece(simPiece, hoverPos);

  return {
    dangerPairs: collectThreatPairs(sim, enemyColor, myColor),
    threatPairs: collectThreatPairs(sim, myColor, enemyColor),
  };
}

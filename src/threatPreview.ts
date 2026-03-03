import { Board } from './board';
import { getValidMoves } from './movement';
import { Piece, PieceColor, Position3D } from './types';

export interface ThreatPair {
  from: Position3D;
  to: Position3D;
}

export interface ThreatPairsByAttacker {
  white: ThreatPair[];
  black: ThreatPair[];
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

export function computeThreatLinesByAttacker(board: Board): ThreatPairsByAttacker {
  const white: ThreatPair[] = [];
  const black: ThreatPair[] = [];
  for (const attacker of board.pieces) {
    const attacks = getValidMoves(board, attacker);
    for (const attackPos of attacks) {
      const occ = board.getPieceAt(attackPos);
      if (!occ || occ.color === attacker.color) continue;
      const pair = { from: { ...attacker.position }, to: { ...attackPos } };
      if (attacker.color === PieceColor.White) {
        white.push(pair);
      } else {
        black.push(pair);
      }
    }
  }
  return { white, black };
}

export function computeProtectionLinesForThreatenedPieces(
  board: Board,
  attackerColor: PieceColor,
  precomputedThreats?: ThreatPair[],
): ThreatPair[] {
  const threatenedColor = attackerColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  const threats = precomputedThreats ?? collectThreatPairs(board, attackerColor, threatenedColor);
  if (threats.length === 0) return [];

  const threatenedSquares = new Map<string, Position3D>();
  for (const threat of threats) {
    threatenedSquares.set(`${threat.to.x},${threat.to.y},${threat.to.z}`, threat.to);
  }

  const protectionPairs: ThreatPair[] = [];
  const enemyOfThreatened = threatenedColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  for (const targetPos of threatenedSquares.values()) {
    const threatenedPiece = board.getPieceAt(targetPos);
    if (!threatenedPiece || threatenedPiece.color !== threatenedColor) continue;

    // Temporarily treat the threatened piece as enemy so allied move generation
    // includes captures onto this square (i.e. defenders/protectors).
    threatenedPiece.color = enemyOfThreatened;
    for (const protector of board.getPiecesOfColor(threatenedColor)) {
      const moves = getValidMoves(board, protector);
      if (moves.some((m) => m.x === targetPos.x && m.y === targetPos.y && m.z === targetPos.z)) {
        protectionPairs.push({ from: { ...protector.position }, to: { ...targetPos } });
      }
    }
    threatenedPiece.color = threatenedColor;
  }

  return protectionPairs;
}

export function computeHoverThreatPreview(
  board: Board,
  selectedPiece: Piece,
  hoverPos: Position3D,
): { dangerPairs: ThreatPair[]; threatPairs: ThreatPair[]; protectionPairs: ThreatPair[] } | null {
  const myColor = selectedPiece.color;
  const enemyColor = myColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  const applied = board.applyMove(selectedPiece, hoverPos);
  try {
    const landedPiece = selectedPiece;

    // Treat the hovered piece as enemy while scanning allied moves so legal capture
    // generation can be reused to determine which allies protect this square.
    const protectionPairs: ThreatPair[] = [];
    landedPiece.color = enemyColor;
    try {
      for (const protector of board.getPiecesOfColor(myColor)) {
        const moves = getValidMoves(board, protector);
        if (moves.some((m) => m.x === hoverPos.x && m.y === hoverPos.y && m.z === hoverPos.z)) {
          protectionPairs.push({ from: { ...protector.position }, to: { ...hoverPos } });
        }
      }
    } finally {
      landedPiece.color = myColor;
    }

    return {
      dangerPairs: collectThreatPairs(board, enemyColor, myColor),
      threatPairs: collectThreatPairs(board, myColor, enemyColor),
      protectionPairs,
    };
  } finally {
    board.unapplyMove(applied);
  }
}

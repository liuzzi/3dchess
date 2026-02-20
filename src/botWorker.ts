import { Board } from './board';
import { getLegalMoves, getValidMoves, isKingInCheck } from './movement';
import { Piece, PieceColor, PieceType, Position3D, Difficulty, posKey } from './types';
import { autoPromoteToQueen } from './promotion';

const PIECE_VALUE: Record<PieceType, number> = {
  [PieceType.Pawn]: 100,
  [PieceType.Knight]: 320,
  [PieceType.Bishop]: 330,
  [PieceType.Rook]: 500,
  [PieceType.Queen]: 900,
  [PieceType.King]: 20000,
};

const MG_VALUE: Record<PieceType, number> = {
  [PieceType.Pawn]: 100,
  [PieceType.Knight]: 325,
  [PieceType.Bishop]: 335,
  [PieceType.Rook]: 505,
  [PieceType.Queen]: 930,
  [PieceType.King]: 0,
};

const EG_VALUE: Record<PieceType, number> = {
  [PieceType.Pawn]: 120,
  [PieceType.Knight]: 300,
  [PieceType.Bishop]: 320,
  [PieceType.Rook]: 520,
  [PieceType.Queen]: 900,
  [PieceType.King]: 0,
};

const TIME_LIMIT: Record<Difficulty, number> = {
  easy: 800,
  medium: 3500,
  hard: 9000,
};

const MAX_DEPTH: Record<Difficulty, number> = {
  easy: 2,
  medium: 7,
  hard: 11,
};

class SearchAborted extends Error {}

let nodesSearched = 0;
let searchDeadline = 0;
let nodeLimit = Infinity;

const NODE_LIMIT: Record<Difficulty, number> = {
  easy: 160_000,
  medium: 700_000,
  hard: 1_800_000,
};

const MATE_SCORE = 1_000_000;
const HISTORY_BONUS_SCALE = 0.15;
const MAX_TT_ENTRIES = 180_000;
const QUIESCENCE_MAX_PLY = 7;
const Q_CHECK_PLY_LIMIT = 2;
const CHECK_EXTENSION_BUDGET = 2;
const RECAPTURE_EXTENSION_BUDGET = 1;
const ASPIRATION_BASE = 45;
const ASPIRATION_MAX = 900;
const NULL_MOVE_REDUCTION = 2;

interface MoveCandidate {
  piece: Piece;
  to: Position3D;
  captured?: Piece;
}

interface ScoredMove {
  fromPos: Position3D;
  to: Position3D;
  score: number;
  rawScore: number;
}

export interface RootMove {
  fromPos: Position3D;
  to: Position3D;
}

interface DepthResult {
  depth: number;
  fromPos: Position3D;
  to: Position3D;
  score: number;
}

interface TimeBudget {
  softMs: number;
  hardMs: number;
}

type BoundFlag = 'exact' | 'alpha' | 'beta';

interface TranspositionEntry {
  depth: number;
  score: number;
  flag: BoundFlag;
  bestMoveKey?: string;
}

const transpositionTable = new Map<string, TranspositionEntry>();
const historyTable = new Map<string, number>();
const killerMoves = new Map<number, [string, string]>();

function checkTime(): void {
  nodesSearched++;
  if (nodesSearched % 1024 !== 0) return;
  if (nodesSearched >= nodeLimit) throw new SearchAborted();
  if (searchDeadline > 0 && Date.now() >= searchDeadline) throw new SearchAborted();
}

function getOpponent(color: PieceColor): PieceColor {
  return color === PieceColor.White ? PieceColor.Black : PieceColor.White;
}

function pieceTypeIndex(type: PieceType): number {
  switch (type) {
    case PieceType.Pawn: return 1;
    case PieceType.Knight: return 2;
    case PieceType.Bishop: return 3;
    case PieceType.Rook: return 4;
    case PieceType.Queen: return 5;
    case PieceType.King: return 6;
  }
}

function hashBoard(board: Board, toMove: PieceColor): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  for (const p of board.pieces) {
    const t = pieceTypeIndex(p.type);
    const c = p.color === PieceColor.White ? 1 : 2;
    const hm = p.hasMoved ? 1 : 0;
    const sq = (p.position.x & 7) | ((p.position.y & 7) << 3) | ((p.position.z & 7) << 6);
    const code = t | (c << 3) | (hm << 5) | (sq << 6);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul((h2 + code) ^ (code << 7), 2246822519);
  }

  h1 ^= board.pieces.length * 131;
  h2 ^= (toMove === PieceColor.White ? 17 : 29) * 257;
  return `${h1 >>> 0}:${h2 >>> 0}:${board.pieces.length}`;
}

function boardSignature(board: Board): string {
  const parts = board.pieces
    .map((p) => `${p.type}:${p.color}:${p.hasMoved ? 1 : 0}:${p.position.x}${p.position.y}${p.position.z}`)
    .sort();
  return `${board.pieces.length}|${parts.join('|')}`;
}

function centerBonus(pos: Position3D): number {
  const cx = Math.abs(pos.x - 3.5);
  const cy = Math.abs(pos.y - 3.5);
  const cz = Math.abs(pos.z - 3.5);
  const maxDist = 3.5 * 3;
  const dist = cx + cy + cz;
  return ((maxDist - dist) / maxDist) * 30;
}

function progressBonus(piece: Piece): number {
  if (piece.type !== PieceType.Pawn) return 0;
  const progress = piece.color === PieceColor.White ? piece.position.y : (7 - piece.position.y);
  return progress * 8;
}

function centrality(pos: Position3D): number {
  const cx = Math.abs(pos.x - 3.5);
  const cy = Math.abs(pos.y - 3.5);
  const cz = Math.abs(pos.z - 3.5);
  const dist = cx + cy + cz;
  return 10.5 - dist;
}

function kingRingAttackPressure(board: Board, kingColor: PieceColor, attackerColor: PieceColor): number {
  const king = board.findKing(kingColor);
  if (!king) return 0;
  let pressure = 0;
  for (const p of board.getPiecesOfColor(attackerColor)) {
    for (const m of getValidMoves(board, p)) {
      if (
        Math.abs(m.x - king.position.x) <= 1 &&
        Math.abs(m.y - king.position.y) <= 1 &&
        Math.abs(m.z - king.position.z) <= 1
      ) {
        pressure += p.type === PieceType.Queen ? 6 : p.type === PieceType.Rook ? 4 : 2;
      }
    }
  }
  return pressure;
}

function pawnStructureScore(board: Board, color: PieceColor): number {
  const pawns = board.getPiecesOfColor(color).filter(p => p.type === PieceType.Pawn);
  if (pawns.length === 0) return 0;

  const fileCounts = new Map<string, number>();
  const pawnSet = new Set<string>();
  for (const p of pawns) {
    const key = `${p.position.x},${p.position.z}`;
    pawnSet.add(key);
    fileCounts.set(key, (fileCounts.get(key) ?? 0) + 1);
  }

  let score = 0;
  for (const p of pawns) {
    const fileKey = `${p.position.x},${p.position.z}`;
    const fileCount = fileCounts.get(fileKey) ?? 1;
    if (fileCount > 1) score -= (fileCount - 1) * 9;

    const hasNeighbor = pawnSet.has(`${p.position.x - 1},${p.position.z}`)
      || pawnSet.has(`${p.position.x + 1},${p.position.z}`)
      || pawnSet.has(`${p.position.x},${p.position.z - 1}`)
      || pawnSet.has(`${p.position.x},${p.position.z + 1}`);
    if (!hasNeighbor) score -= 12;
    score += progressBonus(p) * 0.8;
  }
  return score;
}

function pieceActivity(board: Board, piece: Piece): number {
  // Pseudo-legal mobility is much cheaper than full legal move generation.
  const mobility = getValidMoves(board, piece).length;
  switch (piece.type) {
    case PieceType.Pawn: return mobility;
    case PieceType.Knight: return mobility * 3;
    case PieceType.Bishop: return mobility * 3;
    case PieceType.Rook: return mobility * 2;
    case PieceType.Queen: return mobility * 2;
    case PieceType.King: return mobility;
  }
}

function evaluate(board: Board, botColor: PieceColor, toMove: PieceColor): number {
  const opponentColor = botColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  const phaseMaterial = board.pieces
    .filter(p => p.type !== PieceType.King)
    .reduce((acc, p) => acc + MG_VALUE[p.type], 0);
  const phase = Math.min(1, phaseMaterial / 8000);

  let mg = 0;
  let eg = 0;
  for (const piece of board.pieces) {
    const sign = piece.color === botColor ? 1 : -1;
    const central = centrality(piece.position);
    const mobility = pieceActivity(board, piece);

    let mgTerm = MG_VALUE[piece.type] + mobility * 1.5 + central * (piece.type === PieceType.King ? -1.4 : 1.7);
    let egTerm = EG_VALUE[piece.type] + mobility + central * (piece.type === PieceType.King ? 2.2 : 1.0);

    if (piece.type === PieceType.Pawn) {
      mgTerm += progressBonus(piece) * 0.6;
      egTerm += progressBonus(piece) * 1.2;
    }

    mg += sign * mgTerm;
    eg += sign * egTerm;
  }

  mg += pawnStructureScore(board, botColor) - pawnStructureScore(board, opponentColor);
  eg += pawnStructureScore(board, botColor) * 0.8 - pawnStructureScore(board, opponentColor) * 0.8;

  const botKingPressure = kingRingAttackPressure(board, botColor, opponentColor);
  const oppKingPressure = kingRingAttackPressure(board, opponentColor, botColor);
  mg += (oppKingPressure - botKingPressure) * 12;
  eg += (oppKingPressure - botKingPressure) * 6;

  let score = mg * phase + eg * (1 - phase);
  if (isKingInCheck(board, opponentColor)) score += 90;
  if (isKingInCheck(board, botColor)) score -= 110;
  return toMove === botColor ? score : -score;
}

function getAllMoves(board: Board, color: PieceColor): MoveCandidate[] {
  const moves: MoveCandidate[] = [];
  for (const piece of board.getPiecesOfColor(color)) {
    for (const to of getLegalMoves(board, piece)) {
      moves.push({ piece, to, captured: board.getPieceAt(to) });
    }
  }
  return moves;
}

function moveKey(from: Position3D, to: Position3D): string {
  return `${posKey(from)}>${posKey(to)}`;
}

function moveKeyOf(move: MoveCandidate): string {
  return moveKey(move.piece.position, move.to);
}

function historyScore(move: MoveCandidate): number {
  return historyTable.get(moveKeyOf(move)) ?? 0;
}

function promotionScore(move: MoveCandidate): number {
  if (move.piece.type !== PieceType.Pawn) return 0;
  const promoRow = move.piece.color === PieceColor.White ? 7 : 0;
  return move.to.y === promoRow ? 850 : 0;
}

function captureScore(move: MoveCandidate): number {
  if (!move.captured) return 0;
  // MVV-LVA style ordering: high-value victim with low-value attacker first.
  return PIECE_VALUE[move.captured.type] * 10 - PIECE_VALUE[move.piece.type];
}

function orderMoves(
  moves: MoveCandidate[],
  ply: number,
  pvMoveKey?: string,
  board?: Board,
): MoveCandidate[] {
  const killers = killerMoves.get(ply);
  const scoreMap = new Map<string, number>();

  for (const move of moves) {
    const key = moveKeyOf(move);
    const killerBoost = killers && (key === killers[0] || key === killers[1]) ? 1400 : 0;
    const pvBoost = pvMoveKey && key === pvMoveKey ? 1_000_000 : 0;
    let score = pvBoost + captureScore(move) + promotionScore(move) + killerBoost + historyScore(move) * HISTORY_BONUS_SCALE;

    // Expensive tactical sort bonus only for early plies where ordering impact is highest.
    if (board && ply <= 1) {
      const applied = board.applyMove(move.piece, move.to);
      try {
        autoPromoteToQueen(move.piece);
        if (isKingInCheck(board, getOpponent(move.piece.color))) {
          score += 550;
        }
      } finally {
        board.unapplyMove(applied);
      }
    }

    scoreMap.set(key, score);
  }

  return moves.sort((a, b) => (scoreMap.get(moveKeyOf(b)) ?? 0) - (scoreMap.get(moveKeyOf(a)) ?? 0));
}

function registerCutoff(move: MoveCandidate, ply: number, depth: number): void {
  const key = moveKey(move.piece.position, move.to);
  const current = historyTable.get(key) ?? 0;
  if (!move.captured) {
    historyTable.set(key, current + depth * depth);
    const killers = killerMoves.get(ply) ?? ['', ''];
    if (killers[0] !== key) {
      killers[1] = killers[0];
      killers[0] = key;
      killerMoves.set(ply, killers);
    }
  }
}

function shouldSearchCapture(move: MoveCandidate): boolean {
  if (!move.captured) return false;
  const capturedValue = PIECE_VALUE[move.captured.type];
  const attackerValue = PIECE_VALUE[move.piece.type];
  // Coarse SEE-like filter: keep equal/better trades and near-equal tactical captures.
  return capturedValue + 70 >= attackerValue;
}

function staticExchangeApprox(board: Board, move: MoveCandidate): number {
  if (!move.captured) return 0;
  const target = move.to;
  const attacker = move.piece;
  const victimValue = PIECE_VALUE[move.captured.type];
  const attackerValue = PIECE_VALUE[attacker.type];
  let swing = victimValue - attackerValue;

  const applied = board.applyMove(attacker, target);
  try {
    autoPromoteToQueen(attacker);
    const enemy = getOpponent(attacker.color);
    let cheapest = Infinity;
    for (const p of board.getPiecesOfColor(enemy)) {
      const canCap = getLegalMoves(board, p).some(m => m.x === target.x && m.y === target.y && m.z === target.z);
      if (!canCap) continue;
      cheapest = Math.min(cheapest, PIECE_VALUE[p.type]);
    }
    if (cheapest !== Infinity) swing -= cheapest;
  } finally {
    board.unapplyMove(applied);
  }
  return swing;
}

function quiescenceMoves(board: Board, color: PieceColor, ply: number): MoveCandidate[] {
  const moves: MoveCandidate[] = [];
  const includeCheckMoves = ply <= Q_CHECK_PLY_LIMIT;

  for (const piece of board.getPiecesOfColor(color)) {
    const legal = getLegalMoves(board, piece);
    for (const to of legal) {
      const captured = board.getPieceAt(to);
      const isCapture = Boolean(captured);
      const isPromo = piece.type === PieceType.Pawn && (to.y === 7 || to.y === 0);

      if (isCapture && captured) {
        const candidate: MoveCandidate = { piece, to, captured };
        if (shouldSearchCapture(candidate) && staticExchangeApprox(board, candidate) >= -40) {
          moves.push(candidate);
          continue;
        }
      } else if (isPromo) {
        moves.push({ piece, to });
        continue;
      }

      if (!includeCheckMoves) continue;

      const applied = board.applyMove(piece, to);
      try {
        autoPromoteToQueen(piece);
        if (isKingInCheck(board, getOpponent(color))) {
          moves.push({ piece, to, captured: captured ?? undefined });
        }
      } finally {
        board.unapplyMove(applied);
      }
    }
  }

  return moves;
}

function quiescence(
  board: Board,
  alpha: number,
  beta: number,
  toMove: PieceColor,
  botColor: PieceColor,
  ply: number,
): number {
  checkTime();

  // In-check positions cannot use stand-pat; side must play an evasion.
  if (isKingInCheck(board, toMove)) {
    const evasions = orderMoves(getAllMoves(board, toMove), ply);
    if (evasions.length === 0) return -MATE_SCORE + ply;
    if (ply >= QUIESCENCE_MAX_PLY) return evaluate(board, botColor, toMove);

    let best = -Infinity;
    for (const move of evasions) {
      let score: number;
      const applied = board.applyMove(move.piece, move.to);
      try {
        autoPromoteToQueen(move.piece);
        score = -quiescence(board, -beta, -alpha, getOpponent(toMove), botColor, ply + 1);
      } finally {
        board.unapplyMove(applied);
      }

      if (score > best) best = score;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return best;
  }

  const standPat = evaluate(board, botColor, toMove);
  if (standPat >= beta) return standPat;
  if (standPat > alpha) alpha = standPat;

  if (ply >= QUIESCENCE_MAX_PLY) return standPat;

  const tactical = orderMoves(quiescenceMoves(board, toMove, ply), ply, undefined, board);
  for (const move of tactical) {
    if (move.captured) {
      const delta = PIECE_VALUE[move.captured.type];
      if (standPat + delta + 45 < alpha) continue;
    }
    let score: number;
    const applied = board.applyMove(move.piece, move.to);
    try {
      autoPromoteToQueen(move.piece);
      score = -quiescence(board, -beta, -alpha, getOpponent(toMove), botColor, ply + 1);
    } finally {
      board.unapplyMove(applied);
    }

    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }

  return alpha;
}

function negamax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  toMove: PieceColor,
  botColor: PieceColor,
  ply: number,
  lastCaptureSquare?: string,
  checkExtBudget = CHECK_EXTENSION_BUDGET,
  recaptureExtBudget = RECAPTURE_EXTENSION_BUDGET,
): number {
  checkTime();
  const alphaOrig = alpha;
  const betaOrig = beta;
  const hash = hashBoard(board, toMove);

  const tt = transpositionTable.get(hash);
  if (tt && tt.depth >= depth) {
    if (tt.flag === 'exact') return tt.score;
    if (tt.flag === 'alpha') beta = Math.min(beta, tt.score);
    if (tt.flag === 'beta') alpha = Math.max(alpha, tt.score);
    if (alpha >= beta) return tt.score;
  }

  if (depth === 0) return quiescence(board, alpha, beta, toMove, botColor, ply);

  const moves = getAllMoves(board, toMove);

  if (moves.length === 0) {
    if (isKingInCheck(board, toMove)) {
      return -MATE_SCORE + ply;
    }
    return 0;
  }

  const inCheck = isKingInCheck(board, toMove);
  if (!inCheck && depth >= 3) {
    const staticEval = evaluate(board, botColor, toMove);
    const hasNonPawnMaterial = board.getPiecesOfColor(toMove).some(p => p.type !== PieceType.Pawn && p.type !== PieceType.King);
    if (hasNonPawnMaterial && staticEval >= beta) {
      const nullScore = -negamax(
        board,
        depth - 1 - NULL_MOVE_REDUCTION,
        -beta,
        -beta + 1,
        getOpponent(toMove),
        botColor,
        ply + 1,
        undefined,
        checkExtBudget,
        recaptureExtBudget,
      );
      if (nullScore >= beta) return nullScore;
    }
  }

  const ordered = orderMoves(moves, ply, tt?.bestMoveKey, board);
  let best = -Infinity;
  let bestKey: string | undefined;

  for (let moveIndex = 0; moveIndex < ordered.length; moveIndex++) {
    const move = ordered[moveIndex];
    let score: number;
    const applied = board.applyMove(move.piece, move.to);
    try {
      autoPromoteToQueen(move.piece);
      const givesCheck = isKingInCheck(board, getOpponent(toMove));
      const isRecapture = move.captured !== undefined && lastCaptureSquare !== undefined && posKey(move.to) === lastCaptureSquare;
      const canCheckExtend = givesCheck && checkExtBudget > 0;
      const canRecaptureExtend = isRecapture && recaptureExtBudget > 0;
      const extension = canCheckExtend || canRecaptureExtend ? 1 : 0;
      const nextDepth = depth - 1 + extension;
      const isQuiet = !move.captured && promotionScore(move) === 0 && !givesCheck;
      const canReduce = nextDepth >= 3 && moveIndex >= 3 && isQuiet && !inCheck;
      const reduction = canReduce ? (moveIndex >= 8 ? 2 : 1) : 0;
      const reducedDepth = Math.max(0, nextDepth - reduction);

      if (moveIndex === 0) {
        score = -negamax(
          board,
          nextDepth,
          -beta,
          -alpha,
          getOpponent(toMove),
          botColor,
          ply + 1,
          move.captured ? posKey(move.to) : undefined,
          checkExtBudget - (canCheckExtend ? 1 : 0),
          recaptureExtBudget - (canRecaptureExtend ? 1 : 0),
        );
      } else {
        score = -negamax(
          board,
          reducedDepth,
          -alpha - 1,
          -alpha,
          getOpponent(toMove),
          botColor,
          ply + 1,
          move.captured ? posKey(move.to) : undefined,
          checkExtBudget - (canCheckExtend ? 1 : 0),
          recaptureExtBudget - (canRecaptureExtend ? 1 : 0),
        );

        if (score > alpha) {
          score = -negamax(
            board,
            nextDepth,
            -beta,
            -alpha,
            getOpponent(toMove),
            botColor,
            ply + 1,
            move.captured ? posKey(move.to) : undefined,
            checkExtBudget - (canCheckExtend ? 1 : 0),
            recaptureExtBudget - (canRecaptureExtend ? 1 : 0),
          );
        }
      }
    } finally {
      board.unapplyMove(applied);
    }

    if (score > best) {
      best = score;
      bestKey = moveKey(move.piece.position, move.to);
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      registerCutoff(move, ply, depth);
      break;
    }
  }

  const flag: BoundFlag = best <= alphaOrig ? 'alpha' : best >= betaOrig ? 'beta' : 'exact';
  if (transpositionTable.size > MAX_TT_ENTRIES) transpositionTable.clear();
  transpositionTable.set(hash, { depth, score: best, flag, bestMoveKey: bestKey });
  return best;
}

function searchAtDepth(
  board: Board,
  color: PieceColor,
  depth: number,
  noisy: boolean,
  rootMoves: MoveCandidate[] | null,
  rootAlpha = -Infinity,
  rootBeta = Infinity,
  pvMoveKey?: string,
): ScoredMove[] {
  const moves = rootMoves ?? getAllMoves(board, color);
  if (moves.length === 0) throw new Error('Bot has no legal moves');

  const ordered = orderMoves(moves, 0, pvMoveKey, board);
  const scored: ScoredMove[] = [];
  const initialSig = boardSignature(board);

  for (const move of ordered) {
    let rawScore: number;
    const applied = board.applyMove(move.piece, move.to);
    try {
      autoPromoteToQueen(move.piece);
      rawScore = -negamax(board, depth - 1, -rootBeta, -rootAlpha, getOpponent(color), color, 1);
    } catch (e) {
      if (e instanceof SearchAborted) {
        if (scored.length > 0) break;
      }
      throw e;
    } finally {
      board.unapplyMove(applied);
    }

    if (boardSignature(board) !== initialSig) {
      throw new Error('Board integrity check failed after root move search');
    }
    const score = noisy ? rawScore + (Math.random() - 0.5) * 120 : rawScore;
    scored.push({ fromPos: move.piece.position, to: move.to, score, rawScore });
  }

  if (scored.length === 0) throw new SearchAborted();
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function computeAdaptiveTimeLimit(board: Board, color: PieceColor, difficulty: Difficulty): number {
  const base = TIME_LIMIT[difficulty];
  if (base <= 0) return 0;

  const rootMoves = getAllMoves(board, color).length;
  const inCheck = isKingInCheck(board, color);
  const totalPieces = board.pieces.length;

  let factor = 1;
  if (inCheck) factor += 0.4;
  if (rootMoves <= 12) factor += 0.35;
  else if (rootMoves <= 20) factor += 0.15;
  else if (rootMoves >= 48) factor -= 0.2;
  if (totalPieces <= 14) factor += 0.2;

  const raw = Math.round(base * factor);
  if (difficulty === 'medium') return Math.max(1800, Math.min(raw, 5000));
  return Math.max(3500, Math.min(raw, 12000));
}

function buildTimeBudget(board: Board, color: PieceColor, difficulty: Difficulty): TimeBudget {
  const hardMs = computeAdaptiveTimeLimit(board, color, difficulty);
  if (hardMs <= 0) return { softMs: 0, hardMs: 0 };
  const softRatio = difficulty === 'hard' ? 0.72 : 0.82;
  return {
    softMs: Math.max(800, Math.floor(hardMs * softRatio)),
    hardMs,
  };
}

function guaranteedDepthOne(
  board: Board,
  color: PieceColor,
  noisy: boolean,
  rootMoves: MoveCandidate[] | null,
): ScoredMove[] {
  const prevDeadline = searchDeadline;
  const prevNodeLimit = nodeLimit;

  // Guarantee at least one fully evaluated iteration under bounded budget.
  searchDeadline = prevDeadline > 0 ? Date.now() + 1500 : 0;
  nodeLimit = Math.max(prevNodeLimit, 2_000_000);
  nodesSearched = 0;

  try {
    return searchAtDepth(board, color, 1, noisy, rootMoves, -Infinity, Infinity);
  } finally {
    searchDeadline = prevDeadline;
    nodeLimit = prevNodeLimit;
  }
}

function samePos(a: Position3D, b: Position3D): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function resolveRootMoves(
  board: Board,
  color: PieceColor,
  rootMoves?: RootMove[],
): MoveCandidate[] | null {
  if (!rootMoves || rootMoves.length === 0) return null;
  const legal = getAllMoves(board, color);
  const selected: MoveCandidate[] = [];
  for (const rm of rootMoves) {
    const found = legal.find(m => samePos(m.piece.position, rm.fromPos) && samePos(m.to, rm.to));
    if (found) selected.push(found);
  }
  return selected;
}

function iterativeSearch(
  board: Board,
  color: PieceColor,
  difficulty: Difficulty,
  rootMoves?: RootMove[],
): { best: ScoredMove; completedDepth: number; depthResults: DepthResult[] } {
  const noisy = difficulty === 'easy';
  const maxDepth = MAX_DEPTH[difficulty];
  const budget = buildTimeBudget(board, color, difficulty);
  const restrictedRootMoves = resolveRootMoves(board, color, rootMoves);
  if (restrictedRootMoves && restrictedRootMoves.length === 0) {
    throw new Error('Worker received empty root move subset');
  }

  const searchStart = Date.now();
  if (budget.hardMs > 0) {
    searchDeadline = searchStart + budget.hardMs;
  } else {
    searchDeadline = 0;
  }

  nodeLimit = NODE_LIMIT[difficulty];
  transpositionTable.clear();
  historyTable.clear();
  killerMoves.clear();

  let bestResult: ScoredMove[] | null = null;
  let pvMoveKey: string | undefined;
  let completedDepth = 0;
  const depthResults: DepthResult[] = [];
  let previousScore: number | undefined;

  for (let depth = 1; depth <= maxDepth; depth++) {
    nodesSearched = 0;
    try {
      let result: ScoredMove[];
      if (previousScore !== undefined && depth >= 2) {
        let window = ASPIRATION_BASE;
        while (true) {
          const alpha = previousScore - window;
          const beta = previousScore + window;
          result = searchAtDepth(board, color, depth, noisy, restrictedRootMoves, alpha, beta, pvMoveKey);
          const currentBest = result[0].rawScore;
          if (currentBest > alpha && currentBest < beta) break;
          window = Math.min(ASPIRATION_MAX, window * 2);
          if (window >= ASPIRATION_MAX) {
            result = searchAtDepth(board, color, depth, noisy, restrictedRootMoves, -Infinity, Infinity, pvMoveKey);
            break;
          }
        }
      } else {
        result = searchAtDepth(board, color, depth, noisy, restrictedRootMoves, -Infinity, Infinity, pvMoveKey);
      }
      bestResult = result;
      const best = result[0];
      completedDepth = depth;
      depthResults.push({ depth, fromPos: best.fromPos, to: best.to, score: best.rawScore });
      pvMoveKey = moveKey(best.fromPos, best.to);
      previousScore = best.rawScore;

      if (budget.softMs > 0) {
        const elapsed = Date.now() - searchStart;
        const unstable = depthResults.length >= 2
          ? Math.abs(depthResults[depthResults.length - 1].score - depthResults[depthResults.length - 2].score) > 140
          : false;
        if (elapsed >= budget.softMs && !unstable && depth >= 4) break;
      }
    } catch (e) {
      if (e instanceof SearchAborted) {
        if (!bestResult) {
          bestResult = guaranteedDepthOne(board, color, noisy, restrictedRootMoves);
          completedDepth = 1;
          depthResults.push({
            depth: 1,
            fromPos: bestResult[0].fromPos,
            to: bestResult[0].to,
            score: bestResult[0].rawScore,
          });
        }
        break;
      }
      throw e;
    }
  }

  if (!bestResult || bestResult.length === 0) {
    throw new Error('Bot has no legal moves');
  }

  return { best: bestResult[0], completedDepth, depthResults };
}

export interface WorkerRequest {
  pieces: Piece[];
  color: PieceColor;
  difficulty: Difficulty;
  rootMoves?: RootMove[];
  mode?: 'search' | 'selftest';
}

export interface WorkerResponse {
  type: 'result' | 'error';
  fromPos?: Position3D;
  to?: Position3D;
  score?: number;
  completedDepth?: number;
  depthResults?: DepthResult[];
  selfTest?: {
    pass: boolean;
    checks: string[];
  };
  error?: string;
}

function runSelfTest(pieces: Piece[], color: PieceColor, difficulty: Difficulty): { pass: boolean; checks: string[] } {
  const checks: string[] = [];
  const board = Board.deserialize(pieces);
  const sigBefore = boardSignature(board);
  const result = iterativeSearch(board, color, difficulty);
  const sigAfter = boardSignature(board);
  checks.push(sigBefore === sigAfter ? 'board_integrity_ok' : 'board_integrity_failed');

  const mover = board.getPieceAt(result.best.fromPos);
  const legal = mover ? getLegalMoves(board, mover).some(m => m.x === result.best.to.x && m.y === result.best.to.y && m.z === result.best.to.z) : false;
  checks.push(legal ? 'best_move_legal' : 'best_move_illegal');
  checks.push(result.completedDepth >= 1 ? 'depth_progress_ok' : 'depth_progress_failed');

  return { pass: checks.every(c => c.endsWith('_ok') || c === 'best_move_legal'), checks };
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { pieces, color, difficulty, rootMoves, mode } = e.data;
  try {
    if (mode === 'selftest') {
      const selfTest = runSelfTest(pieces, color, difficulty);
      const resp: WorkerResponse = { type: 'result', selfTest };
      self.postMessage(resp);
      return;
    }
    const board = Board.deserialize(pieces);
    const result = iterativeSearch(board, color, difficulty, rootMoves);
    const resp: WorkerResponse = {
      type: 'result',
      fromPos: result.best.fromPos,
      to: result.best.to,
      score: result.best.rawScore,
      completedDepth: result.completedDepth,
      depthResults: result.depthResults,
    };
    self.postMessage(resp);
  } catch (err) {
    const resp: WorkerResponse = { type: 'error', error: String(err) };
    self.postMessage(resp);
  }
};

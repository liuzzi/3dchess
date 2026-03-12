import { Board } from './board';
import { forEachAttackedSquare, getLegalMoves, getValidMoves, isKingInCheck } from './movement';
import { Piece, PieceColor, PieceType, Position3D, Difficulty, SetupMode, posKey, posKeyXYZ } from './types';
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
  medium: 3200,
  hard: 7500,
};

const MAX_DEPTH: Record<Difficulty, number> = {
  easy: 2,
  medium: 7,
  hard: 10,
};

const NOISE_AMPLITUDE: Record<Difficulty, number> = {
  easy: 100,
  medium: 4,
  hard: 0,
};

class SearchAborted extends Error {}

let nodesSearched = 0;
let searchDeadline = 0;
let nodeLimit = Infinity;

const NODE_LIMIT: Record<Difficulty, number> = {
  // 3D chess has ~150+ legal moves per position — the original 160k was too small for
  // depth-2 to complete, causing easy mode to fall back to depth-1 and miss basic tactics.
  easy: 900_000,
  medium: 1_800_000,
  hard: 2_400_000,
};

const MATE_SCORE = 1_000_000;
const HISTORY_BONUS_SCALE = 0.15;
const QUIESCENCE_MAX_PLY = 32;
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
  isCapture?: boolean;
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
  pvLine?: RootMove[];
  pvCandidates?: { pvLine: RootMove[]; score: number }[];
}

type ProgressMode = 'depth' | 'detailed';

interface TimeBudget {
  softMs: number;
  hardMs: number;
}

const NO_MOVE = -1;

const TT_SIZE_BITS = 20;
const TT_SIZE = 1 << TT_SIZE_BITS;
const TT_MASK = TT_SIZE - 1;
const TT_FIELDS = 5;
const TT_FLAG_EMPTY = 0;
const TT_FLAG_EXACT = 1;
const TT_FLAG_ALPHA = 2;
const TT_FLAG_BETA = 3;
const ttData = new Int32Array(TT_SIZE * TT_FIELDS);

function ttProbe(hashLow: number, hashHigh: number, depth: number): { score: number; flag: number; bestMove: number; depth: number } | null {
  const idx = (hashLow & TT_MASK) * TT_FIELDS;
  const flag = ttData[idx + 3];
  if (flag === TT_FLAG_EMPTY) return null;
  if (ttData[idx] !== hashHigh) return null;
  if (ttData[idx + 1] < depth) return null;
  return { depth: ttData[idx + 1], score: ttData[idx + 2], flag, bestMove: ttData[idx + 4] };
}

function ttStore(hashLow: number, hashHigh: number, depth: number, score: number, flag: number, bestMove: number): void {
  const idx = (hashLow & TT_MASK) * TT_FIELDS;
  const existingFlag = ttData[idx + 3];
  if (existingFlag !== TT_FLAG_EMPTY && ttData[idx] === hashHigh && ttData[idx + 1] > depth) return;
  ttData[idx] = hashHigh;
  ttData[idx + 1] = depth;
  ttData[idx + 2] = score;
  ttData[idx + 3] = flag;
  ttData[idx + 4] = bestMove;
}

function ttClear(): void {
  ttData.fill(0);
}

function ttGetBestMove(hashLow: number, hashHigh: number): number {
  const idx = (hashLow & TT_MASK) * TT_FIELDS;
  if (ttData[idx + 3] === TT_FLAG_EMPTY) return NO_MOVE;
  if (ttData[idx] !== hashHigh) return NO_MOVE;
  return ttData[idx + 4];
}

// In-search repetition detection: track positions on the current search path.
// Any node whose hash matches an ancestor returns 0 (draw) immediately.
let pathDepth = 0;
const pathLows = new Int32Array(256);
const pathHighs = new Int32Array(256);

function pathContains(low: number, high: number): boolean {
  for (let i = 0; i < pathDepth; i++) {
    if (pathLows[i] === low && pathHighs[i] === high) return true;
  }
  return false;
}

const MOVE_KEY_SIZE = 1 << 18;
const historyData = new Int32Array(MOVE_KEY_SIZE);

const MAX_KILLER_PLY = 128;
const killerData = new Int32Array(MAX_KILLER_PLY * 2).fill(NO_MOVE);

let activeSetup: SetupMode = 'classic';
let activeDifficulty: Difficulty = 'medium';

function checkTime(): void {
  nodesSearched++;
  if (nodesSearched % 1024 !== 0) return;
  if (nodesSearched >= nodeLimit) throw new SearchAborted();
  if (searchDeadline > 0 && performance.now() >= searchDeadline) throw new SearchAborted();
}

function getOpponent(color: PieceColor): PieceColor {
  return color === PieceColor.White ? PieceColor.Black : PieceColor.White;
}


// 64-bit Zobrist hashing via two 32-bit integers
let ZOBRIST_PIECES_LOW = new Int32Array(512 * 12);
let ZOBRIST_PIECES_HIGH = new Int32Array(512 * 12);
let ZOBRIST_BLACK_MOVE_LOW = 0;
let ZOBRIST_BLACK_MOVE_HIGH = 0;
// Extra Zobrist keys for the hasMoved flag — positions that look identical but
// differ on pawn double-advance rights must hash differently to avoid TT corruption.
let ZOBRIST_HAS_MOVED_LOW = new Int32Array(512);
let ZOBRIST_HAS_MOVED_HIGH = new Int32Array(512);

function initZobrist() {
  let seed = 1070372;
  function random32() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed;
  }
  
  for (let i = 0; i < 512 * 12; i++) {
    ZOBRIST_PIECES_LOW[i] = random32();
    ZOBRIST_PIECES_HIGH[i] = random32();
  }
  ZOBRIST_BLACK_MOVE_LOW = random32();
  ZOBRIST_BLACK_MOVE_HIGH = random32();
  for (let i = 0; i < 512; i++) {
    ZOBRIST_HAS_MOVED_LOW[i] = random32();
    ZOBRIST_HAS_MOVED_HIGH[i] = random32();
  }
}
initZobrist();

function pieceTypeIndex(type: PieceType): number {
  switch (type) {
    case PieceType.Pawn: return 0;
    case PieceType.Knight: return 1;
    case PieceType.Bishop: return 2;
    case PieceType.Rook: return 3;
    case PieceType.Queen: return 4;
    case PieceType.King: return 5;
  }
}

interface Hash64 {
  low: number;
  high: number;
}

function hashBoard(board: Board, toMove: PieceColor): Hash64 {
  let low = 0;
  let high = 0;

  for (const p of board.pieces) {
    const pType = pieceTypeIndex(p.type);
    const colorOffset = p.color === PieceColor.White ? 0 : 6;
    const pieceIndex = pType + colorOffset;
    const sq = posKey(p.position);

    const index = sq * 12 + pieceIndex;
    low ^= ZOBRIST_PIECES_LOW[index];
    high ^= ZOBRIST_PIECES_HIGH[index];

    // XOR in hasMoved so positions that differ only on pawn double-advance rights
    // get distinct hashes and don't corrupt each other's TT entries.
    if (p.hasMoved) {
      low ^= ZOBRIST_HAS_MOVED_LOW[sq];
      high ^= ZOBRIST_HAS_MOVED_HIGH[sq];
    }
  }

  if (toMove === PieceColor.Black) {
    low ^= ZOBRIST_BLACK_MOVE_LOW;
    high ^= ZOBRIST_BLACK_MOVE_HIGH;
  }

  return { low, high };
}

function hashEquals(a: Hash64, b: Hash64): boolean {
  return a.low === b.low && a.high === b.high;
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
  // In 3D chess, advanced pawns on center layers (z=3,4) are harder to block and
  // more dangerous — add a layer-proximity bonus that scales with advancement.
  const layerCentrality = 1 - Math.abs(piece.position.z - 3.5) / 3.5;
  const layerBonus = progress >= 3 ? layerCentrality * 8 : 0;
  return progress * 8 + layerBonus;
}

function centrality(pos: Position3D): number {
  const cx = Math.abs(pos.x - 3.5);
  const cy = Math.abs(pos.y - 3.5);
  const cz = Math.abs(pos.z - 3.5);
  const dist = cx + cy + cz;
  return 10.5 - dist;
}

function kingRingAttackPressure(
  board: Board,
  kingColor: PieceColor,
  attackerColor: PieceColor,
  moveCache: Map<Piece, Position3D[]>,
): number {
  const king = board.findKing(kingColor);
  if (!king) return 0;
  let pressure = 0;
  for (const p of board.getPiecesOfColor(attackerColor)) {
    let moves = moveCache.get(p);
    if (!moves) {
      moves = getValidMoves(board, p);
      moveCache.set(p, moves);
    }
    for (const m of moves) {
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

const evalPawnFileCounts = new Int32Array(64);
const evalPawnSet = new Uint8Array(512);
const evalPawnsBuffer: Piece[] = [];

function pawnStructureScore(board: Board, color: PieceColor): number {
  evalPawnsBuffer.length = 0;
  for (const p of board.getPiecesOfColor(color)) {
    if (p.type === PieceType.Pawn) evalPawnsBuffer.push(p);
  }
  if (evalPawnsBuffer.length === 0) return 0;

  evalPawnFileCounts.fill(0);
  evalPawnSet.fill(0);
  
  for (const p of evalPawnsBuffer) {
    const fileKey = p.position.x | (p.position.z << 3);
    evalPawnSet[posKey(p.position)] = 1;
    evalPawnFileCounts[fileKey]++;
  }

  let score = 0;
  for (const p of evalPawnsBuffer) {
    const fileKey = p.position.x | (p.position.z << 3);
    const fileCount = evalPawnFileCounts[fileKey];
    if (fileCount > 1) score -= (fileCount - 1) * 9;

    // Check 3D diagonals for defending pawns
    const fwdDir = color === PieceColor.White ? -1 : 1; // backwards from the perspective of the defending pawn
    const dy = p.position.y + fwdDir;
    let hasDefender = false;
    
    if (dy >= 0 && dy < 8) {
      for (const dz of [-1, 0, 1]) {
        for (const dx of [-1, 1]) {
          const nx = p.position.x + dx;
          const nz = p.position.z + dz;
          if (nx >= 0 && nx < 8 && nz >= 0 && nz < 8) {
             if (evalPawnSet[posKeyXYZ(nx, dy, nz)]) {
               hasDefender = true;
               break;
             }
          }
        }
        if (hasDefender) break;
      }
    }
    
    if (!hasDefender) score -= 12;
    score += progressBonus(p) * 0.8;
  }
  return score;
}

function pieceActivity(mobility: number, piece: Piece): number {
  switch (piece.type) {
    case PieceType.Pawn: return mobility;
    case PieceType.Knight: return mobility * 3;
    case PieceType.Bishop: return mobility * 3;
    case PieceType.Rook: return mobility * 2;
    case PieceType.Queen: return mobility * 2;
    case PieceType.King: return mobility;
  }
}

const evalWhiteAttacks = new Int32Array(512);
const evalBlackAttacks = new Int32Array(512);
// Minimum attacker value per square — lets the eval detect losing exchanges
// (cheapest enemy attacker is cheaper than the piece) without a full SEE call.
const evalWhiteAttackMin = new Int32Array(512);
const evalBlackAttackMin = new Int32Array(512);

function attackedAndDefendedCounts(board: Board): {
  white: Int32Array; black: Int32Array;
  whiteMin: Int32Array; blackMin: Int32Array;
} {
  evalWhiteAttacks.fill(0);
  evalBlackAttacks.fill(0);
  evalWhiteAttackMin.fill(99999);
  evalBlackAttackMin.fill(99999);
  for (const piece of board.pieces) {
    const targetMap = piece.color === PieceColor.White ? evalWhiteAttacks : evalBlackAttacks;
    const minMap   = piece.color === PieceColor.White ? evalWhiteAttackMin : evalBlackAttackMin;
    const pv = PIECE_VALUE[piece.type];
    forEachAttackedSquare(board, piece, (x, y, z) => {
      const k = posKeyXYZ(x, y, z);
      targetMap[k]++;
      if (pv < minMap[k]) minMap[k] = pv;
    });
  }
  return { white: evalWhiteAttacks, black: evalBlackAttacks, whiteMin: evalWhiteAttackMin, blackMin: evalBlackAttackMin };
}

const evalMoveCache = new Map<Piece, Position3D[]>();

function evaluate(board: Board, botColor: PieceColor, toMove: PieceColor): number {
  const opponentColor = botColor === PieceColor.White ? PieceColor.Black : PieceColor.White;
  evalMoveCache.clear();
  let phaseMaterial = 0;
  for (const p of board.pieces) {
    evalMoveCache.set(p, getValidMoves(board, p));
    if (p.type !== PieceType.King) phaseMaterial += MG_VALUE[p.type];
  }
  const phase = Math.min(1, phaseMaterial / 8000);

  let mg = 0;
  let eg = 0;
  for (const piece of board.pieces) {
    const sign = piece.color === botColor ? 1 : -1;
    const central = centrality(piece.position);
    const mobility = pieceActivity((evalMoveCache.get(piece) ?? []).length, piece);
    const pawnProgress = piece.type === PieceType.Pawn ? progressBonus(piece) : 0;

    let mgTerm = MG_VALUE[piece.type] + mobility * 1.5 + central * (piece.type === PieceType.King ? -1.4 : 1.7);
    let egTerm = EG_VALUE[piece.type] + mobility + central * (piece.type === PieceType.King ? 2.2 : 1.0);

    if (pawnProgress) {
      mgTerm += pawnProgress * 0.6;
      egTerm += pawnProgress * 1.2;
    }

    mg += sign * mgTerm;
    eg += sign * egTerm;
  }

  mg += pawnStructureScore(board, botColor) - pawnStructureScore(board, opponentColor);
  eg += pawnStructureScore(board, botColor) * 0.8 - pawnStructureScore(board, opponentColor) * 0.8;

  const attacks = attackedAndDefendedCounts(board);
  const botAttacks    = botColor === PieceColor.White ? attacks.white    : attacks.black;
  const oppAttacks    = botColor === PieceColor.White ? attacks.black    : attacks.white;
  const botAttackMin  = botColor === PieceColor.White ? attacks.whiteMin : attacks.blackMin;
  const oppAttackMin  = botColor === PieceColor.White ? attacks.blackMin : attacks.whiteMin;

  for (const piece of board.pieces) {
    if (piece.type === PieceType.King) continue;
    const key = posKey(piece.position);
    const pv  = PIECE_VALUE[piece.type];

    const attackedByOpp = piece.color === botColor ? oppAttacks[key]   : botAttacks[key];
    if (attackedByOpp === 0) continue;

    const defendedByOwn    = piece.color === botColor ? botAttacks[key]   : oppAttacks[key];
    const cheapestAttacker = piece.color === botColor ? oppAttackMin[key] : botAttackMin[key];
    const cheapestDefender = piece.color === botColor ? botAttackMin[key] : oppAttackMin[key];

    // Truly hanging — no defender at all.
    const hangingPenalty = Math.min(pv * 1.05, pv * 0.72 + attackedByOpp * 36);

    // Overloaded — more attackers than defenders (count-based, catches piled-on pieces).
    const overloadedPenalty = Math.min(pv * 0.22, attackedByOpp * 16);

    // Losing exchange — if the cheapest attacker is worth less than this piece, the
    // opponent profits by capturing (they gain pv, lose cheapestAttacker). Scale the
    // penalty down when we have multiple defenders (harder to exploit).
    const exchangeLossPenalty = (cheapestAttacker < pv)
      ? Math.min((pv - cheapestAttacker) * 0.70, pv * 0.50) * Math.max(0.3, 1 - (defendedByOwn - 1) * 0.25)
      : 0;

    let penalty = 0;
    if (defendedByOwn === 0) {
      penalty = hangingPenalty;
    } else {
      if (attackedByOpp > defendedByOwn) penalty += overloadedPenalty;
      if (exchangeLossPenalty > 0) penalty += exchangeLossPenalty;
    }

    if (penalty > 0) {
      if (piece.color === botColor) {
        mg -= penalty;
        eg -= penalty * 0.85;
      } else {
        // Opponent's hanging/attacked pieces: use a fraction of the penalty as a positional
        // bonus. The full penalty value would over-inflate non-capture positions, making them
        // appear nearly as good as the actual capture — which brings them within the noise
        // window and causes the bot to occasionally miss obvious free captures.
        // The search itself evaluates captures directly, so a small hint is sufficient.
        const oppBonus = penalty * 0.20;
        mg += oppBonus;
        eg += oppBonus * 0.85;
      }
    }
  }

  const botKingPressure = kingRingAttackPressure(board, botColor, opponentColor, evalMoveCache);
  const oppKingPressure = kingRingAttackPressure(board, opponentColor, botColor, evalMoveCache);
  mg += (oppKingPressure - botKingPressure) * 12;
  eg += (oppKingPressure - botKingPressure) * 6;

  let score = mg * phase + eg * (1 - phase);
  if (isKingInCheck(board, opponentColor)) score += 90;
  if (isKingInCheck(board, botColor)) score -= 110;
  return toMove === botColor ? score : -score;
}

function getAllMoves(board: Board, color: PieceColor): MoveCandidate[] {
  const legal: MoveCandidate[] = [];
  const pieces = Array.from(board.getPiecesOfColor(color));
  for (const piece of pieces) {
    for (const to of getValidMoves(board, piece)) {
      const captured = board.getPieceAt(to);
      const applied = board.applyMove(piece, to);
      const inCheck = isKingInCheck(board, color);
      board.unapplyMove(applied);
      if (!inCheck) {
        legal.push({ piece, to, captured: captured ?? undefined });
      }
    }
  }
  return legal;
}

function moveKeyNum(from: Position3D, to: Position3D): number {
  return posKey(from) | (posKey(to) << 9);
}

function moveKeyOfNum(move: MoveCandidate): number {
  return posKey(move.piece.position) | (posKey(move.to) << 9);
}

function historyScore(move: MoveCandidate): number {
  return historyData[moveKeyOfNum(move)];
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

function seeMoveOrderingPenalty(board: Board, move: MoveCandidate): number {
  if (!move.captured) return 0;
  const seeVal = staticExchangeEvaluation(board, move);
  return seeVal < 0 ? -20000 : 0;
}

function maxThreatenedEnemyValueByPiece(board: Board, piece: Piece): number {
  let best = 0;
  forEachAttackedSquare(board, piece, (x, y, z) => {
    const occ = board.getPieceAtXYZ(x, y, z);
    if (occ && occ.color !== piece.color) {
      const v = PIECE_VALUE[occ.type];
      if (v > best) best = v;
    }
  });
  return best;
}

function orderMoves(
  moves: MoveCandidate[],
  ply: number,
  pvMoveKey?: number,
  board?: Board,
): MoveCandidate[] {
  const killerBase = ply < MAX_KILLER_PLY ? ply * 2 : -1;
  const killer0 = killerBase >= 0 ? killerData[killerBase] : NO_MOVE;
  const killer1 = killerBase >= 0 ? killerData[killerBase + 1] : NO_MOVE;
  const decorated: Array<{ move: MoveCandidate; score: number }> = [];
  const shouldUseExpensiveTacticalOrdering = Boolean(
    activeSetup === 'classic'
    && board
    && ply <= 1
    && board.pieces.length <= 64
    && moves.length <= 96,
  );

  for (const move of moves) {
    const key = moveKeyOfNum(move);
    const killerBoost = (key === killer0 || key === killer1) ? 1400 : 0;
    const pvBoost = pvMoveKey !== undefined && key === pvMoveKey ? 1_000_000 : 0;
    
    const seePenalty = (board && move.captured) ? seeMoveOrderingPenalty(board, move) : 0;
    
    let score = pvBoost + captureScore(move) + promotionScore(move) + killerBoost + historyScore(move) * HISTORY_BONUS_SCALE + seePenalty;

    // Expensive tactical sort bonus only for early plies where ordering impact is highest.
    if (shouldUseExpensiveTacticalOrdering && board) {
      const openingPhase = board.pieces.length >= 28;
      const wasUnmoved = !move.piece.hasMoved;
      const wasPawn = move.piece.type === PieceType.Pawn;
      const applied = board.applyMove(move.piece, move.to);
      try {
        autoPromoteToQueen(move.piece);
        if (isKingInCheck(board, getOpponent(move.piece.color))) {
          score += 550;
        }

        // Prioritize "queen/rook/bishop/knight now attacks high-value piece" lines.
        let threatenedValue = 0;
        forEachAttackedSquare(board, move.piece, (x, y, z) => {
          const occ = board.getPieceAtXYZ(x, y, z);
          if (occ && occ.color !== move.piece.color) {
            threatenedValue = Math.max(threatenedValue, PIECE_VALUE[occ.type]);
          }
        });
        score += threatenedValue * 0.7;

        // Opening guidance: develop pieces first when tactical urgency is low.
        if (openingPhase) {
          if (!wasPawn && wasUnmoved) score += 95;
          // Only discourage quiet pawn pushes in classic — barricade/pawnWall setups
          // deliberately advance pawns as their primary strategy.
          if (wasPawn && !move.captured && activeSetup === 'classic') score -= 40;
          if ((move.piece.type === PieceType.Knight || move.piece.type === PieceType.Bishop) && wasUnmoved) score += 30;
        }
      } finally {
        board.unapplyMove(applied);
      }
    }

    decorated.push({ move, score });
  }

  decorated.sort((a, b) => b.score - a.score);
  return decorated.map((x) => x.move);
}

function registerCutoff(move: MoveCandidate, ply: number, depth: number): void {
  const key = moveKeyNum(move.piece.position, move.to);
  if (!move.captured) {
    historyData[key] += depth * depth;
    if (ply < MAX_KILLER_PLY) {
      const base = ply * 2;
      if (killerData[base] !== key) {
        killerData[base + 1] = killerData[base];
        killerData[base] = key;
      }
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

function findCheapestAttacker(board: Board, target: Position3D, attackerColor: PieceColor): Piece | null {
  let cheapest: Piece | null = null;
  let cheapestVal = Infinity;
  const pieces = Array.from(board.getPiecesOfColor(attackerColor));
  for (const p of pieces) {
    let attacksTarget = false;
    forEachAttackedSquare(board, p, (x, y, z) => {
      if (x === target.x && y === target.y && z === target.z) attacksTarget = true;
    });
    if (!attacksTarget) continue;
    const v = PIECE_VALUE[p.type];
    if (v < cheapestVal) {
      cheapestVal = v;
      cheapest = p;
    }
  }
  return cheapest;
}

function staticExchangeEvaluation(board: Board, move: MoveCandidate, depth = 0): number {
  if (!move.captured || depth > 8) return 0;
  
  const target = move.to;
  let gain = PIECE_VALUE[move.captured.type];
  
  const promoRow = move.piece.color === PieceColor.White ? 7 : 0;
  if (move.piece.type === PieceType.Pawn && target.y === promoRow) {
    gain += PIECE_VALUE[PieceType.Queen] - PIECE_VALUE[PieceType.Pawn];
  }
  
  const applied = board.applyMove(move.piece, target);
  try {
    autoPromoteToQueen(move.piece);
    const enemy = getOpponent(move.piece.color);
    const cheapestAttacker = findCheapestAttacker(board, target, enemy);
    
    if (cheapestAttacker) {
      const recapture: MoveCandidate = { piece: cheapestAttacker, to: target, captured: move.piece };
      const opponentGain = staticExchangeEvaluation(board, recapture, depth + 1);
      // The opponent will only recapture if it benefits them (or breaks even)
      if (opponentGain >= 0) {
        gain -= opponentGain;
      }
    }
  } finally {
    board.unapplyMove(applied);
  }
  
  // You don't HAVE to capture. If a capture sequence is negative, you just stop.
  return depth === 0 ? gain : Math.max(0, gain);
}

function quiescenceMoves(board: Board, color: PieceColor, ply: number): MoveCandidate[] {
  const moves: MoveCandidate[] = [];
  const includeCheckMoves = ply <= Q_CHECK_PLY_LIMIT;

  const pieces = Array.from(board.getPiecesOfColor(color));
  for (const piece of pieces) {
    const pseudo = getValidMoves(board, piece);
    for (const to of pseudo) {
      const captured = board.getPieceAt(to);
      const isCapture = Boolean(captured);
      const isPromo = piece.type === PieceType.Pawn && (to.y === 7 || to.y === 0);

      if (!isCapture && !isPromo && !includeCheckMoves) continue;

      const candidate: MoveCandidate = { piece, to, captured: captured ?? undefined };

      const applied = board.applyMove(piece, to);
      let isLegal = false;
      let givesCheck = false;
      try {
        if (!isKingInCheck(board, color)) {
          isLegal = true;
          if (!isCapture && !isPromo && includeCheckMoves) {
            autoPromoteToQueen(piece);
            givesCheck = isKingInCheck(board, getOpponent(color));
          }
        }
      } finally {
        board.unapplyMove(applied);
      }

      if (!isLegal) continue;

      if (isCapture && captured) {
        const see = staticExchangeEvaluation(board, candidate);
        if (see >= 0) moves.push(candidate);
      } else if (isPromo) {
        moves.push(candidate);
      } else if (givesCheck) {
        moves.push(candidate);
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
  lastCaptureSquare?: number,
  checkExtBudget = CHECK_EXTENSION_BUDGET,
  recaptureExtBudget = RECAPTURE_EXTENSION_BUDGET,
): number {
  checkTime();
  const alphaOrig = alpha;
  const betaOrig = beta;
  const h = hashBoard(board, toMove);

  // In-search repetition: if this position has already appeared on the current path,
  // score it as a draw (0) — prevents cycling and values avoid-repetition moves correctly.
  if (ply > 0 && pathContains(h.low, h.high)) return 0;

  const tt = ttProbe(h.low, h.high, depth);
  if (tt && tt.depth >= depth) {
    if (tt.flag === TT_FLAG_EXACT) return tt.score;
    if (tt.flag === TT_FLAG_ALPHA) beta = Math.min(beta, tt.score);
    if (tt.flag === TT_FLAG_BETA) alpha = Math.max(alpha, tt.score);
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
  let lazyStaticEval: number | undefined;
  const getStaticEval = (): number => {
    if (lazyStaticEval === undefined) lazyStaticEval = evaluate(board, botColor, toMove);
    return lazyStaticEval;
  };

  if (!inCheck && depth >= 4 && Math.abs(beta) < MATE_SCORE - 1000) {
    const probBeta = beta + 200;
    if (getStaticEval() >= probBeta) {
      const probScore = -negamax(
        board,
        depth - 3,
        -probBeta,
        -probBeta + 1,
        getOpponent(toMove),
        botColor,
        ply + 1,
        undefined,
        checkExtBudget,
        recaptureExtBudget,
      );
      if (probScore >= probBeta) return probScore;
    }
  }

  if (!inCheck && depth >= 3) {
    let hasNonPawnMaterial = false;
    for (const p of board.getPiecesOfColor(toMove)) {
      if (p.type !== PieceType.Pawn && p.type !== PieceType.King) {
        hasNonPawnMaterial = true;
        break;
      }
    }
    if (hasNonPawnMaterial && getStaticEval() >= beta) {
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

  const ttBestMove = tt ? tt.bestMove : ttGetBestMove(h.low, h.high);
  const ordered = orderMoves(moves, ply, ttBestMove !== NO_MOVE ? ttBestMove : undefined, board);
  let best = -Infinity;
  let bestMoveKey = NO_MOVE;

  // Push current position onto the path before exploring children so that any
  // descendant that reaches this same position is detected as a repetition.
  if (pathDepth < 256) {
    pathLows[pathDepth]  = h.low;
    pathHighs[pathDepth] = h.high;
  }
  pathDepth++;

  try {
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
        const createsMajorThreat = !move.captured
          && maxThreatenedEnemyValueByPiece(board, move.piece) >= PIECE_VALUE[PieceType.Rook];
        const isQuiet = !move.captured && promotionScore(move) === 0 && !givesCheck && !createsMajorThreat;

        const historyVal = historyScore(move);
        const isPoorHistory = historyVal < 0;

        const canReduce = nextDepth >= 3 && moveIndex >= 3 && isQuiet && !inCheck;
        let reduction = 0;
        if (canReduce) {
          if (moveIndex >= 8) reduction = 2;
          else reduction = 1;
          if (isPoorHistory) reduction++;
        }
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
        bestMoveKey = moveKeyNum(move.piece.position, move.to);
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        registerCutoff(move, ply, depth);
        break;
      }
    }
  } finally {
    pathDepth--;
  }

  const flag = best <= alphaOrig ? TT_FLAG_ALPHA : best >= betaOrig ? TT_FLAG_BETA : TT_FLAG_EXACT;
  ttStore(h.low, h.high, depth, best, flag, bestMoveKey);
  return best;
}

function searchAtDepth(
  board: Board,
  color: PieceColor,
  depth: number,
  rootMoves: MoveCandidate[] | null,
  rootAlpha = -Infinity,
  rootBeta = Infinity,
  onRootMoveScored?: (result: DepthResult) => void,
  pvMoveKey?: number,
): ScoredMove[] {
  // Reset path so each depth iteration starts with a clean repetition history.
  pathDepth = 0;

  const moves = rootMoves ?? getAllMoves(board, color);
  if (moves.length === 0) throw new Error('Bot has no legal moves');

  const ordered = orderMoves(moves, 0, pvMoveKey, board);
  const scored: ScoredMove[] = [];
  let alpha = rootAlpha;

  for (const move of ordered) {
    let score: number;
    const applied = board.applyMove(move.piece, move.to);
    try {
      autoPromoteToQueen(move.piece);
      score = -negamax(board, depth - 1, -rootBeta, -alpha, getOpponent(color), color, 1);
    } catch (e) {
      if (e instanceof SearchAborted) {
        if (scored.length > 0) break;
      }
      throw e;
    } finally {
      board.unapplyMove(applied);
    }

    scored.push({ fromPos: move.piece.position, to: move.to, score, isCapture: !!move.captured });
    onRootMoveScored?.({ depth, fromPos: move.piece.position, to: move.to, score });
    if (score > alpha) alpha = score;
    if (alpha >= rootBeta) break;
  }

  if (scored.length === 0) throw new SearchAborted();
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function extractPrincipalVariation(board: Board, toMove: PieceColor, maxPlies = 6): RootMove[] {
  const pv: RootMove[] = [];
  const appliedMoves: ReturnType<Board['applyMove']>[] = [];
  let side = toMove;
  try {
    for (let i = 0; i < maxPlies; i++) {
      const h = hashBoard(board, side);
      const bestMoveKey = ttGetBestMove(h.low, h.high);
      if (bestMoveKey === NO_MOVE) break;
      const moves = getAllMoves(board, side);
      const best = moves.find(m => moveKeyOfNum(m) === bestMoveKey);
      if (!best) break;
      pv.push({ fromPos: { ...best.piece.position }, to: { ...best.to } });
      const applied = board.applyMove(best.piece, best.to);
      appliedMoves.push(applied);
      autoPromoteToQueen(best.piece);
      side = getOpponent(side);
    }
  } finally {
    for (let i = appliedMoves.length - 1; i >= 0; i--) {
      board.unapplyMove(appliedMoves[i]);
    }
  }
  return pv;
}

function buildDepthPvLine(
  board: Board,
  color: PieceColor,
  best: ScoredMove,
  maxPlies = 6,
): RootMove[] {
  const rootMove: RootMove = {
    fromPos: { ...best.fromPos },
    to: { ...best.to },
  };
  if (maxPlies <= 1) return [rootMove];

  const sim = board.clone();
  const mover = sim.getPieceAt(rootMove.fromPos);
  if (!mover) return [rootMove];
  sim.applyMove(mover, rootMove.to);
  autoPromoteToQueen(mover);

  const tail = extractPrincipalVariation(sim, getOpponent(color), maxPlies - 1);
  return [rootMove, ...tail];
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
  if (difficulty === 'easy')   return Math.max(600,  Math.min(raw, 1500));
  if (difficulty === 'medium') return Math.max(2600, Math.min(raw, 6200));
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
  rootMoves: MoveCandidate[] | null,
): ScoredMove[] {
  const prevDeadline = searchDeadline;
  const prevNodeLimit = nodeLimit;

  // Guarantee at least one fully evaluated iteration under bounded budget.
  searchDeadline = prevDeadline > 0 ? performance.now() + 1500 : 0;
  nodeLimit = Math.max(prevNodeLimit, 2_000_000);
  nodesSearched = 0;

  try {
    return searchAtDepth(board, color, 1, rootMoves, -Infinity, Infinity);
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

function selectWithNoise(moves: ScoredMove[], noiseAmplitude: number): ScoredMove {
  if (noiseAmplitude === 0 || moves.length <= 1) return moves[0];
  const best = moves[0].score;
  let candidates = moves.filter(m => best - m.score <= noiseAmplitude);

  // Never let noise pick a quiet move over a capture. If any candidate is a
  // capture, restrict the pool to captures only so the bot doesn't randomly
  // skip taking free material.
  const captureExists = candidates.some(m => m.isCapture);
  if (captureExists) candidates = candidates.filter(m => m.isCapture);

  // Exponential weighting heavily biases toward the top candidate (~60% chance
  // for index 0, ~15% for index 1, etc.) — avoids fully-random bad moves.
  const index = Math.floor(Math.pow(Math.random(), 3) * candidates.length);
  return candidates[index];
}

function iterativeSearch(
  board: Board,
  color: PieceColor,
  difficulty: Difficulty,
  rootMoves?: RootMove[],
  progressMode: ProgressMode = 'depth',
  onProgress?: (kind: 'depth' | 'rootMove', result: DepthResult) => void,
): { best: ScoredMove; completedDepth: number; depthResults: DepthResult[] } {
  activeDifficulty = difficulty;
  const maxDepth = MAX_DEPTH[difficulty];
  const budget = buildTimeBudget(board, color, difficulty);
  const restrictedRootMoves = resolveRootMoves(board, color, rootMoves);
  if (restrictedRootMoves && restrictedRootMoves.length === 0) {
    throw new Error('Worker received empty root move subset');
  }

  const searchStart = performance.now();
  if (budget.hardMs > 0) {
    searchDeadline = searchStart + budget.hardMs;
  } else {
    searchDeadline = 0;
  }

  nodeLimit = NODE_LIMIT[difficulty];
  historyData.fill(0);
  killerData.fill(NO_MOVE);

  let bestResult: ScoredMove[] | null = null;
  let pvMoveKey: number | undefined;
  let completedDepth = 0;
  const depthResults: DepthResult[] = [];
  let previousScore: number | undefined;
  let progressEmitCount = 0;
  let lastProgressEmitAt = 0;

  const emitDetailedProgress = (result: DepthResult): void => {
    if (progressMode !== 'detailed' || !onProgress) return;
    // Throttle progress messages to keep animation cheap.
    progressEmitCount++;
    const now = performance.now();
    if (progressEmitCount % 4 !== 0 && now - lastProgressEmitAt < 28) return;
    lastProgressEmitAt = now;
    onProgress('rootMove', result);
  };

  for (let depth = 1; depth <= maxDepth; depth++) {
    nodesSearched = 0;
    try {
      let result: ScoredMove[];
      if (previousScore !== undefined && depth >= 2) {
        let window = ASPIRATION_BASE;
        while (true) {
          const alpha = previousScore - window;
          const beta = previousScore + window;
          result = searchAtDepth(
            board,
            color,
            depth,
            restrictedRootMoves,
            alpha,
            beta,
            emitDetailedProgress,
            pvMoveKey,
          );
          const currentBest = result[0].score;
          if (currentBest > alpha && currentBest < beta) break;
          window = Math.min(ASPIRATION_MAX, window * 2);
          if (window >= ASPIRATION_MAX) {
            result = searchAtDepth(
              board,
              color,
              depth,
              restrictedRootMoves,
              -Infinity,
              Infinity,
              emitDetailedProgress,
              pvMoveKey,
            );
            break;
          }
        }
      } else {
        result = searchAtDepth(
          board,
          color,
          depth,
          restrictedRootMoves,
          -Infinity,
          Infinity,
          emitDetailedProgress,
          pvMoveKey,
        );
      }
      bestResult = result;
      const best = result[0];
      completedDepth = depth;
      const rootHash = hashBoard(board, color);
      ttStore(rootHash.low, rootHash.high, depth, best.score, TT_FLAG_EXACT, moveKeyNum(best.fromPos, best.to));
      const depthResult: DepthResult = {
        depth,
        fromPos: best.fromPos,
        to: best.to,
        score: best.score,
        pvLine: buildDepthPvLine(board, color, best, 6),
        pvCandidates: result
          .slice(0, 3)
          .map((m) => ({ pvLine: buildDepthPvLine(board, color, m, 6), score: m.score })),
      };
      depthResults.push(depthResult);
      onProgress?.('depth', depthResult);
      pvMoveKey = moveKeyNum(best.fromPos, best.to);
      previousScore = best.score;

      if (budget.softMs > 0) {
        const elapsed = performance.now() - searchStart;
        const unstable = depthResults.length >= 2
          ? Math.abs(depthResults[depthResults.length - 1].score - depthResults[depthResults.length - 2].score) > 140
          : false;
        const minDepthBeforeSoftStop = difficulty === 'medium' ? 6 : difficulty === 'hard' ? 5 : 2;
        if (elapsed >= budget.softMs && !unstable && depth >= minDepthBeforeSoftStop) break;
      }
    } catch (e) {
      if (e instanceof SearchAborted) {
        if (!bestResult) {
          bestResult = guaranteedDepthOne(board, color, restrictedRootMoves);
          completedDepth = 1;
          const depthResult: DepthResult = {
            depth: 1,
            fromPos: bestResult[0].fromPos,
            to: bestResult[0].to,
            score: bestResult[0].score,
            pvLine: buildDepthPvLine(board, color, bestResult[0], 4),
            pvCandidates: bestResult
              .slice(0, 3)
              .map((m) => ({ pvLine: buildDepthPvLine(board, color, m, 4), score: m.score })),
          };
          depthResults.push(depthResult);
          onProgress?.('depth', depthResult);
        }
        break;
      }
      throw e;
    }
  }

  if (!bestResult || bestResult.length === 0) {
    throw new Error('Bot has no legal moves');
  }

  const best = selectWithNoise(bestResult, NOISE_AMPLITUDE[difficulty]);
  return { best, completedDepth, depthResults };
}

export interface WorkerRequest {
  pieces: Piece[];
  color: PieceColor;
  difficulty: Difficulty;
  setup?: SetupMode;
  rootMoves?: RootMove[];
  mode?: 'search' | 'selftest';
  progressMode?: ProgressMode;
}

export interface WorkerResponse {
  type: 'progress' | 'result' | 'error';
  progressKind?: 'depth' | 'rootMove';
  fromPos?: Position3D;
  to?: Position3D;
  pvLine?: RootMove[];
  pvCandidates?: { pvLine: RootMove[]; score: number }[];
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
  const countBefore = board.pieces.length;
  const result = iterativeSearch(board, color, difficulty);
  const countAfter = board.pieces.length;
  checks.push(countBefore === countAfter ? 'board_integrity_ok' : 'board_integrity_failed');

  const mover = board.getPieceAt(result.best.fromPos);
  const legal = mover ? getLegalMoves(board, mover).some(m => m.x === result.best.to.x && m.y === result.best.to.y && m.z === result.best.to.z) : false;
  checks.push(legal ? 'best_move_legal' : 'best_move_illegal');
  checks.push(result.completedDepth >= 1 ? 'depth_progress_ok' : 'depth_progress_failed');

  return { pass: checks.every(c => c.endsWith('_ok') || c === 'best_move_legal'), checks };
}

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { pieces, color, difficulty, setup, rootMoves, mode, progressMode } = e.data;
    try {
      activeSetup = setup ?? 'classic';
      if (mode === 'selftest') {
        const selfTest = runSelfTest(pieces, color, difficulty);
        const resp: WorkerResponse = { type: 'result', selfTest };
        self.postMessage(resp);
        return;
      }
      const board = Board.deserialize(pieces);
      const result = iterativeSearch(board, color, difficulty, rootMoves, progressMode ?? 'depth', (kind, depthResult) => {
        const progress: WorkerResponse = {
          type: 'progress',
          progressKind: kind,
          fromPos: depthResult.fromPos,
          to: depthResult.to,
          pvLine: depthResult.pvLine,
          pvCandidates: depthResult.pvCandidates,
          score: depthResult.score,
          completedDepth: depthResult.depth,
        };
        self.postMessage(progress);
      });
      const resp: WorkerResponse = {
        type: 'result',
        fromPos: result.best.fromPos,
        to: result.best.to,
        score: result.best.score,
        completedDepth: result.completedDepth,
        depthResults: result.depthResults,
      };
      self.postMessage(resp);
    } catch (err) {
      const resp: WorkerResponse = { type: 'error', error: String(err) };
      self.postMessage(resp);
    }
  };
}

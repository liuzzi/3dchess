import { Piece, PieceColor, PieceType, Difficulty, Position3D } from './types';
import type { WorkerRequest, WorkerResponse } from './botWorker';

interface Scenario {
  name: string;
  pieces: Piece[];
  toMove: PieceColor;
  difficulty: Difficulty;
  expectedFrom?: Position3D;
  expectedTo?: Position3D;
}

interface ScenarioResult {
  name: string;
  pass: boolean;
  elapsedMs: number;
  details: string;
}

function eq(a: Position3D, b: Position3D): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function makeWorkerRequest(req: WorkerRequest): Promise<WorkerResponse> {
  const worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === 'progress') return;
      cleanup();
      resolve(e.data);
    };
    const onError = (err: ErrorEvent) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(req);
  });
}

function buildScenarios(): Scenario[] {
  // Minimal deterministic tactical fixtures for regression checks.
  const baseKings: Piece[] = [
    { type: PieceType.King, color: PieceColor.White, position: { x: 4, y: 0, z: 3 }, hasMoved: true },
    { type: PieceType.King, color: PieceColor.Black, position: { x: 4, y: 7, z: 3 }, hasMoved: true },
  ];

  return [
    {
      name: 'free_rook_capture',
      toMove: PieceColor.Black,
      difficulty: 'hard',
      pieces: [
        ...baseKings,
        { type: PieceType.Queen, color: PieceColor.Black, position: { x: 4, y: 5, z: 3 }, hasMoved: true },
        { type: PieceType.Rook, color: PieceColor.White, position: { x: 4, y: 4, z: 3 }, hasMoved: true },
      ],
      expectedFrom: { x: 4, y: 5, z: 3 },
      expectedTo: { x: 4, y: 4, z: 3 },
    },
    {
      name: 'prefer_knight_over_pawn',
      toMove: PieceColor.Black,
      difficulty: 'hard',
      pieces: [
        ...baseKings,
        { type: PieceType.Bishop, color: PieceColor.Black, position: { x: 3, y: 5, z: 3 }, hasMoved: true },
        { type: PieceType.Knight, color: PieceColor.White, position: { x: 2, y: 4, z: 2 }, hasMoved: true },
        { type: PieceType.Pawn, color: PieceColor.White, position: { x: 4, y: 4, z: 4 }, hasMoved: true },
      ],
      expectedFrom: { x: 3, y: 5, z: 3 },
      expectedTo: { x: 2, y: 4, z: 2 },
    },
  ];
}

export async function runAiRegressionSuite(): Promise<{
  pass: boolean;
  results: ScenarioResult[];
  medianMs: number;
}> {
  const scenarios = buildScenarios();
  const results: ScenarioResult[] = [];

  for (const s of scenarios) {
    const start = performance.now();
    const resp = await makeWorkerRequest({
      mode: 'search',
      pieces: s.pieces,
      color: s.toMove,
      difficulty: s.difficulty,
    });
    const elapsedMs = performance.now() - start;

    if (resp.type !== 'result' || !resp.fromPos || !resp.to) {
      results.push({ name: s.name, pass: false, elapsedMs, details: resp.error ?? 'worker_error' });
      continue;
    }

    const matchesExpected = s.expectedFrom && s.expectedTo
      ? eq(resp.fromPos, s.expectedFrom) && eq(resp.to, s.expectedTo)
      : true;
    results.push({
      name: s.name,
      pass: matchesExpected,
      elapsedMs,
      details: matchesExpected ? 'ok' : `got ${resp.fromPos.x},${resp.fromPos.y},${resp.fromPos.z} -> ${resp.to.x},${resp.to.y},${resp.to.z}`,
    });
  }

  const elapsed = results.map(r => r.elapsedMs).sort((a, b) => a - b);
  const medianMs = elapsed.length === 0 ? 0 : elapsed[Math.floor(elapsed.length / 2)];
  return {
    pass: results.every(r => r.pass),
    results,
    medianMs,
  };
}

import { Board } from './board';
import { getLegalMoves, getValidMoves, isKingInCheck } from './movement';
import { Piece, PieceColor, Position3D, Difficulty, PieceType } from './types';
import type { WorkerRequest, WorkerResponse, RootMove } from './botWorker';

export class Bot {
  private workers: Worker[];

  constructor(public color: PieceColor, public difficulty: Difficulty) {
    const workerCount = this.getWorkerCount();
    this.workers = Array.from(
      { length: workerCount },
      () => new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' }),
    );
  }

  private getWorkerCount(): number {
    if (this.difficulty !== 'hard') return 1;
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
    // Two workers is a better quality/speed tradeoff than broad fan-out for this engine.
    return cores <= 2 ? 1 : 2;
  }

  private requestWorker(
    worker: Worker,
    req: WorkerRequest,
    timeoutMs = 22000,
    onProgress?: (resp: WorkerResponse) => void,
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      let latestProgress: WorkerResponse | null = null;
      const timeoutId = window.setTimeout(() => {
        cleanup();
        if (latestProgress?.fromPos && latestProgress?.to) {
          resolve({
            type: 'result',
            fromPos: latestProgress.fromPos,
            to: latestProgress.to,
            score: latestProgress.score,
            completedDepth: latestProgress.completedDepth,
          });
          return;
        }
        reject(new Error('Worker timeout before any depth completed'));
      }, timeoutMs);
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'progress') {
          latestProgress = e.data;
          onProgress?.(e.data);
          return;
        }
        cleanup();
        resolve(e.data);
      };
      const onError = (err: ErrorEvent) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(req);
    });
  }

  private pickMoveSingle(
    board: Board,
    onProgress?: (resp: WorkerResponse) => void,
  ): Promise<WorkerResponse> {
    const timeoutMs = this.difficulty === 'hard' ? 22000 : this.difficulty === 'medium' ? 12000 : 8000;
    return this.requestWorker(this.workers[0], {
      pieces: board.serialize(),
      color: this.color,
      difficulty: this.difficulty,
      progressMode: onProgress ? 'detailed' : 'depth',
    }, timeoutMs, onProgress);
  }

  private buildRootMoves(board: Board): RootMove[] {
    const all: Array<RootMove & { ordering: number }> = [];
    const openingPhase = board.pieces.length >= 28;
    for (const piece of board.getPiecesOfColor(this.color)) {
      for (const to of getLegalMoves(board, piece)) {
        const captured = board.getPieceAt(to);
        const captureValue = captured
          ? (captured.type === PieceType.King ? 10_000 : captured.type === PieceType.Queen ? 900 : captured.type === PieceType.Rook ? 500 : captured.type === PieceType.Bishop ? 330 : captured.type === PieceType.Knight ? 320 : 100)
          : 0;
        const wasUnmoved = !piece.hasMoved;
        const wasPawn = piece.type === PieceType.Pawn;

        const applied = board.applyMove(piece, to);
        let threatValue = 0;
        let givesCheck = false;
        try {
          for (const sq of getValidMoves(board, piece)) {
            const occ = board.getPieceAt(sq);
            if (occ && occ.color !== piece.color) {
              threatValue = Math.max(threatValue, captured ? 0 : (occ.type === PieceType.King ? 10_000 : occ.type === PieceType.Queen ? 900 : occ.type === PieceType.Rook ? 500 : occ.type === PieceType.Bishop ? 330 : occ.type === PieceType.Knight ? 320 : 100));
            }
          }
          givesCheck = isKingInCheck(board, this.color === PieceColor.White ? PieceColor.Black : PieceColor.White);
        } finally {
          board.unapplyMove(applied);
        }

        let ordering = captureValue * 10 + threatValue * 3 + (givesCheck ? 800 : 0);
        if (openingPhase) {
          if (!wasPawn && wasUnmoved) ordering += 95;
          if (wasPawn && !captured) ordering -= 40;
          if ((piece.type === PieceType.Knight || piece.type === PieceType.Bishop) && wasUnmoved) ordering += 30;
        }
        all.push({
          fromPos: { ...piece.position },
          to: { ...to },
          ordering,
        });
      }
    }
    all.sort((a, b) => b.ordering - a.ordering);
    return all.map(({ fromPos, to }) => ({ fromPos, to }));
  }

  private async pickMoveParallel(
    board: Board,
    onProgress?: (resp: WorkerResponse) => void,
  ): Promise<WorkerResponse> {
    const reqBase: Omit<WorkerRequest, 'rootMoves'> = {
      pieces: board.serialize(),
      color: this.color,
      difficulty: this.difficulty,
    };
    const rootMoves = this.buildRootMoves(board);
    if (rootMoves.length === 0) {
      throw new Error('Bot has no legal moves');
    }

    const buckets: RootMove[][] = Array.from({ length: this.workers.length }, () => []);
    for (let i = 0; i < rootMoves.length; i++) {
      buckets[i % buckets.length].push(rootMoves[i]);
    }

    const settled = await Promise.allSettled(
      this.workers
        .map((worker, idx) => ({ worker, moves: buckets[idx] }))
        .filter(x => x.moves.length > 0)
        .map(x => this.requestWorker(
          x.worker,
          { ...reqBase, rootMoves: x.moves, progressMode: onProgress ? 'detailed' : 'depth' },
          22000,
          onProgress,
        )),
    );

    const results = settled
      .filter((r): r is PromiseFulfilledResult<WorkerResponse> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.type === 'result' && r.fromPos && r.to);

    if (results.length === 0) {
      const reason = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      throw new Error(reason ? String(reason.reason) : 'No worker returned a move');
    }

    const completedDepths = results
      .map(r => r.completedDepth)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    const commonDepth = completedDepths.length > 0 ? Math.min(...completedDepths) : 1;
    const maxDepth = completedDepths.length > 0 ? Math.max(...completedDepths) : 1;
    const depthSpread = maxDepth - commonDepth;
    if (depthSpread > 2) {
      return this.pickMoveSingle(board, onProgress);
    }

    const comparable = results
      .map((r) => {
        const atDepth = r.depthResults?.find(d => d.depth === commonDepth);
        return {
          resp: r,
          fromPos: atDepth?.fromPos ?? r.fromPos!,
          to: atDepth?.to ?? r.to!,
          score: atDepth?.score ?? (r.score ?? -Infinity),
        };
      });

    if (comparable.some(c => !c.fromPos || !c.to || !Number.isFinite(c.score))) {
      return this.pickMoveSingle(board, onProgress);
    }

    comparable.sort((a, b) => b.score - a.score);
    const best = comparable[0];
    return {
      type: 'result',
      fromPos: best.fromPos,
      to: best.to,
      score: best.score,
      completedDepth: commonDepth,
      depthResults: best.resp.depthResults,
    };
  }

  async pickMove(
    board: Board,
    onProgress?: (resp: WorkerResponse) => void,
  ): Promise<{ piece: Piece; to: Position3D }> {
    let resp: WorkerResponse;
    if (this.workers.length > 1) {
      try {
        resp = await this.pickMoveParallel(board, onProgress);
      } catch {
        // Strict fallback to single search path if parallel orchestration fails.
        resp = await this.pickMoveSingle(board, onProgress);
      }
    } else {
      resp = await this.pickMoveSingle(board, onProgress);
    }

    if (resp.type === 'error') {
      throw new Error(resp.error);
    }
    const piece = board.getPieceAt(resp.fromPos!);
    if (!piece) {
      throw new Error('Worker returned invalid piece position');
    }
    const legal = getLegalMoves(board, piece).some(m =>
      m.x === resp.to!.x && m.y === resp.to!.y && m.z === resp.to!.z,
    );
    if (!legal) {
      throw new Error('Worker returned illegal move');
    }
    return { piece, to: resp.to! };
  }

  terminate(): void {
    for (const worker of this.workers) worker.terminate();
  }
}

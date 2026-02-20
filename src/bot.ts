import { Board } from './board';
import { getLegalMoves } from './movement';
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
    // Keep one core for UI/renderer and cap to avoid worker overhead.
    return Math.max(2, Math.min(4, cores - 1));
  }

  private requestWorker(worker: Worker, req: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
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
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(req);
    });
  }

  private buildRootMoves(board: Board): RootMove[] {
    const all: Array<RootMove & { ordering: number }> = [];
    for (const piece of board.getPiecesOfColor(this.color)) {
      for (const to of getLegalMoves(board, piece)) {
        const captured = board.getPieceAt(to);
        const captureValue = captured
          ? (captured.type === PieceType.King ? 10_000 : captured.type === PieceType.Queen ? 900 : captured.type === PieceType.Rook ? 500 : captured.type === PieceType.Bishop ? 330 : captured.type === PieceType.Knight ? 320 : 100)
          : 0;
        all.push({
          fromPos: { ...piece.position },
          to: { ...to },
          ordering: captureValue,
        });
      }
    }
    all.sort((a, b) => b.ordering - a.ordering);
    return all.map(({ fromPos, to }) => ({ fromPos, to }));
  }

  private async pickMoveParallel(board: Board): Promise<WorkerResponse> {
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
        .map(x => this.requestWorker(x.worker, { ...reqBase, rootMoves: x.moves })),
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

  async pickMove(board: Board): Promise<{ piece: Piece; to: Position3D }> {
    const resp = this.workers.length > 1
      ? await this.pickMoveParallel(board)
      : await this.requestWorker(this.workers[0], {
        pieces: board.serialize(),
        color: this.color,
        difficulty: this.difficulty,
      });

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

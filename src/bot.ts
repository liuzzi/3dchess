import { Board } from './board';
import { Piece, PieceColor, Position3D, Difficulty } from './types';
import type { WorkerRequest, WorkerResponse } from './botWorker';

export class Bot {
  private worker: Worker;

  constructor(public color: PieceColor, public difficulty: Difficulty) {
    this.worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  }

  pickMove(board: Board): Promise<{ piece: Piece; to: Position3D }> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const resp = e.data;
        if (resp.type === 'error') {
          reject(new Error(resp.error));
          return;
        }
        const piece = board.getPieceAt(resp.fromPos!);
        if (!piece) {
          reject(new Error('Worker returned invalid piece position'));
          return;
        }
        resolve({ piece, to: resp.to! });
      };

      this.worker.onerror = (err) => {
        reject(err);
      };

      const req: WorkerRequest = {
        pieces: board.serialize(),
        color: this.color,
        difficulty: this.difficulty,
      };
      this.worker.postMessage(req);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

import { Piece, PieceColor, Difficulty } from './types';
import type { WorkerRequest, WorkerResponse } from './botWorker';

export async function runBotSelfTest(
  pieces: Piece[],
  color: PieceColor,
  difficulty: Difficulty = 'hard',
): Promise<{ pass: boolean; checks: string[] }> {
  const worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
  try {
    const req: WorkerRequest = {
      mode: 'selftest',
      pieces,
      color,
      difficulty,
    };
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerResponse>) => resolve(e.data);
      const onError = (err: ErrorEvent) => reject(err);
      worker.addEventListener('message', onMessage, { once: true });
      worker.addEventListener('error', onError, { once: true });
      worker.postMessage(req);
    });
    if (response.type === 'error' || !response.selfTest) {
      return { pass: false, checks: [response.error ?? 'selftest_failed'] };
    }
    return response.selfTest;
  } finally {
    worker.terminate();
  }
}

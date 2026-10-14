import type { Auth } from '../github/auth.js';
import { scan } from './pipeline.js';
import { ScanProgress } from './progress.js';
import type { ScanOptions } from './config.js';

export class Cancelled extends Error {
  constructor() {
    super('Scan cancelled');
  }
}

export async function withCancellation<T>(
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Cancelled());
  process.on('SIGINT', abort);
  try {
    return await task(controller.signal);
  } finally {
    process.removeListener('SIGINT', abort);
  }
}

export async function scanWithProgress(
  username: string,
  config: ScanOptions,
  auth?: Auth,
  signal?: AbortSignal,
) {
  const display = new ScanProgress();
  try {
    return await scan(username, config, display.update, {
      ...(auth ? { auth } : {}),
      ...(signal ? { signal } : {}),
    });
  } finally {
    display.stop();
  }
}

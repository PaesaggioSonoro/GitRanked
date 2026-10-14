import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export class Cache {
  constructor(
    readonly root: string,
    readonly ttlMs = 3600000,
  ) {}
  path(key: string): string {
    return join(
      this.root,
      `${createHash('sha256').update(key).digest('hex')}.json`,
    );
  }
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.path(key), 'utf8')) as {
        version: number;
        expires: number;
        data: T;
      };
      if (entry.version === 1 && entry.expires > Date.now()) return entry.data;
    } catch {
      /* Corrupt/missing caches are misses. */
    }
    return undefined;
  }
  async set(key: string, data: unknown): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(key);
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({ version: 1, expires: Date.now() + this.ttlMs, data }),
      { mode: 0o600 },
    );
    await rename(temp, target);
  }
}

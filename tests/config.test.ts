import { expect, test } from 'vitest';
import { date, options, windowFrom } from '../src/cli/config.js';
import { Cache } from '../src/cache/store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('UTC windows validate real dates and include entire until day', () => {
  expect(date('2024-02-29')).toBe('2024-02-29');
  expect(() => date('2025-02-29')).toThrow();
  expect(windowFrom('2024-12-31', '2025-01-01')).toEqual({
    since: '2024-12-31T00:00:00.000Z',
    until: '2025-01-01T23:59:59.999Z',
  });
  expect(() => options({ mode: 'oops' })).toThrow();
  expect(() => options({ maxRepos: '-1' })).toThrow();
});
test('cache expires and tolerates corrupted entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitranked-cache-'));
  try {
    const cache = new Cache(dir);
    await cache.set('public-data', { value: 1 });
    expect(await cache.get('public-data')).toEqual({ value: 1 });
    expect(await new Cache(dir, -1).get('missing')).toBeUndefined();
    const expired = new Cache(dir, -1);
    await expired.set('old', 1);
    expect(await cache.get('old')).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

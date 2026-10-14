import { expect, test } from 'vitest';
import { GitHubClient, boundedMap } from '../src/github/client.js';
const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(data), { status, headers });
test('pagination preserves partial pages and records failures without response bodies', async () => {
  let n = 0;
  const client = new GitHubClient(
    { source: 'anonymous' },
    {
      retries: 0,
      fetcher: async () =>
        ++n === 1
          ? response(Array.from({ length: 100 }, (_, i) => i))
          : response({ message: 'secret-value' }, 403),
    },
  );
  expect(await client.pages('/users/alice/repos', 3)).toHaveLength(100);
  expect(client.warnings.join()).toContain('403');
  expect(client.warnings.join()).not.toContain('secret-value');
});
test('429 retries within budget and search truncation is explicit', async () => {
  let n = 0;
  const sleeps: number[] = [];
  const client = new GitHubClient(
    { token: 'never-log-this', source: 'environment' },
    {
      fetcher: async () =>
        ++n === 1
          ? response({}, 429, { 'retry-after': '1' })
          : response({ items: [1], total_count: 12, incomplete_results: true }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );
  expect(await client.pages('/search/issues?q=a', 2, true)).toEqual([1]);
  expect(sleeps).toEqual([1000]);
  expect(client.warnings).toHaveLength(2);
});
test('network failures and long primary limits are bounded', async () => {
  const client = new GitHubClient(
    { source: 'anonymous' },
    {
      fetcher: async () => {
        throw new Error('token-in-upstream-error');
      },
      sleep: async () => {},
      retries: 1,
    },
  );
  await expect(client.request('/users/a')).rejects.toThrow('network');
  const rate = new GitHubClient(
    { source: 'anonymous' },
    {
      fetcher: async () =>
        response({}, 403, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Date.now() / 1000 + 1000),
        }),
    },
  );
  await expect(rate.request('/users/a')).rejects.toThrow('rate limit');
});
test('bounded concurrency maintains deterministic ordering', async () => {
  let active = 0,
    max = 0;
  const result = await boundedMap([1, 2, 3, 4], 2, async (n) => {
    max = Math.max(max, ++active);
    await Promise.resolve();
    active--;
    return n * 2;
  });
  expect(max).toBeLessThanOrEqual(2);
  expect(result).toEqual([2, 4, 6, 8]);
});

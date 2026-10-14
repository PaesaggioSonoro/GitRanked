import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../src/cli/pipeline.js';
import { options } from '../src/cli/config.js';
import { validateReport } from '../src/report/index.js';
import type { ProgressEvent } from '../src/cli/progress.js';
import * as authentication from '../src/github/auth.js';

afterEach(() => vi.restoreAllMocks());
const publicApi: typeof fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  return new Response(
    JSON.stringify(
      path === '/users/alice'
        ? {
            login: 'alice',
            id: 42,
            html_url: 'https://github.com/alice',
            type: 'User',
          }
        : path.startsWith('/search/')
          ? { items: [], total_count: 0 }
          : [],
    ),
  );
};

test('forced anonymous scan bypasses all auth resolution and writes validated token-free JSON', async () => {
  const resolve = vi
    .spyOn(authentication, 'resolveAuth')
    .mockRejectedValue(new Error('must not resolve credentials'));
  const dir = await mkdtemp(join(tmpdir(), 'gitranked-pipeline-'));
  const events: ProgressEvent[] = [];
  try {
    const report = await scan(
      'alice',
      options({ mode: 'fast', output: dir, format: 'json' }),
      (event) => events.push(event),
      { auth: { source: 'anonymous' }, fetcher: publicApi },
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(report.provenance.authSource).toBe('anonymous');
    expect(events.map((event) => event.stage)).toContain('export');
    expect(events.at(-1)?.stage).toBe('done');
    expect(
      events.filter((event) => event.stage === 'discovery').at(-1)?.requests,
    ).toBeGreaterThan(0);
    const text = await readFile(join(dir, 'gitranked.json'), 'utf8');
    expect(validateReport(JSON.parse(text)).coverage.status).toBe('partial');
    expect(text).not.toContain('token');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('github-app provenance validates and session credentials never enter reports or progress', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitranked-app-pipeline-'));
  const events: ProgressEvent[] = [];
  try {
    const token = 'ghu_do_not_print_123';
    const report = await scan(
      'alice',
      options({ mode: 'fast', output: dir, format: 'json' }),
      (event) => events.push(event),
      {
        auth: { source: 'github-app', token },
        fetcher: async (url, init) => {
          expect((init?.headers as Record<string, string>).Authorization).toBe(
            `Bearer ${token}`,
          );
          return publicApi(url, init);
        },
      },
    );
    expect(report.provenance.authSource).toBe('github-app');
    expect(JSON.stringify(report) + JSON.stringify(events)).not.toContain(
      token,
    );
    expect(
      validateReport(
        JSON.parse(await readFile(join(dir, 'gitranked.json'), 'utf8')),
      ).reportId,
    ).toBe(report.reportId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expired saved access fails with reauthorization guidance before producing a misleading report', async () => {
  await expect(
    scan('alice', options({ mode: 'fast' }), () => {}, {
      auth: { source: 'keychain', token: 'ghu_expired_123' },
      fetcher: async () =>
        new Response(JSON.stringify({ message: 'ghu_expired_123' }), {
          status: 401,
        }),
    }),
  ).rejects.toThrow('credential expired or was revoked');
});

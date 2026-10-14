import { afterEach, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  interactiveScan,
  authorizedUsername,
  AUTH_EXPLANATION,
  type WizardUi,
} from '../src/cli/interactive.js';
import { GITHUB_APP_CLIENT_ID } from '../src/github/app.js';
import { Cancelled } from '../src/cli/workflow.js';
import { validateReport } from '../src/report/index.js';

const report = validateReport(
  JSON.parse(await readFile('tests/fixtures/report.json', 'utf8')),
);
afterEach(() => vi.unstubAllGlobals());
function ui(choice: 'github' | 'anonymous'): WizardUi {
  return {
    start: vi.fn(),
    chooseAuth: vi.fn(async () => choice),
    username: vi.fn(async () => 'alice'),
    message: vi.fn(),
    waiting: vi.fn(),
    stopWaiting: vi.fn(),
    finish: vi.fn(),
  };
}

test('anonymous wizard asks for username then scans with forced anonymous auth', async () => {
  const terminal = ui('anonymous');
  const authorize = vi.fn(),
    identity = vi.fn();
  const performScan = vi.fn(async () => report);
  const signal = new AbortController().signal;
  await interactiveScan(
    { mode: 'fast', output: '.gitranked/interactive-test' },
    signal,
    {
      tty: true,
      ui: terminal,
      authorize,
      identity,
      performScan,
    },
  );
  expect(terminal.username).toHaveBeenCalledOnce();
  expect(authorize).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
  expect(performScan).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({ mode: 'fast', format: 'all' }),
    { source: 'anonymous' },
    signal,
  );
  expect(terminal.finish).toHaveBeenCalledWith(
    report,
    expect.stringContaining('interactive-test'),
    false,
  );
  expect(AUTH_EXPLANATION).toMatch(/higher API limits/);
  expect(AUTH_EXPLANATION).toMatch(/revoke/);
});

test('login wizard uses bundled client and authorized account rather than asking for username', async () => {
  const terminal = ui('github');
  const auth = { token: 'ghu_ephemeral_123', source: 'github-app' as const };
  const authorize = vi.fn(async (_clientId, opts) => {
    opts?.announce?.('Enter temporary verification code');
    opts?.waiting?.();
    return auth;
  });
  const identity = vi.fn(async () => 'signed-in-account');
  const performScan = vi.fn(async () => report);
  const signal = new AbortController().signal;
  await interactiveScan({}, signal, {
    tty: true,
    ui: terminal,
    authorize,
    identity,
    performScan,
  });
  expect(authorize).toHaveBeenCalledWith(
    GITHUB_APP_CLIENT_ID,
    expect.objectContaining({ signal, openBrowser: expect.any(Function) }),
  );
  expect(identity).toHaveBeenCalledWith(auth, signal);
  expect(terminal.username).not.toHaveBeenCalled();
  expect(performScan).toHaveBeenCalledWith(
    'signed-in-account',
    expect.objectContaining({ mode: 'deep' }),
    auth,
    signal,
  );
  expect(terminal.stopWaiting).toHaveBeenCalledWith(true);
  expect(terminal.finish).toHaveBeenCalledWith(
    report,
    expect.any(String),
    true,
  );
});

test('non-TTY, prompt cancellation, authorization denial and cancelled scan do not proceed', async () => {
  const signal = new AbortController().signal;
  const terminal = ui('github'),
    performScan = vi.fn(async () => report);
  await expect(
    interactiveScan({}, signal, { tty: false, ui: terminal, performScan }),
  ).rejects.toThrow('scan USERNAME --anonymous');
  expect(terminal.start).not.toHaveBeenCalled();
  await expect(
    interactiveScan({}, signal, {
      tty: true,
      ui: {
        ...terminal,
        chooseAuth: async () => {
          throw new Cancelled();
        },
      },
      performScan,
    }),
  ).rejects.toThrow('cancelled');
  await expect(
    interactiveScan({}, signal, {
      tty: true,
      ui: terminal,
      authorize: async () => {
        throw new Error('denied');
      },
      performScan,
    }),
  ).rejects.toThrow('denied');
  expect(terminal.stopWaiting).toHaveBeenCalledWith(false);
  const controller = new AbortController();
  controller.abort(new Cancelled());
  await expect(
    interactiveScan({}, controller.signal, {
      tty: true,
      ui: ui('anonymous'),
      performScan,
    }),
  ).rejects.toThrow('cancelled');
  expect(performScan).not.toHaveBeenCalled();
});

test('authorized identity is fetched with the session token and validated', async () => {
  const fetcher = vi.fn(async (_url, opts) => {
    expect(opts?.headers.Authorization).toBe('Bearer ghu_session_123');
    return new Response(JSON.stringify({ login: 'alice', id: 42 }));
  });
  vi.stubGlobal('fetch', fetcher);
  expect(
    await authorizedUsername({
      token: 'ghu_session_123',
      source: 'github-app',
    }),
  ).toBe('alice');
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.github.com/user',
    expect.anything(),
  );
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify({ login: 'alice' })),
  );
  await expect(authorizedUsername({ source: 'github-app' })).rejects.toThrow(
    'invalid authorized account',
  );
});

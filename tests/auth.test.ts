import { expect, test } from 'vitest';
import { resolveAuth } from '../src/github/auth.js';
import { deviceLogin } from '../src/github/device-flow.js';
import { OsSecretStore, type SecretStore } from '../src/github/secret-store.js';
import type { run } from '../src/git/process.js';
const memory = (): SecretStore & { value?: string } => ({
  available: async () => {},
  get: async function () {
    return this.value;
  },
  set: async function (token: string) {
    this.value = token;
  },
  delete: async function () {
    delete this.value;
  },
});
const unavailable: typeof run = async () => {
  throw new Error('upstream-secret-do-not-print');
};
test('auth precedence respects environment, gh, secure saved login and anonymous access', async () => {
  const store = memory();
  await store.set('saved_token_123');
  expect(
    await resolveAuth({ GITHUB_TOKEN: 'env_token_123' }, unavailable, store),
  ).toEqual({ token: 'env_token_123', source: 'environment' });
  expect(await resolveAuth({}, async () => 'cli_token_123', store)).toEqual({
    token: 'cli_token_123',
    source: 'github-cli',
  });
  expect(await resolveAuth({}, unavailable, store)).toEqual({
    token: 'saved_token_123',
    source: 'keychain',
  });
  await store.delete();
  expect(await resolveAuth({}, unavailable, store)).toEqual({
    source: 'anonymous',
  });
});
test('device flow requests no OAuth scopes, polls pending/slow_down and never announces token', async () => {
  const store = memory();
  let now = 0,
    n = 0;
  const messages: string[] = [],
    sleeps: number[] = [],
    bodies: URLSearchParams[] = [];
  const responses = [
    {
      device_code: 'device-secret',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 60,
      interval: 1,
    },
    { error: 'authorization_pending' },
    { error: 'slow_down' },
    { access_token: 'ghu_token_123', scope: '' },
  ];
  await deviceLogin('configured-client', store, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      sleeps.push(ms);
    },
    announce: (m) => messages.push(m),
    fetcher: async (_url, opts) => {
      bodies.push(new URLSearchParams(String(opts?.body)));
      return new Response(JSON.stringify(responses[n++]), { status: 200 });
    },
  });
  expect(sleeps).toEqual([1000, 1000, 6000]);
  expect(bodies[0]?.has('scope')).toBe(false);
  expect(bodies.every((b) => !b.has('client_secret'))).toBe(true);
  expect(messages.join()).not.toContain('ghu_token_123');
  expect(messages.join()).not.toContain('device-secret');
  expect(await store.get()).toBe('ghu_token_123');
});
test('missing client, denial, expiration and unexpected permissions are safe failures', async () => {
  const store = memory();
  await expect(deviceLogin(undefined, store)).rejects.toThrow('Client ID');
  for (const error of ['access_denied', 'expired_token']) {
    let n = 0;
    await expect(
      deviceLogin('client', store, {
        sleep: async () => {},
        fetcher: async () =>
          new Response(
            JSON.stringify(
              n++ === 0
                ? {
                    device_code: 'code',
                    user_code: 'ABCD',
                    verification_uri: 'https://github.com/login/device',
                    expires_in: 60,
                    interval: 1,
                  }
                : { error },
            ),
            { status: 200 },
          ),
      }),
    ).rejects.toThrow(error === 'access_denied' ? 'denied' : 'expired');
  }
  let n = 0;
  await expect(
    deviceLogin('client', store, {
      sleep: async () => {},
      fetcher: async () =>
        new Response(
          JSON.stringify(
            n++ === 0
              ? {
                  device_code: 'code',
                  user_code: 'ABCD',
                  verification_uri: 'https://github.com/login/device',
                  expires_in: 60,
                  interval: 1,
                }
              : { access_token: 'secret_never_saved', scope: 'repo' },
          ),
          { status: 200 },
        ),
    }),
  ).rejects.toThrow('scopes');
  expect(await store.get()).toBeUndefined();
});
test('OS stores send credentials via stdin and securely delete; unsupported storage has no fallback', async () => {
  for (const platform of ['darwin', 'linux'] as const) {
    let value: string | undefined;
    const calls: { args: string[]; input?: string }[] = [];
    const execute: typeof run = async (_command, args, opts = {}) => {
      calls.push({ args, ...(opts.input ? { input: opts.input } : {}) });
      if (args.includes('-i') || args[0] === 'store') value = 'ghu_token_123';
      if (args.includes('delete-generic-password') || args[0] === 'clear')
        value = undefined;
      if (args.includes('find-generic-password') || args[0] === 'lookup') {
        if (!value) throw new Error('missing');
        return value;
      }
      return '';
    };
    const store = new OsSecretStore(platform, execute);
    await store.set('ghu_token_123');
    expect(calls.some((c) => c.input?.includes('ghu_token_123'))).toBe(true);
    expect(calls.some((c) => c.args.join().includes('ghu_token_123'))).toBe(
      false,
    );
    await store.delete();
    expect(await store.get()).toBeUndefined();
    await expect(store.set('bad\ncredential')).rejects.toThrow('format');
  }
  await expect(
    new OsSecretStore('win32', unavailable).available(),
  ).rejects.toThrow('OS storage');
  expect(await new OsSecretStore('win32', unavailable).get()).toBeUndefined();
});

test('GitHub App session opens the browser and does not retain refresh credentials', async () => {
  const { authorizeDevice } = await import('../src/github/device-flow.js');
  const messages: string[] = [],
    urls: string[] = [];
  let n = 0;
  const auth = await authorizeDevice('Iv23lifRY1rPYNaMNGes', {
    sleep: async () => {},
    announce: (message) => messages.push(message),
    openBrowser: async (url) => {
      urls.push(url);
      return false;
    },
    fetcher: async () =>
      new Response(
        JSON.stringify(
          n++ === 0
            ? {
                device_code: 'device-secret',
                user_code: 'ABCD-EFGH',
                verification_uri: 'https://github.com/login/device',
                expires_in: 60,
                interval: 1,
              }
            : {
                access_token: 'ghu_session_123',
                refresh_token: 'ghr_never_retain',
                expires_in: 28800,
                scope: '',
              },
        ),
      ),
  });
  expect(auth).toEqual({ token: 'ghu_session_123', source: 'github-app' });
  expect(urls).toEqual(['https://github.com/login/device']);
  expect(messages.join()).toContain('Could not open');
  expect(messages.join()).not.toMatch(/ghu_|ghr_|device-secret/);
});

test('device session honors cancellation and redacts upstream errors', async () => {
  const { authorizeDevice } = await import('../src/github/device-flow.js');
  const controller = new AbortController();
  controller.abort();
  await expect(
    authorizeDevice('client', { signal: controller.signal }),
  ).rejects.toThrow();
  await expect(
    authorizeDevice('client', {
      fetcher: async () => {
        throw new Error('upstream-secret');
      },
    }),
  ).rejects.toThrow('request failed');
});

test('device polling honors the returned slow-down interval and local code deadline', async () => {
  const { authorizeDevice } = await import('../src/github/device-flow.js');
  let now = 0,
    request = 0;
  const sleeps: number[] = [];
  await expect(
    authorizeDevice('client', {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetcher: async () =>
        new Response(
          JSON.stringify(
            request++ === 0
              ? {
                  device_code: 'secret',
                  user_code: 'ABCD-EFGH',
                  verification_uri: 'https://github.com/login/device',
                  expires_in: 10,
                  interval: 1,
                }
              : { error: 'slow_down', interval: 20 },
          ),
        ),
    }),
  ).rejects.toThrow('expired');
  expect(sleeps).toEqual([1000, 9000]);
  expect(request).toBe(2);
});

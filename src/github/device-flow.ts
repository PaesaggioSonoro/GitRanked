import type { SecretStore } from './secret-store.js';
import type { Auth } from './auth.js';
import { DEVICE_URL } from './app.js';
import { setTimeout as delay } from 'node:timers/promises';
export interface DeviceOptions {
  signal?: AbortSignal;
  openBrowser?: (url: string) => Promise<boolean>;
  waiting?: () => void;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  announce?: (message: string) => void;
}
export async function authorizeDevice(
  clientId: string | undefined,
  options: DeviceOptions = {},
): Promise<Auth> {
  if (!clientId || !/^[A-Za-z0-9._-]{1,200}$/.test(clientId))
    throw new Error(
      'Set GITRANKED_CLIENT_ID or --client-id to a real GitHub App Client ID with Device Flow enabled',
    );
  const fetcher = options.fetcher ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      delay(ms, undefined, options.signal ? { signal: options.signal } : {}));
  const now = options.now ?? Date.now;
  const post = async (
    path: string,
    body: Record<string, string>,
  ): Promise<any> => {
    options.signal?.throwIfAborted();
    try {
      const response = await fetcher(`https://github.com${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'gitranked/1.0.0',
        },
        body: new URLSearchParams(body),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      options.signal?.throwIfAborted();
      throw new Error(
        'GitHub device authorization request failed or timed out',
      );
    }
  };
  // GitHub Apps use registration permissions, not OAuth App scopes.
  // No client secret or offline_access request; discard any returned refresh token.
  const device = await post('/login/device/code', {
    client_id: clientId,
  });
  if (
    typeof device.device_code !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(device.user_code ?? '') ||
    device.verification_uri !== DEVICE_URL ||
    !Number.isFinite(device.expires_in) ||
    device.expires_in <= 0 ||
    !Number.isFinite(device.interval) ||
    device.interval <= 0
  )
    throw new Error(
      'GitHub returned invalid device authorization data; check GitHub App Device Flow configuration',
    );
  options.announce?.(
    `Enter code ${device.user_code} at ${DEVICE_URL}. GitRanked analyzes public activity only.`,
  );
  if (options.openBrowser && !(await options.openBrowser(DEVICE_URL)))
    options.announce?.(
      `Could not open a browser automatically. Open ${DEVICE_URL} and enter the code above.`,
    );
  options.waiting?.();
  const expires = now() + Math.min(device.expires_in, 1800) * 1000;
  let interval = Math.max(1, device.interval) * 1000;
  while (now() < expires) {
    options.signal?.throwIfAborted();
    await sleep(Math.min(interval, Math.max(0, expires - now())));
    if (now() >= expires) break;
    const result = await post('/login/oauth/access_token', {
      client_id: clientId,
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (typeof result.access_token === 'string') {
      if (result.scope && String(result.scope).trim())
        throw new Error(
          'GitHub returned unexpected OAuth scopes; check that this is a GitHub App.',
        );
      if (!/^ghu_[A-Za-z0-9_]{6,508}$/.test(result.access_token))
        throw new Error(
          'GitHub returned an unsupported GitHub App credential format',
        );
      return { token: result.access_token, source: 'github-app' };
    }
    if (result.error === 'authorization_pending') continue;
    if (result.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    if (result.error === 'access_denied')
      throw new Error('GitHub device authorization was denied');
    if (result.error === 'expired_token') break;
    throw new Error(
      'GitHub device authorization failed; check the Client ID and Device Flow setting',
    );
  }
  throw new Error('GitHub device authorization expired; run login again');
}

/** Explicit login retains only the access token, never a refresh token. */
export async function deviceLogin(
  clientId: string | undefined,
  store: SecretStore,
  options: DeviceOptions = {},
): Promise<void> {
  await store.available();
  const auth = await authorizeDevice(clientId, options);
  await store.set(auth.token!);
}

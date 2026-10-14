import type { SecretStore } from './secret-store.js';
interface DeviceOptions {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  announce?: (message: string) => void;
}
export async function deviceLogin(
  clientId: string | undefined,
  store: SecretStore,
  options: DeviceOptions = {},
): Promise<void> {
  if (!clientId || !/^[A-Za-z0-9._-]{1,200}$/.test(clientId))
    throw new Error(
      'Set GITRANKED_CLIENT_ID or --client-id to a real GitHub OAuth App Client ID with Device Flow enabled',
    );
  await store.available();
  const fetcher = options.fetcher ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const post = async (
    path: string,
    body: Record<string, string>,
  ): Promise<any> => {
    try {
      const response = await fetcher(`https://github.com${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'gitranked/1.0.0',
        },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      throw new Error(
        'GitHub device authorization request failed or timed out',
      );
    }
  };
  // An empty scope suffices for public-only API reads. Never bundle a Client Secret.
  const device = await post('/login/device/code', {
    client_id: clientId,
    scope: '',
  });
  if (
    typeof device.device_code !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(device.user_code ?? '') ||
    device.verification_uri !== 'https://github.com/login/device' ||
    !Number.isFinite(device.expires_in) ||
    device.expires_in <= 0 ||
    !Number.isFinite(device.interval) ||
    device.interval <= 0
  )
    throw new Error(
      'GitHub returned invalid device authorization data; check OAuth App Device Flow configuration',
    );
  options.announce?.(
    `Open https://github.com/login/device and enter ${device.user_code}. This requests access to public data with no OAuth scopes.`,
  );
  const expires = now() + Math.min(device.expires_in, 1800) * 1000;
  let interval = Math.max(1, device.interval) * 1000;
  while (now() < expires) {
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
          'OAuth returned unexpected permissions. Revoke the existing app grant and retry with no scopes.',
        );
      await store.set(result.access_token);
      return;
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

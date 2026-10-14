import { OsSecretStore, type SecretStore } from './secret-store.js';
import { run } from '../git/process.js';
export interface Auth {
  token?: string;
  source: 'environment' | 'github-cli' | 'anonymous' | 'keychain';
}
export async function resolveAuth(
  env: NodeJS.ProcessEnv = process.env,
  execute: typeof run = run,
  store: SecretStore = new OsSecretStore(),
): Promise<Auth> {
  if (env.GITHUB_TOKEN?.trim())
    return { token: env.GITHUB_TOKEN.trim(), source: 'environment' };
  try {
    const token = await execute(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 5000, maxOutput: 4096 },
    );
    if (token) return { token, source: 'github-cli' };
  } catch {
    /* Anonymous access is supported. */
  }
  const saved = await store.get();
  if (saved) return { token: saved, source: 'keychain' };
  return { source: 'anonymous' };
}

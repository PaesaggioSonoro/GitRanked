import { run } from '../git/process.js';
export interface Auth {
  token?: string;
  source: 'environment' | 'github-cli' | 'anonymous' | 'keychain';
}
export async function resolveAuth(): Promise<Auth> {
  if (process.env.GITHUB_TOKEN?.trim())
    return { token: process.env.GITHUB_TOKEN.trim(), source: 'environment' };
  try {
    const token = await run(
      'gh',
      ['auth', 'token', '--hostname', 'github.com'],
      { timeout: 5000, maxOutput: 4096 },
    );
    if (token) return { token, source: 'github-cli' };
  } catch {
    /* Anonymous access is supported. */
  }
  return { source: 'anonymous' };
}

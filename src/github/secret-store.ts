import { run } from '../git/process.js';
export interface SecretStore {
  available(): Promise<void>;
  get(): Promise<string | undefined>;
  set(token: string): Promise<void>;
  delete(): Promise<void>;
}
const SERVICE = 'com.gitranked.github';
const tokenIsSafe = (token: string) => /^[A-Za-z0-9_]{10,512}$/.test(token);
/** Native OS tools receive token data over stdin, never argv or a plaintext file. */
export class OsSecretStore implements SecretStore {
  constructor(
    readonly platform: NodeJS.Platform = process.platform,
    readonly execute: typeof run = run,
  ) {}
  async available(): Promise<void> {
    try {
      if (this.platform === 'darwin')
        await this.execute('security', ['help', 'add-generic-password'], {
          timeout: 5000,
          maxOutput: 8192,
        });
      else if (this.platform === 'linux')
        await this.execute('secret-tool', ['--help'], {
          timeout: 5000,
          maxOutput: 8192,
        });
      else throw new Error('unsupported platform');
    } catch {
      throw new Error(
        'Optional login requires macOS Keychain or Linux Secret Service with secret-tool. Use GITHUB_TOKEN or existing gh authentication when OS storage is unavailable.',
      );
    }
  }
  async get(): Promise<string | undefined> {
    try {
      const value =
        this.platform === 'darwin'
          ? await this.execute(
              'security',
              [
                'find-generic-password',
                '-a',
                'github.com',
                '-s',
                SERVICE,
                '-w',
              ],
              { timeout: 5000, maxOutput: 4096 },
            )
          : this.platform === 'linux'
            ? await this.execute(
                'secret-tool',
                ['lookup', 'service', SERVICE, 'account', 'github.com'],
                { timeout: 5000, maxOutput: 4096 },
              )
            : '';
      return tokenIsSafe(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  async set(token: string): Promise<void> {
    if (!tokenIsSafe(token))
      throw new Error('GitHub returned an unsupported credential format');
    await this.available();
    try {
      if (this.platform === 'darwin')
        await this.execute('security', ['-i'], {
          input: `add-generic-password -U -a github.com -s ${SERVICE} -w ${token}\nquit\n`,
          timeout: 15000,
          maxOutput: 8192,
        });
      else
        await this.execute(
          'secret-tool',
          [
            'store',
            '--label=GitRanked GitHub login',
            'service',
            SERVICE,
            'account',
            'github.com',
          ],
          { input: `${token}\n`, timeout: 15000, maxOutput: 8192 },
        );
      if ((await this.get()) !== token) throw new Error('verification failed');
    } catch {
      throw new Error(
        'Unable to save GitHub credential in OS secret storage; no plaintext fallback is used',
      );
    }
  }
  async delete(): Promise<void> {
    await this.available();
    try {
      if (this.platform === 'darwin')
        await this.execute(
          'security',
          ['delete-generic-password', '-a', 'github.com', '-s', SERVICE],
          { timeout: 15000, maxOutput: 8192 },
        );
      else
        await this.execute(
          'secret-tool',
          ['clear', 'service', SERVICE, 'account', 'github.com'],
          { timeout: 15000, maxOutput: 8192 },
        );
      if ((await this.get()) !== undefined)
        throw new Error('deletion verification failed');
    } catch (err) {
      if (
        this.platform === 'darwin' &&
        err instanceof Error &&
        err.message.endsWith('(44)')
      )
        return;
      throw new Error(
        'Unable to delete the GitRanked GitHub credential from OS secret storage',
      );
    }
  }
}

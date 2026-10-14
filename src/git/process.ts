import { spawn } from 'node:child_process';
export interface ProcessOptions {
  cwd?: string;
  input?: string;
  timeout?: number;
  maxOutput?: number;
  checkBudget?: () => Promise<void>;
}
/** Never expose command arguments, child stderr, or credentials through errors. */
export function run(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_LFS_SKIP_SMUDGE: '1',
      },
    });
    let output = '';
    let size = 0;
    let failure: Error | undefined;
    let checking = false;
    const stop = (reason: string) => {
      failure ??= new Error(reason);
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Process already exited. */
      }
    };
    const timer = setTimeout(
      () => stop('Process execution budget exceeded'),
      options.timeout ?? 30000,
    );
    const budget = setInterval(() => {
      if (!checking && options.checkBudget) {
        checking = true;
        options
          .checkBudget()
          .catch(() => stop('Git resource budget exceeded'))
          .finally(() => {
            checking = false;
          });
      }
    }, 100);
    child.stdout.on('data', (b: Buffer) => {
      size += b.length;
      if (size > (options.maxOutput ?? 16 * 1024 ** 2))
        stop('Process output budget exceeded');
      else output += b.toString();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      failure = new Error(`${command} is unavailable`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(budget);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(`${command} operation failed (${code})`));
      else resolve(output.trimEnd());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
}

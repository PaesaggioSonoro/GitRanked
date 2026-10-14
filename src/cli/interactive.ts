import * as prompts from '@clack/prompts';
import type { Auth } from '../github/auth.js';
import { appClientId, REVOKE_URL } from '../github/app.js';
import { GitHubClient } from '../github/client.js';
import { authorizeDevice } from '../github/device-flow.js';
import type { Report } from '../report/index.js';
import { options, isUsername } from './config.js';
import { openBrowser } from './browser.js';
import { Cancelled, scanWithProgress } from './workflow.js';

export const AUTH_EXPLANATION = [
  'GitHub login: higher API limits and additional public contribution discovery.',
  'Anonymous: no authorization; lower limits and potentially less public evidence.',
  'Both analyze public activity only. Discovery is never guaranteed exhaustive.',
  'After a logged-in scan, you can revoke GitRanked in GitHub settings.',
].join('\n');

export interface WizardUi {
  start(): void;
  chooseAuth(): Promise<'github' | 'anonymous'>;
  username(): Promise<string>;
  message(message: string): void;
  waiting(): void;
  stopWaiting(success: boolean): void;
  finish(report: Report, output: string, authenticated: boolean): void;
}

export function terminalUi(signal?: AbortSignal): WizardUi {
  const output = process.stderr;
  let spinner: ReturnType<typeof prompts.spinner> | undefined;
  return {
    start() {
      prompts.intro('GitRanked | your public year in code', { output });
      prompts.note(AUTH_EXPLANATION, 'Choose how to scan', { output });
    },
    async chooseAuth() {
      const choice = await prompts.select<'github' | 'anonymous'>({
        message: 'How would you like to continue?',
        initialValue: 'github',
        options: [
          {
            value: 'github' as const,
            label: 'Continue with GitHub',
            hint: 'recommended',
          },
          {
            value: 'anonymous' as const,
            label: 'Scan anonymously',
            hint: 'no login',
          },
        ],
        output,
        ...(signal ? { signal } : {}),
      });
      if (prompts.isCancel(choice)) throw new Cancelled();
      return choice;
    },
    async username() {
      const value = await prompts.text({
        message: 'Which GitHub username should we scan?',
        placeholder: 'octocat',
        validate: (value) =>
          isUsername((value ?? '').trim())
            ? undefined
            : 'Enter a valid GitHub username (without @).',
        output,
        ...(signal ? { signal } : {}),
      });
      if (prompts.isCancel(value)) throw new Cancelled();
      return value.trim();
    },
    message(message) {
      prompts.log.info(message, { output });
    },
    waiting() {
      spinner = prompts.spinner({ output, onCancel: () => {} });
      spinner.start('Waiting for GitHub authorization (Ctrl+C to cancel)');
    },
    stopWaiting(success) {
      spinner?.stop(
        success ? 'GitHub account authorized' : 'Authorization stopped',
      );
      spinner = undefined;
    },
    finish(report, outputPath, authenticated) {
      prompts.note(
        `Score: ${report.scoring.displayTotal}/1000\n${report.coverage.status} | ${Math.floor(report.coverage.ratio * 100)}% of discovered activity analyzed\nSaved to: ${outputPath}${report.warnings.length ? `\n${report.warnings.length} coverage warnings recorded in JSON.` : ''}`,
        `@${report.subject.login}`,
        { output },
      );
      if (authenticated)
        prompts.note(
          `This session's credentials are discarded; GitHub authorization remains.\nRevoke GitRanked whenever you like:\n${REVOKE_URL}`,
          'Your GitHub access',
          { output },
        );
      prompts.outro('Your GitRanked report is ready.', { output });
    },
  };
}

export async function authorizedUsername(
  auth: Auth,
  signal?: AbortSignal,
): Promise<string> {
  const user = await new GitHubClient(auth, signal ? { signal } : {}).request<{
    login: string;
    id: number;
  }>('/user');
  if (!isUsername(user.login) || !Number.isSafeInteger(user.id) || user.id <= 0)
    throw new Error('GitHub returned an invalid authorized account');
  return user.login;
}

interface WizardDependencies {
  ui?: WizardUi;
  tty?: boolean;
  authorize?: typeof authorizeDevice;
  identity?: typeof authorizedUsername;
  performScan?: typeof scanWithProgress;
}

export async function interactiveScan(
  raw: Record<string, string | undefined>,
  signal: AbortSignal,
  dependencies: WizardDependencies = {},
): Promise<Report> {
  if (!(dependencies.tty ?? (process.stdin.isTTY && process.stderr.isTTY)))
    throw new Error(
      'Interactive mode needs a terminal. Use: gitranked scan USERNAME --anonymous (or omit --anonymous to use existing authentication).',
    );
  const config = options(raw);
  const ui = dependencies.ui ?? terminalUi(signal);
  ui.start();
  const choice = await ui.chooseAuth();
  let auth: Auth;
  let username: string;
  if (choice === 'anonymous') {
    auth = { source: 'anonymous' };
    username = (await ui.username()).trim();
    if (!isUsername(username)) throw new Error('Invalid GitHub username');
  } else {
    try {
      auth = await (dependencies.authorize ?? authorizeDevice)(appClientId(), {
        signal,
        openBrowser,
        announce: (message) => ui.message(message),
        waiting: () => ui.waiting(),
      });
      username = await (dependencies.identity ?? authorizedUsername)(
        auth,
        signal,
      );
      ui.stopWaiting(true);
      ui.message(`Scanning @${username}'s publicly verifiable activity.`);
    } catch (error) {
      ui.stopWaiting(false);
      throw error;
    }
  }
  signal.throwIfAborted();
  const report = await (dependencies.performScan ?? scanWithProgress)(
    username,
    config,
    auth,
    signal,
  );
  ui.finish(report, config.output, choice === 'github');
  return report;
}

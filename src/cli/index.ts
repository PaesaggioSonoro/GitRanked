#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VERSION } from '../index.js';
import { options } from './config.js';
import { scan, exportReport } from './pipeline.js';
import { validateReport } from '../report/index.js';
import { deviceLogin } from '../github/device-flow.js';
import { OsSecretStore } from '../github/secret-store.js';
import { appClientId, REVOKE_URL } from '../github/app.js';
import { openBrowser } from './browser.js';
const program = new Command()
  .name('gitranked')
  .description('An auditable index of public GitHub development activity')
  .version(VERSION);
program
  .command('scan')
  .argument('<username>', 'GitHub username')
  .description('Scan publicly verifiable activity; defaults to deep inspection')
  .option('--mode <mode>', 'fast or deep', 'deep')
  .option('--since <date>', 'UTC start date YYYY-MM-DD')
  .option('--until <date>', 'UTC end date YYYY-MM-DD')
  .option('--format <format>', 'json, svg, png or all', 'all')
  .option('--output <dir>', 'output directory', '.gitranked')
  .option('--cache <dir>', 'cache directory outside the current checkout')
  .option('--max-repos <number>', 'Git repository inspection limit', '50')
  .option('--max-pages <number>', 'pages per API listing', '10')
  .option('--max-commits <number>', 'total Git commits inspected', '2000')
  .option(
    '--max-repo-kb <number>',
    'preliminary approximate GitHub size limit',
    '100000',
  )
  .option('--max-repo-mb <number>', 'Git disk budget per repository', '256')
  .option('--max-total-mb <number>', 'Git cache disk budget', '1024')
  .option(
    '--max-seconds <number>',
    'total Git execution budget in seconds',
    '300',
  )
  .option(
    '--max-requests <number>',
    'API request budget including retries',
    '500',
  )
  .option('--concurrency <number>', 'API workers, capped at 8', '3')
  .action(async (username: string, raw: Record<string, string | undefined>) => {
    const config = options(raw);
    const report = await scan(username, config, (message) =>
      process.stderr.write(`${message}\n`),
    );
    console.log(
      `@${report.subject.login}: ${report.scoring.displayTotal}/1000 · ${report.coverage.status} · ${Math.floor(report.coverage.ratio * 100)}% of discovered activity analyzed\nOutput: ${config.output}`,
    );
    if (report.warnings.length)
      process.stderr.write(
        `${report.warnings.length} coverage warnings recorded in the JSON report.\n`,
      );
  });
program
  .command('render')
  .argument('<report>', 'validated gitranked JSON report')
  .description('Render a saved report offline')
  .option('--format <format>', 'json, svg, png or all', 'all')
  .option('--output <dir>', 'output directory', '.gitranked')
  .action(async (path: string, raw: Record<string, string | undefined>) => {
    const config = options(raw);
    const report = validateReport(
      JSON.parse(await readFile(resolve(path), 'utf8')),
    );
    await exportReport(report, config.output, config.format);
    console.log(
      `Rendered ${report.fixture ? 'fixture' : 'saved report'}: ${config.output}`,
    );
  });
program
  .command('login')
  .description(
    'Optionally log in with GitHub Device Flow and OS secret storage',
  )
  .option(
    '--client-id <id>',
    'GitHub App Client ID (or GITRANKED_CLIENT_ID; bundled by default)',
  )
  .action(async (raw: { clientId?: string }) => {
    await deviceLogin(appClientId(raw.clientId), new OsSecretStore(), {
      announce: (message) => console.log(message),
      openBrowser,
    });
    console.log(
      'GitHub login saved in OS secret storage. GITHUB_TOKEN and existing gh authentication take precedence.',
    );
  });
program
  .command('logout')
  .description('Remove the GitRanked GitHub App login from OS secret storage')
  .action(async () => {
    await new OsSecretStore().delete();
    console.log(
      `GitRanked credential removed. Environment tokens and gh authentication remain available. Revoke GitHub authorization at ${REVOKE_URL}.`,
    );
  });
try {
  await program.parseAsync();
} catch (err) {
  console.error(
    `GitRanked: ${err instanceof Error ? err.message : 'operation failed'}`,
  );
  process.exitCode = 1;
}

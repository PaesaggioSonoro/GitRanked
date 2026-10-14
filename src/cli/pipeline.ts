import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanOptions } from './config.js';
import { GitHubClient } from '../github/client.js';
import { discover } from '../github/discovery.js';
import type { Auth } from '../github/auth.js';
import type { Progress } from './progress.js';
import { resolveAuth } from '../github/auth.js';
import { normalize } from '../normalize/index.js';
import { analyzeGit } from '../git/download.js';
import { audit } from '../antifarming/index.js';
import { makeReport, serializeReport, type Report } from '../report/index.js';
import { svg, png } from '../render/index.js';
export async function exportReport(
  report: Report,
  output: string,
  format: ScanOptions['format'],
): Promise<void> {
  await mkdir(output, { recursive: true });
  if (format === 'json' || format === 'all')
    await writeFile(join(output, 'gitranked.json'), serializeReport(report));
  if (format !== 'json') {
    const source = await svg(report);
    if (format === 'svg' || format === 'all')
      await writeFile(join(output, 'gitranked.svg'), source);
    if (format === 'png' || format === 'all')
      await writeFile(join(output, 'gitranked.png'), await png(source));
  }
}
export async function scan(
  username: string,
  options: ScanOptions,
  progress: Progress = () => {},
  context: { auth?: Auth; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<Report> {
  context.signal?.throwIfAborted();
  const auth = context.auth ?? (await resolveAuth());
  let message = `Discovering public activity (${auth.source} authentication)`;
  const emit = () =>
    progress({ stage: 'discovery', message, requests: client.requests });
  const client = new GitHubClient(auth, {
    maxRequests: options.maxRequests,
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.fetcher ? { fetcher: context.fetcher } : {}),
    onRequest: emit,
  });
  emit();
  if (auth.source === 'keychain') await client.request('/user');
  const discovery = normalize(
    await discover(username, client, options, (next) => {
      message = next;
      emit();
    }),
  );
  context.signal?.throwIfAborted();
  progress({
    stage: 'git',
    message: `${discovery.repositories.length} public repositories and ${discovery.activities.length} discovered activities`,
    completed: 0,
    total: discovery.repositories.length,
  });
  const analyzed = await analyzeGit(
    discovery,
    options,
    progress,
    context.signal,
  );
  context.signal?.throwIfAborted();
  progress({
    stage: 'audit',
    message: 'Checking farming patterns and computing versioned scores',
  });
  const report = makeReport(
    normalize(audit(analyzed, options.window.until)),
    options,
    auth.source,
  );
  context.signal?.throwIfAborted();
  progress({ stage: 'export', message: `Writing ${options.format} output` });
  await exportReport(report, options.output, options.format);
  progress({ stage: 'done', message: 'Public activity report saved' });
  return report;
}

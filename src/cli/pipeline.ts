import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanOptions } from './config.js';
import { GitHubClient } from '../github/client.js';
import { discover } from '../github/discovery.js';
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
  progress: (message: string) => void = () => {},
): Promise<Report> {
  const auth = await resolveAuth();
  progress(`Discovering public activity (${auth.source} authentication)`);
  const client = new GitHubClient(auth, { maxRequests: options.maxRequests });
  const discovery = normalize(await discover(username, client, options));
  progress(
    `Discovered ${discovery.repositories.length} public repositories and ${discovery.activities.length} activity records`,
  );
  const analyzed = await analyzeGit(discovery, options);
  progress('Auditing changes and computing versioned scores');
  const report = makeReport(
    normalize(audit(analyzed, options.window.until)),
    options,
    auth.source,
  );
  await exportReport(report, options.output, options.format);
  return report;
}

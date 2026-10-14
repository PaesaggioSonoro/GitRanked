import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import type { ScanOptions } from '../cli/config.js';
import type { Activity, Discovery, Repository } from '../report/model.js';
import { inspectCommit } from './analyzer.js';
import { run } from './process.js';
export async function diskBytes(path: string): Promise<number> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map(async (e) => {
        const p = join(path, e.name);
        if (e.isSymbolicLink()) return 0;
        return e.isDirectory() ? diskBytes(p) : (await stat(p)).size;
      }),
    );
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}
export class GitInspector {
  private readonly started = Date.now();
  constructor(readonly options: ScanOptions) {}
  async checkBudget(path: string): Promise<void> {
    if (
      (await diskBytes(path)) > this.options.maxRepoBytes ||
      (await diskBytes(join(this.options.cache, 'git'))) >
        this.options.maxTotalBytes
    )
      throw new Error('Git disk budget exceeded');
    if (Date.now() - this.started > this.options.maxSeconds * 1000)
      throw new Error('Git execution budget exceeded');
  }
  async prepare(repo: Repository): Promise<string> {
    if (repo.sizeKb > this.options.maxRepoKb)
      throw new Error(
        'GitHub approximate repository size exceeds preliminary limit',
      );
    const root = join(this.options.cache, 'git');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(
      root,
      createHash('sha256').update(repo.name.toLowerCase()).digest('hex'),
    );
    const timeout = Math.max(
      1,
      Math.min(
        60000,
        this.options.maxSeconds * 1000 - (Date.now() - this.started),
      ),
    );
    const limits = { timeout, checkBudget: () => this.checkBudget(path) };
    await this.checkBudget(path);
    let exists = false;
    try {
      await stat(join(path, '.git'));
      exists = true;
    } catch {
      /* new clone */
    }
    try {
      if (exists) {
        const remote = await run('git', ['remote', 'get-url', 'origin'], {
          cwd: path,
        });
        if (remote !== `https://github.com/${repo.name}.git`)
          throw new Error('Unexpected cached Git origin');
        await run(
          'git',
          [
            'fetch',
            '--filter=blob:none',
            '--depth=256',
            '--no-tags',
            'origin',
            repo.defaultBranch,
          ],
          { cwd: path, ...limits },
        );
      } else
        await run(
          'git',
          [
            'clone',
            '--filter=blob:none',
            '--no-checkout',
            '--single-branch',
            '--depth=256',
            '--no-tags',
            '--',
            `https://github.com/${repo.name}.git`,
            path,
          ],
          limits,
        );
      await this.checkBudget(path);
      return path;
    } catch (err) {
      if (!exists) await rm(path, { recursive: true, force: true });
      throw err;
    }
  }
  async inspect(path: string, c: Activity): Promise<Activity> {
    const limits = {
      timeout: Math.max(
        1,
        Math.min(
          30000,
          this.options.maxSeconds * 1000 - (Date.now() - this.started),
        ),
      ),
      checkBudget: () => this.checkBudget(path),
    };
    await this.checkBudget(path);
    // Fetch only candidate plus parents; no full-history fallback and no checkout.
    try {
      await run('git', ['cat-file', '-e', `${c.sha}^`], {
        cwd: path,
        ...limits,
      });
    } catch {
      await run(
        'git',
        [
          'fetch',
          '--filter=blob:none',
          '--depth=2',
          '--no-tags',
          'origin',
          c.sha!,
        ],
        { cwd: path, ...limits },
      );
    }
    const result = await inspectCommit(path, c, limits);
    await this.checkBudget(path);
    return result;
  }
}
export function assertExternalCache(
  cache: string,
  sourceRoot = process.cwd(),
): void {
  const rel = relative(resolve(sourceRoot), resolve(cache));
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/')))
    throw new Error('Cache must be outside the current working directory');
}
export async function analyzeGit(
  discovery: Discovery,
  options: ScanOptions,
): Promise<Discovery> {
  assertExternalCache(options.cache);
  const inspector = new GitInspector(options);
  const activities: Activity[] = [];
  let inspected = 0;
  let attemptedRepos = 0;
  for (const repo of discovery.repositories) {
    const commits = discovery.activities.filter(
      (c) => c.kind === 'commit' && c.repository === repo.name,
    );
    if (!commits.length) {
      repo.status = 'analyzed';
      continue;
    }
    if (options.mode === 'fast') {
      repo.status = 'skipped';
      repo.reasons.push('fast-api-only');
      activities.push(
        ...commits.map((c) => ({
          ...c,
          status: 'api' as const,
          exclusions: ['git-diff-not-inspected'],
          confidence: 'low' as const,
        })),
      );
      continue;
    }
    try {
      if (++attemptedRepos > options.maxRepos)
        throw new Error('Repository inspection budget exceeded');
      const path = await inspector.prepare(repo);
      repo.status = 'analyzed';
      for (const c of commits) {
        try {
          if (inspected++ >= options.maxCommits)
            throw new Error('Commit inspection budget exceeded');
          activities.push(await inspector.inspect(path, c));
        } catch (err) {
          activities.push({
            ...c,
            status: 'skipped',
            exclusions: [
              err instanceof Error ? err.message : 'Git inspection unavailable',
            ],
          });
          repo.reasons.push('some-commits-unavailable');
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Git unavailable';
      repo.status = 'skipped';
      repo.reasons.push(reason);
      activities.push(
        ...commits.map((c) => ({
          ...c,
          status: 'skipped' as const,
          exclusions: [reason],
        })),
      );
    }
  }
  return {
    ...discovery,
    activities: [
      ...activities,
      ...discovery.activities.filter((c) => c.kind !== 'commit'),
    ],
  };
}

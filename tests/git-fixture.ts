import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/git/process.js';
import { inspectCommit } from '../src/git/analyzer.js';
import { activity } from '../src/report/model.js';
export async function gitFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gitranked-git-'));
  const git = (args: string[]) => run('git', args, { cwd: dir });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.invalid']);
  const commit = async (message: string) => {
    await git(['add', '.']);
    await git(['commit', '--allow-empty', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  const inspect = async (sha: string) =>
    inspectCommit(
      dir,
      activity({
        id: `commit:test/project:${sha}`,
        kind: 'commit',
        repository: 'test/project',
        project: 'test/project',
        timestamp: '2025-01-01T00:00:00.000Z',
        sourceUrls: [`https://github.com/test/project/commit/${sha}`],
        sha,
        verification: 'github-author-id',
        integrated: true,
      }),
    );
  return { dir, git, commit, inspect };
}

import { expect, test } from 'vitest';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/git/process.js';
import { inspectCommit, classify } from '../src/git/analyzer.js';
import { activity } from '../src/report/model.js';
import { assertExternalCache } from '../src/git/download.js';
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
test('real Git detects roots, empty, whitespace, renames and equivalent patches', async () => {
  const f = await gitFixture();
  try {
    await writeFile(join(f.dir, 'main.ts'), 'export const value = 1;\n');
    const root = await f.commit('initial');
    expect((await f.inspect(root)).flags).toContain('initial-import');
    const empty = await f.commit('empty');
    expect((await f.inspect(empty)).flags).toContain('empty-commit');
    await writeFile(join(f.dir, 'main.ts'), 'export const value = 2;\n');
    const change = await f.commit('real');
    const first = await f.inspect(change);
    expect(first.files?.[0]?.weight).toBe(1);
    await f.git(['checkout', '-b', 'copy', empty]);
    await writeFile(join(f.dir, 'main.ts'), 'export const value = 2;\n');
    const copy = await f.commit('other message');
    expect(copy).not.toBe(change);
    expect((await f.inspect(copy)).patchId).toBe(first.patchId);
    await writeFile(join(f.dir, 'main.ts'), 'export  const value = 2;\n');
    expect((await f.inspect(await f.commit('format'))).flags).toContain(
      'format-only',
    );
    await rename(join(f.dir, 'main.ts'), join(f.dir, 'renamed.ts'));
    expect((await f.inspect(await f.commit('rename'))).flags).toContain(
      'rename-only',
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test('generated, locks and cache safety', () => {
  expect(classify('dist/a.js', 'x').weight).toBe(0);
  expect(classify('a.ts', '// @generated').weight).toBe(0);
  expect(classify('package-lock.json', '{}').weight).toBe(0.15);
  expect(() => assertExternalCache('/project/cache', '/project')).toThrow();
  expect(() => assertExternalCache('/external', '/project')).not.toThrow();
});
test('process timeout and output limits fail safely', async () => {
  await expect(
    run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 10 }),
  ).rejects.toThrow('budget');
  await expect(
    run(process.execPath, ['-e', 'console.log("x".repeat(10000))'], {
      maxOutput: 20,
    }),
  ).rejects.toThrow('budget');
});

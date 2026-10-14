import { expect, test } from 'vitest';
import { writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/git/process.js';
import { classify } from '../src/git/analyzer.js';
import { gitFixture } from './git-fixture.js';
import { assertExternalCache } from '../src/git/download.js';
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

test('cancelling a running child terminates work and removes the abort listener', async () => {
  const controller = new AbortController();
  const task = run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], {
    signal: controller.signal,
  });
  controller.abort();
  await expect(task).rejects.toThrow('cancelled');
  const { getEventListeners } = await import('node:events');
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
});

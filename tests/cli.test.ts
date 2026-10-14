import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from '../src/git/process.js';
import { validateReport } from '../src/report/index.js';
import { svg, png } from '../src/render/index.js';
const cli = (args: string[]) =>
  run(process.execPath, ['--import', 'tsx', 'src/cli/index.ts', ...args]);
test('CLI help, version, invalid flags and offline render work without authentication', async () => {
  expect(await cli(['--help'])).toContain('scan');
  expect(await cli(['--version'])).toBe('1.0.0');
  await expect(
    cli(['scan', 'alice', '--since', '2025-02-30']),
  ).rejects.toThrow();
  const dir = await mkdtemp(join(tmpdir(), 'gitranked-cli-'));
  try {
    expect(
      await cli(['render', 'tests/fixtures/report.json', '--output', dir]),
    ).toContain('fixture');
    const data = await readFile(join(dir, 'gitranked.png'));
    expect(data.readUInt32BE(16)).toBe(1000);
    expect(
      validateReport(
        JSON.parse(await readFile(join(dir, 'gitranked.json'), 'utf8')),
      ).fixture,
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('labeled fixture has stable PNG snapshot and rejects altered report', async () => {
  const report = validateReport(
    JSON.parse(await readFile('tests/fixtures/report.json', 'utf8')),
  );
  const image = await png(await svg(report));
  expect(
    createHash('sha256').update(image).digest('hex'),
  ).toMatchInlineSnapshot(
    `"41bb57033b10fc2cfcc9cc0032bc8d01ee6677e3b8ef98b02290f28878a501b1"`,
  );
  report.coverage.fullyVerified = false;
  expect(() => validateReport(report)).toThrow();
});

test('no-argument non-TTY invocation exits with explicit scan guidance', async () => {
  const { execFile } = await import('node:child_process');
  const result = await new Promise<{ code: number; stderr: string }>(
    (resolve) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', 'src/cli/index.ts'],
        (err, _out, stderr) =>
          resolve({
            code: typeof err?.code === 'number' ? err.code : 0,
            stderr,
          }),
      );
    },
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('gitranked scan USERNAME --anonymous');
  expect(await cli(['scan', '--help'])).toContain('--anonymous');
  expect(await cli(['login', '--help'])).toContain('GitHub App Client ID');
});

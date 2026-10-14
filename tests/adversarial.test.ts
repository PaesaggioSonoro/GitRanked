import { expect, test } from 'vitest';
import { writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitFixture } from './git-fixture.js';
import { audit } from '../src/antifarming/index.js';
import { normalize } from '../src/normalize/index.js';
import { score, SCORING } from '../src/scoring/index.js';
import type { Activity, Discovery } from '../src/report/model.js';
import { GitInspector } from '../src/git/download.js';
import { options } from '../src/cli/config.js';
import { makeReport, validateReport } from '../src/report/index.js';
import { fixture } from './helpers.js';
const discovery = (activities: Activity[]): Discovery => ({
  user: { login: 'test', id: 1, url: 'https://github.com/test', bot: false },
  repositories: [],
  activities,
  warnings: [],
  aggregates: [],
});
test('real generated, lock, merge, rollback and copied histories receive explainable audits', async () => {
  const f = await gitFixture();
  try {
    await writeFile(join(f.dir, 'main.ts'), 'export const n = 1;\n');
    const root = await f.commit('root');
    await writeFile(
      join(f.dir, 'generated.ts'),
      '// @generated\nexport const generated = 10;\n',
    );
    const generated = await f.commit('generated');
    await writeFile(
      join(f.dir, 'package-lock.json'),
      '{"dependencies":{"a":"1"}}\n',
    );
    const lock = await f.commit('lock');
    await writeFile(join(f.dir, 'main.ts'), 'export const n = 2;\n');
    const forward = await f.commit('forward');
    await writeFile(join(f.dir, 'main.ts'), 'export const n = 1;\n');
    const rollback = await f.commit('rollback');
    await writeFile(join(f.dir, 'main.ts'), 'export const n = 2;\n');
    const again = await f.commit('again');
    await f.git(['checkout', '-b', 'feature', root]);
    await writeFile(join(f.dir, 'feature.ts'), 'export const branch = 1;\n');
    const branch = await f.commit('feature');
    await f.git(['checkout', 'main']);
    await f.git(['merge', '--no-ff', 'feature', '-m', 'merge']);
    const merge = await f.git(['rev-parse', 'HEAD']);
    const shas = [
      root,
      generated,
      lock,
      forward,
      rollback,
      again,
      branch,
      merge,
    ];
    const records = [];
    for (let i = 0; i < shas.length; i++) {
      const a = await f.inspect(shas[i]!);
      a.timestamp = new Date(Date.UTC(2025, 0, i + 1)).toISOString();
      records.push(a);
    }
    records.push({
      ...records[3]!,
      id: 'copied-fork',
      repository: 'test/fork',
    });
    const a = audit(normalize(discovery(records)), '2025-12-31T23:59:59Z');
    expect(a.activities.find((c) => c.sha === generated)?.eligible).toBe(false);
    expect(a.activities.find((c) => c.sha === lock)?.weight).toBe(0.15);
    expect(a.activities.find((c) => c.sha === merge)?.flags).toContain(
      'merge-transport',
    );
    expect(a.activities.find((c) => c.sha === again)?.eligible).toBe(false);
    expect(a.activities.find((c) => c.id === 'copied-fork')?.eligible).toBe(
      false,
    );
    expect(a.activities.find((c) => c.sha === rollback)?.flags).toContain(
      'first-rollback-discount-maintenance-retained',
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test('rename paths with spaces and incremental cache require no second Git traversal', async () => {
  const f = await gitFixture();
  const cache = await mkdtemp(join(tmpdir(), 'gitranked-diff-cache-'));
  try {
    await writeFile(join(f.dir, 'name with space.ts'), 'export const n = 1;\n');
    await f.commit('root');
    await rename(
      join(f.dir, 'name with space.ts'),
      join(f.dir, 'renamed with space.ts'),
    );
    const renamed = await f.commit('rename');
    expect((await f.inspect(renamed)).flags).toContain('rename-only');
    await writeFile(
      join(f.dir, 'renamed with space.ts'),
      'export const n = 2;\n',
    );
    const sha = await f.commit('change');
    const candidate = await f.inspect(sha);
    const inspector = new GitInspector(options({ cache }));
    const inspected = await inspector.inspect(f.dir, candidate);
    await rm(join(f.dir, '.git'), { recursive: true, force: true });
    expect(await inspector.inspect(f.dir, candidate)).toEqual(inspected);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});
test('coverage below threshold and missing Git inspection cannot receive complete badge', () => {
  const r = fixture();
  const d = discovery(
    Array.from({ length: 10 }, (_, i) => ({
      ...r.activities[0]!,
      id: String(i),
      status: i < 8 ? 'inspected' : 'skipped',
    })),
  );
  const report = makeReport(
    d,
    options({ since: '2025-01-01', until: '2025-12-31' }),
    'fixture',
    true,
  );
  expect(report.coverage.ratio).toBe(0.8);
  expect(report.coverage.status).toBe('partial');
  expect(report.coverage.fullyVerified).toBe(false);
  expect(validateReport(report)).toEqual(report);
  const huge = Array.from({ length: 2000 }, (_, i) => ({
    ...r.activities[0]!,
    id: String(i),
    timestamp: new Date(Date.UTC(2000, 0, i + 1)).toISOString(),
    points: 10000,
    effectiveLines: 10000,
    weight: 1,
    kind: 'commit' as const,
    integrated: true,
    project: `group${i % 5}`,
  }));
  const s = score(huge);
  for (const key of Object.keys(
    SCORING.maxima,
  ) as (keyof typeof SCORING.maxima)[])
    expect(s.categories[key]).toBeLessThanOrEqual(SCORING.maxima[key]);
  expect(s.total).toBeLessThanOrEqual(1000);
});

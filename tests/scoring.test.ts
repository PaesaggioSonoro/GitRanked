import { expect, test } from 'vitest';
import {
  activity,
  type Activity,
  type Discovery,
} from '../src/report/model.js';
import { audit } from '../src/antifarming/index.js';
import { normalize } from '../src/normalize/index.js';
import { score, streak, utcWeek } from '../src/scoring/index.js';
const make = (extra: Partial<Activity> = {}) =>
  activity({
    id: 'one',
    kind: 'commit',
    repository: 'u/r',
    project: 'u/r',
    timestamp: '2025-01-01T00:00:00.000Z',
    sourceUrls: ['https://github.com/u/r/commit/one'],
    status: 'inspected',
    verification: 'git-diff',
    integrated: true,
    files: [
      {
        path: 'a.ts',
        added: 100,
        deleted: 0,
        binary: false,
        weight: 1,
        reason: 'source',
        before: 'a',
        after: 'b',
      },
    ],
    ...extra,
  });
const discovery = (activities: Activity[]): Discovery => ({
  user: { login: 'u', id: 1, url: 'https://github.com/u', bot: false },
  repositories: [],
  activities,
  warnings: [],
  aggregates: [],
});
test('SHA, patch and lifecycle deduplication preserves integration evidence', () => {
  const raw = discovery([
    make({ sha: 'same', patchId: 'same' }),
    make({ id: 'two', sha: 'same' }),
    make({ id: 'three', patchId: 'same' }),
    make({ integrated: false }),
  ]);
  const n = normalize(raw);
  expect(n.activities).toHaveLength(3);
  expect(n.activities[0]?.integrated).toBe(true);
  const a = audit(n, '2025-12-31T23:59:59Z');
  expect(a.activities.filter((a) => a.eligible)).toHaveLength(1);
});
test('rollback preserved once, repeated restorations suppressed, bulk import bounded', () => {
  const files = (before: string, after: string) => [
    {
      path: 'a.ts',
      added: 100,
      deleted: 100,
      binary: false,
      weight: 1,
      reason: 'source',
      before,
      after,
    },
  ];
  const a = audit(
    discovery([
      make({ files: files('a', 'b') }),
      make({
        id: '2',
        timestamp: '2025-01-02T00:00:00.000Z',
        files: files('b', 'a'),
      }),
      make({
        id: '3',
        timestamp: '2025-01-03T00:00:00.000Z',
        files: files('a', 'b'),
      }),
    ]),
    '2025-12-31T23:59:59Z',
  );
  expect(a.activities[1]?.weight).toBe(0.5);
  expect(a.activities[2]?.eligible).toBe(false);
  const bulk = audit(
    discovery(
      Array.from({ length: 10 }, (_, i) =>
        make({
          id: String(i),
          flags: ['initial-import'],
          files: [
            {
              path: 'a.ts',
              added: 10000,
              deleted: 0,
              binary: false,
              weight: 1,
              reason: 'source',
            },
          ],
        }),
      ),
    ),
    '2025-12-31T23:59:59Z',
  );
  expect(score(bulk.activities).metrics.impactUnits).toBe(20);
  expect(score(bulk.activities).metrics.effectiveCommits).toBe(0);
});
test('daily impact and delivery caps, full precision and bounded categories', () => {
  const a = Array.from({ length: 30 }, (_, i) =>
    make({ id: String(i), eligible: true, effectiveLines: 1000, weight: 1 }),
  );
  const s = score(a);
  expect(s.metrics.impactUnits).toBe(300);
  expect(s.metrics.effectiveCommits).toBe(5);
  expect(s.categories.impact).toBeCloseTo(
    300 * (1 - Math.exp(-300 / 5000)),
    10,
  );
  expect(s.total).toBeLessThanOrEqual(1000);
  const huge = Array.from({ length: 10000 }, (_, i) =>
    make({
      id: String(i),
      project: String(i),
      timestamp: new Date(Date.UTC(1990, 0, i + 1)).toISOString(),
      eligible: true,
      effectiveLines: 1000,
      weight: 1,
      points: 100,
    }),
  );
  const h = score(huge);
  expect(h.total).toBeLessThanOrEqual(1000);
  expect(h.categories.consistency).toBeLessThanOrEqual(250);
  expect(score([]).total).toBe(0);
});
test('UTC Monday weeks and cross-year/month streaks', () => {
  expect(streak(['2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02'])).toBe(
    4,
  );
  expect(streak(['2025-01-31', '2025-02-01'])).toBe(2);
  expect(utcWeek('2025-01-01')).toBe('2024-12-30');
});
test('trivial/self reviews, bots, repetitive collaboration and caps', () => {
  const a = audit(
    discovery([
      make({ kind: 'review', body: 'LGTM' }),
      make({
        id: 'self',
        kind: 'review',
        body: 'Detailed '.repeat(20),
        flags: ['self-review'],
      }),
      make({ id: 'bot', bot: true }),
      ...Array.from({ length: 40 }, (_, i) =>
        make({ id: `pr${i}`, kind: 'pr-merged', selfControlled: true }),
      ),
    ]),
    '2025-12-31T23:59:59Z',
  );
  expect(a.activities.slice(0, 3).every((a) => !a.eligible)).toBe(true);
  expect(a.activities.reduce((n, a) => n + a.points, 0)).toBe(20);
  expect(a.activities.every((a) => a.body === undefined)).toBe(true);
});

test('unrelated rollbacks retain maintenance credit and mixed commits preserve new code', () => {
  const file = (path: string, before: string, after: string) => ({
    path,
    added: 20,
    deleted: 20,
    binary: false,
    weight: 1,
    reason: 'source',
    before,
    after,
  });
  const records = [
    make({ id: 'a1', files: [file('a.ts', 'a', 'b')] }),
    make({
      id: 'b1',
      timestamp: '2025-01-02T00:00:00.000Z',
      files: [file('b.ts', 'x', 'y')],
    }),
    make({
      id: 'a2',
      timestamp: '2025-01-03T00:00:00.000Z',
      files: [file('a.ts', 'b', 'a')],
    }),
    make({
      id: 'b2',
      timestamp: '2025-01-04T00:00:00.000Z',
      files: [file('b.ts', 'y', 'x')],
    }),
    make({
      id: 'mixed',
      timestamp: '2025-01-05T00:00:00.000Z',
      files: [file('a.ts', 'a', 'b'), file('new.ts', 'old', 'new')],
    }),
  ];
  const result = audit(discovery(records), '2025-12-31T23:59:59Z');
  expect(result.activities[2]?.weight).toBe(0.5);
  expect(result.activities[3]?.weight).toBe(0.5);
  expect(result.activities[4]?.eligible).toBe(true);
  expect(result.activities[4]?.files?.[0]?.weight).toBe(0);
  expect(result.activities[4]?.effectiveLines).toBe(20);
});

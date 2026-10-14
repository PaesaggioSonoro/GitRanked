import { expect, test } from 'vitest';
import {
  canonical,
  serializeReport,
  validateReport,
} from '../src/report/index.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './helpers.js';
test('report schema, digest and scores are deterministic and reject tampering', () => {
  const r = fixture();
  expect(serializeReport(r)).toBe(serializeReport(fixture()));
  expect(validateReport(JSON.parse(serializeReport(r)))).toEqual(r);
  expect(() =>
    validateReport({ ...r, scoring: { ...r.scoring, total: 999 } }),
  ).toThrow();
  expect(r.coverage.fullyVerified).toBe(false);
  expect(r.fixture).toBe(true);
});

test('portable validation accepts last-bit engine variation but rejects altered scores and metrics', async () => {
  const original = JSON.parse(
    await readFile('tests/fixtures/report.json', 'utf8'),
  );
  const rehash = (report: typeof original) => {
    const content = { ...report };
    delete content.reportId;
    report.reportId = createHash('sha256')
      .update(canonical(content))
      .digest('hex');
    return report;
  };
  const portable = structuredClone(original);
  portable.scoring.categories.delivery -= 2e-14;
  expect(validateReport(rehash(portable)).scoring.categories.delivery).toBe(
    portable.scoring.categories.delivery,
  );
  const altered = structuredClone(original);
  altered.scoring.categories.delivery -= 0.001;
  expect(() => validateReport(rehash(altered))).toThrow('score');
  const changedMetric = structuredClone(original);
  changedMetric.scoring.metrics.effectiveCommits++;
  expect(() => validateReport(rehash(changedMetric))).toThrow('score');
});

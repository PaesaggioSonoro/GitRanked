import { expect, test } from 'vitest';
import { serializeReport, validateReport } from '../src/report/index.js';
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

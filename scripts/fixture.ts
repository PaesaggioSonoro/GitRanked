import { options } from '../src/cli/config.js';
import { exportReport } from '../src/cli/pipeline.js';
import { makeReport, serializeReport } from '../src/report/index.js';
import { activity, type Discovery } from '../src/report/model.js';
import { audit } from '../src/antifarming/index.js';
import { normalize } from '../src/normalize/index.js';
import { writeFile } from 'node:fs/promises';
const repositories = Array.from({ length: 4 }, (_, i) => ({
  name: `fixture-user/project-${i}`,
  project: `fixture-user/project-${i}`,
  url: `https://github.com/fixture-user/project-${i}`,
  public: true as const,
  owner: 'fixture-user',
  defaultBranch: 'main',
  sizeKb: 10,
  fork: false,
  status: 'analyzed' as const,
  reasons: [],
}));
const activities = Array.from({ length: 180 }, (_, i) => {
  const r = repositories[i % 4]!;
  const day = new Date(Date.UTC(2025, 0, 1) + i * 2 * 86400000).toISOString();
  return activity({
    id: `fixture-commit-${i}`,
    kind: 'commit',
    repository: r.name,
    project: r.project,
    timestamp: day,
    source: 'git',
    verification: 'git-diff',
    status: 'inspected',
    integrated: true,
    sourceUrls: [`${r.url}/commit/${i.toString(16).padStart(40, '0')}`],
    sha: i.toString(16).padStart(40, '0'),
    patchId: `fixture-patch-${i}`,
    files: [
      {
        path: 'src/feature.ts',
        added: 90 + (i % 30),
        deleted: 35 + (i % 15),
        binary: false,
        weight: 1,
        reason: 'source-tests-heuristic',
      },
    ],
    additions: 90 + (i % 30),
    deletions: 35 + (i % 15),
  });
});
for (let i = 0; i < 35; i++) {
  const r = repositories[0]!;
  activities.push(
    activity({
      id: `fixture-pr-${i}`,
      kind: 'pr-merged',
      repository: r.name,
      project: r.project,
      timestamp: new Date(
        Date.UTC(2025, 1, 1) + i * 7 * 86400000,
      ).toISOString(),
      sourceUrls: [`${r.url}/pull/${i + 1}`],
    }),
  );
}
const d: Discovery = {
  user: {
    login: 'fixture-user',
    id: 0,
    url: 'https://github.com/fixture-user',
    bot: false,
  },
  repositories,
  activities,
  warnings: [],
  aggregates: [],
};
const config = options({
  since: '2025-01-01',
  until: '2025-12-31',
  output: '.gitranked/fixture',
});
const report = makeReport(
  normalize(audit(normalize(d), config.window.until)),
  config,
  'fixture',
  true,
);
await exportReport(report, config.output, 'all');
await writeFile('tests/fixtures/report.json', serializeReport(report));
console.log(
  `Synthetic fixture only: ${config.output} (${report.scoring.displayTotal}/1000)`,
);

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SCORING, score } from '../scoring/index.js';
import { RULES } from '../antifarming/index.js';
import { activitySchema, repositorySchema, type Discovery } from './model.js';
import type { ScanOptions } from '../cli/config.js';
const n = z.number().finite().nonnegative();
const categories = z.object({
  impact: n.max(300),
  consistency: n.max(250),
  collaboration: n.max(200),
  delivery: n.max(150),
  breadth: n.max(100),
});
const scoreSchema = z.object({
  total: n.max(1000),
  displayTotal: n.int().max(1000),
  categories,
  metrics: z.object({
    activeDays: n.int(),
    activeWeeks: n.int(),
    longestStreak: n.int(),
    validCommits: n.int(),
    effectiveCommits: n.int(),
    mergedPRs: n.int(),
    independentProjects: n.int(),
    impactUnits: n,
    collaborationPoints: n,
  }),
});
export const reportSchema = z.object({
  schemaVersion: z.literal('gitranked-report-1'),
  toolVersion: z.literal('1.0.0'),
  reportId: z.string().regex(/^[a-f0-9]{64}$/),
  subject: z.object({
    login: z.string(),
    id: n.int(),
    url: z.url(),
    bot: z.boolean(),
  }),
  window: z.object({
    since: z.iso.datetime(),
    until: z.iso.datetime(),
    timezone: z.literal('UTC'),
  }),
  mode: z.enum(['fast', 'deep']),
  fixture: z.boolean(),
  description: z.string(),
  parameters: z.object({ scoring: z.json(), antifarming: z.json() }),
  scoring: scoreSchema,
  coverage: z.object({
    status: z.enum(['partial', 'complete-for-discovered-activity']),
    fullyVerified: z.boolean(),
    threshold: n.max(1),
    discovered: n.int(),
    observed: n.int(),
    gitDiffInspected: n.int(),
    apiOnly: n.int(),
    skipped: n.int(),
    analyzed: n.int(),
    ratio: n.max(1),
    unknownActivity: z.literal('not-quantifiable'),
    checks: z.array(z.string()),
    omittedChecks: z.array(z.string()),
  }),
  provenance: z.object({
    authSource: z.enum([
      'environment',
      'github-cli',
      'anonymous',
      'keychain',
      'github-app',
      'fixture',
    ]),
    sources: z.array(z.string()),
    budgets: z.object({
      maxRepos: n,
      maxPages: n,
      maxCommits: n,
      maxRepoKb: n,
      maxRepoBytes: n,
      maxTotalBytes: n,
      maxSeconds: n,
      maxRequests: n,
    }),
    lineSemantics: z.string(),
  }),
  repositories: z.array(repositorySchema),
  activities: z.array(activitySchema),
  aggregates: z.array(
    z.object({
      source: z.string(),
      publicOnly: z.literal(true),
      data: z.json(),
    }),
  ),
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
});
export type Report = z.infer<typeof reportSchema>;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export function makeReport(
  discovery: Discovery,
  options: ScanOptions,
  authSource: Report['provenance']['authSource'],
  fixture = false,
): Report {
  const activities = discovery.activities;
  const inspected = activities.filter((a) => a.status === 'inspected').length;
  const api = activities.filter((a) => a.status === 'api').length;
  const skipped = activities.length - inspected - api;
  const ratio = activities.length ? inspected / activities.length : 0;
  const operationalWarnings = discovery.warnings.filter(
    (w) => !w.startsWith('Public discovery is not exhaustive:'),
  );
  const verified =
    options.mode === 'deep' &&
    ratio >= SCORING.coverageThreshold &&
    !operationalWarnings.length &&
    !discovery.repositories.some(
      (r) => r.status === 'skipped' || r.reasons.length > 0,
    );
  const fullChecks = [
    'public-visibility',
    'github-numeric-author-id',
    'activity-id-deduplication',
    'collaboration-substance-heuristic',
    'self-controlled-discount',
  ];
  const gitChecks = [
    'git-diff-lines',
    'stable-patch-id',
    'git-sha-deduplication',
    'empty-and-rename-only',
    'generated-content-heuristics',
    'bulk-import-caps',
    '7-and-30-day-file-restoration',
    'git-date-consistency',
  ];
  const budgets = {
    maxRepos: options.maxRepos,
    maxPages: options.maxPages,
    maxCommits: options.maxCommits,
    maxRepoKb: options.maxRepoKb,
    maxRepoBytes: options.maxRepoBytes,
    maxTotalBytes: options.maxTotalBytes,
    maxSeconds: options.maxSeconds,
    maxRequests: options.maxRequests,
  };
  const raw = {
    schemaVersion: 'gitranked-report-1',
    toolVersion: '1.0.0',
    subject: discovery.user,
    window: { ...options.window, timezone: 'UTC' },
    mode: options.mode,
    fixture,
    description:
      'An experimental index of publicly verifiable development activity, not developer skill or code quality.',
    parameters: { scoring: SCORING, antifarming: RULES },
    scoring: score(activities),
    coverage: {
      status: verified ? 'complete-for-discovered-activity' : 'partial',
      fullyVerified: verified,
      threshold: SCORING.coverageThreshold,
      discovered: activities.length,
      observed: activities.filter((a) => a.verification !== 'unverified')
        .length,
      gitDiffInspected: activities.filter((a) => a.verification === 'git-diff')
        .length,
      apiOnly: api,
      skipped,
      analyzed: inspected,
      ratio,
      unknownActivity: 'not-quantifiable',
      checks: [...fullChecks, ...(options.mode === 'deep' ? gitChecks : [])],
      omittedChecks: options.mode === 'fast' ? gitChecks : [],
    },
    provenance: {
      authSource,
      sources: [
        'GitHub public REST API',
        ...(discovery.aggregates.length
          ? ['GitHub public GraphQL aggregates (unscored)']
          : []),
        ...(options.mode === 'deep' ? ['public Git remotes'] : []),
      ],
      budgets,
      lineSemantics:
        'Text diff additions/deletions against the first parent; merge transport, binary assets and excluded files receive no line credit. Renames use Git similarity detection. Weight is an average of file line-change weights; cap applies once per commit.',
    },
    repositories: discovery.repositories,
    activities,
    aggregates: discovery.aggregates.filter((a) => a.publicOnly),
    warnings: operationalWarnings,
    limitations: [
      'Discovery is not exhaustive; coverage refers only to discovered public activity.',
      'Search is capped at 1,000 results per query; contribution repository lists are capped at 100 per type.',
      'GitHub author association provides account attribution, not proof of human authorship.',
      'Adversarial users controlling repositories and cooperating accounts cannot always be identified.',
      'Content, review substance, project independence, rollback and date checks are conservative heuristics.',
      'Default branch listing and PR evidence can miss other branches, deleted activity, squashed or reassigned contributions.',
      'Fast scores omit Git impact, delivery and breadth and cannot be compared directly with deep scores.',
      'Git budgets measure disk and elapsed time, not exact transfer bytes; monitoring can overshoot briefly.',
    ],
  };
  return reportSchema.parse({ ...raw, reportId: digest(raw) });
}
export function validateReport(input: unknown): Report {
  const report = reportSchema.parse(input);
  const { reportId, ...rest } = report;
  if (digest(rest) !== reportId)
    throw new Error('Report content digest does not match');
  if (
    canonical(report.parameters) !==
    canonical({ scoring: SCORING, antifarming: RULES })
  )
    throw new Error('Unsupported scoring parameters');
  if (canonical(report.scoring) !== canonical(score(report.activities)))
    throw new Error('Report score does not match audited activity');
  if (
    report.activities.some(
      (a) =>
        Date.parse(a.timestamp) < Date.parse(report.window.since) ||
        Date.parse(a.timestamp) > Date.parse(report.window.until),
    )
  )
    throw new Error('Activity outside analysis window');
  return report;
}
export function serializeReport(report: Report): string {
  return `${JSON.stringify(JSON.parse(canonical(report)), null, 2)}\n`;
}

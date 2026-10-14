import { z } from 'zod';
const finite = z.number().finite().nonnegative();
export const repositorySchema = z.object({
  name: z.string(),
  url: z.url(),
  public: z.literal(true),
  owner: z.string(),
  defaultBranch: z.string(),
  sizeKb: finite,
  project: z.string(),
  fork: z.boolean(),
  status: z.enum(['discovered', 'analyzed', 'skipped']),
  reasons: z.array(z.string()),
});
export type Repository = z.infer<typeof repositorySchema>;
export const activitySchema = z.object({
  id: z.string(),
  kind: z.enum([
    'commit',
    'pr-opened',
    'pr-merged',
    'issue-opened',
    'issue-closed',
    'issue-linked',
    'review',
  ]),
  repository: z.string(),
  project: z.string(),
  timestamp: z.iso.datetime(),
  source: z.enum(['rest', 'git']),
  verification: z.enum([
    'github-author-id',
    'public-api',
    'git-diff',
    'unverified',
  ]),
  status: z.enum(['discovered', 'inspected', 'api', 'skipped']),
  sourceUrls: z.array(z.url()).min(1),
  eligible: z.boolean(),
  additions: finite,
  deletions: finite,
  effectiveLines: finite,
  weight: finite.max(1),
  flags: z.array(z.string()),
  exclusions: z.array(z.string()),
  ruleVersion: z.literal('antifarming-1'),
  confidence: z.enum(['high', 'medium', 'low']),
  sha: z.string().optional(),
  patchId: z.string().optional(),
  tree: z.string().optional(),
  parentTree: z.string().optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        added: finite,
        deleted: finite,
        binary: z.boolean(),
        weight: finite.max(1),
        reason: z.string(),
        before: z.string().optional(),
        after: z.string().optional(),
      }),
    )
    .optional(),
  authoredAt: z.string().optional(),
  committedAt: z.string().optional(),
  integrated: z.boolean().optional(),
  selfControlled: z.boolean(),
  bot: z.boolean(),
  body: z.string().optional(),
  points: finite,
});
export type Activity = z.infer<typeof activitySchema>;
export interface Discovery {
  user: { login: string; id: number; url: string; bot: boolean };
  repositories: Repository[];
  activities: Activity[];
  warnings: string[];
  aggregates: { source: string; publicOnly: boolean; data: unknown }[];
}
export function activity(
  input: Pick<
    Activity,
    'id' | 'kind' | 'repository' | 'project' | 'timestamp' | 'sourceUrls'
  > &
    Partial<Activity>,
): Activity {
  return activitySchema.parse({
    source: 'rest',
    verification: 'public-api',
    status: 'discovered',
    eligible: false,
    additions: 0,
    deletions: 0,
    effectiveLines: 0,
    weight: 0,
    flags: [],
    exclusions: [],
    ruleVersion: 'antifarming-1',
    confidence: 'high',
    selfControlled: false,
    bot: false,
    points: 0,
    ...input,
  });
}

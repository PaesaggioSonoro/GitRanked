import { createHash } from 'node:crypto';
import type { Activity, Discovery } from '../report/model.js';
export const RULE_VERSION = 'antifarming-1';
export const RULES = {
  weights: {
    substantive: 1,
    documentation: 0.7,
    configuration: 0.5,
    dependency: 0.15,
    format: 0.1,
    excluded: 0,
  },
  commitLineCap: 200,
  dailyImpactCap: 300,
  importLineThreshold: 10000,
  importWeight: 0.1,
  projectImportImpactCap: 20,
  restorationWindowsDays: [7, 30],
  firstRestorationWeight: 0.5,
  collaborationDailyKindCap: 20,
  selfControlledMultiplier: 0.25,
  reviewMinCharacters: 80,
  collaborationPointCap: 1500,
  breadthMinCommits: 3,
  breadthMinLines: 50,
  breadthMinDays: 2,
} as const;
const bases: Partial<Record<Activity['kind'], number>> = {
  'pr-opened': 2,
  'pr-merged': 8,
  review: 3,
  'issue-opened': 1,
  'issue-closed': 2,
  'issue-linked': 3,
};
export function audit(discovery: Discovery, until: string): Discovery {
  const result = structuredClone(discovery);
  const shaSeen = new Set<string>(),
    patchSeen = new Set<string>();
  const treeProjects = new Map<string, string>();
  const projectAliases = new Map<string, string>();
  // Identical complete Git trees provide conservative evidence of repository copies.
  for (const c of result.activities)
    if (c.tree && c.flags.includes('initial-import')) {
      const canonical = treeProjects.get(c.tree);
      if (canonical && canonical !== c.project) {
        projectAliases.set(c.project, canonical);
        c.flags.push('repository-copy');
      } else treeProjects.set(c.tree, c.project);
    }
  for (const r of result.repositories)
    r.project = projectAliases.get(r.project) ?? r.project;
  for (const a of result.activities)
    a.project = projectAliases.get(a.project) ?? a.project;
  const stateHistory = new Map<string, Map<string, number>>();
  const restorations = new Map<string, { count: number; timestamp: number }>();
  const imports = new Map<string, number>();
  const collabDays = new Map<string, number>();
  const bodySeen = new Set<string>();
  for (const a of result.activities) {
    a.eligible = false;
    a.points = 0;
    a.effectiveLines = 0;
    a.weight = 0;
    const exclude = (reason: string) => {
      a.exclusions.push(reason);
    };
    if (a.bot) {
      exclude('bot-activity');
      continue;
    }
    if (a.status === 'skipped') continue;
    if (a.kind === 'commit' && a.status === 'discovered') continue;
    if (a.kind !== 'commit') {
      a.status = 'inspected';
      if (
        a.kind === 'review' &&
        (a.flags.includes('self-review') ||
          (a.body?.trim().length ?? 0) < RULES.reviewMinCharacters)
      ) {
        exclude(
          a.flags.includes('self-review')
            ? 'self-review'
            : 'review-substance-not-evidenced',
        );
        continue;
      }
      let weight = a.selfControlled ? RULES.selfControlledMultiplier : 1;
      if (a.selfControlled)
        a.flags.push('self-controlled-collaboration-discount');
      if (a.body && a.body.trim().length >= 20) {
        const hash = createHash('sha256')
          .update(
            `${a.kind}:${a.body.toLowerCase().replace(/\s+/g, ' ').trim()}`,
          )
          .digest('hex');
        if (bodySeen.has(hash)) {
          weight *= 0.25;
          a.flags.push('repetitive-collaboration-discount');
        }
        bodySeen.add(hash);
      }
      const key = `${a.timestamp.slice(0, 10)}:${a.kind}`;
      const credited = collabDays.get(key) ?? 0;
      a.points = Math.min(
        (bases[a.kind] ?? 0) * weight,
        Math.max(0, RULES.collaborationDailyKindCap - credited),
      );
      collabDays.set(key, credited + a.points);
      a.weight = weight;
      a.eligible = a.points > 0;
      if (!a.eligible) exclude('daily-collaboration-cap');
      continue;
    }
    if (a.verification !== 'git-diff') {
      exclude('git-diff-not-inspected');
      continue;
    }
    if (a.sha && shaSeen.has(a.sha)) {
      exclude('duplicate-commit-sha');
      continue;
    }
    if (a.sha) shaSeen.add(a.sha);
    if (a.patchId && patchSeen.has(a.patchId)) {
      exclude('equivalent-patch-already-credited');
      continue;
    }
    if (a.patchId) patchSeen.add(a.patchId);
    if (
      a.flags.includes('empty-commit') ||
      a.flags.includes('rename-only') ||
      a.flags.includes('merge-transport')
    ) {
      exclude('no-attributable-line-change');
      continue;
    }
    const time = Date.parse(a.timestamp);
    const committed = Date.parse(a.committedAt ?? a.timestamp);
    const authored = Date.parse(a.authoredAt ?? a.timestamp);
    if (
      !Number.isFinite(committed) ||
      !Number.isFinite(authored) ||
      authored > committed + 86400000 ||
      committed > Date.parse(until) + 86400000 ||
      Math.abs(committed - authored) > 30 * 86400000
    ) {
      a.flags.push('inconsistent-git-dates');
      a.confidence = 'medium';
    }
    const files = a.files ?? [];
    let added = 0,
      deleted = 0,
      weighted = 0,
      raw = 0;
    for (const f of files) {
      if (f.weight <= 0) continue;
      if (f.before !== undefined && f.after !== undefined) {
        const key = `${a.project}:${f.path}`;
        const history = stateHistory.get(key) ?? new Map<string, number>();
        if (!history.has(f.before)) history.set(f.before, time);
        const previous = history.get(f.after);
        if (
          f.before !== f.after &&
          previous !== undefined &&
          time - previous <= 30 * 86400000
        ) {
          a.flags.push(
            time - previous <= 7 * 86400000
              ? 'file-state-restored-within-7-days'
              : 'file-state-restored-within-30-days',
          );
          const last = restorations.get(key);
          const count =
            last && time - last.timestamp <= 30 * 86400000 ? last.count + 1 : 1;
          restorations.set(key, { count, timestamp: time });
          f.weight *= count === 1 ? RULES.firstRestorationWeight : 0;
          f.reason +=
            count === 1
              ? '; first-restoration-discount'
              : '; repeated-restoration-excluded';
          if (count === 1)
            a.flags.push('first-rollback-discount-maintenance-retained');
          else a.flags.push('repeated-restoration-file-excluded');
        }
        history.set(f.after, time);
        stateHistory.set(key, history);
      }
      if (f.weight > 0) {
        const l =
          Math.min(f.added, f.deleted) + 0.5 * Math.abs(f.added - f.deleted);
        added += f.added;
        deleted += f.deleted;
        weighted += l * f.weight;
        raw += l;
      }
    }
    const lines = Math.min(added, deleted) + 0.5 * Math.abs(added - deleted);
    a.effectiveLines = lines;
    a.weight = raw > 0 ? weighted / raw : 0;
    if (
      a.flags.includes('repeated-restoration-file-excluded') &&
      weighted === 0
    )
      exclude('repeated-restoration-cycle');
    if (
      a.flags.includes('initial-import') ||
      a.additions + a.deletions >= RULES.importLineThreshold
    ) {
      a.flags.push('bulk-import-or-reupload-discount');
      a.weight *= RULES.importWeight;
      const used = imports.get(a.project) ?? 0;
      const possible = a.weight * Math.min(lines, RULES.commitLineCap);
      const allowance = Math.min(
        possible,
        Math.max(0, RULES.projectImportImpactCap - used),
      );
      if (possible > 0) a.weight *= allowance / possible;
      imports.set(a.project, used + allowance);
    }
    a.eligible = a.weight > 0 && lines > 0;
    if (!a.eligible && !a.exclusions.length) exclude('no-eligible-content');
    if (files.some((f) => f.weight === 0)) a.flags.push('excluded-files');
  }
  for (const a of result.activities) {
    a.flags = [...new Set(a.flags)].sort();
    a.exclusions = [...new Set(a.exclusions)].sort();
    delete a.body;
  }
  return result;
}
export function isEffective(a: Activity): boolean {
  return (
    a.kind === 'commit' &&
    a.eligible &&
    a.weight >= 0.5 &&
    a.integrated === true &&
    !a.flags.some((f) =>
      [
        'initial-import',
        'massive-change',
        'bulk-import-or-reupload-discount',
        'first-rollback-discount-maintenance-retained',
      ].includes(f),
    )
  );
}

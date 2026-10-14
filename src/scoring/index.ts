import { isEffective, RULES } from '../antifarming/index.js';
import type { Activity } from '../report/model.js';
export const SCORING = {
  version: 'scoring-1',
  maxima: {
    impact: 300,
    consistency: 250,
    collaboration: 200,
    delivery: 150,
    breadth: 100,
  },
  impactScale: 5000,
  activeDaysScale: 100,
  activeWeeksCap: 52,
  streakScale: 14,
  collaborationScale: 150,
  deliveryScale: 150,
  breadthScale: 5,
  dailyDeliveryCap: 5,
  coverageThreshold: 0.9,
} as const;
export function utcWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function streak(days: string[]): number {
  let longest = 0,
    current = 0,
    prev = -Infinity;
  for (const day of [...new Set(days)].sort()) {
    const n = Date.parse(day) / 86400000;
    current = n === prev + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    prev = n;
  }
  return longest;
}
export function score(activities: Activity[]) {
  const eligible = activities.filter((a) => a.eligible);
  const days = [
    ...new Set(eligible.map((a) => a.timestamp.slice(0, 10))),
  ].sort();
  const weeks = new Set(days.map(utcWeek));
  const impactDays = new Map<string, number>();
  const deliveryDays = new Map<string, number>();
  const projects = new Map<
    string,
    { commits: number; lines: number; days: Set<string> }
  >();
  for (const a of eligible) {
    const day = a.timestamp.slice(0, 10);
    if (a.kind === 'commit')
      impactDays.set(
        day,
        (impactDays.get(day) ?? 0) +
          a.weight * Math.min(a.effectiveLines, RULES.commitLineCap),
      );
    if (isEffective(a)) {
      deliveryDays.set(day, (deliveryDays.get(day) ?? 0) + 1);
      const project = projects.get(a.project) ?? {
        commits: 0,
        lines: 0,
        days: new Set<string>(),
      };
      project.commits++;
      project.lines += a.effectiveLines * a.weight;
      project.days.add(day);
      projects.set(a.project, project);
    }
  }
  const I = [...impactDays.values()].reduce(
      (n, v) => n + Math.min(RULES.dailyImpactCap, v),
      0,
    ),
    E = [...deliveryDays.values()].reduce(
      (n, v) => n + Math.min(SCORING.dailyDeliveryCap, v),
      0,
    ),
    C = Math.min(
      RULES.collaborationPointCap,
      eligible.reduce((n, a) => n + a.points, 0),
    );
  const P = [...projects.values()].filter(
    (p) =>
      p.commits >= RULES.breadthMinCommits &&
      p.lines >= RULES.breadthMinLines &&
      p.days.size >= RULES.breadthMinDays,
  ).length;
  const R = streak(days);
  const categories = {
    impact: 300 * (1 - Math.exp(-I / 5000)),
    consistency:
      130 * (1 - Math.exp(-days.length / 100)) +
      (80 * Math.min(weeks.size, 52)) / 52 +
      40 * (1 - Math.exp(-R / 14)),
    collaboration: 200 * (1 - Math.exp(-C / 150)),
    delivery: 150 * (1 - Math.exp(-E / 150)),
    breadth: 100 * (1 - Math.exp(-P / 5)),
  };
  for (const k of Object.keys(categories) as (keyof typeof categories)[])
    categories[k] = Math.max(0, Math.min(SCORING.maxima[k], categories[k]));
  const total = Math.max(
    0,
    Math.min(
      1000,
      Object.values(categories).reduce((a, b) => a + b, 0),
    ),
  );
  return {
    total,
    displayTotal: Math.round(total),
    categories,
    metrics: {
      activeDays: days.length,
      activeWeeks: weeks.size,
      longestStreak: R,
      validCommits: eligible.filter((a) => a.kind === 'commit').length,
      effectiveCommits: E,
      mergedPRs: eligible.filter((a) => a.kind === 'pr-merged').length,
      independentProjects: P,
      impactUnits: I,
      collaborationPoints: C,
    },
  };
}

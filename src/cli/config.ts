import { resolve } from 'node:path';
import { homedir } from 'node:os';

export const isUsername = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value);

export type Mode = 'fast' | 'deep';
export interface Window {
  since: string;
  until: string;
}
export interface ScanOptions {
  mode: Mode;
  window: Window;
  output: string;
  format: 'json' | 'svg' | 'png' | 'all';
  cache: string;
  maxRepos: number;
  maxPages: number;
  maxCommits: number;
  maxRepoKb: number;
  maxRepoBytes: number;
  maxTotalBytes: number;
  maxSeconds: number;
  concurrency: number;
  maxRequests: number;
}
export function date(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('Dates must be real UTC dates in YYYY-MM-DD format');
  if (value < '1970-01-01' || value > '2099-12-31')
    throw new Error('Dates must be between 1970 and 2099');
  return value;
}
export function windowFrom(
  since?: string,
  until?: string,
  now = new Date(),
): Window {
  const end = until ? new Date(`${date(until)}T23:59:59.999Z`) : now;
  const start = since
    ? new Date(`${date(since)}T00:00:00.000Z`)
    : new Date(end.getTime() - 365 * 86400000);
  if (start > end) throw new Error('--since must precede --until');
  return { since: start.toISOString(), until: end.toISOString() };
}
export function options(raw: Record<string, string | undefined>): ScanOptions {
  const num = (key: string, fallback: number) => {
    const v = Number(raw[key] ?? fallback);
    if (!Number.isSafeInteger(v) || v <= 0)
      throw new Error(`--${key} must be a positive integer`);
    return v;
  };
  const mode = raw.mode ?? 'deep';
  const format = raw.format ?? 'all';
  if (mode !== 'fast' && mode !== 'deep')
    throw new Error('--mode must be fast or deep');
  if (!['json', 'svg', 'png', 'all'].includes(format))
    throw new Error('--format must be json, svg, png or all');
  return {
    mode,
    format: format as ScanOptions['format'],
    window: windowFrom(raw.since, raw.until),
    output: resolve(raw.output ?? '.gitranked'),
    cache: resolve(raw.cache ?? `${homedir()}/.cache/gitranked/v1`),
    maxRepos: num('maxRepos', 50),
    maxPages: num('maxPages', 10),
    maxCommits: num('maxCommits', 2000),
    maxRepoKb: num('maxRepoKb', 100000),
    maxRepoBytes: num('maxRepoMb', 256) * 1024 ** 2,
    maxTotalBytes: num('maxTotalMb', 1024) * 1024 ** 2,
    maxSeconds: num('maxSeconds', 300),
    concurrency: Math.min(num('concurrency', 3), 8),
    maxRequests: num('maxRequests', 500),
  };
}

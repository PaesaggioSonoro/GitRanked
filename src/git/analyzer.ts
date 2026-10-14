import { run, type ProcessOptions } from './process.js';
import type { Activity } from '../report/model.js';
export type FileChange = NonNullable<Activity['files']>[number];
export function classify(
  path: string,
  content: string,
  binary = false,
): { weight: number; reason: string } {
  if (binary) return { weight: 0, reason: 'binary-or-non-code-asset' };
  if (
    /(^|\/)(vendor|node_modules|dist|build|coverage|generated|\.next)(\/|$)|\.(min\.(js|css)|map|snap)$|(^|\/)package-lock\.json$/.test(
      path.toLowerCase(),
    )
  ) {
    if (/(^|\/)(package-lock\.json)$/.test(path))
      return { weight: 0.15, reason: 'dependency-lockfile' };
    return { weight: 0, reason: 'generated-vendor-build' };
  }
  if (
    /@generated|automatically generated|do not edit|code generated/i.test(
      content,
    ) ||
    content.split('\n').some((l) => l.length > 1000)
  )
    return { weight: 0, reason: 'generated-or-minified-content-heuristic' };
  if (
    /(^|\/)(yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum|bun\.lockb?)$|(^|\/)(package\.json|Cargo\.toml|requirements\.txt)$/.test(
      path,
    )
  )
    return { weight: 0.15, reason: 'dependency-manifest-or-lockfile' };
  if (/\.(md|mdx|rst|adoc)$|(^|\/)(docs|documentation)(\/|$)/i.test(path))
    return { weight: 0.7, reason: 'technical-documentation-heuristic' };
  if (
    /(^|\/)(\.github|\.gitlab)(\/|$)|(^|\/)(Dockerfile|Makefile)|\.(json|ya?ml|toml|ini|cfg)$/.test(
      path,
    )
  )
    return { weight: 0.5, reason: 'ci-configuration-heuristic' };
  if (
    /\.(png|jpe?g|svg|gif|webp|ico|pdf|csv|mp[34]|wav|ttf|woff2?|zip)$/i.test(
      path,
    )
  )
    return { weight: 0, reason: 'non-code-asset' };
  if (
    /\.(ts|tsx|js|jsx|py|rs|go|c|cpp|h|hpp|java|kt|swift|rb|php|cs|sh|sql|vue|svelte|css|scss|html|ex|exs|hs|lua|r|dart)$/i.test(
      path,
    )
  )
    return { weight: 1, reason: 'source-tests-heuristic' };
  return { weight: 0.5, reason: 'unclassified-text-conservative' };
}
function numstat(
  text: string,
): { path: string; added: number; deleted: number; binary: boolean }[] {
  const parts = text.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(parts[i]!);
    if (!match) continue;
    let path = match[3]!;
    if (path === '') {
      i++;
      path = parts[++i] ?? '';
    }
    files.push({
      path,
      added: Number(match[1]) || 0,
      deleted: Number(match[2]) || 0,
      binary: match[1] === '-',
    });
  }
  return files;
}
/** Inspect only API-attributed SHAs. No author-email or author-name guessing. */
export async function inspectCommit(
  cwd: string,
  candidate: Activity,
  limits: ProcessOptions = {},
): Promise<Activity> {
  const sha = candidate.sha;
  if (!sha || !/^[0-9a-f]{40,64}$/.test(sha))
    throw new Error('Invalid commit identity');
  const git = (args: string[], input?: string) =>
    run('git', args, {
      ...limits,
      cwd,
      ...(input === undefined ? {} : { input }),
    });
  const raw = await git(['cat-file', '-p', sha]);
  const parents = [...raw.matchAll(/^parent ([0-9a-f]+)$/gm)].map((m) => m[1]!);
  const tree = /^tree (\w+)$/m.exec(raw)?.[1];
  if (!tree) throw new Error('Commit tree unavailable');
  // Real parents from the raw object avoid mistaking a shallow boundary for a root import.
  const parent = parents[0];
  const base =
    parent ?? (await git(['hash-object', '-t', 'tree', '--stdin'], ''));
  const parentTree = parent
    ? await git(['rev-parse', `${parent}^{tree}`])
    : base;
  if (parents.length > 1)
    return {
      ...candidate,
      source: 'git',
      verification: 'git-diff',
      status: 'inspected',
      tree,
      parentTree,
      flags: [...candidate.flags, 'merge-transport'],
      exclusions: ['merge-diff-not-attributed-to-merger'],
      eligible: false,
    };
  const diffArgs = [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--find-renames',
    base,
    sha,
  ];
  const stats = numstat(await git([...diffArgs, '--numstat', '-z']));
  const whitespaceStats = numstat(
    await git([
      ...diffArgs,
      '--ignore-all-space',
      '--ignore-blank-lines',
      '--numstat',
      '-z',
    ]),
  );
  const substantive = new Set(
    whitespaceStats.filter((f) => f.added + f.deleted > 0).map((f) => f.path),
  );
  const patch = await git([...diffArgs, '--full-index', '--unified=3']);
  const files: FileChange[] = [];
  for (const stat of stats) {
    // Content evidence is bounded to diff lines; classifications are explicitly heuristics.
    const section =
      patch
        .split('diff --git ')
        .find((p) => p.split('\n')[0]?.endsWith(`b/${stat.path}`)) ?? '';
    let classification = classify(stat.path, section, stat.binary);
    if (
      stat.added + stat.deleted > 0 &&
      !substantive.has(stat.path) &&
      classification.weight > 0
    )
      classification = { weight: 0.1, reason: 'format-whitespace-only' };
    files.push({ ...stat, ...classification });
  }
  // Tree entries detect file restoration cycles without storing source contents.
  const states = async (ref: string) => {
    const map = new Map<string, string>();
    const entries = await git(['ls-tree', '-r', '-z', ref]);
    for (const e of entries.split('\0')) {
      const m = /^\d+ \w+ ([0-9a-f]+)\t([\s\S]+)$/.exec(e);
      if (m) map.set(m[2]!, m[1]!);
    }
    return map;
  };
  const [before, after] = await Promise.all([states(base), states(sha)]);
  for (const f of files) {
    f.before = before.get(f.path) ?? 'absent';
    f.after = after.get(f.path) ?? 'absent';
  }
  const creditedPaths = files.filter((f) => f.weight > 0).map((f) => f.path);
  const creditPatch = creditedPaths.length
    ? await git([
        ...diffArgs,
        '--full-index',
        '--unified=3',
        '--',
        ...creditedPaths,
      ])
    : '';
  const patchId = creditPatch
    ? (await git(['patch-id', '--stable'], creditPatch)).split(' ')[0]
    : undefined;
  const dates = (await git(['show', '-s', '--format=%aI%n%cI', sha])).split(
    '\n',
  );
  const additions = files.reduce((n, f) => n + f.added, 0),
    deletions = files.reduce((n, f) => n + f.deleted, 0);
  const flags = [...candidate.flags];
  if (!parent) flags.push('initial-import');
  if (additions + deletions >= 10000) flags.push('massive-change');
  if (files.some((f) => f.reason === 'format-whitespace-only'))
    flags.push('format-only');
  if (files.length === 0 || additions + deletions === 0)
    flags.push(tree === parentTree ? 'empty-commit' : 'rename-only');
  return {
    ...candidate,
    source: 'git',
    verification: 'git-diff',
    status: 'inspected',
    tree,
    parentTree,
    ...(patchId ? { patchId } : {}),
    files,
    additions,
    deletions,
    flags,
    ...(dates[0] ? { authoredAt: dates[0] } : {}),
    ...(dates[1] ? { committedAt: dates[1] } : {}),
  };
}

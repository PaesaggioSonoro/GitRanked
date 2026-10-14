import { isUsername, type ScanOptions } from '../cli/config.js';
import {
  activity,
  type Activity,
  type Discovery,
  type Repository,
} from '../report/model.js';
import { boundedMap, GitHubClient } from './client.js';
const inWindow = (date: string, options: ScanOptions) =>
  Number.isFinite(Date.parse(date)) &&
  Date.parse(date) >= Date.parse(options.window.since) &&
  Date.parse(date) <= Date.parse(options.window.until);
export async function discover(
  username: string,
  client: GitHubClient,
  options: ScanOptions,
  progress: (message: string) => void = () => {},
): Promise<Discovery> {
  if (!isUsername(username)) throw new Error('Invalid GitHub username');
  progress(`Loading @${username}'s public profile`);
  const profile = await client.request<any>(`/users/${username}`);
  const user = {
    login: String(profile.login),
    id: Number(profile.id),
    url: String(profile.html_url),
    bot: profile.type === 'Bot',
  };
  const warnings: string[] = [];
  const aggregates: Discovery['aggregates'] = [];
  const candidates = new Set<string>();
  progress('Finding owned public repositories');
  const owned = await client.pages<any>(
    `/users/${username}/repos?type=owner&sort=pushed`,
    options.maxPages,
  );
  for (const repo of owned)
    if (repo.private === false && repo.visibility !== 'private')
      candidates.add(repo.full_name);
  const since = options.window.since.slice(0, 10),
    until = options.window.until.slice(0, 10);
  const search = async (q: string) =>
    client.pages<any>(
      `/search/issues?q=${encodeURIComponent(`${q} is:public`)}`,
      options.maxPages,
      true,
    );
  progress('Searching public PRs, issues, reviews, and commits');
  const queries = [
    () => search(`type:pr author:${username} created:${since}..${until}`),
    () => search(`type:pr author:${username} merged:${since}..${until}`),
    () => search(`type:issue author:${username} created:${since}..${until}`),
    () => search(`type:issue author:${username} closed:${since}..${until}`),
    () => search(`type:pr reviewed-by:${username} updated:>=${since}`),
    () =>
      client.pages<any>(
        `/search/commits?q=${encodeURIComponent(`author:${username} author-date:${since}..${until} is:public`)}`,
        options.maxPages,
        true,
      ),
  ];
  const [
    opened = [],
    merged = [],
    issues = [],
    closed = [],
    reviewed = [],
    commits = [],
  ] = await boundedMap(queries, options.concurrency, (fn) => fn());
  const repoName = (item: any): string =>
    String(item.repository_url ?? item.url)
      .replace('https://api.github.com/repos/', '')
      .split('/')
      .slice(0, 2)
      .join('/');
  for (const item of [...opened, ...merged, ...issues, ...closed, ...reviewed])
    candidates.add(repoName(item));
  for (const item of commits)
    if (item.repository?.private === false)
      candidates.add(item.repository.full_name);
  if (client.auth.token) {
    progress('Reading public contribution signals');
    // GitHub limits contributionsCollection to at most one year. Split longer windows.
    let start = new Date(options.window.since);
    while (start.getTime() <= Date.parse(options.window.until)) {
      const stop = new Date(
        Math.min(
          start.getTime() + 364 * 86400000,
          Date.parse(options.window.until),
        ),
      );
      try {
        const result = await client.request<any>('/graphql', {
          query: `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){hasAnyRestrictedContributions contributionCalendar{weeks{contributionDays{date contributionCount}}} commitContributionsByRepository(maxRepositories:100){repository{nameWithOwner isPrivate} contributions{totalCount}} pullRequestContributionsByRepository(maxRepositories:100){repository{nameWithOwner isPrivate}} issueContributionsByRepository(maxRepositories:100){repository{nameWithOwner isPrivate}} pullRequestReviewContributionsByRepository(maxRepositories:100){repository{nameWithOwner isPrivate}}}} rateLimit{remaining resetAt}}`,
          variables: {
            login: username,
            from: start.toISOString(),
            to: stop.toISOString(),
          },
        });
        const collection = result.data?.user?.contributionsCollection;
        if (collection) {
          const counts = [];
          for (const key of [
            'commitContributionsByRepository',
            'pullRequestContributionsByRepository',
            'issueContributionsByRepository',
            'pullRequestReviewContributionsByRepository',
          ]) {
            const items = collection[key] ?? [];
            if (items.length === 100)
              warnings.push(`Contribution repository cap reached (${key})`);
            for (const item of items)
              if (item.repository.isPrivate === false) {
                candidates.add(item.repository.nameWithOwner);
                if (item.contributions)
                  counts.push({
                    repository: item.repository.nameWithOwner,
                    total: item.contributions.totalCount,
                  });
              }
          }
          aggregates.push({
            source: 'graphql-public-commit-counts',
            publicOnly: true,
            data: {
              since: start.toISOString(),
              until: stop.toISOString(),
              counts,
            },
          });
          if (collection.hasAnyRestrictedContributions === false)
            aggregates.push({
              source: 'graphql-public-calendar-unscored',
              publicOnly: true,
              data: collection.contributionCalendar,
            });
          else
            warnings.push(
              'Contribution calendar omitted because restricted contributions may be included',
            );
        } else warnings.push('Contribution data unavailable');
      } catch {
        warnings.push(
          'GraphQL contribution data unavailable; REST discovery continues',
        );
      }
      start = new Date(stop.getTime() + 1);
    }
  } else
    warnings.push(
      'GraphQL contribution discovery unavailable without authentication',
    );
  const repositories: Repository[] = [];
  // Metadata is fetched even for candidates past the Git budget so public activity stays in the denominator.
  const names = [...candidates]
    .filter((n) => /^[\w.-]+\/[\w.-]+$/.test(n))
    .sort();
  progress(`Checking visibility of ${names.length} discovered repositories`);
  const metadata = await boundedMap(
    names,
    options.concurrency,
    async (name) => {
      try {
        const r = await client.request<any>(`/repos/${name}`);
        if (r.private !== false || r.visibility === 'private') {
          warnings.push(`Non-public repository excluded: ${name}`);
          return undefined;
        }
        return {
          name: r.full_name,
          url: r.html_url,
          public: true,
          owner: r.owner.login,
          defaultBranch: r.default_branch ?? 'main',
          sizeKb: r.size ?? 0,
          project: r.source?.full_name ?? r.parent?.full_name ?? r.full_name,
          fork: !!r.fork,
          status: 'discovered',
          reasons: [],
        } as Repository;
      } catch {
        warnings.push(`Repository metadata unavailable: ${name}`);
        return undefined;
      }
    },
  );
  for (const r of metadata) if (r) repositories.push(r);
  const byName = new Map(repositories.map((r) => [r.name.toLowerCase(), r]));
  const activities: Activity[] = [];
  const add = (
    r: Repository,
    kind: Activity['kind'],
    id: string,
    timestamp: string,
    url: string,
    extra: Partial<Activity> = {},
  ) => {
    if (inWindow(timestamp, options))
      activities.push(
        activity({
          id,
          kind,
          repository: r.name,
          project: r.project,
          timestamp: new Date(timestamp).toISOString(),
          sourceUrls: [url],
          selfControlled: r.owner.toLowerCase() === username.toLowerCase(),
          bot: user.bot,
          ...extra,
        }),
      );
  };
  const prItems = new Map(
    [...opened, ...merged, ...reviewed].map((i) => [i.id, i]),
  );
  progress(`Verifying ${prItems.size} public pull requests and their reviews`);
  await boundedMap([...prItems.values()], options.concurrency, async (item) => {
    const r = byName.get(repoName(item).toLowerCase());
    if (!r) return;
    try {
      const p = await client.request<any>(
        `/repos/${r.name}/pulls/${item.number}`,
      );
      if (p.user?.id === user.id) {
        add(r, 'pr-opened', `pr:${p.id}:opened`, p.created_at, p.html_url, {
          body: p.body ?? '',
          bot: p.user.type === 'Bot',
        });
        if (p.merged_at)
          add(r, 'pr-merged', `pr:${p.id}:merged`, p.merged_at, p.html_url, {
            body: p.body ?? '',
            bot: p.user.type === 'Bot',
          });
      }
      const reviews = await client.pages<any>(
        `/repos/${r.name}/pulls/${item.number}/reviews`,
        options.maxPages,
      );
      for (const review of reviews)
        if (review.user?.id === user.id && review.submitted_at)
          add(
            r,
            'review',
            `review:${review.id}`,
            review.submitted_at,
            review.html_url,
            {
              body: review.body ?? '',
              flags: p.user?.id === user.id ? ['self-review'] : [],
              bot: review.user.type === 'Bot',
            },
          );
      // Include authored commits on PR heads as well as default-branch history.
      if (p.user?.id === user.id) {
        const cs = await client.pages<any>(
          `/repos/${r.name}/pulls/${item.number}/commits`,
          options.maxPages,
        );
        for (const c of cs)
          if (c.author?.id === user.id)
            add(
              r,
              'commit',
              `commit:${r.name}:${c.sha}`,
              c.commit.author.date,
              c.html_url,
              {
                sha: c.sha,
                authoredAt: c.commit.author.date,
                committedAt: c.commit.committer.date,
                verification: 'github-author-id',
                integrated: !!p.merged_at && inWindow(p.merged_at, options),
              },
            );
      }
    } catch {
      warnings.push(`Pull request unavailable: ${r.name}#${item.number}`);
      add(
        r,
        'pr-opened',
        `pr:${item.id}:unavailable`,
        item.created_at,
        item.html_url,
        { status: 'skipped', exclusions: ['pull-request-detail-unavailable'] },
      );
    }
  });
  const issueItems = new Map([...issues, ...closed].map((i) => [i.id, i]));
  progress(`Verifying ${issueItems.size} public issue lifecycles`);
  for (const item of issueItems.values()) {
    const r = byName.get(repoName(item).toLowerCase());
    if (!r || item.user?.id !== user.id) continue;
    add(
      r,
      'issue-opened',
      `issue:${item.id}:opened`,
      item.created_at,
      item.html_url,
      { body: item.body ?? '', bot: item.user.type === 'Bot' },
    );
    if (item.closed_at) {
      add(
        r,
        'issue-closed',
        `issue:${item.id}:closed`,
        item.closed_at,
        item.html_url,
      );
      // Public timeline cross-reference verifies a linked PR; closure alone is not merit.
      const timeline = await client.pages<any>(
        `/repos/${r.name}/issues/${item.number}/timeline`,
        options.maxPages,
      );
      for (const e of timeline)
        if (e.event === 'cross-referenced' && e.source?.issue?.pull_request) {
          const linked = e.source.issue;
          const linkedRepo = byName.get(repoName(linked).toLowerCase());
          if (linkedRepo && linked.state === 'closed') {
            try {
              const p = await client.request<any>(
                `/repos/${linkedRepo.name}/pulls/${linked.number}`,
              );
              if (
                p.merged_at &&
                Date.parse(p.merged_at) <= Date.parse(item.closed_at)
              ) {
                add(
                  r,
                  'issue-linked',
                  `issue:${item.id}:linked`,
                  item.closed_at,
                  item.html_url,
                  { sourceUrls: [item.html_url, p.html_url] },
                );
                break;
              }
            } catch {
              warnings.push(
                `Issue linked PR verification unavailable: ${item.html_url}`,
              );
            }
          }
        }
    }
  }
  progress('Resolving public commit identities and integration');
  await boundedMap(repositories, options.concurrency, async (r) => {
    const cs = await client.pages<any>(
      `/repos/${r.name}/commits?author=${username}&since=${options.window.since}&until=${options.window.until}`,
      options.maxPages,
    );
    for (const c of cs)
      if (c.author?.id === user.id)
        add(
          r,
          'commit',
          `commit:${r.name}:${c.sha}`,
          c.commit.author.date,
          c.html_url,
          {
            sha: c.sha,
            authoredAt: c.commit.author.date,
            committedAt: c.commit.committer.date,
            verification: 'github-author-id',
            integrated: true,
          },
        );
  });
  // Search is evidence of repositories; commit attribution still requires GitHub's numeric author ID.
  for (const c of commits) {
    const r = byName.get(c.repository?.full_name?.toLowerCase());
    if (r && c.author?.id === user.id)
      add(
        r,
        'commit',
        `commit:${r.name}:${c.sha}`,
        c.commit.author.date,
        c.html_url,
        {
          sha: c.sha,
          authoredAt: c.commit.author.date,
          committedAt: c.commit.committer.date,
          verification: 'github-author-id',
          integrated: false,
        },
      );
  }
  warnings.push(
    'Public discovery is not exhaustive: search caps, deleted activity, non-default branches, identity mapping, and third-party history can leave unknown contributions.',
  );
  return {
    user,
    repositories,
    activities,
    warnings: [...warnings, ...client.warnings],
    aggregates,
  };
}

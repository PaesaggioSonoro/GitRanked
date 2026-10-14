import { expect, test } from 'vitest';
import { GitHubClient } from '../src/github/client.js';
import { discover } from '../src/github/discovery.js';
import { options } from '../src/cli/config.js';
import { normalize } from '../src/normalize/index.js';
import { audit } from '../src/antifarming/index.js';
const user = {
  login: 'alice',
  id: 1,
  html_url: 'https://github.com/alice',
  type: 'User',
};
const repo = (name: string, privateValue = false) => ({
  full_name: name,
  private: privateValue,
  visibility: privateValue ? 'private' : 'public',
  owner: { login: name.split('/')[0] },
  html_url: `https://github.com/${name}`,
  default_branch: 'main',
  size: 10,
});
const issue = {
  id: 7,
  number: 1,
  repository_url: 'https://api.github.com/repos/org/public',
  html_url: 'https://github.com/org/public/issues/1',
  user: { id: 1, type: 'User' },
  created_at: '2025-01-01T00:00:00Z',
  closed_at: '2025-02-01T00:00:00Z',
  body: 'Detailed report',
};
const pr = {
  id: 8,
  number: 2,
  repository_url: 'https://api.github.com/repos/org/public',
  html_url: 'https://github.com/org/public/pull/2',
  user: { id: 1, type: 'User' },
  created_at: '2024-12-01T00:00:00Z',
  merged_at: '2025-02-01T00:00:00Z',
  body: 'Detailed change',
};
test('mock discovery finds third-party lifecycle evidence and excludes private or wrongly attributed commits', async () => {
  const fetcher: typeof fetch = async (input) => {
    const u = new URL(String(input));
    const p = u.pathname;
    let data: any = [];
    if (p === '/users/alice') data = user;
    else if (p === '/users/alice/repos')
      data = [repo('alice/owned'), repo('alice/private', true)];
    else if (p === '/search/issues') {
      const q = u.searchParams.get('q')!;
      data = {
        items: q.includes('type:issue') ? [issue] : [pr],
        total_count: 1,
      };
    } else if (p === '/search/commits')
      data = {
        items: [{ repository: repo('alice/private', true) }],
        total_count: 1,
      };
    else if (p === '/graphql')
      data = {
        data: {
          user: {
            contributionsCollection: {
              hasAnyRestrictedContributions: true,
              commitContributionsByRepository: [
                {
                  repository: {
                    nameWithOwner: 'alice/private',
                    isPrivate: true,
                  },
                  contributions: { totalCount: 1000 },
                },
              ],
            },
          },
        },
      };
    else if (p === '/repos/alice/owned') data = repo('alice/owned');
    else if (p === '/repos/org/public') data = repo('org/public');
    else if (p === '/repos/org/public/pulls/2') data = pr;
    else if (p.endsWith('/reviews'))
      data = [
        {
          id: 9,
          user: { id: 1 },
          submitted_at: '2025-02-01T00:00:00Z',
          html_url: 'https://github.com/org/public/pull/2#review-9',
          body: 'Detailed review '.repeat(10),
        },
      ];
    else if (p.endsWith('/timeline'))
      data = [
        {
          event: 'cross-referenced',
          source: {
            issue: {
              ...pr,
              state: 'closed',
              pull_request: {
                url: 'https://api.github.com/repos/org/public/pulls/2',
              },
            },
          },
        },
      ];
    else if (p.endsWith('/commits'))
      data = [
        {
          sha: 'a'.repeat(40),
          author: { id: 1 },
          commit: {
            author: { date: '2025-01-03T00:00:00Z' },
            committer: { date: '2025-01-03T00:00:00Z' },
          },
          html_url: 'https://github.com/org/public/commit/' + 'a'.repeat(40),
        },
        {
          sha: 'b'.repeat(40),
          author: { id: 2 },
          commit: {
            author: { date: '2025-01-03T00:00:00Z' },
            committer: { date: '2025-01-03T00:00:00Z' },
          },
          html_url: 'https://github.com/org/public/commit/' + 'b'.repeat(40),
        },
      ];
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const client = new GitHubClient(
    { source: 'environment', token: 'fixture-token' },
    { fetcher },
  );
  const d = normalize(
    await discover(
      'alice',
      client,
      options({ mode: 'fast', since: '2025-01-01', until: '2025-12-31' }),
    ),
  );
  expect(d.repositories.map((r) => r.name)).toEqual([
    'alice/owned',
    'org/public',
  ]);
  expect(d.activities.some((a) => a.kind === 'pr-merged')).toBe(true);
  expect(d.activities.some((a) => a.kind === 'pr-opened')).toBe(false);
  expect(d.activities.some((a) => a.kind === 'issue-linked')).toBe(true);
  expect(d.activities.some((a) => a.sha === 'b'.repeat(40))).toBe(false);
  expect(d.aggregates.some((a) => a.source.includes('calendar'))).toBe(false);
  const reviewed = audit(d, '2025-12-31T23:59:59.999Z');
  expect(
    reviewed.activities.find((a) => a.kind === 'pr-merged')?.eligible,
  ).toBe(true);
  expect(reviewed.activities.find((a) => a.kind === 'review')?.eligible).toBe(
    false,
  );
  expect(JSON.stringify(reviewed)).not.toContain('fixture-token');
});

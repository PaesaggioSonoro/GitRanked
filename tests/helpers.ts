import { options } from '../src/cli/config.js';
import { makeReport } from '../src/report/index.js';
import { activity, type Discovery } from '../src/report/model.js';
export function fixture(): ReturnType<typeof makeReport> {
  const d: Discovery = {
    user: {
      login: 'fixture-user',
      id: 1,
      url: 'https://github.com/fixture-user',
      bot: false,
    },
    repositories: [],
    activities: [
      activity({
        id: 'review:1',
        kind: 'review',
        repository: 'fixture/public',
        project: 'fixture/public',
        timestamp: '2025-01-01T00:00:00.000Z',
        sourceUrls: [
          'https://github.com/fixture/public/pull/1#pullrequestreview-1',
        ],
        status: 'inspected',
        eligible: true,
        weight: 1,
        points: 3,
      }),
    ],
    warnings: [],
    aggregates: [],
  };
  return makeReport(
    d,
    options({ since: '2025-01-01', until: '2025-12-31', mode: 'fast' }),
    'fixture',
    true,
  );
}

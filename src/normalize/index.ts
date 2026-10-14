import type { Activity, Discovery } from '../report/model.js';
export function normalize(discovery: Discovery): Discovery {
  const byId = new Map<string, Activity>();
  for (const original of discovery.activities) {
    const a = structuredClone(original);
    a.timestamp = new Date(a.timestamp).toISOString();
    const prev = byId.get(a.id);
    if (prev) {
      prev.sourceUrls = [
        ...new Set([...prev.sourceUrls, ...a.sourceUrls]),
      ].sort();
      if (a.integrated) prev.integrated = true;
      continue;
    }
    byId.set(a.id, a);
  }
  return {
    ...discovery,
    repositories: [...discovery.repositories].sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    ),
    activities: [...byId.values()].sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) ||
        Number(!!b.integrated) - Number(!!a.integrated) ||
        a.id.localeCompare(b.id, 'en'),
    ),
    warnings: [...new Set(discovery.warnings)].sort(),
    aggregates: discovery.aggregates.sort(
      (a, b) =>
        a.source.localeCompare(b.source, 'en') ||
        JSON.stringify(a.data).localeCompare(JSON.stringify(b.data), 'en'),
    ),
  };
}

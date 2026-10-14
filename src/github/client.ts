import { setTimeout as delay } from 'node:timers/promises';
import type { Auth } from './auth.js';
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
interface ClientOptions {
  signal?: AbortSignal;
  onRequest?: (count: number) => void;
  maxRequests?: number;
  timeout?: number;
  retries?: number;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}
export class GitHubClient {
  readonly warnings: string[] = [];
  requests = 0;
  constructor(
    readonly auth: Auth,
    readonly config: ClientOptions = {},
  ) {}
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Invalid GitHub API path');
    const fetcher = this.config.fetcher ?? fetch;
    const sleep =
      this.config.sleep ??
      ((ms: number) =>
        delay(
          ms,
          undefined,
          this.config.signal ? { signal: this.config.signal } : {},
        ));
    for (let attempt = 0; attempt <= (this.config.retries ?? 2); attempt++) {
      this.config.signal?.throwIfAborted();
      if (++this.requests > (this.config.maxRequests ?? 500))
        throw new ApiError(
          0,
          'GitHub request budget exhausted; increase --max-requests or retry later',
        );
      this.config.onRequest?.(this.requests);
      let response: Response;
      try {
        response = await fetcher(`https://api.github.com${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'gitranked/1.0.0',
            ...(this.auth.token
              ? { Authorization: `Bearer ${this.auth.token}` }
              : {}),
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: this.config.signal
            ? AbortSignal.any([
                this.config.signal,
                AbortSignal.timeout(this.config.timeout ?? 15000),
              ])
            : AbortSignal.timeout(this.config.timeout ?? 15000),
          redirect: 'error',
        });
      } catch {
        this.config.signal?.throwIfAborted();
        if (attempt < (this.config.retries ?? 2)) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ApiError(0, 'GitHub network request failed or timed out');
      }
      if (response.ok) {
        try {
          const data = (await response.json()) as any;
          if (data.errors?.length) {
            this.warnings.push('GraphQL returned incomplete results');
            if (!data.data)
              throw new ApiError(200, 'GraphQL returned no usable data');
          }
          return data as T;
        } catch (err) {
          if (err instanceof ApiError) throw err;
          throw new ApiError(response.status, 'GitHub returned invalid JSON');
        }
      }
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' ||
            response.headers.has('retry-after')));
      const reset =
        Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000;
      const delay = Math.max(
        Number(response.headers.get('retry-after') ?? 0) * 1000,
        reset - Date.now(),
        500 * 2 ** attempt,
      );
      if (
        (rateLimited || response.status >= 500) &&
        attempt < (this.config.retries ?? 2) &&
        delay <= 5000
      ) {
        await sleep(delay);
        continue;
      }
      throw new ApiError(
        response.status,
        rateLimited
          ? 'GitHub rate limit reached; retry after reset or authorize with gitranked / use GITHUB_TOKEN'
          : response.status === 401
            ? 'GitHub credential expired or was revoked; run gitranked login again or scan with --anonymous'
            : `GitHub API request failed (${response.status})`,
      );
    }
    throw new ApiError(0, 'GitHub retry budget exhausted');
  }
  async pages<T>(path: string, maxPages: number, search = false): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const data = await this.request<any>(
          `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
        );
        const items: T[] = search ? data.items : data;
        if (!Array.isArray(items))
          throw new ApiError(
            200,
            'GitHub returned an unexpected list response',
          );
        result.push(...items);
        if (search && data.incomplete_results)
          this.warnings.push(`Incomplete search results: ${path}`);
        if (items.length < 100) {
          if (search && data.total_count > result.length)
            this.warnings.push(`Search omitted results: ${path}`);
          return result;
        }
        if (page === maxPages || (search && page === 10)) {
          this.warnings.push(`Pagination limit reached: ${path}`);
          return result;
        }
      } catch (err) {
        this.warnings.push(
          `${path}: ${err instanceof Error ? err.message : 'request failed'}`,
        );
        return result;
      }
    }
    return result;
  }
}
export async function boundedMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

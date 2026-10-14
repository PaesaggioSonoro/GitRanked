# GitRanked

An open-source, local TypeScript CLI that scores **publicly verifiable GitHub development activity** over a UTC interval and exports an auditable JSON report and a shareable SVG/PNG card. The experimental 0–1000 index is **not a measure of developer skill, code quality, employability, or technical merit**.

## Install and run

Requires Node.js **22.12+** and, for deep scans, Git **2.28+**. PNG rendering uses WebAssembly and a bundled SIL Open Font License Noto Sans font; no native compiler, browser, or system fonts are needed.

From this checkout:

```sh
npm ci
npm run build
node dist/cli/index.js scan USERNAME
node dist/cli/index.js scan USERNAME --mode fast --format json
node dist/cli/index.js scan USERNAME --since 2025-01-01 --until 2025-12-31 --output .gitranked/2025
node dist/cli/index.js --help
node dist/cli/index.js --version
```

Install the checkout locally with `npm install -g .` to use `gitranked scan USERNAME`. The package has not been published by this rebuild. **After npm publication**, the equivalent command will be `npx gitranked scan USERNAME` (or pin `npx gitranked@1.0.0 scan USERNAME` for reproducibility).

Authentication during development is automatic: `GITHUB_TOKEN`, then an already-authenticated `gh auth token --hostname github.com`, then anonymous public requests. Tokens are never written to reports, caches, or logs. No authentication is required to start using the core.

The default interval is the trailing 365 × 24 hours through scan start. `--since` starts at 00:00:00 UTC; `--until` includes the entire end date. Pin both dates to reproduce the analysis window. Public GitHub data can change, so save the JSON report to preserve the exact analyzed evidence.

## Outputs and offline example

`--format json|svg|png|all` defaults to `all`. `--output <directory>` defaults to the Git-ignored `.gitranked/`. Outputs are `gitranked.json`, `gitranked.svg`, and `gitranked.png`.

```sh
npm run fixture
node dist/cli/index.js render tests/fixtures/report.json --output .gitranked/offline
```

These commands produce a **synthetic fixture**, clearly marked on its card and in its JSON. They do not describe an actual profile. `render <report>` supports `--format` and `--output`, works without network access, verifies the schema/content digest, and recomputes the score from audited records. The digest detects accidental changes; it is not a cryptographic signature or external attestation. Reports include formula/rule versions, scoring parameters, public URLs, per-item eligibility and exclusion explanations, repository omissions, and coverage. See [the schema](docs/gitranked.schema.json) and [methodology](docs/METHODOLOGY.md).

## Discovery, coverage, and comparability

Discovery combines owned public repositories, public PR/issue lifecycle searches, reviewed PRs, commit search, PR commit lists, default-branch commit lists, and authenticated contribution queries when available. `/users/{username}/repos` is not treated as a full contribution list. Public events are deliberately not used as a historical source. Every repository must pass an explicit public visibility check, even if the token can access private repositories. GitHub's numeric `author.id` must match the target account; arbitrary author names or email addresses do not establish attribution. Coauthor trailers without this association are not credited.

GitHub search has a 1,000-result query cap; contribution repository lists have a 100-repository cap per contribution type. Deleted contributions, rewritten history, non-default branches without PR/search evidence, inaccessible endpoints, and limited identity mapping can remain unknown. Calendar signals are unscored and omitted if GitHub reports restricted contributions. Private repository records and private aggregate counts are excluded. High coverage does not establish exhaustive discovery.

Coverage is the fraction of **discovered, deduplicated public activity records** whose applicable checks finished, including analyzed exclusions. Git-diff inspection, API-only records, skips, and unquantifiable unknown activity are separate fields. It is not a percentage of all activity that ever existed. Below the experimental 90% threshold the report is partial. Operational discovery failures or Git omissions also prevent a complete badge. A complete label means checks completed for discovered public evidence only.

- **Deep** performs bounded Git inspection, stable patch deduplication, content classification, and restoration checks.
- **Fast** makes only public API requests. It awards conservatively audited collaboration/consistency points but gives uninspected commits no impact, delivery, breadth, or active-day credit. It is always partial.

Do not directly compare fast and deep scores, or scores with incompatible windows, scoring versions, discovery warnings, or analysis completeness. More Git/API access can reveal different evidence and therefore change a score.

## Network and Git budgets

Requests have 15-second timeouts, up to two bounded exponential-backoff retries, pagination limits, and bounded API workers. Errors preserve previously fetched pages. 403/429 rate limits are explicit; long reset delays stop that source instead of hanging. Anonymous GitHub REST requests ordinarily have a 60-request/hour IP limit; token requests generally have higher limits, with separate search/GraphQL constraints. See [GitHub's rate-limit documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

Deep scans use `git clone --filter=blob:none --no-checkout --single-branch --depth=256 --no-tags`. Candidate SHAs missing parents can fetch a depth-two history. Needed diffs lazily fetch blobs. There is no blind full-clone fallback. Cached clones fetch incrementally; validated immutable diff records are reused for 30 days under a versioned cache key and re-audited on every scan.

| Flag             |                 Default | Meaning                                              |
| ---------------- | ----------------------: | ---------------------------------------------------- |
| `--max-repos`    |                      50 | Repositories attempted for Git inspection            |
| `--max-pages`    |                      10 | Pages per API listing/search                         |
| `--max-commits`  |                    2000 | Git commit inspection attempts                       |
| `--max-requests` |                     500 | API attempts, including retries                      |
| `--concurrency`  |                       3 | API workers; maximum 8                               |
| `--max-repo-kb`  |                  100000 | Preliminary GitHub approximate repository size limit |
| `--max-repo-mb`  |                     256 | Git disk bytes per cached repository, MiB            |
| `--max-total-mb` |                    1024 | Total cached Git disk bytes, MiB                     |
| `--max-seconds`  |                     300 | Total Git execution time budget                      |
| `--cache`        | `~/.cache/gitranked/v1` | Local cache outside the working checkout             |

GitHub `size` is approximate KB, **not** a prediction of clone transfer. Commit/tree histories can be huge even with partial clones. Disk monitoring runs about every 100 ms and can briefly overshoot; execution/output limits also abort work. Exact network transfer bytes are not measured. Failed new clones are removed; existing oversized caches cause transparent skips and can be removed manually to free space. There is no cache eviction daemon.

## Privacy and limitations

The CLI has no proprietary backend, analytics, database, or AI service. Runtime scan requests go to GitHub APIs and public HTTPS GitHub remotes. Rendering is offline. Public Git data is stored outside the checkout; reports contain public account/repository/activity identifiers and change classifications, not raw source contents, author emails, or credentials. Local Git commands disable global/system configuration, external diffs, text conversions, checkouts, and LFS smudging. No tokens are passed to Git clone URLs. Sharing a card/report is your choice.

Anti-farming checks are explainable heuristics: equivalent patches, empty/rename-only changes, generated/vendor/build/minified content, dependency files, whitespace-only changes, capped imports, file restoration within 7/30 days, suspicious dates, bot/self-review activity, repetitive text, daily collaboration caps, and discounts for self-controlled collaboration. Legitimate rollbacks are retained once at reduced weight. These checks can undercount maintenance and cannot reliably distinguish every adversarial repository owner or cooperating account. Formatting, reviews, repository independence, and issue closure do not prove technical merit.

## Development

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run fixture
npm pack --dry-run
```

CI runs lint, strict TypeScript checking, offline tests, and build on Node 22 and 24. Tests use mocked GitHub APIs and local adversarial Git histories. Production dependencies are Commander, Zod, and resvg WASM. No secrets or downloaded repositories belong in Git. See [CONTRIBUTING](CONTRIBUTING.md). Source is MIT licensed; the bundled font has its own [OFL license](assets/OFL.txt).

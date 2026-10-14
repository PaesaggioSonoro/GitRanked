# Methodology v1

`scoring-1`, `antifarming-1`, `gitranked-report-1`. This index summarizes observed public activity; the parameters are starting hypotheses, not scientifically validated constants. No sample profile is used to tune the formula. Configuration is centralized in `src/scoring/index.ts` and `src/antifarming/index.ts`; classification consumes the exported weights. Changing behavior requires a new version and updated fixtures/schema where applicable. Runtime arbitrary score customization is not supported because it would break comparability.

## Code Impact: maximum 300

For each text file, count Git diff additions/deletions. Exclude binary/generated/vendor/build/minified/assets; retain source/tests at weight 1, technical documentation at 0.7, CI/config at 0.5, dependencies/locks at 0.15, formatting at 0.1. Unknown text receives a conservative 0.5. Extensions alone do not establish substantive value: changed-content markers and long-line heuristics can override the path classification. Every file stores its classification reason. Snapshot files are treated as generated. This heuristic can misclassify unusual languages, long strings, documentation, or generated-looking text.

For eligible added/deleted totals `A,D`, `L = min(A,D) + 0.5*abs(A-D)`. Commit weight is the file-level `L`-weighted average. `effectiveLines` stores `L`; weighted impact is `weight * min(L,200)`. Sum per UTC day and cap at 300. With `I` the sum of capped days, `S_impact = 300*(1-exp(-I/5000))`.

Compare against the first parent. Merge transport is excluded because its diff cannot reliably attribute other authors' changes to the merger. Root commits receive an import discount. A change touching 10,000+ lines receives a possible-import/reupload discount. Root/large-change weight is multiplied by 0.1 and **all such changes in an independent project share a 20-impact-unit window allowance**, preventing repeated imports from exploiting per-commit caps. These changes cannot count toward delivery or breadth. No claim is made that every large legitimate refactor is an import.

Equivalent SHA and stable Git patch IDs are credited once globally across discovered repositories. Stable patch IDs use positive-weight files, ignore whitespace, and are not semantic equivalence proofs. Tree identity plus initial-import evidence groups copied repositories; public fork source/parent metadata groups fork families. Different filenames or substantially altered copies can evade detection.

## Consistency: maximum 250

Let `D_days` be distinct UTC dates containing eligible activity, `W` distinct Monday-start UTC calendar weeks, and `R` the longest consecutive calendar-date streak. Week keys use the Monday's date so streaks/weeks span month/year boundaries without locale ambiguity.

`130*(1-exp(-D_days/100)) + 80*min(W,52)/52 + 40*(1-exp(-R/14))`.

Empty, excluded, duplicate, skipped, and uninspected commits do not create active days. Conservatively retained formatting and the first rollback can count as activity. Eligible public collaboration can create active days in both modes.

## Collaboration: maximum 200

PR opened +2; merge +8; substantive review +3; issue opened +1; own issue closed +2; own closed issue publicly linked to a merged PR +3. Each lifecycle credit is timestamped separately, so a PR opened before the window can still earn a merge credit inside it. Issue linkage requires a public cross-reference, a public known repository, and a verified merged PR no later than issue closure. Cross-reference is evidence of linkage, not proof that the PR caused the closure or solved the issue.

Review body must contain at least 80 characters; self-reviews and bots are excluded. This is a cautious substance proxy and undercounts useful concise/inline-only reviews. Reviews by the target on others' PRs are fetched from reviewed-by search evidence and filtered by GitHub user ID. REST review bodies omit some inline discussions.

Activity IDs deduplicate repeated endpoint evidence. Self-controlled repositories receive a 0.25 multiplier. Repeated normalized text of at least 20 characters within the same activity kind receives another 0.25 multiplier; templated legitimate work may be discounted. Each kind shares a global daily 20-point limit. `C` is the adjusted total, capped at 1500, and `S_collab = 200*(1-exp(-C/150))`. Org membership or cooperating accounts are not reliably identified as self-controlled. Issue closure does not establish merit.

## Delivery: maximum 150

An effective commit must have eligible inspected text changes, weight at least 0.5, and API evidence of default-branch reachability or integration through a PR merged within the interval. Commits marked import/large-change/first-rollback do not count. API evidence of a merged PR can include original SHAs squashed or rebased away; it does not claim those SHAs remain Git ancestors. Count at most 5 per UTC calendar day globally. `E` is this capped count; `S_delivery = 150*(1-exp(-E/150))`.

## Breadth: maximum 100

An independent project must have at least 3 effective commits, at least 50 weighted lines in total, and effective commits on at least 2 UTC dates. Fork families and detected identical-tree copies are grouped. With `P` qualified projects, `S_breadth = 100*(1-exp(-P/5))`. This is a conservative project-activity proxy, not a measure of language mastery or project success.

## Rollbacks, dates, and audit

Within each canonical project/path, remember inspected before/after Git blob IDs. A return to a known file state within 7 or 30 days is flagged. The first restoring change per project/path within a rolling 30-day period keeps half file weight; later restorations of that same path within the period are excluded. Unrelated paths and other substantive files in the same commit retain their credit. Equivalent forward patches are independently excluded, so repeatedly alternating states does not produce indefinite streak credit. State is limited to discovered, attributed commits; other authors' changes and activity outside the interval are not fully reconstructed. Legitimate sequences of several rollbacks of the same file within 30 days can be undercounted; explanations expose this decision.

Dates are compared cautiously: author over a day after committer, commit after the window by over a day, or author/committer differing by over 30 days produces a medium-confidence flag, not automatic exclusion. Git timestamps can be forged; GitHub identity association is not proof of trusted timestamps or human authorship.

Every record exposes eligibility, effective lines, weight, flags, exclusions, rule version, public source URLs, confidence, source, verification method, and analysis status. Per-file reasons and blob-state IDs explain inspected commit decisions. Raw review/issue bodies are removed after auditing. An analyzed exclusion counts toward inspection coverage but never toward activity credit.

## Reporting and coverage

Five categories clamp to their maxima; total clamps to [0,1000]. Internal values remain floating-point; only card values and `displayTotal` are rounded. JSON preserves category/metric precision and all parameters. Canonical sorted-object serialization and SHA-256 digest give deterministic output for fixed input evidence/options/window. API/Git contents changing later can change a new report. The content digest is not a signed verification.

Coverage denominator is discovered public activity records after same-ID deduplication, including cross-repository evidence retained for the audit. Inspected numerator includes Git diffs and completed public API collaboration checks; API-only commits are separate. Aggregates are unscored, explicitly marked public-only, and never expanded into invented commits. Unknown activity cannot be quantified. Zero discovered activity has zero measurable coverage. Below 90%, fast mode, operational warnings, or repository/commit omissions yields `partial`; a complete-for-discovered-activity label still does not prove exhaustive discovery. Coverage reports checks attempted at mode level; individual statuses/flags indicate their application and success.

Compare only compatible scoring versions, UTC intervals, modes, and completeness. Even apparently compatible scores can reflect different public discovery visibility. Treat this as an experimental descriptive index.

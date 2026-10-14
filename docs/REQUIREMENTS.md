# GitRanked product requirements

These requirements replace the original OAuth App and command-only onboarding requirements. The existing public-only data integrity, scoring v1, anti-farming, Git budgets, reproducible reports, and offline testing requirements remain in force; see [METHODOLOGY.md](METHODOLOGY.md).

## Preferred workflow

- `npx gitranked` (or `bunx gitranked`) starts an interactive wizard in a terminal, without requiring a username or configuration.
- First show a choice navigable with arrow keys and Enter: **Continue with GitHub** (initial selection) or **Scan anonymously**.
- Explain briefly: login offers higher API limits and additional public contribution discovery; anonymous scans require no authorization, have lower limits, and may retrieve less evidence. Neither guarantees exhaustive discovery. Private contributions never count.
- Anonymous asks for a valid GitHub username, then immediately starts the default deep scan. It must bypass environment, GitHub CLI, and stored credentials.
- GitHub login opens the device authorization page, displays the temporary user code, waits for consent, resolves the authorized account via `/user`, and starts that account's default deep scan. No username prompt, repository installation, backend, callback server, or app registration by end users.
- Interactive sessions hold the access token only in memory and discard refresh tokens. At completion provide the GitHub authorization settings link and explain that local credential disposal does not revoke the grant.
- Preserve explicit scan/render/login/logout commands and all existing scan flags. Add `scan USERNAME --anonymous` for a guaranteed unauthenticated scan. Explicit login may store only the access token in OS secret storage; expired or revoked credentials require reauthorization rather than silent authenticated-looking fallback.
- No-argument execution without a TTY must fail with actionable explicit-command instructions, never hang waiting for input. Cancellation must restore the terminal and exit cleanly.

## Terminal presentation

- Use a compact interactive terminal presentation with arrow-key choices, clear short explanations, an authorization status, and scan stages.
- Discovery displays current API request count and a stage spinner rather than a fabricated completion percentage.
- Git inspection displays repository and commit counters with progress bars only when the denominator is known. Counts represent processing, including recorded skips, not successfully verified contributions.
- Show audit/scoring, rendering/export, and completion stages. Keep a fixed live status area rather than printing every API request or Git output. Non-TTY explicit commands use concise stage lines without ANSI escape sequences.
- Show final score, partial/coverage status, output path, and coverage warning count. Never expose tokens, refresh tokens, device secrets, raw API errors, or Git output in terminal status.

## GitHub App configuration

- Use a **GitHub App** with Device Flow, not an OAuth App registration. OAuth device authorization remains the underlying protocol.
- Bundle maintainer-provided public Client ID `Iv23lifRY1rPYNaMNGes`; permit `GITRANKED_CLIENT_ID` / `login --client-id` overrides for contributors.
- Request no additional OAuth scopes or optional repository/account/organization permissions. Public-resource reads use GitHub App user authorization's implicit public access. Verify GraphQL and REST queries with mocked tests; record any actual endpoint restrictions as coverage limitations.
- Keep token expiration enabled; no client secret, private key, installation token, webhook, deployment, or mandatory `.env` is required.
- Device Flow must respect pending, slow-down, denial, expiration, timeout, and cancellation states. Browser opening must have a manual URL/code fallback.
- Development explicit scans retain authentication precedence: `GITHUB_TOKEN`, existing `gh` auth, OS-stored GitRanked access token, anonymous; interactive anonymous ignores all of these.
- Authentication improves discovery availability and limits, not the meaning of the score or certainty about historical coverage.

## Acceptance

Offline tests must exercise both wizard routes, anonymous credential bypass, authenticated identity selection, browser success/fallback, cancellation, Device Flow polling and expiry, token-safe progress and reports, expired saved credentials, non-TTY behavior, and preservation of explicit commands. Run lint, strict typecheck, tests, build, and package inspection before delivery. Commit completed logical increments with Conventional Commits; do not push.

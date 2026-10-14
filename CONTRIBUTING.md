# Contributing

Use Node 22.12+ and Git 2.28+. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `npm run fixture` recreates the labeled synthetic report and local preview; inspect the PNG when changing rendering. CI must run without internet access during tests or any GitHub credentials.

Use strict TypeScript and small Conventional Commits (`feat(scope): describe change`, `fix(scope): describe change`, `test(scope): describe change`). Keep score functions pure and retain full internal precision. Version scoring/audit behavior changes and document threshold assumptions. Preserve public-source provenance; never guess missing activity or match commit authors by name/email alone. Report incomplete discovery and failed analyses rather than treating them as zero activity.

Add meaningful local Git fixtures or mocked API cases for changed behavior. Don't commit tokens, client secrets or private keys, downloaded repositories, caches, build output, or live profile reports. Synthetic fixtures must carry `fixture: true`. Depend on GitHub APIs/public remotes only for scans. Rendering must remain offline and use openly licensed assets.

Authentication changes must retain environment/CLI/anonymous fallbacks, exclude private activity, and keep default interactive session credentials only in memory. Only explicit saved login may use supported OS secret storage; never retain refresh tokens. Forced anonymous scans must bypass every credential source. Optional login must not become a core prerequisite. Network errors/logging must not include provider response bodies, request authorization headers, or child stderr that can contain credentials.

Use issues/PRs to explain the user-visible problem, final behavior, limitations, and relevant validation. No automated test should require a real GitHub App or ask contributors for credentials.

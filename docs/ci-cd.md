# CI/CD

> **Status:** workflow files are syntax-checked as YAML and every command they run was executed locally (see [testing.md](testing.md)), but **no GitHub Actions run has happened**. Expect to fix small issues on the first run.

## Workflows

| File                                | Trigger                           | Purpose                                                              |
| ----------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `.github/workflows/ci.yml`          | pull requests, pushes to `main`   | Quality gates, tests, scans, image builds                            |
| `.github/workflows/codeql.yml`      | PRs, `main`, weekly               | Static analysis (`security-extended` queries, JavaScript/TypeScript) |
| `.github/workflows/deploy.yml`      | after green CI on `main`; release | Entry point: staging after CI, production on a published release     |
| `.github/workflows/_deploy-env.yml` | called by `deploy.yml`            | Build/push, migrate (Cloud Run Job), deploy, smoke test, rollback    |
| `.github/dependabot.yml`            | weekly                            | npm, Docker and **GitHub Actions** updates (keeps pinned SHAs fresh) |

## CI jobs

| Job                | What it runs                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `quality`          | `npm ci` (lockfile) → Prettier check → ESLint → TypeScript (shared, API, web) → unit tests                                       |
| `api-integration`  | PostgreSQL 16 service → **`prisma migrate deploy`** → **schema drift check** → integration tests with coverage → upload coverage |
| `e2e`              | Build → Playwright (Chromium) against the real API + built web app + PostgreSQL; uploads report on failure                       |
| `dependency-audit` | `audit-ci` (fails on HIGH/CRITICAL except the reviewed allowlist) and dependency review on PRs                                   |
| `secret-scan`      | gitleaks over full history                                                                                                       |
| `trivy-fs`         | Trivy filesystem scan (vulnerabilities, secrets, misconfiguration), HIGH/CRITICAL fail                                           |
| `build-images`     | Builds API and web images, Trivy image scan (HIGH/CRITICAL, unfixed ignored)                                                     |
| `summary`          | Writes a results table to the run summary                                                                                        |

Every job has a `timeout-minutes`, top-level `permissions: contents: read`, and the workflow uses `concurrency` to cancel superseded runs. Required checks should be enforced with branch protection (list in [deployment.md](deployment.md)).

## Pin actions to commit SHAs (required before relying on this pipeline)

The workflows use version tags (`actions/checkout@v4.2.2`) because commit SHAs could not be looked up from the authoring sandbox (GitHub's API returned 403) and **SHAs must never be guessed**. Pin them from a machine with internet access:

```bash
GITHUB_TOKEN=<a fine-grained token with no scopes> python3 scripts/pin-actions.py
git diff .github/workflows        # review: each `uses:` becomes owner/repo@<40-hex> # <tag>
```

Dependabot's `github-actions` ecosystem then proposes SHA updates with changelogs.

## The two things CI verifies that the authoring sandbox could not

1. **Real Prisma migrations:** `npm run db:migrate` runs `prisma migrate deploy`; `npm run db:drift-check` runs `prisma migrate diff … --exit-code` and fails if `schema.prisma` and the committed migrations disagree. If the drift check fails, run `npx prisma migrate dev` locally, review the generated migration, and commit it. (The exact `migrate diff` flags changed between Prisma versions; if the script errors on flag names, adjust it to the installed CLI's `--help`.)
2. **Container builds and scans:** Docker image builds and Trivy image scans.

## Local equivalents

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:unit
npm run test:api            # needs PostgreSQL + TEST_DATABASE_URL
npm run build && npm run test:e2e
npm run audit
```

# Implementation status

Last updated: 2026-10-10. Evidence for each claim is in [testing.md](testing.md).

## Phases

- [x] **1. Environment inspection and plan.** Findings: no Docker/Redis/Trivy/gh; PostgreSQL 16 installable via apt; Prisma engine host blocked.
- [x] **2. Repository, manifests, env template, schema, Docker files.** Docker/Compose files written but **not built**.
- [x] **3. Migrations, seed, backend foundation, health, validation, errors, authentication.** Migrations hand-written (see deviations).
- [x] **4. Catalogue, search, categories, cart, wishlist, inventory.**
- [x] **5. Checkout, transactional order creation, payment adapter (mock), webhooks, order history.**
- [x] **6. Complete frontend connected to the real API.**
- [x] **7. Administration, reviews, audit logs, access controls.**
- [x] **8. Unit, integration, E2E and security tests** — all executed (see testing.md).
- [x] **9. CI/CD, scanning, deployment configuration, rollback docs.** Written and YAML-validated; **never executed**.
- [x] **10. Full verification pass, documentation, demonstration screenshots.**

## Verified (actually run)

Prettier, ESLint, TypeScript, 20 + 18 unit tests, 70 integration tests against PostgreSQL (86 % statement coverage), 9 Playwright tests (including a run through a real nginx with the production CSP), production build, compiled-server production-mode smoke test, `audit-ci` gate, Mermaid diagram rendering.

## Deviations from the brief (and why)

| Brief                                 | What was done                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma migrations                     | SQL written by hand in Prisma's folder format + fallback runner, because `binaries.prisma.sh` was unreachable. CI runs real `migrate deploy` + drift check. |
| Real test-mode payment provider       | Mock adapter only (no credentials available); it uses the real signed-webhook code path. Razorpay/Stripe not implemented.                                   |
| Email verification/reset              | Flows work end to end with a dev-only in-memory outbox; no SMTP/SES transport.                                                                              |
| Safe image upload via object storage  | Not implemented; admin supplies validated `https://` or `/products/*` URLs.                                                                                 |
| Pin Actions to full commit SHAs       | Not done (GitHub API unreachable from the sandbox, and SHAs must not be guessed); `scripts/pin-actions.py` + Dependabot provided.                           |
| Redis-optional                        | Not used; rate limits are per process.                                                                                                                      |
| `packages/shared`, `tests/e2e` layout | `e2e/` at the repo root; Prisma lives in `apps/api/prisma`.                                                                                                 |
| Controllers/repositories layers       | Route files act as thin controllers; Prisma is the data layer.                                                                                              |
| Tailwind                              | v3 (v4 migration would remove a dev-tooling advisory chain).                                                                                                |

## Open items (next session)

1. Run the CI pipeline on GitHub; fix whatever the first run reveals; run `python3 scripts/pin-actions.py`.
2. Run `npm run db:migrate` + `npm run db:drift-check` with real Prisma; commit any drift fix via `prisma migrate dev`.
3. Build and run the Docker images; run Trivy; fix findings.
4. Implement an email transport and a real payment-provider adapter (hosted checkout; no card data in scope).
5. Add a scheduled job to cancel unpaid orders and release stock, and a retention/purge job.
6. Shared rate-limit store; MFA; accessibility audit (axe + manual); more browser tests (reviews, wishlist, admin forms).
7. Migrate to Tailwind 4 and remove the `braces` allowlist entry.

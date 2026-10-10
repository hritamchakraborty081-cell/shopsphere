# Testing

## How to run

```bash
npm run test:unit                          # API unit + web unit/component tests (no database)
npm run test:api                           # API integration tests (needs PostgreSQL + TEST_DATABASE_URL)
npm run test:coverage -w @shopsphere/api   # integration tests with coverage (apps/api/coverage)
npm run build && npm run test:e2e          # Playwright (needs E2E_DATABASE_URL and `npx playwright install chromium`)
```

Test isolation: integration tests refuse to run unless `TEST_DATABASE_URL` points to a database whose name contains `test`; the schema is recreated once per run and every test file truncates all tables before each test. E2E uses its own database (`E2E_DATABASE_URL`) that is recreated and seeded before the run.

## Results recorded when this repository was produced

Environment: Ubuntu 24.04 sandbox, 1 CPU, Node 22.22.2, npm 10.9.7, PostgreSQL 16 (apt), Playwright 1.56.0 with Chromium 1194, Vitest 5.0.3, Vite 8.3.4. Run on 2026-10-10.

| Suite                           | Command                                | Result                                                                       |
| ------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| Prettier                        | `npx prettier --check .`               | all files formatted                                                          |
| ESLint                          | `npx eslint .`                         | 0 errors, 0 warnings                                                         |
| TypeScript                      | `npm run typecheck` (+ e2e `tsc`)      | clean                                                                        |
| API unit                        | `npm run test:unit -w @shopsphere/api` | **20 / 20 passed** (2 files)                                                 |
| Web unit + component            | `npm test -w @shopsphere/web`          | **18 / 18 passed** (2 files)                                                 |
| API integration (PostgreSQL)    | `npm run test:integration -w …/api`    | **70 / 70 passed** (8 files)                                                 |
| Browser E2E (Chromium)          | `npm run test:e2e`                     | **9 passed**, 2 skipped (opt-in screenshot capture)                          |
| Production build                | `npm run build`                        | success (shared, Prisma generate, API `tsc`, web bundle)                     |
| Dependency audit gate           | `npm run audit`                        | passed (3 allowlisted dev-tooling advisories, justified in `audit-ci.jsonc`) |
| Compiled API in production mode | `node dist/server.js` with prod env    | served products; `/dev/outbox` and `/docs` returned 404; HSTS present        |
| Web under production nginx CSP  | Playwright through real nginx 1.24     | full journey passed, **0 CSP violations**                                    |

Coverage of the API integration run (`src/**` excluding generated code and `server.ts`): **86.43 % statements, 75.73 % branches, 87.5 % functions, 88.77 % lines**.

### Notable defects found by these tests during development (and fixed)

- `requireAuth` in two routers was mounted at the API root and intercepted unrelated routes (404/validation became 401) → guards scoped to their own path prefixes.
- Vitest/React/test-tooling version hoisting conflicts, a Mermaid sequence diagram that did not parse, a CSP-sensitive mobile filter panel that hid products, and a deploy workflow that made the API private while nginx called it publicly were all found by running or rendering the artefacts rather than by reading them.

## Acceptance criteria → tests

| Requirement                                    | Test(s)                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Register, log in, log out                      | `auth.test.ts` (registration + verification, login/logout), E2E shopping journey                                    |
| Invalid credentials rejected                   | `auth.test.ts` (wrong password/unknown user identical), lockout test                                                |
| Expired and revoked sessions rejected          | `auth.test.ts` (expired, idle-timeout, revoked, forged cookie)                                                      |
| Reset tokens expire and cannot be reused       | `auth.test.ts` (password reset block: reuse, expiry, superseded, hashed at rest)                                    |
| Customer cannot access admin endpoints         | `authz.test.ts` (every admin route 401/403), E2E admin test                                                         |
| Cannot read/modify another customer's data     | `authz.test.ts` (addresses, orders cancel/pay/read, address-in-order), `users-cart.test.ts` (cart/wishlist privacy) |
| Product validation and pagination              | `catalog.test.ts`, `admin.test.ts` (product validation)                                                             |
| Invalid quantities / out-of-stock rejected     | `checkout.test.ts` (cart validation), `users-cart.test.ts`                                                          |
| Client-manipulated prices ignored              | `checkout.test.ts` (tamper test, server-computed subtotal, snapshot test)                                           |
| Concurrent checkouts cannot oversell           | `checkout.test.ts` ("overselling prevention" — 6 parallel buyers of 1 unit; 5 buyers × 3 of 10)                     |
| Duplicate webhooks do not duplicate fulfilment | `checkout.test.ts` (3 concurrent identical events, re-sent event, late success)                                     |
| Reviews require eligibility and authorisation  | `reviews.test.ts`                                                                                                   |
| Rate limits and security middleware            | `security.test.ts` (login/register/reset 429, headers, CORS, 413, 415, request ids)                                 |
| Errors do not leak secrets                     | `security.test.ts`, `security-units.test.ts` (env + log redaction)                                                  |
| Main user journey in a real browser            | `shopping-journey.spec.ts`                                                                                          |

## What was **not** tested

- Docker image builds, `docker compose up`, the nginx **container** (config was tested with a host nginx), Trivy, CodeQL, gitleaks, and every GitHub Actions workflow run.
- `prisma migrate dev/deploy` and the schema drift check (Prisma's engine binary could not be downloaded; migrations were applied by a fallback SQL runner).
- Real email delivery, a real payment provider, deployment to any cloud.
- Accessibility with axe or a screen reader; browsers other than Chromium; real mobile devices; load/performance testing; penetration testing.
- Browser tests do not cover the review form, wishlist toggling, address deletion, or admin product creation through the UI (these are covered at the API level only).

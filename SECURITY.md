# Security Policy

ShopSphere is a portfolio/educational project. It is designed with OWASP ASVS and the OWASP Top 10 as references, but it has **not** been independently audited and makes **no claim of formal compliance or certification**.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

1. Use GitHub's private "Report a vulnerability" (Security → Advisories) on the repository, or email `security@your-domain.example` (placeholder: replace with a mailbox you control before publishing).
2. Include: affected endpoint/page, steps to reproduce, impact, and any proof-of-concept. Do not include real personal data.
3. Expected handling: acknowledgement within 3 working days, triage within 7, fix or mitigation plan within 30 days for high-severity issues. You will be credited unless you prefer otherwise.
4. Please do not run automated scanners against a shared deployment or access data that is not yours.

## Supported versions

Only the latest commit on `main` is supported.

## Security controls (what exists, and how it is verified)

| #   | Control                                                                                                       | Where                                   | Verified by                                                         |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| 1   | Parameterised queries only (Prisma; two audited `$executeRaw` tagged templates, never string-built)           | `orders.service.ts`                     | injection-style search test, code review                            |
| 2   | Safe rendering: React escapes output; no `dangerouslySetInnerHTML`; strict CSP on web (nginx) and API         | `apps/web`, `infra/nginx.conf.template` | E2E CSP test (0 violations under nginx), integration header tests   |
| 3   | Session cookie `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production; only SHA-256 stored     | `middleware/auth.ts`                    | auth tests, E2E cookie test                                         |
| 4   | CSRF: JSON-only bodies, Origin allow-list, per-session token (`X-CSRF-Token`)                                 | `middleware/auth.ts`                    | CSRF tests (missing/bad token, foreign origin, form post)           |
| 5   | Server-side RBAC on every admin route; ownership in every private query (IDOR/BOLA)                           | `admin.routes.ts`, services             | authz tests (customer→admin 403, cross-user address/order 404)      |
| 6   | Rate limits: global, auth, login (per IP+email), register, reset, checkout                                    | `middleware/rateLimit.ts`               | rate-limit tests (429)                                              |
| 7   | Brute-force defence: lockout after 5 failures (15 min), uniform error + timing                                | `auth.service.ts`                       | lockout test, same-response test                                    |
| 8   | Strict CORS allow-list; Helmet; body limit 100 kB; JSON content-type enforcement                              | `app.ts`                                | CORS, 413, 415 tests                                                |
| 9   | Verification/reset tokens: 256-bit random, hashed at rest, expiring, single-use (compare-and-set)             | `auth.service.ts`                       | reuse/expiry/superseded tests                                       |
| 10  | Argon2id (19 MiB, t=2, p=1); passwords ≥ 12 chars with letters+digits and a small denylist                    | `auth.service.ts`, `auth.schemas.ts`    | hash-format test, policy unit tests                                 |
| 11  | Mass-assignment protection: Zod `.strict()` on every body                                                     | all `*.routes.ts`                       | role-smuggling, userId-smuggling, price-tampering tests             |
| 12  | Server-authoritative money: totals computed on the server from DB prices, integer paise                       | `pricing.ts`, `orders.service.ts`       | tamper test, pricing unit tests                                     |
| 13  | Oversell prevention: atomic conditional `UPDATE … WHERE quantity >= n` + `CHECK (quantity >= 0)`              | `orders.service.ts`, migration          | two concurrency tests with parallel checkouts                       |
| 14  | Payment webhooks: HMAC-SHA256 over raw body, constant-time compare, 5-min replay window, idempotency ledger   | `orders.service.ts`                     | signature, replay, duplicate, concurrent-duplicate tests            |
| 15  | Idempotent order creation (`Idempotency-Key`, unique `(userId,key)`)                                          | `orders.service.ts`                     | replay test                                                         |
| 16  | Audit log for auth and admin actions; log redaction of cookies, tokens, passwords, emails, addresses          | `services/audit.ts`, `utils/logger.ts`  | audit assertions, redaction unit test                               |
| 17  | Safe errors: uniform JSON, no stack/secrets in production; env validation never echoes values                 | `errorHandler.ts`, `config/env.ts`      | error-shape and env unit tests                                      |
| 18  | Production guards: refuses to boot with dev outbox on, insecure cookies, or placeholder webhook secret        | `config/env.ts`                         | env unit tests; compiled server run in production mode              |
| 19  | Admin-supplied image URLs restricted to `https://` or `/products/*` (no `javascript:`/`data:`); never fetched | `admin.routes.ts`                       | URL rejection test (SSRF not applicable: server never fetches URLs) |
| 20  | Open-redirect protection for post-login navigation                                                            | `apps/web/src/lib/api.ts`               | unit tests                                                          |
| 21  | Dependency and supply-chain gates: `audit-ci`, Dependabot, CodeQL, gitleaks, Trivy (defined in CI)            | `.github/workflows`                     | audit gate run locally; CI jobs **not yet executed**                |

## Threat model

See [docs/threat-model.md](docs/threat-model.md) (assets, trust boundaries, entry points, threats, mitigations, residual risks, ASVS reference table).

## Known limitations and residual risks

- Not independently reviewed or penetration-tested. No formal ASVS verification.
- Rate limiting is per process (in memory). Behind multiple instances an attacker's budget multiplies; use a shared store.
- No MFA, CAPTCHA, breached-password lookup, or device/session management UI.
- Email delivery is not implemented (dev outbox only); in production, verification/reset links are not sent.
- Payments are mock-only. A real provider integration needs its own review (webhook secret rotation, refunds, reconciliation, PCI scope via hosted checkout).
- No file upload (images are URLs), so malware scanning/content-type sniffing for uploads is not exercised.
- Session ids are not bound to IP/device. Stolen cookies work until expiry/revocation.
- Data-retention and backup procedures are documented but not automated here ([docs/deployment.md](docs/deployment.md)).
- Container images, CI pipelines and the deployment workflow have not been executed or scanned yet.
- Dev-tooling advisories are allowlisted in `audit-ci.jsonc` with written justification; review them on every dependency update.

## Remediation guidance (for maintainers)

1. **Reproduce** with a failing integration test in `apps/api/tests/integration/` (add the test first).
2. **Fix** at the lowest layer that makes the bug impossible (database constraint → service → route).
3. **Rotate secrets** if exposure is possible: `PAYMENT_WEBHOOK_SECRET`, database credentials; revoke sessions with `UPDATE "Session" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;`.
4. **Release** via the normal pipeline; note the fix in the release notes and credit the reporter.
5. **Review** `audit-ci.jsonc` allowlist entries after any dependency change.

## Security verification checklist (run before each release)

- [ ] `npm run audit` passes; allowlist entries re-justified
- [ ] CI green: CodeQL, gitleaks, Trivy (fs + images)
- [ ] `npm run test:api` and `npm run test:e2e` pass; new endpoints have authz + validation tests
- [ ] Production env: `NODE_ENV=production`, `COOKIE_SECURE=true`, `ENABLE_DEV_OUTBOX=false`, `ENABLE_DOCS` intentional, strong `PAYMENT_WEBHOOK_SECRET`
- [ ] Application DB role has no DDL rights; migrations run with a separate role
- [ ] TLS terminates with HSTS at the load balancer; `TRUST_PROXY` matches the real proxy count
- [ ] Backups configured and a restore has been rehearsed
- [ ] `GET /api/v1/dev/outbox` and `/api/v1/docs` return 404 in production

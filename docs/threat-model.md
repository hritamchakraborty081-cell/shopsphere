# Threat model

Method: lightweight STRIDE over the data-flow in [architecture.md](architecture.md). Scope: the web app, API, database and CI/CD. Out of scope: the cloud provider and the (mock) payment provider internals.

## Assets

| Asset                                       | Why it matters                  |
| ------------------------------------------- | ------------------------------- |
| Customer accounts and sessions              | Account takeover, privacy       |
| Passwords and reset/verify tokens           | Credential theft                |
| Personal data (name, email, phone, address) | Privacy, regulatory exposure    |
| Orders and payment state                    | Financial integrity, fraud      |
| Inventory and prices                        | Revenue integrity, overselling  |
| Admin capabilities and audit log            | Privilege abuse, accountability |
| Secrets (DB URL, webhook secret)            | Full compromise                 |
| CI/CD pipeline and artifacts                | Supply-chain compromise         |

## Trust boundaries

1. Browser ↔ nginx/API (untrusted network and client; everything from the client is hostile).
2. API ↔ PostgreSQL (private network; least-privilege role).
3. Payment provider ↔ API webhook endpoint (untrusted sender until the signature verifies).
4. GitHub ↔ cloud environment (OIDC-federated, short-lived credentials).
5. Developer machine/CI runner ↔ package registries (supply chain).

## Entry points

Public: `/auth/*`, `GET /products*`, `GET /categories`, `POST /support/messages`, `POST /payments/webhook/mock`, health endpoints. Authenticated: cart, wishlist, orders, profile, reviews. Admin: `/admin/*`. Operational: CI workflows, deployment, container registry.

## Threats and mitigations

| ID  | Threat (STRIDE)                                       | Mitigation                                                                                                  | Residual risk                                                             |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| T1  | Credential stuffing / brute force (S)                 | Per IP+email limiter, lockout, Argon2id, uniform errors/timing                                              | No MFA/CAPTCHA; distributed attacks can slow-roll                         |
| T2  | Account enumeration (I)                               | Generic register/forgot/login responses; dummy hash verification                                            | Timing of email delivery not equalised                                    |
| T3  | Session theft (S/E)                                   | HttpOnly, SameSite, `__Host-`, hashed ids, revocation, idle+absolute expiry; no tokens in JS                | Cookie theft via malware/MITM TLS misconfig                               |
| T4  | CSRF (T)                                              | JSON-only, Origin allow-list, per-session token, SameSite=Lax                                               | Subdomain takeover of an allowed origin                                   |
| T5  | XSS (T/I)                                             | React escaping, no raw HTML sinks, CSP (`script-src 'self'`), no inline handlers, JSON `nosniff`            | Third-party script added later; CSP relaxations                           |
| T6  | SQL injection (T)                                     | Prisma parameterisation; Zod validation; raw SQL only via tagged templates                                  | Future raw queries must follow the same rule                              |
| T7  | IDOR/BOLA on orders, addresses, cart (I/E)            | Owner is part of every query; foreign ids look like 404                                                     | New endpoints must copy the pattern (test it)                             |
| T8  | Privilege escalation to admin (E)                     | `requireRole` on router; role change revokes sessions; no self-change; last-admin guard; `.strict()` bodies | A compromised admin account has full power                                |
| T9  | Price/total tampering (T)                             | Server computes all money; order bodies reject unknown fields; DB CHECK constraints                         | Pricing bugs (covered by unit tests)                                      |
| T10 | Overselling via races (T/D)                           | Atomic conditional UPDATE + CHECK constraint; consistent lock order                                         | Stock reserved for unpaid orders until cancelled — no auto-expiry job yet |
| T11 | Duplicate orders / duplicate payments (T)             | `Idempotency-Key`; webhook ledger with unique `(provider,eventId)`; compare-and-set status transitions      | Real provider needs reconciliation job                                    |
| T12 | Forged payment webhook (S/T)                          | HMAC over raw body, constant-time compare, timestamp window                                                 | Secret leakage → rotate; no key-rotation overlap                          |
| T13 | Token replay (reset/verify) (S)                       | Hashed, expiring, single-use via conditional update; newer reset invalidates older                          | Emailed links can be forwarded by the user                                |
| T14 | DoS: large bodies, deep pagination, heavy queries (D) | 100 kB limit, pageSize ≤ 48, validated filters, global rate limit                                           | Substring search on large catalogues needs an index/FTS                   |
| T15 | Information leakage via errors/logs (I)               | Uniform errors, no stack in prod, log redaction, env errors omit values                                     | Logs may still hold IDs; restrict access                                  |
| T16 | Malicious product image URL (T)                       | Only `https://` or `/products/*`; server never fetches (no SSRF); CSP `img-src 'self' data: https:`         | Tracking via third-party image host                                       |
| T17 | Open redirect (S)                                     | Same-site relative redirects only                                                                           | —                                                                         |
| T18 | Repudiation of admin actions (R)                      | Audit log for admin/auth events with actor and entity                                                       | Audit table is writable by the app role; ship logs off-box                |
| T19 | Vulnerable/malicious dependencies (T)                 | Lockfile, `npm ci`, audit-ci, Dependabot, pinned base images; (SHA pinning pending)                         | Zero-day and registry compromise                                          |
| T20 | CI/CD compromise, secret exfiltration (E)             | Least-privilege `permissions`, OIDC (no long-lived keys), environment approvals, gitleaks                   | Unexecuted pipeline; unpinned actions until script run                    |
| T21 | Dev-only features exposed in production (I)           | Startup refuses `ENABLE_DEV_OUTBOX` and insecure cookies in production; docs off by default                 | Misconfigured platform env vars could still enable docs                   |

## ASVS reference table (not a compliance claim)

Status legend: ✅ implemented and covered by an automated test · 🟡 implemented, not directly tested or partial · ❌ not implemented.

| ASVS 4.0.3 area                               | Representative requirements                                              | Status | Notes                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| V2.1 Password security                        | min 12 chars, max ≥ 64, no composition-only rules, common-password check | 🟡     | 12–128 chars; also requires letter+digit (a composition rule ASVS discourages); small denylist only, no breached-password API |
| V2.2 / V2.5 General authenticators & recovery | anti-automation, secure recovery, single-use tokens                      | ✅     | Throttling, lockout, hashed single-use expiring tokens                                                                        |
| V2.7+ MFA                                     | multi-factor options                                                     | ❌     | Not implemented                                                                                                               |
| V3.2–V3.4 Session management                  | unique random ids, hashed storage, logout, timeouts, cookie attributes   | ✅     | Absolute and idle timeout, revoke-all on reset/role change                                                                    |
| V4.1–V4.2 Access control                      | server-side enforcement, deny by default, IDOR protection                | ✅     | RBAC + ownership tests                                                                                                        |
| V5.1 / V5.3 Validation & encoding             | schema validation, parameterised queries, output encoding                | ✅     | Zod strict; Prisma; React escaping                                                                                            |
| V7.1 / V7.4 Logging & error handling          | no secrets in logs, generic errors                                       | ✅     | Redaction and error-shape tests                                                                                               |
| V8 Data protection                            | sensitive data minimisation, caching headers                             | 🟡     | `Cache-Control: no-store` on API; no field-level encryption; retention is documented only                                     |
| V9 Communications                             | TLS everywhere, HSTS                                                     | 🟡     | HSTS set by API in production; TLS termination is deployment-specific and untested                                            |
| V11 Business logic                            | sequential flows, limits, idempotency                                    | ✅     | Order state machine, quantity limits, idempotent checkout/webhooks                                                            |
| V12 Files                                     | upload validation                                                        | ❌     | No uploads implemented                                                                                                        |
| V13 API                                       | schema validation, CORS, content-type, rate limits                       | ✅     | JSON-only, strict CORS, limits                                                                                                |
| V14 Configuration                             | hardened config, headers, dependency checks                              | 🟡     | Headers/guards tested; CI scanners defined but not yet run                                                                    |

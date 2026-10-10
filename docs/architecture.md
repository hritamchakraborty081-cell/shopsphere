# Architecture

## System context

```mermaid
flowchart TB
  subgraph Client
    B[Browser: React SPA<br/>TanStack Query, React Router]
  end
  subgraph Edge["Web container (nginx-unprivileged)"]
    N[Static assets + SPA fallback<br/>CSP + security headers<br/>/api reverse proxy]
  end
  subgraph App["API container (Node 22, non-root)"]
    direction TB
    L[Request ID + pino logging]
    H[Helmet, CORS, global rate limit]
    J[JSON parser 100 kB, content-type guard]
    S[Session loader<br/>cookie -> SHA-256 -> Session row]
    C[CSRF: Origin allow-list + X-CSRF-Token]
    R[Routers: Zod validation, requireAuth,<br/>requireRole, ownership checks]
    V[Services: auth, catalog, cart, orders,<br/>payments, reviews, admin, audit]
    L --> H --> J --> S --> C --> R --> V
  end
  DB[(PostgreSQL 16<br/>sessions, catalogue, orders, audit)]
  PP[Payment provider<br/>MOCK adapter]
  CI[GitHub Actions<br/>CI, CodeQL, Trivy, gitleaks, deploy]
  REG[(Artifact Registry)]
  B -->|HTTPS same origin| N
  N -->|/api/v1| L
  V --> DB
  V <-->|signed webhook, HMAC-SHA256| PP
  CI -->|build + scan + test| REG
  CI -->|OIDC, migrate job, deploy| App
  CI --> Edge
```

## Why these decisions

| Decision                                                   | Reason                                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-side sessions in PostgreSQL (no JWT, no Redis)      | Instant revocation (logout, password reset, role change), no token in `localStorage`, one fewer service to run. Cost: a DB read per request (indexed on a unique hash). |
| Same-origin deployment (nginx proxies `/api`)              | Lets `SameSite=Lax` HttpOnly cookies and the CSRF design work unchanged in dev (Vite proxy) and prod; avoids wide CORS.                                                 |
| Money as integer paise                                     | No floating-point error; exact comparisons; `CHECK` constraints are simple.                                                                                             |
| Stock decrement as a conditional `UPDATE`                  | Atomic and lock-based; correct under concurrency without serialisable isolation or retries. Proven by parallel-checkout tests.                                          |
| Reserve stock at order creation, release on failure/cancel | The customer sees an order immediately and the item cannot be sold twice; unpaid orders must be cancelled (a timed auto-expiry job is a known gap).                     |
| Webhook ledger table with unique `(provider,eventId)`      | Idempotency independent of application logic; duplicates are harmless even when concurrent.                                                                             |
| Zod `.strict()` at every boundary                          | Validation and mass-assignment protection in one declaration.                                                                                                           |
| Hand-written SQL migrations in Prisma's folder format      | Prisma's engine download was blocked where this was built; CI runs `prisma migrate deploy` and a drift check to prove they match the schema.                            |
| Mock payment adapter behind the real webhook path          | The "pay" button sends a **signed event through the same handler** a provider would call, so paid-state logic is exercised honestly.                                    |

## Request lifecycle: checkout

```mermaid
sequenceDiagram
  participant U as Browser
  participant A as API
  participant D as PostgreSQL
  participant P as Payment provider (mock)
  U->>A: POST /checkout/quote (cart is server-side)
  A->>D: read cart + current prices
  A-->>U: totals computed on server
  U->>A: POST /orders (Idempotency-Key, addressId, method, coupon)
  A->>D: BEGIN
  A->>D: lock-order: UPDATE Inventory SET qty = qty - n WHERE qty >= n (per item)
  A->>D: INSERT Order + OrderItems (snapshot) + Payment(PENDING) + history, clear cart
  A->>D: COMMIT
  A-->>U: 201 order (PENDING_PAYMENT)
  U->>A: POST /orders/:id/pay/mock (dev only)
  A->>P: (simulated) provider emits signed event
  P->>A: POST /payments/webhook/mock (x-signature)
  A->>A: verify HMAC over raw body, timestamp window
  A->>D: BEGIN, INSERT WebhookEvent ON CONFLICT DO NOTHING
  A->>D: compare-and-set Payment PENDING->SUCCEEDED, Order PENDING_PAYMENT->PAID, COMMIT
  A-->>U: order status PAID (never from a client redirect)
```

## Module layout (API)

`src/modules/<domain>/` holds `*.routes.ts` (HTTP, validation, authorisation), `*.service.ts` (business rules and transactions) and `*.schemas.ts` (Zod). Cross-cutting code lives in `middleware/`, `config/`, `services/` (audit, mailer), `utils/`. Controllers are folded into route files (handlers are one-liners calling services) to avoid a pass-through layer; repositories are not used because Prisma already provides a typed data layer.

## Dependency summary

- **Runtime (API):** express, helmet, cors, express-rate-limit, cookie-parser, zod, pino/pino-http, `@node-rs/argon2` (prebuilt native Argon2id), `@prisma/client` + `@prisma/adapter-pg` + `pg`, swagger-ui-express.
- **Runtime (web, bundled):** react, react-dom, react-router, @tanstack/react-query, react-hook-form, @hookform/resolvers, zod, lucide-react.
- **Dev/CI:** typescript, vite, vitest, supertest, Testing Library, Playwright, ESLint, Prettier, tailwindcss, prisma CLI, audit-ci.

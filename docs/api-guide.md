# API guide

Base path `/api/v1`. Interactive reference: `/api/v1/docs` (when `ENABLE_DOCS=true`). JSON only (`Content-Type: application/json`).

## Conventions

- **Errors:** `{"error":{"code":"VALIDATION_ERROR","message":"…","requestId":"…","details":[{"path":"quantity","message":"…"}]}}`. `details` lists field paths/messages only — never submitted values. Send `X-Request-Id` to correlate logs (generated if absent).
- **Status codes:** 200/201/202/204 success · 400 malformed JSON or bad token · 401 unauthenticated · 403 forbidden (RBAC, CSRF, unverified email) · 404 not found (also for other users' resources) · 409 conflict (stock, duplicates, invalid transition) · 413 body too large · 415 wrong content type · 422 validation · 429 rate limited · 503 dependency unavailable.
- **Pagination:** `page` (≥1) and `pageSize` (1–48, default 12). Responses include `total`, `totalPages`.
- **Money:** integer **paise** (`priceMinor: 129900` = ₹1,299.00).

## Authentication flow

```bash
BASE=http://localhost:4000/api/v1
ORIGIN=http://localhost:5173          # must be listed in CORS_ORIGINS

# 1) log in: sets an HttpOnly cookie and returns the CSRF token
curl -c jar -s -X POST $BASE/auth/login -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d '{"email":"customer@shopsphere.test","password":"<SEED_DEMO_PASSWORD>"}'
# => {"user":{...},"csrfToken":"<token>"}

# 2) read requests need only the cookie
curl -b jar -s $BASE/cart

# 3) mutating requests also need Origin + X-CSRF-Token
curl -b jar -s -X POST $BASE/cart/items -H "Origin: $ORIGIN" -H "X-CSRF-Token: <token>" \
  -H 'Content-Type: application/json' -d '{"productId":"<uuid>","quantity":1}'
```

`GET /auth/me` returns the current user and CSRF token (`user: null` when signed out) — the SPA calls it on load.

## Endpoints

| Area      | Endpoint                                                                                                                                                                                                                                                                | Auth      | Notes                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| Health    | `GET /health`, `GET /ready`                                                                                                                                                                                                                                             | none      | `/ready` checks the database                                                 |
| Auth      | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`                                                                                                                                                                                                | none      | Register returns a generic 202 (no enumeration)                              |
|           | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`                                                                                                                                                                                                                 | none/user | Login throttled per IP+email                                                 |
|           | `POST /auth/forgot-password`, `POST /auth/reset-password`                                                                                                                                                                                                               | none      | Reset revokes all sessions                                                   |
| Users     | `GET/PATCH/DELETE /users/me`, `POST /users/me/password`                                                                                                                                                                                                                 | user      | DELETE deactivates (soft)                                                    |
|           | `GET/POST /users/me/addresses`, `PATCH/DELETE /users/me/addresses/:id`                                                                                                                                                                                                  | user      | Max 10; owner-scoped                                                         |
| Catalogue | `GET /categories`, `GET /products`, `GET /products/:slug`                                                                                                                                                                                                               | none      | Filters: `q, category, minPrice, maxPrice (paise), minRating, inStock, sort` |
| Reviews   | `GET /products/:id/reviews`, `GET …/review-eligibility`, `POST /products/:id/reviews`                                                                                                                                                                                   | none/user | Requires a **DELIVERED** order; one review per product                       |
| Cart      | `GET /cart`, `POST /cart/items`, `PATCH/DELETE /cart/items/:productId`                                                                                                                                                                                                  | user      | Max 10 per item, 25 items                                                    |
| Wishlist  | `GET /wishlist`, `PUT/DELETE /wishlist/:productId`                                                                                                                                                                                                                      | user      |                                                                              |
| Checkout  | `POST /checkout/quote`                                                                                                                                                                                                                                                  | user      | Server-computed totals                                                       |
| Orders    | `POST /orders` (header `Idempotency-Key`), `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel`                                                                                                                                                                  | user      | Verified email required to create; cancel only while unpaid                  |
| Payments  | `POST /orders/:id/pay/mock`                                                                                                                                                                                                                                             | user      | **Mock only**; routes through the real webhook handler                       |
|           | `POST /payments/webhook/mock`                                                                                                                                                                                                                                           | HMAC      | Header `x-signature` = hex HMAC-SHA256(secret, raw body)                     |
| Support   | `POST /support/messages`                                                                                                                                                                                                                                                | none      | Rate limited                                                                 |
| Admin     | `GET /admin/stats`, products CRUD + `PATCH …/inventory`, categories CRUD, `GET /admin/orders`, `PATCH /admin/orders/:id/status`, `GET /admin/users`, `PATCH /admin/users/:id/role`, `DELETE /admin/reviews/:id`, `GET /admin/audit-logs`, `GET /admin/support-messages` | ADMIN     | Every route behind `requireRole('ADMIN')`                                    |
| Dev only  | `GET/DELETE /dev/outbox`                                                                                                                                                                                                                                                | none      | 404 unless `ENABLE_DEV_OUTBOX=true` (forbidden in production)                |

## Creating an order (idempotent)

```bash
curl -b jar -s -X POST $BASE/orders -H "Origin: $ORIGIN" -H "X-CSRF-Token: <token>" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"addressId":"<uuid>","shippingMethod":"STANDARD","couponCode":"WELCOME10"}'
```

There are intentionally **no price, total or quantity fields** — unknown fields return 422. Repeating the same `Idempotency-Key` returns the original order (200) without reserving stock again. A 409 `INSUFFICIENT_STOCK` rolls back everything.

## Order status machine

`PENDING_PAYMENT → PAID | CANCELLED` · `PAID → PROCESSING | CANCELLED | REFUNDED` · `PROCESSING → SHIPPED | CANCELLED | REFUNDED` · `SHIPPED → DELIVERED` · `DELIVERED → REFUNDED`. Terminal: `CANCELLED`, `REFUNDED`. Cancelling/refunding before delivery restocks items; payment becomes `REFUNDED` (state only — no provider call).

## Webhook signing (mock provider)

```bash
BODY='{"eventId":"evt_abc12345","type":"payment.succeeded","providerOrderId":"mock_order_…","timestamp":'$(date +%s)'}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -s -X POST $BASE/payments/webhook/mock -H 'Content-Type: application/json' -H "x-signature: $SIG" -d "$BODY"
```

Responses: `{"received":true,"result":"paid|duplicate|noop|failed|ignored|refunded_late"}`. Bad/missing signature → 401; timestamp older than 5 minutes → 400.

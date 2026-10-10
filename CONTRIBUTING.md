# Contributing

Thanks for helping improve ShopSphere. This is a learning/portfolio project; clarity beats cleverness.

## Setup

Follow "Quick start → Option B" in the [README](README.md). Run everything with `npm run lint && npm run format:check && npm run typecheck && npm run test:unit && npm run test:api`.

## Workflow

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Write a failing test first for behaviour changes — especially anything touching authentication, authorisation, money, stock or payments.
3. Keep business logic in `*.service.ts`; routes only validate (Zod), authorise and call services.
4. Run the checks above, then `npx prettier --write .`.
5. Open a pull request. CI must pass (lint, typecheck, unit, integration, E2E, scans). Describe _what_ changed, _why_, and how you verified it. Do not claim something works unless you ran it.

## Conventions

- TypeScript strict; no `any` without a comment. Money is integer paise — never floats.
- Every new endpoint needs: Zod `.strict()` validation, an authorisation decision (public / user / admin), ownership in the query for private data, and tests for the negative cases (401/403/404/422).
- No secrets in code or logs. `.env.example` holds placeholders only.
- Schema changes: edit `schema.prisma`, run `npx prisma migrate dev --name <change>` locally, commit the generated migration, and make sure `npm run db:drift-check -w @shopsphere/api` is clean. Prefer additive/expand-contract migrations.
- Commit messages: imperative mood, e.g. `fix: reject quantities above stock in cart`.

## Security

Never open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).

# syntax=docker/dockerfile:1
# UNVERIFIED in the authoring sandbox (no Docker daemon was available). See docs/testing.md.
ARG NODE_IMAGE=node:22.12.0-bookworm-slim

# ---- build: full deps, prisma client generation, TypeScript compile ----
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci -w @shopsphere/api -w @shopsphere/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @shopsphere/shared \
 && npm run generate -w @shopsphere/api \
 && npm run build -w @shopsphere/api
# This stage also serves as the one-off migration runner: `npx prisma migrate deploy`.
WORKDIR /repo/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production deps only, non-root, minimal ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev -w @shopsphere/api -w @shopsphere/shared --include-workspace-root \
 && npm cache clean --force
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

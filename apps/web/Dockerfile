# syntax=docker/dockerfile:1
# UNVERIFIED in the authoring sandbox (no Docker daemon was available). See docs/testing.md.
ARG NODE_IMAGE=node:22.12.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci -w @shopsphere/web -w @shopsphere/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @shopsphere/shared && npm run build -w @shopsphere/web

# Unprivileged nginx (runs as uid 101, listens on 8080). Config is templated with $API_UPSTREAM.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV API_UPSTREAM=http://api:4000
COPY infra/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

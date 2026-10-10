# Deployment guide

> **Status: not deployed, not executed.** The workflows and commands below were written carefully but never run (the authoring environment had no Docker daemon and no cloud account). Treat every step as "to be verified on your first deployment" and expect small fixes. Local, non-Docker operation _was_ tested end to end.

## 1. Environments and secrets

| Environment  | Trigger                      | Approval                                     | Data                         |
| ------------ | ---------------------------- | -------------------------------------------- | ---------------------------- |
| `staging`    | Green CI run on `main`       | none                                         | Separate database, fake data |
| `production` | Published GitHub **release** | Required reviewers on the GitHub Environment | Production database          |

Keep **test, staging and production credentials separate** (separate databases, separate `PAYMENT_WEBHOOK_SECRET`s). Secrets live in the cloud secret manager and are mounted into the services at deploy time; GitHub stores only non-secret identifiers (repository/environment **variables**).

## 2. One-time Google Cloud setup (reference)

```bash
PROJECT=my-project REGION=asia-south1 REPO=shopsphere
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com
gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION

# Database (per environment)
gcloud sql instances create shopsphere-staging --database-version=POSTGRES_16 --region=$REGION --tier=db-f1-micro --backup-start-time=02:00 --enable-point-in-time-recovery
gcloud sql databases create shopsphere --instance=shopsphere-staging
gcloud sql users create migrator --instance=shopsphere-staging --password="$(openssl rand -base64 24)"   # DDL role
gcloud sql users create app      --instance=shopsphere-staging --password="$(openssl rand -base64 24)"   # DML-only role; GRANT SELECT,INSERT,UPDATE,DELETE …

# Secrets (names are referenced by deploy workflow)
printf '%s' "postgresql://migrator:<pw>@localhost/shopsphere?host=/cloudsql/$PROJECT:$REGION:shopsphere-staging" | gcloud secrets create shopsphere-migrate-db-url-staging --data-file=-
printf '%s' "postgresql://app:<pw>@localhost/shopsphere?host=/cloudsql/$PROJECT:$REGION:shopsphere-staging"      | gcloud secrets create shopsphere-app-db-url-staging --data-file=-
openssl rand -hex 32 | gcloud secrets create shopsphere-webhook-secret-staging --data-file=-
```

Workload Identity Federation (no long-lived keys):

```bash
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github-oidc --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='YOUR_ORG/shopsphere'"
gcloud iam service-accounts create gh-deployer
# grant gh-deployer: roles/run.admin, roles/artifactregistry.writer, roles/iam.serviceAccountUser, roles/cloudsql.client, roles/secretmanager.secretAccessor
gcloud iam service-accounts add-iam-policy-binding gh-deployer@$PROJECT.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/attribute.repository/YOUR_ORG/shopsphere"
```

GitHub → Settings → Environments → create `staging` and `production`; on `production` add **required reviewers** and restrict to protected branches/tags. Add these **variables** to each environment:

| Variable            | Example                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`    | `my-project`                                                                       |
| `GCP_REGION`        | `asia-south1`                                                                      |
| `GCP_ARTIFACT_REPO` | `shopsphere`                                                                       |
| `GCP_WIF_PROVIDER`  | `projects/<n>/locations/global/workloadIdentityPools/github/providers/github-oidc` |
| `GCP_DEPLOY_SA`     | `gh-deployer@my-project.iam.gserviceaccount.com`                                   |
| `GCP_SQL_INSTANCE`  | `shopsphere-staging`                                                               |
| `PUBLIC_URL`        | `https://staging.example.com` (the **web** service URL / custom domain)            |

Also protect the `main` branch: require pull requests, the CI jobs (`quality`, `api-integration`, `e2e`, `dependency-audit`, `secret-scan`, `trivy-fs`, `build-images`) and CodeQL to pass, and disallow force pushes.

## 3. What the workflow does

1. Builds three images (`api` runtime, `migrate` = build stage with the Prisma CLI, `web`) tagged with the **commit SHA** and pushes them to Artifact Registry.
2. Runs migrations as a **Cloud Run Job** (`prisma migrate deploy`) with the DDL-capable secret, `--max-retries 0`, and waits for success. The app role used by the service has no DDL rights.
3. Deploys the API (`NODE_ENV=production`, `COOKIE_SECURE=true`, dev outbox off, docs off, `TRUST_PROXY=2`) and then the web service (`API_UPSTREAM=<api url>`).
4. Smoke tests: `/api/v1/ready`, `/api/v1/health`, product listing, home page, and that `/api/v1/dev/outbox` returns **404**.
5. On failure, routes API traffic back to the previous revision.

**Trade-off:** the API service is public (`--allow-unauthenticated`) because the web service proxies to it over HTTPS. It is protected by its own controls (sessions, CSRF/Origin checks, CORS allow-list, rate limits). For a private API, add a Serverless VPC connector to the web service and set the API ingress to `internal`.

**Before real users:** add an email transport (verification/reset emails are not sent in production), a real payment provider, a shared rate-limit store if you run more than one API instance, and a scheduled job to cancel unpaid orders and release reserved stock.

## 4. Migrations: safe strategy

- Use **additive, expand → migrate → contract** changes. Never ship a migration that drops/renames a column the _currently running_ revision still reads; deploy the code that stops using it first, then drop it in a later release.
- Migrations run **before** the new revision receives traffic; destructive statements require a manual `workflow_dispatch` run or a separate, reviewed release.
- Always test the migration on a restored copy of production (or staging with realistic data) first.
- Prisma migrations are forward-only. Recovery from a bad migration = **restore** (below) or write a new corrective migration.

## 5. Rollback and recovery

| Situation                             | Action                                                                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad code, schema unchanged/compatible | `gcloud run services update-traffic shopsphere-api-<env> --to-revisions <previous>=100` (and the same for web). Fast and safe.                                                                                                                  |
| Bad code, additive migration applied  | Same as above — the old revision tolerates extra columns/tables.                                                                                                                                                                                |
| Bad or destructive migration          | Put the site in maintenance (scale API to 0), restore Cloud SQL **point-in-time recovery** to just before the migration into a new instance, repoint `DATABASE_URL` secrets, redeploy the previous image tag. Rehearse this before you need it. |
| Leaked secret                         | Rotate in Secret Manager, redeploy, run `UPDATE "Session" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;` if sessions may be affected.                                                                                                      |

## 6. Backups, retention and data protection

Enable automated backups and PITR; additionally export a nightly logical dump to a separate bucket with lifecycle rules; test restores quarterly. Retention suggestions are in [database-design.md](database-design.md) (no purge job exists yet). Do not log personal data (the logger redacts email, phone, address fields, cookies and tokens). Use HTTPS only; HSTS is sent by the API in production and should also be set at the load balancer.

## 7. Running without a cloud provider

`docker compose up --build` (see README) on any VM with Docker works as a single-host deployment: terminate TLS in front of port 8080 (Caddy/Traefik/a cloud load balancer), set `API_NODE_ENV=production`, `COOKIE_SECURE=true`, `ENABLE_DEV_OUTBOX=false`, and use strong secrets in `.env` (not committed).

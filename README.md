# Shipwreck

**Find what sinks before you ship.** An evidence-first production-readiness MVP with a working repository scanner, persistent reports, user isolation, and a dark developer dashboard.

## Run locally

Use Node.js **22.13+** (Node 22 LTS recommended) and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://localhost:3000**. Development automatically opens a fresh, isolated demo workspace with three projects. No GitHub credentials, AI key, Docker, or external database are required. Embedded PostgreSQL persists in `.shipwreck/data`. Use a single application process when using embedded storage.

To scan your own project, select **New project**, provide a public GitHub `owner/repository` and its branch, optionally add a public production URL, then run a Hull Check. Create an account to keep your own workspace separate from demo data. For private repositories, follow the [GitHub App setup guide](docs/GITHUB_APP_SETUP.md), connect the App in Settings, and select the repository from the connected picker. Public GitHub API calls are subject to GitHub's unauthenticated limits.

```sh
npm run scan -- /path/to/local/repository
npm run scan -- /path/to/local/repository --json
```

For pure JSON output use `npm run --silent scan -- /path --json`. The CLI exits with code 1 when a confirmed critical finding blocks launch, and 0 otherwise. It never executes repository code. Use it on local checkouts of private repositories.

## What is implemented

- Signup, login, logout, salted scrypt passwords, hashed opaque session tokens, origin protection, rate limiting, and owner-scoped database access.
- GitHub OAuth sign-in/connection, read-only GitHub App installations for private repositories, repository/branch selection, ingestion pinned to an immutable commit, and safe production URL inspection. App tokens refresh automatically, and each private scan uses a temporary token restricted to its repository.
- 32 independent deterministic checks with severity, confidence, evidence, explanation and remediation.
- Dashboard, project reports, category/status filters, environment inventory, detected technology manifest, persistent scan history, previous report viewing, critical-count comparisons, and project settings/deletion.
- Copyable coding-agent fix prompts; clipboard feedback, loading/error states, keyboard dismissal/focus management and responsive layouts.
- Three isolated demo projects scanned with the real engine, plus an earlier snapshot containing a destructive migration to demonstrate improvement.
- PostgreSQL migration, container deployment, CLI, health endpoint, and retention maintenance command.

## Architecture and repository structure

See [architecture decisions](docs/ARCHITECTURE.md) and [database migration](migrations/001_initial.sql).

```text
src/app/                      Next.js routes and styles
src/app/api/[...path]/         Workspace, auth, projects, scans, health API
src/app/api/auth/github/      OAuth authorization and callback
src/app/api/github/app/       App authorization, installation setup and callback
src/components/              Interactive dashboard and report UI
src/lib/scanner/               Framework-independent checks, types and engine
src/lib/server/                Storage, sessions, GitHub ingestion, safe HTTP inspection
src/lib/demo.ts                Deliberately imperfect, non-executable source fixtures
src/cli.ts                    Local repository scanner
src/maintenance.ts            Expired session/demo data cleanup
migrations/001_initial.sql     PostgreSQL schema and indexes
migrations/002_github_app.sql  App credentials, refresh lease and project installation binding
tests/                       Scanner/security tests and browser integration tests
```

The TypeScript scanner is shared by the API and CLI. Rust would not provide enough value at this stage to justify a second runtime. A bounded synchronous scan handler is appropriate for a persistent Node server; a durable job queue is required before large-scale or serverless deployment.

### Database schema

| Table                    | Purpose                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `users`                  | Account identity, salted password hash, GitHub identity, demo flag                        |
| `sessions`               | SHA-256 hashes of random 256-bit session tokens and expiry                                |
| `github_app_connections` | Encrypted App user/refresh credentials, App and GitHub identity, expiry and refresh lease |
| `repository_connections` | AES-256-GCM encrypted OAuth token, provider login                                         |
| `projects`               | Owner, repository, branch, deployment URL, source type                                    |
| `scans`                  | Immutable commit, timestamp, JSONB report with findings/evidence/manifest                 |
| `subscriptions`          | Future plan identifier, customer identifier, status; no payments enabled                  |
| `rate_limits`            | Atomic request counters and reset times                                                   |

User → projects → scans and user → connections/sessions/subscriptions use cascading foreign keys. Ownership, scan chronology and session expiry are indexed. Results are stored as versionable JSONB snapshots to preserve their exact historical meaning. Current migrations are idempotent and applied in filename order on storage initialization. Future non-idempotent changes should introduce a tracked migration runner.

## Check library

| Category               | Checks                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Security               | Recognized credential patterns, wildcard CORS, explicitly insecure cookie flags, public secret variable names, disabled TLS verification |
| Authentication         | Provider indicators, documented session secret, resource ownership review                                                                |
| Environment            | Undocumented source variables, unused documentation, committed non-template dotenv                                                       |
| Database & data safety | Schema/migrations, destructive SQL, backup verification gap, connection pooling indicators                                               |
| Deployment             | Final-stage container user, health endpoint/probe, CI workflow, development mode in deployment config                                    |
| Reliability            | Outbound timeout indicators, graceful shutdown indicators                                                                                |
| Observability          | Error reporting and structured logging indicators                                                                                        |
| Dependencies           | Lockfile, mutable `latest` container tag                                                                                                 |
| Integrations & cost    | Stripe webhook verification, AI usage-control indicators                                                                                 |
| Production HTTP        | HTTPS, response availability, HSTS, `nosniff`, response cookie attributes                                                                |

A passed pattern check only means its specific risk pattern was not found. A detected framework/configuration does not prove runtime enforcement. Tests and fixtures are excluded from risk-pattern matching and source environment references to reduce false positives. Repository secret checks inspect the selected snapshot, **not Git history**.

### Report semantics

- **Launch Blocked:** at least one failed critical check.
- **Needs Attention:** critical findings requiring verification.
- **Minor Risks:** remaining warning/informational failures or verification gaps.
- **Shipworthy:** all applicable checks passed; this is limited to supported checks, not a guarantee.
- **Coverage:** passed checks / applicable checks. Unverified checks remain in the denominator; inapplicable checks do not.

The overview labels critical findings explicitly because this count includes both confirmed issues and unresolved critical verification gaps. Charts use previous/current report counts. Previous demo scans are explicitly synthetic fixtures.

## Deterministic versus AI

**All scanning and reporting is deterministic.** Rules inspect manifests, source patterns, configuration, filenames, environment references, and safe HTTP observations. No source is sent to an LLM. Fix prompts are deterministic templates containing the actual finding and redacted evidence. Users can paste these into their chosen coding agent. There is no integrated AI interpretation or autonomous remediation.

“Unable to verify” is used for ambiguous authorization patterns, missing backup/provider evidence, absent runtime configuration, unavailable HTTP observations, and other incomplete evidence. Source absence does not prove missing production controls. Pattern-based checks can miss indirect configuration and should not substitute for an application security review.

## Environment variables

| Variable                      | Use                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | PostgreSQL connection string; omit for local embedded PostgreSQL                                                   |
| `APP_URL`                     | Canonical application origin, e.g. `https://shipwreck.example.com`; must match browser origin for writes and OAuth |
| `TOKEN_ENCRYPTION_KEY`        | 64 hex characters (32 random bytes), required for OAuth tokens                                                     |
| `GITHUB_CLIENT_ID`            | GitHub OAuth App client ID                                                                                         |
| `GITHUB_APP_ID`               | Numeric GitHub App ID for private repository access                                                                |
| `GITHUB_APP_SLUG`             | GitHub App URL slug                                                                                                |
| `GITHUB_APP_CLIENT_ID`        | GitHub App user authorization client ID                                                                            |
| `GITHUB_APP_CLIENT_SECRET`    | GitHub App user authorization client secret                                                                        |
| `GITHUB_APP_PRIVATE_KEY`      | RSA PEM value; actual newlines or literal `\n` escapes                                                             |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Alternative mounted PEM file path                                                                                  |
| `GITHUB_CLIENT_SECRET`        | GitHub OAuth App client secret                                                                                     |
| `ENABLE_DEMO`                 | Set `true` to allow demo in production; development enables it automatically                                       |
| `POSTGRES_PASSWORD`           | Required only by Docker Compose                                                                                    |
| `TEST_URL`                    | Optional URL for browser tests; defaults to `http://localhost:3000`                                                |

Generate an encryption key with `openssl rand -hex 32`. Do not rotate it without first re-encrypting existing connection tokens or requiring users to reconnect. GitHub OAuth callback: `${APP_URL}/api/auth/github/callback`. Scope is deliberately limited to `read:user`; it does **not** grant private repository access. Private repository ingestion uses the separate GitHub App installation flow with read-only permissions. See [GitHub App setup](docs/GITHUB_APP_SETUP.md) for App credentials, callback/setup URLs, installation selection and token lifecycle.

## Demo and retention

Demo workspaces are individual accounts with separate data, seeded on first development visit. Demo scans inspect source fixtures; there are no invented live production observations. Signing up creates an empty real workspace. A project deletion cascades to all of its scans.

Production reports remain until their owner deletes the project. Sessions expire after seven days. Schedule the maintenance command daily to remove expired sessions/counters and demo workspaces older than seven days with no active session:

```sh
npm run maintenance
```

This command intentionally deletes expired demo data. Back up the production database and define your own report retention policy before a public launch.

## Verification

See [the completed verification report](docs/VERIFICATION.md) for test and build results, live integration checks, and untested deployment dependencies.

```sh
npm test
npm run lint
npm run typecheck
npm run build
# With npm run dev running in another terminal:
npx playwright install chromium
npm run test:e2e
```

Unit/security tests cover vulnerable and healthy configuration pairs, deterministic reports, evidence completeness, redaction, source/fixture separation, environment extraction, multistage Docker behavior, Stripe ambiguity, production HTTP observations, SSRF protection, password hashing and token encryption. Browser tests cover dashboard search, finding drilldown, clipboard, rescans/history, environment/manifest, mobile overflow, signup/login/logout, settings/deletion, cross-user access and CSRF rejection.

## Deployment

For Azure, use the **F1 Free** App Service deployment in the [Azure deployment guide](docs/AZURE_DEPLOYMENT.md). It provides a stable HTTPS URL and persistent embedded PostgreSQL for a single application process, with hard free-tier quotas and no paid fallback.

For another provider, use a persistent Node.js service with managed PostgreSQL or the included Compose setup.

1. Set `DATABASE_URL`, `APP_URL`, and optional GitHub OAuth credentials in your deployment secret store. Use HTTPS for `APP_URL` and a PostgreSQL connection with provider-supported TLS verification. Keep `ENABLE_DEMO=false` for a normal production install.
2. Run `npm ci`, `npm run build`, then `npm start`. The schema is created on first storage use. Restrict the runtime database role after applying migrations if required by your deployment policy.
3. Put a TLS reverse proxy in front of port 3000. Use `/api/health` for readiness; it checks database connectivity.
4. Allow outbound HTTPS to GitHub and DNS/public HTTP(S) targets for scans. Block private network egress at the infrastructure layer too.
5. Schedule backups, restore tests and `npm run maintenance`. Use a single embedded-database process only for demos; deploy PostgreSQL for shared or multi-instance production.

Compose example:

```sh
cp .env.example .env
# Set POSTGRES_PASSWORD to a generated password, APP_URL, and ENABLE_DEMO=false.
docker compose up --build -d
```

The PostgreSQL port is not published. The app image runs as a non-root user. The Azure script explicitly provisions cloud resources; the Docker Compose configuration runs locally.

## Security considerations and limits

- All project/scan queries enforce owner identity. The API rejects cross-origin writes. Sessions are HttpOnly, SameSite=Lax, seven-day cookies; HTTPS `APP_URL` enables Secure cookies.
- Password hashes use random salts with scrypt. Sessions store only token hashes. GitHub tokens are encrypted with authenticated AES-GCM and are never returned to the browser.
- Remote code is never executed. Repository bodies live only in bounded process memory; reports retain paths, names and redacted descriptions, never source contents or secret values.
- URL inspection blocks private, local, reserved and mapped private addresses; pins resolved IPs; validates each redirect; permits only HTTP(S) on standard ports; enforces timeouts; destroys response bodies. Cookie values are discarded. It only inspects the supplied URL, not speculative debug paths.
- GitHub scans are limited to 350 eligible files, 8 MB total, 2 MB per file, four redirect steps for HTTP, and a bounded ingestion window. Large repositories should use the local CLI. Private repositories can use GitHub App access or a local checkout. Git submodules and symlinks are not followed. Lockfile presence is verified; no vulnerability/advisory or EOL claims are made without a live advisory source.
- HTTP inspection cannot prove availability over time, authenticated session safety or health endpoint behavior beyond the requested URL. Backups, restore success, production environment values, provider limits, runtime authorization, retries and actual spending are not verified.
- This is an MVP, not an audited SaaS service. Email verification, password reset, MFA, durable scan workers, real billing, scheduled scans, audit trails and webhook-triggered rescans are not yet implemented. Subscription storage is an architectural seam only. API rate limits are database-backed and basic; add trusted-proxy-aware abuse controls before public exposure.
- CSP blocks external frames and limits resource origins; Next.js currently needs inline script/style allowances in this setup. A nonce-based CSP is a hardening follow-up.

## Next 10 highest-value additions

1. Webhook-driven installation status, revocation notifications and repository rescans.
2. Durable scan workers with cancellation, progress events and retry-safe jobs.
3. AST-based ownership and tenant-boundary tracing with framework-aware tests.
4. OSV advisory matching against resolved lockfile versions.
5. Provider-backed backup evidence and restore-test verification.
6. Production environment comparison without transferring secret values.
7. Per-route rate-limit, webhook and paid API enforcement analysis.
8. Scan comparison by stable finding identity, new/fixed/regressed filters and policy gates.
9. CLI packaging and GitHub Action/PR annotations with scoped access.
10. Email verification/password recovery, alert delivery, recurring scans and plan enforcement.

# Shipwreck architecture

Design established before implementation in an empty repository.

## Application

Next.js App Router + React + TypeScript. Server route handlers own authentication, ingestion, scanning and persistence. A responsive dark dashboard exposes projects, reports, evidence, remediation, environment inventory, history and settings. Plain CSS design tokens keep the UI cohesive without an additional styling runtime.

## Engine contract

`Check { id, category, title, severity, why, fix, run(context) }` returns `CheckResult { status, confidence, evidence, message }`. Context contains bounded repository files and optional safe HTTP observations. Status is passed, failed, unverified, or not_applicable. Evidence has a file, line and redacted description. Each check is isolated; rule errors become unverified. Engine imports no framework or storage APIs and is reusable by the CLI.

No AI provider is required. Remediation prompts are deterministic templates; ambiguous pattern checks explicitly remain unverified. Readiness counts only applicable checks; unresolved critical verification gaps require attention but do not falsely claim a proven blocker. The coverage percentage is passed / applicable, and is not a probability of safety.

## Data model

PostgreSQL: users, sessions (hashed opaque tokens), repository_connections (encrypted provider tokens), projects (owner, repository, branch, URL), scans (immutable JSONB results and manifest), subscriptions (plan identifier), rate_limits. Foreign keys cascade deletion. Owner-scoped queries form the tenant boundary. Index project ownership, session expiry and project scan chronology. SQL migrations are the source of truth. Local development uses PGlite with the same migration, production requires PostgreSQL.

## Initial rules

Security: committed secrets, wildcard CORS, cookie flags, public secret variables, disabled TLS verification.
Authentication: provider detection, session secret documentation, resource ownership review.
Environment: undocumented references, unused documentation, committed dotenv.
Database: migrations, destructive SQL, backup verification, pooling verification.
Deployment: container user, health check, CI, production mode.
Reliability: outbound timeouts, graceful shutdown.
Observability: error reporting, structured logging.
Dependencies: lockfile, pinned container image.
Integrations: Stripe webhook verification, AI usage controls.
URL: HTTPS, availability, HSTS, content-type sniffing protection, cookie flags.

## Ingestion & security

GitHub REST ingestion resolves a branch to an immutable commit, reads bounded text blobs, rejects oversized/truncated trees and never executes repository code. Public repositories work without OAuth. OAuth uses state cookies, an explicit callback origin and encrypted tokens. Local CLI traversal excludes symlinks, dependencies, build artifacts and VCS objects. Evidence is redacted before storage. URL requests resolve and pin globally routable addresses, block local/private/reserved IPs and nonstandard ports, revalidate every redirect, and enforce time/response limits.

## MVP tradeoffs

Synchronous bounded scans on a Node server; an external queue/worker is the next scaling step. Provider backup settings, deployed environment values, dynamic authorization and runtime behavior cannot be verified from source alone. No dependency vulnerability claim without an advisory source. No arbitrary numeric AI score. No billing collection, organization hierarchy or autonomous changes.

## GitHub App private access

Migration `002_github_app.sql` adds a user-scoped App connection with encrypted user/refresh tokens, expiry and refresh lease, and an optional installation ID on each project. App authorization is separate from email/password sign-in and uses encrypted session-bound state and PKCE. The installation setup callback is followed by user authorization and accessible-installation verification; incoming installation IDs never grant access on their own.

Private repository browsing uses GitHub's user/installation intersection endpoints. Each branch lookup and scan checks repository access with the user's App token, checks that the requested installation is active and belongs to the configured App, then creates an installation token limited to that repository with read-only contents permissions. Temporary installation tokens are held in request memory and revoked in a finally block. Database-backed refresh leases protect rotating user tokens across concurrent processes; disconnect deletes the user-scoped credentials and prevents stale refresh completion.

See [configuration and operating instructions](GITHUB_APP_SETUP.md).

## Azure free hosting

Azure F1 Free runs the Next.js standalone server in one Node 22 process. `EMBEDDED_DATABASE_PATH=/home/shipwreck/data` explicitly permits persistent embedded storage with demo access disabled. This path is outside the ZIP deployment directory, so application updates preserve data. Managed PostgreSQL remains supported through `DATABASE_URL` on other deployments. Embedded storage requires one application process and has no managed backup or high availability; see the Azure deployment guide for limits.

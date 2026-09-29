# Authentication and protected routes

Shipwreck uses email/password for signup and sign-in. GitHub is an optional repository connection added afterward in Settings. Signup opens Settings, where users can connect GitHub or continue with a public repository. GitHub callbacks never create users or issue Shipwreck sessions. Each project selects its own repository; GitHub App installations can grant access to multiple selected repositories.

## Existing controls

- `src/lib/server/auth.ts` hashes passwords with scrypt and a random salt. Password comparison uses `timingSafeEqual`.
- Sessions use 32 random bytes; only a SHA-256 token hash is stored in the database. Every authenticated request looks up the hash and requires an unexpired session associated with a user. Sessions expire after seven days. Logout deletes the database session, so replaying its cookie fails.
- Session cookies are HttpOnly, SameSite=Lax, and scoped to `/`. Secure is enabled when `APP_URL` uses HTTPS. Production must use an HTTPS URL.
- Login/signup attempts are limited per email and globally. Mutation requests require an exact matching Origin and have a bounded request body.
- Projects, updates, deletions, and scan history are scoped by the authenticated user. Scanning a project checks ownership before repository ingestion.

These describe the implemented controls and tested behavior, not a claim that source analysis proves the entire deployment secure.

## API compatibility

| Endpoint                                       | Authentication behavior                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                              | Public database readiness check                                                                                       |
| `GET /api/workspace`                           | Anonymous bootstrap returns `{ user: null, demoEnabled }`; authenticated responses contain only that user's workspace |
| Other catch-all API GET routes                 | Existing anonymous contract returns the same bootstrap response with no protected data                                |
| `POST /api/auth/signup`, `/api/auth/login`     | Public credential entry points with Origin checks and rate limits                                                     |
| `POST /api/auth/demo`                          | Disabled in production unless explicitly enabled                                                                      |
| Project, scan, and GitHub connection mutations | Require a valid session; anonymous requests return 401                                                                |
| Cross-user scan/update                         | Return 404                                                                                                            |
| Cross-user project delete                      | Returns the existing idempotent success response, but cannot delete the other user's project                          |

The existing OAuth callback URL remains registered for compatibility, but it now only links repositories to an authenticated, non-demo account. Its encrypted state expires after ten minutes and is bound to the initiating account. Anonymous callbacks, changed accounts, invalid state, and attempts to link a GitHub identity owned by another workspace are rejected.

## Configuration

Before deploying this change to an existing database, check for non-demo users with `password_hash IS NULL`. Older GitHub sign-in could create passwordless accounts with synthetic `@github.shipwreck.local` addresses. Those users need a separately verified email/password migration that preserves their user IDs and projects before this release; this change does not invent credentials, merge accounts, or provide a recovery flow. Existing email/password accounts and their linked repositories keep working.

Password sign-in requires working persistent storage and production `APP_URL`. It does not require GitHub credentials. Azure F1 supplies `APP_URL` and `EMBEDDED_DATABASE_PATH`; other deployments can use `DATABASE_URL`.

Optional GitHub public-repository linking requires `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a 32-byte hex `TOKEN_ENCRYPTION_KEY`. These are server-only deployment settings. Azure currently has all four settings, including the HTTPS app URL; credential values were not printed during verification.

The OAuth App callback is:

```text
https://shipwreck-free-daac2bd8ebe4.azurewebsites.net/api/auth/github/callback
```

See [Azure deployment](AZURE_DEPLOYMENT.md) for the secure settings upload command. Keep existing `GITHUB_APP_*` settings in the same upload file to retain private-repository access. The deployment script retains Azure's app URL and encryption key; they do not need to be copied out of Azure. For local OAuth testing, configure a local `APP_URL`, an independent encryption key, and a callback registered for that local URL.

Local regression tests use fake OAuth credentials and never contact GitHub. They verify redirect/state construction, rejected callbacks, and successful linking with a mocked GitHub token/profile response in the disposable server. They cannot establish that registered callbacks, client secrets, consent, or repository permissions work at GitHub. Verify those by signing in with email/password and connecting GitHub in Settings. The OAuth implementation currently does not refresh expiring OAuth App tokens. GitHub App token refresh is a separate implementation with its own tests.

## Scanner finding

The previous `auth.provider` rule recognized a list of library names but missed custom sessions. It now recognizes declared/imported libraries or a conservative set of database session lifecycle indicators together in a source module: random token generation, token hashing, issuance, expiry-checked lookup, HttpOnly cookies, and revocation. Evidence contains file locations and descriptions, never source values.

Missing or incomplete evidence stays **unverified**, not a confirmed vulnerability. A source-evidence pass explicitly does not establish runtime configuration, credential validation, or protected-route authorization. Existing stored reports are immutable; run a new Hull Check against the updated source to get the updated finding.

## Reproducing verification

Use Node.js 22.13 or newer:

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:auth
```

`test:auth` requires the production build. It starts a dedicated server on loopback port 3107 with demo disabled, a temporary database, a seeded expired session, and fake provider credentials. It refuses to reuse an existing server. The database is removed on server shutdown. It never uses the local or Azure database or `.env` provider credentials.

The suite covers anonymous/forged/malformed/expired sessions, successful signup/login, rejected credentials, cookie attributes, logout replay, two-account project and scan-history isolation, Origin rejection, demo rejection, rate limiting, OAuth state generation, invalid/missing/tampered callback state, session changes during linking, successful mocked linking without replacing the session, and the email-first browser flow. HTTPS Secure-cookie behavior and a successful remote OAuth exchange are not exercised by this local HTTP test server.

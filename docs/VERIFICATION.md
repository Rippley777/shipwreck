# Verification results

Verified locally on September 28, 2026.

| Check                           | Result                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Scanner/security suite          | 36 tests passed, including GitHub App access and migration coverage                 |
| Browser integration suite       | 3 workflows passed against development and production servers                       |
| ESLint                          | Passed, no errors or warnings                                                       |
| TypeScript                      | Passed                                                                              |
| Next.js production build        | Passed, Next.js 16.3.6                                                              |
| Production startup              | Passed; running at http://localhost:3000                                            |
| Database readiness              | `/api/health` returned `{"status":"ok"}`                                            |
| Live public GitHub ingestion    | `lukeed/clsx`, 14 eligible files, commit `925494cf31bcd97d3337aacd34e659e80cae7fe2` |
| Live public HTTPS inspection    | `https://example.com/`, HTTP 200                                                    |
| Dependency audit during install | No known vulnerabilities reported                                                   |

Browser tests exercised report drilldown, environment and manifest views, clipboard remediation, filters, rescanning, immutable previous reports, mobile overflow, signup, login, logout, project settings, deletion, cross-user scan/update rejection, and cross-origin write rejection. Desktop and mobile screenshots are in `artifacts/`.

Validation used the workspace's Node.js 20.15.0 runtime. The project recommends Node.js 22.13+ because current tooling has a newer supported engine range. The build and tests succeeded on the available local runtime. The Azure deployment additionally built and ran the Node 22 Linux AMD64 container.

Not externally verified: live GitHub App/private repository authorization and GitHub OAuth authorization (require operator credentials), email delivery, or live billing. Embedded PostgreSQL persistence was verified by restarting from development to the production server and rerunning the browser suite.

The running preview uses `ENABLE_DEMO=true` and embedded storage. It remains a local preview; the separate Azure deployment uses managed PostgreSQL and disables demo sessions. Production deployment steps, limitations and security considerations are in the README.

## GitHub App private repository access

The added provider tests cover RS256 JWTs, PKCE, encrypted/session-bound callback state, inaccessible and forged installations, revoked authorization, repository-scoped read-only tokens, revocation on ingestion failure, listing pagination, user token rotation, concurrent refresh leases, disconnect races, and preservation of existing projects during the idempotent migration. Provider API responses are simulated; no live private repository credentials are present.

The added browser workflow checks private repository selection, passing the selected installation to branch lookup/project creation, listing installations and disconnecting. The full three-workflow suite passed against the final production build, and `/api/health` returned `{"status":"ok"}` after upgrading the existing embedded database. See [the GitHub App setup guide](GITHUB_APP_SETUP.md) to configure a real installation.

## Azure deployment

Deployed on September 28, 2026 to `rg-shipwreck-prod` in Central US. The foundation and application ARM deployments completed successfully. The app is running at https://shipwreck.whitebay-73212c38.centralus.azurecontainerapps.io.

- Bicep compilation, Python deployment script compilation, ESLint and TypeScript checks passed.
- The Linux AMD64 Node 22 image built successfully and was pulled from ACR using the app's managed identity.
- `/api/health` returned `{"status":"ok"}` against PostgreSQL 17 B1ms, with TLS certificate and hostname verification enabled. The database has public network access disabled.
- HTTP redirects to HTTPS with status 301. Azure reports a ready application revision and provisioning state `Succeeded`.
- A live Playwright browser check passed the production sign-in page and sign-up form, demo access rejection (403), cross-origin write rejection (403), and incorrect login rejection (401), with no browser page errors. No production user account was created by these checks.
- `APP_URL`, database credentials, and the token encryption key are configured in Azure. GitHub App credentials are not yet supplied; live private repository authorization remains unverified.

Update and credential-upload commands, resource details and ongoing cost estimates are in [Azure deployment](AZURE_DEPLOYMENT.md). Deployment state, credentials, verification JSON, and browser captures are stored under ignored `.shipwreck/azure/`; its state file and directory use restrictive permissions.

## Azure F1 Free migration

The current deployment is https://shipwreck-free-daac2bd8ebe4.azurewebsites.net in Central US. Azure reports hosting SKU `F1`, tier `Free`. The resource group contains only the free App Service site and plan. The previous registry, Container App, PostgreSQL server, managed environment/resource group, load balancer, public IP, private DNS zone/link, VNet and managed identity have been removed.

- The Linux AMD64 Node 22 production build, ESLint, TypeScript, Bicep compilation, Python compilation and all 36 unit/security tests passed.
- The account, session and rate-limit records were backed up privately, restored into PGlite and uploaded to `/home/shipwreck/data`. Every uploaded database file matched the migration copy's SHA-256 checksum.
- After the new code deployment, a fresh snapshot from the free app’s persistent storage was checked: account identity and password hash matched the original database. The app was restarted after that check.
- The corrected ZIP deployment completed successfully, and `/api/health` returned `{"status":"ok"}` with demo access disabled. After the persistence-check restart, live Playwright checks passed HTTPS, database health, sign-up form visibility, demo rejection (403), cross-origin write rejection (403), and no browser page errors.
- App Service’s Node deployment optimizer excludes nested `node_modules` folders. The deployment script materializes Next.js external-dependency links and moves their aliases into the root dependency folder before packaging. This layout also passed health checks in a local Linux container containing only the deployment package.
- The app uses Azure's Node 22 runtime, one server process and included persistent storage. No paid fallback is allowed. The old paid deployment script requires explicit `--allow-paid`.

The earlier Container Apps results are historical. See [Azure deployment](AZURE_DEPLOYMENT.md) for current commands, hard quota limits, credentials and backup guidance. Live GitHub App authorization remains unverified without operator credentials.

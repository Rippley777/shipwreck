# Verification results

Verified locally on September 28, 2026.

| Check | Result |
| --- | --- |
| Scanner/security suite | 19 tests passed |
| Browser integration suite | 2 workflows passed against development and production servers |
| ESLint | Passed, no errors or warnings |
| TypeScript | Passed |
| Next.js production build | Passed, Next.js 16.3.6 |
| Production startup | Passed; running at http://localhost:3000 |
| Database readiness | `/api/health` returned `{"status":"ok"}` |
| Live public GitHub ingestion | `lukeed/clsx`, 14 eligible files, commit `925494cf31bcd97d3337aacd34e659e80cae7fe2` |
| Live public HTTPS inspection | `https://example.com/`, HTTP 200 |
| Dependency audit during install | No known vulnerabilities reported |

Browser tests exercised report drilldown, environment and manifest views, clipboard remediation, filters, rescanning, immutable previous reports, mobile overflow, signup, login, logout, project settings, deletion, cross-user scan/update rejection, and cross-origin write rejection. Desktop and mobile screenshots are in `artifacts/`.

Validation used the workspace's Node.js 20.15.0 runtime. The project recommends Node.js 22.13+ because current tooling has a newer supported engine range. The build and tests succeeded on the available runtime, but Node 22 deployment/container validation remains for the target environment.

Not externally verified: GitHub OAuth authorization (requires operator credentials), a remote PostgreSQL service, Docker image execution, hosted TLS/reverse proxy configuration, email delivery, or live billing. Embedded PostgreSQL persistence was verified by restarting from development to the production server and rerunning the browser suite.

The running preview uses `ENABLE_DEMO=true` and embedded storage. It is a local preview, not an externally deployed SaaS service. Production deployment steps, limitations and security considerations are in the README.

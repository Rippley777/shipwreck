# Azure F1 Free deployment

Shipwreck now uses **Azure App Service F1 Free**, Node 22, and embedded PostgreSQL (PGlite) on the included persistent `/home` storage. It runs one application process. There is no paid registry, managed PostgreSQL server, custom virtual network, load balancer, public IP resource, or Application Insights deployment.

## Current deployment

- App and `APP_URL`: https://shipwreck.oddware.dev
- Azure origin: https://shipwreck-free-daac2bd8ebe4.azurewebsites.net (retained in `ALLOWED_ORIGINS`)
- Region: `centralus`
- Resource group: `rg-shipwreck-prod`
- App name: `shipwreck-free-daac2bd8ebe4`
- Plan: `shipwreck-free-plan`, SKU **F1**, tier **Free**
- Database directory: `/home/shipwreck/data`
- Demo access: disabled

F1 includes 60 CPU minutes per day, 1 GiB memory, and 1 GiB app storage. Shared hosting sleeps when idle and may have cold starts. Exhausting a hard quota makes the app unavailable rather than upgrading the plan. This is suitable for development and a small prototype; it has no production SLA or managed database backups. See [Azure F1 pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/) and [App Service quota limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#app-service-limits).

**Migration complete:** the original paid resources and their managed resource group were removed. The existing account was preserved and verified from the free app’s persistent storage; HTTPS and database health passed after deployment. Its account was backed up privately and copied to embedded storage. Charges incurred before paid resources were removed can still appear on the subscription; moving to F1 does not refund earlier usage. Other applications in your subscription are outside this deployment's scope.

## Deploy and update

Run these commands from the `shipwreck/` directory. Install Node.js 22.13+, npm, Python 3, Azure CLI, and Docker. Azure builds run locally; no Azure build service or registry is provisioned. `--settings-only` does not need Docker.

```sh
az login
az account set --subscription <subscription-id>
npm run deploy -- --dry-run
npm run deploy
```

`npm run deploy` calls `scripts/deploy.py`, which checks the selected Azure subscription and Docker before running `scripts/deploy-azure-free.py`. The first run creates the resource group, F1 App Service plan and Linux web app. Later runs reuse the saved app and secrets, rebuild the code, upload it, and wait for `/api/health`. Preview only reads the local saved state; it does not contact Azure or change resources. The free deployment template is `infra/azure/free.bicep`. The deployer verifies SKU `F1` and refuses a paid fallback. The legacy `scripts/deploy-azure.py` requires an explicit `--allow-paid` flag and is not part of this flow.

The script packages Next.js standalone output, static files, migrations and PGlite runtime files into a ZIP. It materializes dependency links and places external-package aliases in the root dependency folder so App Service’s Node optimizer includes them. The upload runs asynchronously, and the script waits for Azure deployment completion and database health. Code is deployed to `/home/site/wwwroot`; database data stays outside that directory, so a code update does not replace it. Keep exactly one process and one app instance when using embedded storage. Do not open the live data directory from another process while the app is running.

By default, `APP_URL` is the Azure hostname. HTTPS enables Secure session cookies. `TOKEN_ENCRYPTION_KEY` is retained across updates and the migration. Azure app settings hold runtime credentials. The ignored `.shipwreck/azure/free-state.json` stores the subscription, URL, extra allowed origins, deployment configuration and secrets with restrictive permissions; keep a secure backup. Never commit or share that file. The older ignored state and migration snapshots also contain secrets/account data. The deployer does not read `.env`: that file is local to the developer machine. Use the flags below to update Azure settings.

To change settings without rebuilding code, preview and run:

```sh
npm run deploy -- --dry-run --settings-only --allowed-origins https://shipwreck.oddware.dev
npm run deploy -- --settings-only --allowed-origins https://shipwreck.oddware.dev
```

If the deployed app does not yet include the `ALLOWED_ORIGINS` code, omit `--settings-only` the first time so code and setting deploy together: `npm run deploy -- --allowed-origins https://shipwreck.oddware.dev`.

`APP_URL` is always accepted by the API's POST `Origin` check. `--allowed-origins` adds other exact HTTP(S) origins to that check; pass a comma-separated list for several. The value is saved and reused on future deployments. This setting does not enable CORS for cross-site JavaScript, change GitHub callbacks, or change the canonical URL. To serve Shipwreck at a custom domain, first bind that hostname and a valid HTTPS certificate to the existing App Service and point DNS to it. Then set the canonical URL:

```sh
npm run deploy -- --dry-run --settings-only --app-url https://shipwreck.oddware.dev
npm run deploy -- --settings-only --app-url https://shipwreck.oddware.dev
```

The script checks that the custom domain already serves `/api/health` before changing `APP_URL`, then checks health again after the update. Update the GitHub App and OAuth callback URLs to that host before connecting GitHub there. If the Azure hostname must also accept browser writes, add it with `--allowed-origins`. Cookies are scoped to the host where users sign in; switching hosts requires signing in again. Passing an empty `--allowed-origins ''` clears saved extra origins.

Before rolling out the email/password login change to an older database, follow the [account migration note](AUTHENTICATION.md#configuration) for users with no password hash. The deployer does not migrate those accounts.

## GitHub App configuration

Use the canonical `APP_URL` reported by the deployer in GitHub. For the current custom domain, the URLs are:

- Homepage: `https://shipwreck.oddware.dev`
- Authorization callback: `https://shipwreck.oddware.dev/api/github/app/callback`
- Setup: `https://shipwreck.oddware.dev/api/github/app/setup`
- Optional separate OAuth App repository-linking callback: `https://shipwreck.oddware.dev/api/auth/github/callback`

If you registered an earlier Azure hostname, update its homepage, callback and setup URLs. The GitHub App and optional OAuth App are separate registrations with different callback paths; changing `ALLOWED_ORIGINS` does not update either registration. Sign in again at the new host; cookies cannot transfer between hostnames. Existing account credentials are preserved.

Follow [GitHub App setup](GITHUB_APP_SETUP.md) for permissions. Put your credentials in an ignored private dotenv file:

```dotenv
GITHUB_APP_ID=<App ID>
GITHUB_APP_SLUG=<App slug>
GITHUB_APP_CLIENT_ID=<App client ID>
GITHUB_APP_CLIENT_SECRET=<App client secret>
GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/app-key.pem
```

Optionally include `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for a separate OAuth App. Upload settings without rebuilding:

```sh
chmod 600 .env.azure.local
npm run deploy -- --settings-only --github-env .env.azure.local
```

Settings are remembered for later updates. Providing another `--github-env` replaces saved GitHub configuration; include every setting you want to retain. Keys are uploaded as data, never executed as shell commands. No GitHub credentials are committed or included in build contexts. Run `npm run deploy -- --dry-run --settings-only --github-env .env.azure.local` first to preview the target without uploading the file.

## Verify and protect data

```sh
curl --fail https://shipwreck-free-daac2bd8ebe4.azurewebsites.net/api/health
az appservice plan show -g rg-shipwreck-prod -n shipwreck-free-plan --query sku
```

After switching `APP_URL` to a custom domain, check `/api/health` on that domain too.

The health endpoint queries embedded PostgreSQL and initializes idempotent migrations. To test restart persistence, restart the app and sign in with your existing account. Make regular private backups of `/home/shipwreck/data` while the app is stopped, or use PGlite's data dump API with appropriate access controls. Never put a database backup inside `public/` or the deployed web root. Deleting the web app removes its persistent storage; back up first.

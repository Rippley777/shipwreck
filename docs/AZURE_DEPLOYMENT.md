# Azure F1 Free deployment

Shipwreck now uses **Azure App Service F1 Free**, Node 22, and embedded PostgreSQL (PGlite) on the included persistent `/home` storage. It runs one application process. There is no paid registry, managed PostgreSQL server, custom virtual network, load balancer, public IP resource, or Application Insights deployment.

## Current deployment

- App and `APP_URL`: https://shipwreck-free-daac2bd8ebe4.azurewebsites.net
- Region: `centralus`
- Resource group: `rg-shipwreck-prod`
- App name: `shipwreck-free-daac2bd8ebe4`
- Plan: `shipwreck-free-plan`, SKU **F1**, tier **Free**
- Database directory: `/home/shipwreck/data`
- Demo access: disabled

F1 includes 60 CPU minutes per day, 1 GiB memory, and 1 GiB app storage. Shared hosting sleeps when idle and may have cold starts. Exhausting a hard quota makes the app unavailable rather than upgrading the plan. This is suitable for development and a small prototype; it has no production SLA or managed database backups. See [Azure F1 pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/) and [App Service quota limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#app-service-limits).

**Migration complete:** the original paid resources and their managed resource group were removed. The existing account was preserved and verified from the free app’s persistent storage; HTTPS and database health passed after deployment. Its account was backed up privately and copied to embedded storage. Charges incurred before paid resources were removed can still appear on the subscription; moving to F1 does not refund earlier usage. Other applications in your subscription are outside this deployment's scope.

## Deploy and update

Requires Azure CLI, Python 3, and Docker. Builds run locally; no Azure build service or registry is provisioned.

```sh
az login
az account set --subscription <subscription-id>
python3 scripts/deploy-azure-free.py
```

The free deployment template is `infra/azure/free.bicep`. The script verifies SKU `F1` and refuses a paid fallback. The previous `scripts/deploy-azure.py` requires an explicit `--allow-paid` flag and is not used by this deployment.

The script packages Next.js standalone output, static files, migrations and PGlite runtime files into a ZIP. It materializes dependency links and places external-package aliases in the root dependency folder so App Service’s Node optimizer includes them. The upload runs asynchronously, and the script waits for Azure deployment completion and database health. Code is deployed to `/home/site/wwwroot`; database data stays outside that directory, so a code update does not replace it. Keep exactly one process and one app instance when using embedded storage. Do not open the live data directory from another process while the app is running.

`APP_URL` is derived from Azure's actual hostname. HTTPS enables Secure session cookies. `TOKEN_ENCRYPTION_KEY` is retained across updates and the migration. Azure app settings hold runtime credentials. The ignored `.shipwreck/azure/free-state.json` stores deployment configuration and secrets with restrictive permissions; keep a secure backup. Never commit or share that file. The older ignored state and migration snapshots also contain secrets/account data.

## GitHub App configuration

Use these exact URLs in GitHub:

- Homepage: `https://shipwreck-free-daac2bd8ebe4.azurewebsites.net`
- Authorization callback: `https://shipwreck-free-daac2bd8ebe4.azurewebsites.net/api/github/app/callback`
- Setup: `https://shipwreck-free-daac2bd8ebe4.azurewebsites.net/api/github/app/setup`
- Optional separate OAuth App repository-linking callback: `https://shipwreck-free-daac2bd8ebe4.azurewebsites.net/api/auth/github/callback`

If you registered the earlier Container Apps hostname, replace its homepage, callback and setup URLs. Sign in again at the new host; cookies cannot transfer between hostnames. Existing account credentials are preserved.

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
python3 scripts/deploy-azure-free.py --settings-only --github-env .env.azure.local
```

Settings are remembered for later updates. Providing another `--github-env` replaces saved GitHub configuration; include every setting you want to retain. Keys are uploaded as data, never executed as shell commands. No GitHub credentials are committed or included in build contexts.

## Verify and protect data

```sh
curl --fail https://shipwreck-free-daac2bd8ebe4.azurewebsites.net/api/health
az appservice plan show -g rg-shipwreck-prod -n shipwreck-free-plan --query sku
```

The health endpoint queries embedded PostgreSQL and initializes idempotent migrations. To test restart persistence, restart the app and sign in with your existing account. Make regular private backups of `/home/shipwreck/data` while the app is stopped, or use PGlite's data dump API with appropriate access controls. Never put a database backup inside `public/` or the deployed web root. Deleting the web app removes its persistent storage; back up first.

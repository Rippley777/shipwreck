# Deploy Shipwreck to Azure

Shipwreck runs in Azure Container Apps with a stable HTTPS hostname. PostgreSQL Flexible Server stores application data in a private subnet. Azure Container Registry stores the image; the app pulls it with a managed identity rather than a registry password.

The infrastructure is defined in `infra/azure/foundation.bicep` and `infra/azure/app.bicep`. This is a small MVP deployment: PostgreSQL 17 on Burstable B1ms with 32 GiB storage and seven-day backup retention; Container Apps Consumption with 0.5 vCPU, 1 GiB memory, zero to one replicas; and an ACR Basic registry. There is no database high availability. Scale-to-zero can cause a cold start on the first request. The database and registry incur ongoing charges even when the app is idle. See [Azure PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/) and [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

For Central US, the public USD retail rates checked on September 28, 2026 imply roughly **$49/month before app compute, traffic, taxes, backup overage and subscription discounts**, assuming 730 hours and 30 days. This is an estimate, not a spending cap:

| Resource | Approximate monthly baseline |
| --- | ---: |
| PostgreSQL B1ms compute ($0.01921/hour) | $14.02 |
| PostgreSQL 32 GiB storage ($0.13/GiB-month) | $4.16 |
| ACR Basic ($0.1666/day) | $5.00 |
| Standard load balancer ($0.025/hour) | $18.25 |
| Public IPv4 allowance for two addresses ($0.005/hour each) | $7.30 |

At verification, the managed resource group contained one public IP and one load balancer. The estimate allows for the additional egress IP described in Azure networking documentation; actual network costs may be lower.

The virtual network integration creates Azure-managed networking resources billed separately, as described in [Container Apps virtual networking](https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks#managed-resources). Rates were retrieved from the [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). Check Azure Cost Management for actual charges and set a budget alert appropriate to your account.

## Current deployment

- App: [https://shipwreck.whitebay-73212c38.centralus.azurecontainerapps.io](https://shipwreck.whitebay-73212c38.centralus.azurecontainerapps.io)
- Region: `centralus`
- Resource group: `rg-shipwreck-prod`
- App name: `shipwreck`
- Registry: `shipwreckhrruoaxrcrtei`
- Image tag: `20260928075156`

The deployed app already has `APP_URL`, the database connection, and token encryption configured. GitHub App credentials are still required to activate private repository access.

## Deploy or update

Install Python 3, Azure CLI with Bicep, and Docker. Docker must be running. Authenticate to the intended subscription:

```sh
az login
az account set --subscription <subscription-id>
az extension add --name containerapp
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.ContainerRegistry
python3 scripts/deploy-azure.py
```

The default location is `centralus` and resource group is `rg-shipwreck-prod`. On first deployment, choose another region with `--location southcentralus`. Subsequent deployments must use the same subscription, resource group and location. The script builds a Linux AMD64 image, pushes it, and deploys the application. For code updates without changing infrastructure:

```sh
python3 scripts/deploy-azure.py --app-only
```

`APP_URL` is derived from the Container Apps environment hostname. `DATABASE_URL` uses `sslmode=verify-full`; both the certificate chain and database hostname are verified. An encryption key and database password are generated once and saved with restrictive file permissions in the ignored `.shipwreck/azure/state.json`. Azure stores runtime credentials as Container Apps secrets. Back up that state file securely outside the repository: losing or replacing the encryption key makes existing encrypted GitHub credentials unreadable. Do not upload it, paste it into tickets, or commit it. `--app-only` requires the saved foundation outputs.

Demo access is disabled in the deployment. Create your own Shipwreck account using the sign-up form. Production registration currently has no email verification.

## Configure GitHub after you have the URL

Use the URL printed by the deployment script for the GitHub App homepage. Register:

- User authorization callback: `APP_URL/api/github/app/callback`
- Setup URL: `APP_URL/api/github/app/setup`
- Optional separate OAuth App sign-in callback: `APP_URL/api/auth/github/callback`

Follow [GitHub App setup](GITHUB_APP_SETUP.md) for permissions and installation settings. Store the following in a private dotenv file, such as `.env.azure.local` (ignored by Git and Docker):

```dotenv
GITHUB_APP_ID=<numeric App ID>
GITHUB_APP_SLUG=<app slug>
GITHUB_APP_CLIENT_ID=<App client ID>
GITHUB_APP_CLIENT_SECRET=<App client secret>
GITHUB_APP_PRIVATE_KEY_PATH=/absolute/path/to/downloaded-app-key.pem
```

Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` only if using a separate OAuth App for sign-in. An inline `GITHUB_APP_PRIVATE_KEY` is also supported as a single line containing literal `\n` escapes. The script reads values as data, never as shell commands; it uploads PEM contents as a secret rather than mounting the local key path.

```sh
chmod 600 .env.azure.local
python3 scripts/deploy-azure.py --app-only --reuse-image --github-env .env.azure.local
```

This restarts the app with the credentials while preserving the URL, database, encryption key and image. The deployment script remembers GitHub configuration for later deployments. Treat its state file as a secret. Passing another `--github-env` replaces the saved GitHub settings; include every setting you want to keep. Avoid editing Container Apps secrets or environment variables manually, since later template deployments apply the saved configuration.

## Verify and operate

```sh
curl --fail https://YOUR-APP-HOST/api/health
az containerapp show -g rg-shipwreck-prod -n shipwreck --query properties.latestReadyRevisionName -o tsv
az containerapp logs show -g rg-shipwreck-prod -n shipwreck --follow
```

A successful health check includes a database query and automatic migration initialization. Container readiness checks use that endpoint. Startup and liveness checks use TCP, so a transient database outage does not continuously kill the process.

To roll back application code, use an earlier image tag from the registry:

```sh
python3 scripts/deploy-azure.py --app-only --image-tag <previous-tag>
```

A rollback does not reverse database migrations. Existing migrations are additive and idempotent. Do not delete the resource group unless you intend to remove the application, registry, and database along with its retained data. Export data first if you need it.

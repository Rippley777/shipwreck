# Private repositories with a GitHub App

Shipwreck supports selected private repositories through a GitHub App. Sign in to Shipwreck with email/password, then connect the GitHub App in Settings. The optional OAuth App connection is only for public repository browsing; it is not needed for sign-in or GitHub App access.

## Register the App

In GitHub developer settings, create a GitHub App for your Shipwreck deployment.

- **Homepage URL:** your `APP_URL`.
- **User authorization callback URL:** `${APP_URL}/api/github/app/callback`.
- **Setup URL:** `${APP_URL}/api/github/app/setup`.
- Enable **Redirect on update** so repository access changes return through the setup flow.
- Leave **Request user authorization (OAuth) during installation** unchecked. Shipwreck explicitly starts authorization with session-bound state and PKCE after the setup redirect.
- **Repository permissions:** Contents **Read-only** and Metadata **Read-only**. No write or organization permissions are needed.
- Enable expiring user access tokens; Shipwreck encrypts and rotates refresh credentials automatically. Non-expiring user tokens are supported if your App disables expiry, but installation tokens remain temporary.
- Webhooks can be inactive for this manual-scanning integration. Every private scan revalidates live user and installation access; suspended/uninstalled installations and revoked user authorization fail closed.
- Allow installation on any account if customers outside the App owner's account need access.

GitHub distinguishes the installation setup URL from the user authorization callback. An installation ID in the setup query is untrusted; Shipwreck checks it against the authorized user's accessible installations before connecting it. See [GitHub's setup URL guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).

## Configure the deployment

For Azure, follow [Azure deployment and GitHub secrets](AZURE_DEPLOYMENT.md#github-app-configuration) to get a stable HTTPS URL and upload credentials safely.

Add these values to `.env.local` for development or your deployment secret store:

```dotenv
APP_URL=https://shipwreck.example.com
TOKEN_ENCRYPTION_KEY=<64 hex characters from 32 random bytes>
GITHUB_APP_ID=<numeric App ID>
GITHUB_APP_SLUG=<URL slug shown under github.com/apps>
GITHUB_APP_CLIENT_ID=<GitHub App client ID, not the numeric App ID>
GITHUB_APP_CLIENT_SECRET=<GitHub App client secret>
GITHUB_APP_PRIVATE_KEY_PATH=/secure/shipwreck-app.pem
```

Generate an RSA private key in the GitHub App settings. Keep the downloaded PEM outside the repository and readable only by the application account. Alternatively, set `GITHUB_APP_PRIVATE_KEY` to the PEM, using actual newlines or literal `\n` escapes. The inline value takes precedence over the file path. Never commit the key or place it in `public/`. PEM and key files are excluded from Git and Docker build contexts by default.

Restart Shipwreck after changing credentials. `002_github_app.sql` runs automatically at storage initialization alongside the existing idempotent migration; existing accounts, projects and scans are preserved. Changing `GITHUB_APP_ID` invalidates connections to the previous App and requires reconnection.

For Docker, use an inline private-key environment secret or mount a key at the configured path. If using a host-mounted file, add a Compose override and ensure the non-root app user can read it:

```yaml
services:
  app:
    environment:
      GITHUB_APP_PRIVATE_KEY_PATH: /run/secrets/github-app.pem
    volumes:
      - /secure/shipwreck-app.pem:/run/secrets/github-app.pem:ro
```

Production should use HTTPS for `APP_URL`, which enables Secure cookies. During local development use `http://localhost:3000` in both GitHub App URLs and `APP_URL`; do not mix localhost with another origin.

## Connect and scan

1. Sign in to a real Shipwreck account. Demo sessions cannot connect credentials.
2. Open **Settings → Private repository access → Connect GitHub App**.
3. Authorize the App with your GitHub account. If the account is already linked to Shipwreck, use that same account.
4. If there is no accessible installation, Shipwreck opens GitHub's installer. Install on your personal account or organization and choose **Only select repositories**. An organization administrator may need to approve the request.
5. Return to Shipwreck, create a project, and click **Browse connected repositories**. Private repositories are marked **Private**.
6. Select a repository and branch, optionally enter the production URL, and run a Hull Check.

Shipwreck stores the selected installation ID with the project. Manually typing a repository name follows the existing public repository workflow; use the picker to bind a private repository to its installation. For an existing project, its repository can be changed to another repository accessible through the same installation. Create a new project to select a different installation.

**Manage repository access** opens the installation flow again. **View installations** lists only accessible, active installations with contents permissions for the configured App. **Disconnect App** deletes the account's encrypted App credentials and stops future private scans. It preserves projects and reports and does not uninstall the App from a shared GitHub organization; manage the installation in GitHub to uninstall it.

Installation listing supports up to 1,000 installations, and repository browsing supports up to 1,000 repositories per installation. Larger listings report a limit instead of silently truncating the choices. Existing scan file and byte limits still apply.

## Access and token lifecycle

- App private keys remain deployment secrets. Shipwreck signs RS256 JWTs with backdated issuance and a lifetime below ten minutes.
- Authorization uses encrypted, ten-minute state cookies bound to the Shipwreck user and flow purpose, plus PKCE S256. Setup callbacks cannot grant access by submitting an installation ID alone.
- GitHub App user and refresh tokens are encrypted with AES-256-GCM. The connection records the App ID and GitHub identity. Tokens are never included in workspace/repository API responses.
- Expiring user credentials refresh one minute before expiry. A database-backed lease prevents multiple application instances from using the same rotating refresh token concurrently. Disconnect/reconnect invalidates the lease so a stale refresh cannot restore deleted credentials.
- Before issuing an installation token, Shipwreck requests repository metadata with the **user access token**, then checks the repository's installation using the **App JWT**. This enforces the intersection of GitHub user membership and the App's selected repositories, including organization repositories.
- Each installation token requests exactly one `repository_id` and `contents: read`. Returned tokens must be unexpired and carry no write permissions. They remain only in request memory and are revoked after ingestion/branch lookup, including failure paths. Revocation is best effort; GitHub's expiry is the fallback.

The user-token intersection is described in [GitHub's user access token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app). Repository and permission restrictions for installation tokens are documented in [GitHub's installation token guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

## Troubleshooting

- **App is not configured:** provide all App credentials, an encryption key, and either the PEM value or private-key path.
- **Organization approval pending:** an administrator must approve the installation. Reconnect after approval.
- **Connection failed:** check exact callback/setup origins, ensure the expected GitHub account is used, and restart expired authorization flows from Settings. If your organization uses SAML SSO, authorize with an active organization SAML session.
- **Expired or missing browser state:** start a fresh connection from Settings on the canonical `APP_URL` and finish in the same browser tab. Keep **Request user authorization (OAuth) during installation** unchecked so installation returns through the setup flow Shipwreck started.
- **Client credentials or callback rejected:** check the GitHub App registration and deployed `GITHUB_APP_CLIENT_ID`/`GITHUB_APP_CLIENT_SECRET`. The separate public-repository OAuth App uses different credentials and a different callback path.
- **Account conflict:** use the GitHub identity already linked to this Shipwreck workspace. Connecting an identity owned by another Shipwreck account does not move that account's data or connection.
- **Repository unavailable:** verify the App is installed on that repository and your GitHub account still has repository access. Suspended installations and revoked grants deliberately stop scans.
- **Authorization being refreshed:** another request holds the refresh lease; retry in a moment. Failed refreshes release the lease; a crashed worker's lease expires after 45 seconds.
- **Expired refresh authorization:** reconnect the App. Encryption-key rotation also requires re-encrypting stored tokens or disconnecting/reconnecting.

## Verification scope

Automated tests exercise JWT signing, PKCE, encrypted callback state, account boundaries, forged/suspended/wrong-App installations, revoked access, repository-scoped token issuance, failed-ingestion revocation, pagination, refresh rotation/concurrency, disconnect races, and the idempotent schema upgrade. A browser test exercises private repository selection, installation-aware branches and project creation, installation listing, and disconnect.

Authentication integration tests also exercise successful App connection, callback replay, changed browser state/accounts, installation setup and reauthorization, provider errors, and identity conflicts.

GitHub provider responses in these tests are simulated. Live authorization requires an operator to approve the GitHub flow; automated tests do not verify that consent. Failed callbacks return specific error codes and log only those fixed reason codes, without cookies, authorization codes, tokens, or provider response bodies.

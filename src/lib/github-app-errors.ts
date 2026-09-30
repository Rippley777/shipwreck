export const githubAppErrors = {
  "github-app-connection-failed":
    "GitHub App connection could not finish. Start again from Settings.",
  "github-app-state-invalid":
    "This GitHub App connection attempt expired or lost its browser state. Start again from Settings on the same Shipwreck domain and finish in one tab.",
  "github-app-authorization-denied":
    "GitHub App authorization was cancelled or did not include an authorization code. Start again from Settings and approve access.",
  "github-app-client-credentials":
    "GitHub rejected the App's client credentials. The site administrator must update the deployed GitHub App client ID and client secret.",
  "github-app-redirect-mismatch":
    "The GitHub App callback URL does not match this deployment. The site administrator must check the registered callback URL.",
  "github-app-code-expired":
    "The GitHub authorization code expired or was already used. Start a new connection from Settings.",
  "github-app-email-unverified":
    "Verify your primary email address on GitHub, then connect the GitHub App again.",
  "github-app-token-failed":
    "GitHub could not complete the App authorization exchange. Start a new connection from Settings; if it fails again, contact the site administrator.",
  "github-app-profile-failed":
    "GitHub authorized the App, but Shipwreck could not read your GitHub account. Try connecting again.",
  "github-app-installation-access":
    "Shipwreck could not verify access to the GitHub App installation. Check that the App is installed for your GitHub account or organization with read access to repository contents.",
  "github-app-account-mismatch":
    "This GitHub account conflicts with an existing Shipwreck account connection. Sign in to the GitHub account already linked to your Shipwreck workspace.",
  "github-app-save-failed":
    "GitHub authorization succeeded, but Shipwreck could not save the connection. Try again; if it fails again, contact the site administrator.",
  "github-app-rate-limited":
    "Too many GitHub App connection attempts. Wait 15 minutes before trying again.",
};

export type GitHubAppFailureCode = keyof typeof githubAppErrors;

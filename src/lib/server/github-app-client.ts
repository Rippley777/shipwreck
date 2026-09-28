import { github } from "./github";
import { appJWT, githubAppConfig } from "./github-app-config";
export type AppInstallation = {
  id: number;
  app_id: number;
  account: { login: string };
  suspended_at: string | null;
  permissions: Record<string, string>;
};
export type AppRepository = {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
  installation_id: string;
};
type Repository = Omit<AppRepository, "installation_id">;
export type GitHubRequest = typeof github;
export class GitHubAppClient {
  constructor(
    private readonly request: GitHubRequest = github,
    private readonly jwt: () => Promise<string> = appJWT,
    private readonly appId: () => string = () => githubAppConfig().id,
  ) {}
  private usable(installation: AppInstallation) {
    return (
      String(installation.app_id) === this.appId() &&
      !installation.suspended_at &&
      ["read", "write"].includes(installation.permissions.contents)
    );
  }
  async installations(userToken: string): Promise<AppInstallation[]> {
    const result: AppInstallation[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await this.request<{
        installations: AppInstallation[];
        total_count: number;
      }>(`/user/installations?per_page=100&page=${page}`, userToken);
      result.push(...data.installations.filter((i) => this.usable(i)));
      if (data.installations.length < 100 || page * 100 >= data.total_count)
        return result;
    }
    throw new Error(
      "Too many GitHub installations to list. Restrict this GitHub App to the accounts you need.",
    );
  }
  async repositories(userToken: string): Promise<AppRepository[]> {
    const result: AppRepository[] = [];
    for (const installation of await this.installations(userToken)) {
      for (let page = 1; page <= 10; page++) {
        const data = await this.request<{
          repositories: Repository[];
          total_count: number;
        }>(
          `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`,
          userToken,
        );
        result.push(
          ...data.repositories.map((r) => ({
            id: r.id,
            full_name: r.full_name,
            default_branch: r.default_branch,
            private: r.private,
            installation_id: String(installation.id),
          })),
        );
        if (data.repositories.length < 100 || page * 100 >= data.total_count)
          break;
        if (page === 10)
          throw new Error(
            "An installation exceeds 1,000 repositories. Select fewer repositories in GitHub App settings.",
          );
      }
    }
    return result;
  }
  async validateRepository(
    userToken: string,
    repository: string,
    installationId: string,
  ) {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      !/^[1-9]\d*$/.test(installationId)
    )
      throw new Error("Invalid repository or GitHub installation.");
    // This request uses a USER token: GitHub enforces the intersection of user and App access.
    const repo = await this.request<Repository>(
      `/repos/${repository}`,
      userToken,
    );
    if (
      repo.full_name.toLowerCase() !== repository.toLowerCase() ||
      !Number.isSafeInteger(repo.id) ||
      repo.id <= 0
    )
      throw new Error(
        "GitHub repository identity changed. Select the repository again.",
      );
    const installation = await this.request<AppInstallation>(
      `/repos/${repository}/installation`,
      await this.jwt(),
    );
    if (
      String(installation.id) !== installationId ||
      !this.usable(installation)
    )
      throw new Error(
        "The GitHub App installation cannot access this repository. Reconnect or update repository access.",
      );
    return repo;
  }
  async repositoryToken(
    userToken: string,
    repository: string,
    installationId: string,
  ) {
    const repo = await this.validateRepository(
      userToken,
      repository,
      installationId,
    );
    const data = await this.request<{
      token: string;
      expires_at: string;
      permissions: Record<string, string>;
    }>(`/app/installations/${installationId}/access_tokens`, await this.jwt(), {
      method: "POST",
      body: { repository_ids: [repo.id], permissions: { contents: "read" } },
    });
    if (
      !data.token ||
      !Number.isFinite(Date.parse(data.expires_at)) ||
      Date.parse(data.expires_at) <= Date.now() + 30_000 ||
      data.permissions.contents !== "read" ||
      Object.values(data.permissions).some(
        (value) => value === "write" || value === "admin",
      )
    ) {
      if (data.token) await this.revoke(data.token).catch(() => {});
      throw new Error(
        "GitHub did not issue the required read-only installation token.",
      );
    }
    return data.token;
  }
  async withRepository<T>(
    userToken: string,
    repository: string,
    installationId: string,
    operation: (token: string) => Promise<T>,
  ) {
    const token = await this.repositoryToken(
      userToken,
      repository,
      installationId,
    );
    try {
      return await operation(token);
    } finally {
      await this.revoke(token).catch(() => {});
    }
  }
  async revoke(token: string) {
    await this.request("/installation/token", token, { method: "DELETE" });
  }
}
export const githubAppClient = new GitHubAppClient();

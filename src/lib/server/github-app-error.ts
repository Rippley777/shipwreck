import {
  githubAppErrors,
  type GitHubAppFailureCode,
} from "../github-app-errors";

export class GitHubAppError extends Error {
  constructor(readonly reason: GitHubAppFailureCode) {
    super(githubAppErrors[reason]);
    this.name = "GitHubAppError";
  }
}

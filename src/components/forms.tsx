"use client";
import { useState } from "react";
import Link from "next/link";
import type { Project } from "@/lib/server/workspace";
import { api } from "@/lib/client";
import { Logo } from "./ui";
import {
  ArrowRight,
  ChevronDown,
  FolderGit2,
  GitBranch,
  Github,
  Globe,
  LoaderCircle,
  Radar,
  ShieldCheck,
} from "lucide-react";
export function ProjectSettings({
  project,
  onSaved,
  onDeleted,
}: {
  project: Project;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api("projects/update", {
        id: project.id,
        name: f.get("name"),
        repository: f.get("repository"),
        branch: f.get("branch"),
        production_url: f.get("production_url"),
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel padded settings-panel">
      <h2>Project configuration</h2>
      {project.github_installation_id && (
        <div className="info-box">
          <ShieldCheck size={17} />
          <p>
            Connected through GitHub App installation{" "}
            {project.github_installation_id}. Manage private repository access
            in workspace settings.
          </p>
        </div>
      )}
      <form onSubmit={submit}>
        <label>
          Project name
          <input name="name" required defaultValue={project.name} />
        </label>
        <label>
          Repository
          <input
            name="repository"
            required
            defaultValue={project.repository}
            readOnly={project.source === "demo"}
          />
        </label>
        <label>
          Branch
          <input name="branch" required defaultValue={project.branch} />
        </label>
        <label>
          Production URL
          <input
            name="production_url"
            type="url"
            defaultValue={project.production_url ?? ""}
            placeholder="https://your-app.com"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
      <hr />
      <h3 className="red-text">Delete project</h3>
      <p className="muted">
        Permanently deletes this project and all of its reports.
      </p>
      {confirm ? (
        <div className="danger-confirm">
          <p>
            Delete <strong>{project.name}</strong> and its scan history? This
            cannot be undone.
          </p>
          <button
            className="button danger"
            onClick={async () => {
              try {
                await api("projects/delete", { id: project.id });
                await onDeleted();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Yes, delete project
          </button>
          <button className="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="button danger" onClick={() => setConfirm(true)}>
          Delete project
        </button>
      )}
    </section>
  );
}

export function AuthForm({
  mode,
  onSwitch,
  onSuccess,
}: {
  mode: "login" | "signup";
  onSwitch: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("auth/" + mode, {
        email: data.get("email"),
        password: data.get("password"),
        ...(mode === "signup" ? { name: data.get("name") } : {}),
      });
      await onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Logo />
      <h2>
        {mode === "signup"
          ? "Your next launch deserves better."
          : "Welcome back aboard."}
      </h2>
      <p>
        {mode === "signup"
          ? "Create your workspace with email and password. Connect GitHub afterward in Settings to choose your repositories."
          : "Sign in with your Shipwreck email and password. Manage your GitHub connection in Settings."}
      </p>
      <form onSubmit={submit}>
        {mode === "signup" && (
          <label>
            Name
            <input
              name="name"
              required
              autoComplete="name"
              placeholder="Your name"
            />
          </label>
        )}
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={200}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            placeholder="At least 12 characters"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={17} /> : null}
          {mode === "signup" ? "Create account" : "Sign in"}
          <ArrowRight size={16} />
        </button>
      </form>
      <button className="auth-switch" onClick={onSwitch}>
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "New to Shipwreck? Create an account"}
      </button>
    </>
  );
}

export function NewProject({
  onCreated,
  githubConnected,
  githubAppAvailable,
  githubAppConnected,
}: {
  onCreated: (id: string) => Promise<void>;
  githubConnected: boolean;
  githubAppAvailable: boolean;
  githubAppConnected: boolean;
}) {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [repos, setRepos] = useState<
    {
      full_name: string;
      default_branch: string;
      private: boolean;
      installation_id: string | null;
    }[]
  >([]);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("projects", {
        name,
        repository: repository
          .replace(/^https:\/\/github.com\//, "")
          .replace(/\.git$/, ""),
        branch,
        production_url: url,
        github_installation_id: installationId,
      });
      await onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="modal-symbol">
        <FolderGit2 size={25} />
      </div>
      <div className="eyebrow">YOUR NEXT VOYAGE</div>
      <h2>Let’s see what’s shipworthy.</h2>
      <p>
        Connect your repository. Get a clear picture of what could sink your
        launch.
      </p>
      <form onSubmit={submit}>
        <label>
          Project name
          <input
            autoFocus
            required
            minLength={2}
            maxLength={60}
            placeholder="my-next-big-thing"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          GitHub repository
          <div className="input-icon">
            <Github size={17} />
            <input
              required
              placeholder="owner / repository"
              value={repository}
              onChange={(e) => {
                setRepository(e.target.value);
                setInstallationId(null);
                setBranches([]);
              }}
            />
          </div>
        </label>
        {githubAppAvailable && !githubAppConnected && (
          <Link
            prefetch={false}
            className="text-button mint-text"
            href="/api/github/app/connect"
          >
            Connect GitHub App for private repositories
            <ArrowRight size={14} />
          </Link>
        )}
        {githubConnected && (
          <>
            <button
              type="button"
              className="text-button mint-text"
              onClick={async () => {
                try {
                  setRepos(await api("repositories"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Browse connected repositories
              <ChevronDown size={14} />
            </button>
            {repos.length > 0 && (
              <select
                aria-label="Select repository"
                onChange={async (e) => {
                  const repo = repos.find(
                    (r) => r.full_name === e.target.value,
                  );
                  if (repo) {
                    setRepository(repo.full_name);
                    setInstallationId(repo.installation_id);
                    setBranches([]);
                    setBranch(repo.default_branch);
                    if (!name) setName(repo.full_name.split("/")[1]);
                    try {
                      setBranches(
                        await api(
                          "branches?repository=" +
                            encodeURIComponent(repo.full_name) +
                            (repo.installation_id
                              ? "&installation_id=" +
                                encodeURIComponent(repo.installation_id)
                              : ""),
                        ),
                      );
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }
                }}
              >
                <option>Select repository</option>
                {repos.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                    {r.private ? " · Private" : " · Public"}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        {installationId && (
          <div className="info-box">
            <ShieldCheck size={17} />
            <p>
              This repository uses read-only GitHub App access. Membership and
              installation access are verified for every scan.
            </p>
          </div>
        )}
        <label>
          Branch
          <div className="input-icon">
            <GitBranch size={16} />
            {branches.length ? (
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            ) : (
              <input
                required
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            )}
          </div>
        </label>
        <label>
          Production URL <span className="muted">optional</span>
          <div className="input-icon">
            <Globe size={16} />
            <input
              type="url"
              placeholder="https://your-app.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </label>
        <div className="info-box">
          <ShieldCheck size={17} />
          <p>
            Read-only inspection. Your code stays private. Public GitHub
            repositories work without connecting an account.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Radar size={17} />
          )}{" "}
          {busy ? "Creating project…" : "Create project & run Hull Check"}
          <ArrowRight size={16} />
        </button>
      </form>
    </>
  );
}

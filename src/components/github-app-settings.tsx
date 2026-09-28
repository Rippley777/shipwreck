"use client";
import { useState } from "react";
import Link from "next/link";
import { Github, ArrowUpRight, ShieldCheck, LoaderCircle } from "lucide-react";
import { api } from "@/lib/client";
type Installation = { id: number; account: { login: string } };
export function GitHubAppSettings({
  configured,
  connection,
  demo,
  onSignup,
  onChanged,
}: {
  configured: boolean;
  connection: { login: string } | null;
  demo: boolean;
  onSignup: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [installations, setInstallations] = useState<Installation[] | null>(
    null,
  );
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await api("github/app/disconnect", {});
      setInstallations(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="settings-row">
        <div>
          <h3>
            <Github size={18} />
            Private repository access
          </h3>
          <p>
            {connection
              ? `GitHub App connected as ${connection.login}`
              : "Connect the GitHub App to scan selected private repositories."}
          </p>
          <small>
            <ShieldCheck size={13} /> Read-only contents access. Scans use a
            temporary token restricted to one repository.
          </small>
          {!configured && !demo && (
            <p className="amber-text">
              The GitHub App must be configured on this server before you can
              connect it.
            </p>
          )}
        </div>
        {demo ? (
          <button className="button" onClick={onSignup}>
            Create an account
            <ArrowUpRight size={15} />
          </button>
        ) : configured ? (
          <Link
            prefetch={false}
            className="button"
            href="/api/github/app/connect"
          >
            {connection ? "Reconnect App" : "Connect GitHub App"}
            <ArrowUpRight size={15} />
          </Link>
        ) : (
          <button className="button" disabled>
            Connect GitHub App
          </button>
        )}
      </div>
      {connection && (
        <>
          <div className="github-app-actions">
            <Link
              prefetch={false}
              className="button"
              href="/api/github/app/install"
            >
              Manage repository access
              <ArrowUpRight size={14} />
            </Link>
            <button
              className="button"
              onClick={async () => {
                setError("");
                try {
                  setInstallations(await api("github/app/installations"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              View installations
            </button>
            <button className="button" disabled={busy} onClick={disconnect}>
              {busy ? <LoaderCircle size={14} className="spin" /> : null}
              Disconnect App
            </button>
          </div>
          <small className="muted">
            Disconnecting removes stored App credentials and stops new private
            scans. Manage the installation in GitHub to uninstall it.
          </small>
          {installations && (
            <div className="github-installations">
              {installations.length ? (
                installations.map((i) => (
                  <div key={i.id}>
                    <Github size={15} />
                    <strong>{i.account.login}</strong>
                    <span>Installation {i.id}</span>
                  </div>
                ))
              ) : (
                <p>
                  No accessible installations. Install the App on an account and
                  select repositories.
                </p>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

"use client";
import {
  Anchor,
  X,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  FolderGit2,
  GitBranch,
  Github,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Radar,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

import type { CheckResult } from "@/lib/scanner/types";
import type { Project, StoredScan } from "@/lib/server/workspace";
import { Overview } from "./overview";
import { Logo, Status, PageTitle } from "./ui";
import { Findings, HistoryList } from "./reports";
import { NewProject, AuthForm, ProjectSettings } from "./forms";
import { api, ago, type Modal } from "@/lib/client";
import { fixPrompt } from "@/lib/scanner/prompt";
type Workspace = {
  user: { name: string; email: string; demo: boolean };
  projects: Project[];
  github: string | null;
  oauthConfigured: boolean;
};
export function Dashboard() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState("overview");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState("Overview");
  const [modal, setModal] = useState<Modal>(null);
  const [finding, setFinding] = useState<CheckResult | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All projects");
  const [mobile, setMobile] = useState(false);
  const [selectedScan, setSelectedScan] = useState<StoredScan | null>(null);
  const load = useCallback(async () => {
    const data = await api("workspace");
    if (data.user) setWorkspace(data);
    else setWorkspace(null);
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let data = await api("workspace");
        if (!data.user && data.demoEnabled) {
          await api("auth/demo", {});
          data = await api("workspace");
        }
        if (active) {
          if (data.user) setWorkspace(data);
          else setModal("login");
          const reason = new URLSearchParams(window.location.search).get(
            "error",
          );
          if (reason)
            setError(
              reason === "github-not-configured"
                ? "Configure GitHub OAuth environment variables to connect your account."
                : reason === "create-account-first"
                  ? "Create an account before connecting GitHub."
                  : "GitHub connection failed. Please try again.",
            );
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModal(null);
        setFinding(null);
        setMobile(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("project-search")?.focus();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!modal && !finding) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = oldOverflow;
      dialog.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal, finding]);
  const projects = workspace?.projects ?? [];
  const project = projects.find((p) => p.id === projectId);
  const report = selectedScan?.report ?? project?.latest?.report;
  const totals = projects.reduce(
    (t, p) => ({
      critical: t.critical + (p.latest?.report.counts.critical ?? 0),
      risks: t.risks + (p.latest?.report.counts.warnings ?? 0),
      passed: t.passed + (p.latest?.report.counts.passed ?? 0),
    }),
    { critical: 0, risks: 0, passed: 0 },
  );
  const repaired = projects.reduce((total, p) => {
    const previous = p.history?.[1]?.report;
    return (
      total +
      (previous && p.latest
        ? Math.max(
            0,
            previous.counts.critical - p.latest.report.counts.critical,
          )
        : 0)
    );
  }, 0);
  function navigate(next: string) {
    setPage(next);
    setProjectId(null);
    setSelectedScan(null);
    setQuery("");
    setMobile(false);
  }
  function openProject(p: Project, next = "Overview") {
    setProjectId(p.id);
    setTab(next);
    setSelectedScan(null);
    setPage("project");
  }
  async function run(p: Project) {
    if (scanning) return;
    setScanning(p.id);
    setError("");
    try {
      await api("scans", { projectId: p.id });
      await load();
      setSelectedScan(null);
      setNotice(`Hull Check complete for ${p.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(null);
    }
  }
  async function signout() {
    try {
      await api("auth/logout", {});
      setWorkspace(null);
      setProjectId(null);
      setModal("login");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Fix prompt copied. Ready for your coding agent.");
    } catch {
      setError(
        "Clipboard unavailable. Select and copy the prompt in the finding panel.",
      );
    }
  }
  const nav = [
    { id: "overview", name: "Overview", icon: LayoutDashboard },
    { id: "projects", name: "Projects", icon: FolderGit2 },
    { id: "checks", name: "Hull Checks", icon: Radar },
    { id: "risks", name: "All risks", icon: Shield },
  ];
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <Logo />
        <button
          className="workspace-switch"
          onClick={() =>
            setNotice(
              workspace?.user.demo
                ? "This is your isolated demo workspace. Create an account to save your own projects."
                : "Your personal workspace. Team workspaces are planned.",
            )
          }
        >
          <span className="workspace-avatar">
            {workspace?.user.demo ? "A" : workspace?.user.name.charAt(0) || "S"}
          </span>
          <span>
            {workspace?.user.demo
              ? "Acme workspace"
              : workspace?.user.name || "Your workspace"}
            <small>
              {workspace?.user.demo ? "Demo workspace" : "Personal workspace"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={"nav-item " + (page === item.id ? "active" : "")}
            >
              <item.icon size={18} />
              {item.name}
              {item.id === "projects" && (
                <span className="nav-count">{projects.length}</span>
              )}
              {item.id === "risks" && totals.critical > 0 && (
                <span className="nav-count critical">{totals.critical}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label project-label">
          YOUR PROJECTS
          <button aria-label="Add project" onClick={() => setModal("project")}>
            <Plus size={15} />
          </button>
        </div>
        <div className="project-nav">
          {projects.map((p, i) => (
            <button
              className={"nav-item " + (projectId === p.id ? "active" : "")}
              key={p.id}
              onClick={() => openProject(p)}
            >
              <span className={"project-dot dot-" + i} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          {!projects.length && (
            <p className="muted small">Your first voyage starts here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-callout">
            <span className="mini-label">
              <Waves size={16} /> BUILT TO SHIP
            </span>
            <strong>
              Your code floats.
              <br />
              Will your system?
            </strong>
            <button
              onClick={() => setModal(workspace?.user.demo ? "signup" : "docs")}
            >
              {workspace?.user.demo
                ? "Make it your workspace"
                : "Explore the check library"}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="nav-item" onClick={() => setModal("docs")}>
            <BookOpen size={17} />
            Documentation
            <ArrowUpRight size={14} className="push" />
          </button>
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => navigate("settings")}
          >
            <Settings size={17} />
            Settings
          </button>
          <div className="user-card">
            <span className="user-avatar">
              {workspace?.user.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("") || "SW"}
            </span>
            <span>
              <strong>{workspace?.user.name || "Welcome aboard"}</strong>
              <small>
                {workspace?.user.demo
                  ? "Personal account"
                  : workspace?.user.email || "Sign in to continue"}
              </small>
            </span>
            <button title="Sign out" aria-label="Sign out" onClick={signout}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <>
        {mobile && (
          <button
            className="mobile-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
      </>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              aria-label="Open menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {project?.name ||
                ({
                  overview: "Overview",
                  projects: "Projects",
                  checks: "Hull Checks",
                  risks: "All risks",
                  settings: "Settings",
                }[page] ??
                  "Overview")}
            </strong>
            {workspace?.user.demo && <span className="demo-tag">DEMO</span>}
          </div>
          <div className="topbar-actions">
            <span className="system-status">
              <span />
              Scanner ready
            </span>
            <div className="topbar-divider" />
            <button aria-label="Documentation" onClick={() => setModal("docs")}>
              <CircleHelp size={18} />
            </button>
            <button
              aria-label="Notifications"
              className="notification-button"
              onClick={() => setModal("notifications")}
            >
              <Bell size={18} />
              {totals.critical > 0 && <i />}
            </button>
            <span className="top-avatar">
              {workspace?.user.name.charAt(0) || "S"}
            </span>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <Radar size={42} className="spin" />
              <h2>Getting your bearings…</h2>
              <p>Preparing your workspace and demo Hull Checks.</p>
            </div>
          ) : !workspace ? (
            <div className="signed-out">
              <Logo />
              <h1>
                Find what sinks
                <br />
                before you ship.
              </h1>
              <p>Evidence-backed production readiness for your next launch.</p>
              <button
                className="button primary"
                onClick={() => setModal("login")}
              >
                Sign in
                <ArrowRight size={16} />
              </button>
              <button className="button" onClick={() => setModal("signup")}>
                Create account
              </button>
            </div>
          ) : (
            <>
              {(page === "overview" || page === "projects") && (
                <Overview
                  page={page}
                  projects={projects}
                  totals={totals}
                  repaired={repaired}
                  scanning={scanning}
                  filter={filter}
                  query={query}
                  setModal={setModal}
                  run={run}
                  navigate={navigate}
                  setFilter={setFilter}
                  setQuery={setQuery}
                  openProject={openProject}
                  setFinding={setFinding}
                />
              )}
              {page === "project" && project && (
                <>
                  <div className="page-heading project-heading">
                    <div>
                      <button
                        className="back-link"
                        onClick={() => navigate("overview")}
                      >
                        ← All projects
                      </button>
                      <h1>
                        {project.name}
                        <Status status={report?.status} />
                      </h1>
                      <p>
                        <Github size={14} />
                        {project.repository}
                        <span>·</span>
                        <GitBranch size={14} />
                        {project.branch}
                        {project.source === "demo" && (
                          <span className="demo-tag">DEMO FIXTURE</span>
                        )}
                      </p>
                    </div>
                    <button
                      className="button primary"
                      disabled={!!scanning}
                      onClick={() => run(project)}
                    >
                      {scanning === project.id ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Radar size={17} />
                      )}{" "}
                      {scanning === project.id
                        ? "Scanning repository…"
                        : "Run Hull Check"}
                    </button>
                  </div>
                  <div className="tabs">
                    {[
                      "Overview",
                      "Hull Check",
                      "Environment",
                      "Manifest",
                      "History",
                      "Settings",
                    ].map((t) => (
                      <button
                        className={tab === t ? "active" : ""}
                        key={t}
                        onClick={() => {
                          setTab(t);
                          setSelectedScan(null);
                        }}
                      >
                        {t === "History" && <History size={14} />} {t}
                      </button>
                    ))}
                  </div>
                  {selectedScan && (
                    <div className="info-banner">
                      <History size={17} />
                      Viewing scan from{" "}
                      {new Date(selectedScan.created_at).toLocaleString()}
                      <button onClick={() => setSelectedScan(null)}>
                        Return to latest
                      </button>
                    </div>
                  )}
                  {(tab === "Overview" || tab === "Hull Check") &&
                    (report ? (
                      <>
                        <div className="report-summary">
                          <div>
                            <div className="mini-label">SHIPWRECK REPORT</div>
                            <h2>
                              {report.status === "Shipworthy"
                                ? "Ready for your next launch."
                                : `${report.counts.critical} critical findings deserve a closer look.`}
                            </h2>
                            <p>
                              {report.filesAnalyzed} files inspected ·{" "}
                              {report.counts.applicable} applicable checks ·{" "}
                              {report.counts.unverified} unable to verify
                            </p>
                            <div className="report-meta">
                              <span>
                                <Clock3 size={13} />
                                {ago(
                                  (selectedScan ?? project.latest)?.created_at,
                                )}
                              </span>
                              <span>
                                <GitBranch size={13} />
                                {(
                                  selectedScan ?? project.latest
                                )?.commit_sha?.slice(0, 12) || "No commit"}
                              </span>
                            </div>
                          </div>
                          <div className="coverage">
                            <div
                              className="coverage-circle"
                              style={
                                {
                                  "--coverage": report.coverage + "%",
                                } as React.CSSProperties
                              }
                            >
                              <span>
                                {report.coverage}
                                <small>%</small>
                              </span>
                            </div>
                            <span>
                              Checks passed
                              <small>
                                {report.counts.passed} /{" "}
                                {report.counts.applicable} applicable
                              </small>
                            </span>
                          </div>
                        </div>
                        <div className="report-note">
                          <CircleHelp size={15} />
                          Coverage is the share of applicable checks that
                          passed, not a prediction of safety. Unverified
                          findings require review.
                        </div>
                        <Findings
                          results={report.results}
                          onSelect={setFinding}
                        />
                      </>
                    ) : (
                      <div className="empty-state">
                        <Radar size={38} />
                        <h2>Let’s see if it’s shipworthy.</h2>
                        <p>
                          Run your first Hull Check to inspect this repository.
                        </p>
                        <button
                          className="button primary"
                          onClick={() => run(project)}
                        >
                          Run Hull Check
                        </button>
                      </div>
                    ))}
                  {tab === "Environment" && (
                    <section className="panel padded">
                      <div className="section-heading">
                        <div>
                          <h2>Environment inventory</h2>
                          <p>
                            Variable names and configuration coverage. Secret
                            values are never retained.
                          </p>
                        </div>
                        <span className="number-tag">
                          {report?.environment.length ?? 0} variables
                        </span>
                      </div>
                      <div className="overflow">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>VARIABLE</th>
                              <th>DOCUMENTATION</th>
                              <th>CLASSIFICATION</th>
                              <th>PRODUCTION</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report?.environment.map((v) => (
                              <tr key={v.name}>
                                <td>
                                  <code>{v.name}</code>
                                  <small>{v.locations[0]}</small>
                                </td>
                                <td>
                                  <span
                                    className={
                                      v.documented ? "mint-text" : "amber-text"
                                    }
                                  >
                                    {v.documented
                                      ? "Documented"
                                      : "Undocumented"}
                                  </span>
                                </td>
                                <td>
                                  {v.secret
                                    ? "Potentially secret"
                                    : "Configuration"}
                                  <small>
                                    {v.optional
                                      ? "Optional (fallback detected)"
                                      : v.referenced
                                        ? "Referenced · requiredness unverified"
                                        : "No recognized reference"}
                                  </small>
                                </td>
                                <td className="muted">Unable to verify</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!report && (
                        <p>
                          Run a Hull Check to discover environment variables.
                        </p>
                      )}
                    </section>
                  )}
                  {tab === "Manifest" && (
                    <section className="panel padded">
                      <h2>Infrastructure manifest</h2>
                      <p className="muted">
                        Detected from the repository snapshot. Provider
                        configuration remains unverified.
                      </p>
                      <div className="manifest-grid">
                        {report?.technologies.map((t) => (
                          <div className="manifest-item" key={t}>
                            <Code2 size={24} />
                            <strong>{t}</strong>
                            <span className="mint-text">
                              <Check size={13} />
                              Detected in source
                            </span>
                          </div>
                        ))}
                      </div>
                      {!report?.technologies.length && (
                        <p>Run a scan to detect supported technologies.</p>
                      )}
                    </section>
                  )}
                  {tab === "History" && (
                    <HistoryList
                      projects={[project]}
                      onOpen={(p, s) => {
                        openProject(p, "Hull Check");
                        setSelectedScan(s);
                      }}
                    />
                  )}
                  {tab === "Settings" && (
                    <ProjectSettings
                      project={project}
                      onSaved={async () => {
                        await load();
                        setNotice("Project settings saved.");
                      }}
                      onDeleted={async () => {
                        await load();
                        navigate("overview");
                        setNotice("Project and scan history deleted.");
                      }}
                    />
                  )}
                </>
              )}
              {page === "checks" && (
                <>
                  <PageTitle
                    title="Hull Checks"
                    sub="Every inspection. Every improvement. Your launch history."
                  />
                  <HistoryList
                    projects={projects}
                    onOpen={(p, s) => {
                      openProject(p, "Hull Check");
                      setSelectedScan(s);
                    }}
                  />
                </>
              )}
              {page === "risks" && (
                <>
                  <PageTitle
                    title="All risks"
                    sub="The most important findings across your workspace, with the evidence to act."
                  />
                  <Findings
                    results={projects.flatMap((p) =>
                      (p.latest?.report.results ?? [])
                        .filter(
                          (r) =>
                            r.status === "failed" || r.status === "unverified",
                        )
                        .map((r) => ({
                          ...r,
                          id: p.name + ":" + r.id,
                          title: p.name + " / " + r.title,
                        })),
                    )}
                    onSelect={setFinding}
                  />
                </>
              )}
              {page === "settings" && (
                <>
                  <PageTitle
                    title="Workspace settings"
                    sub="Your account, repository connection, and data."
                  />
                  <section className="panel padded settings-panel">
                    <h2>Personal account</h2>
                    <label>
                      Name
                      <input value={workspace.user.name} readOnly />
                    </label>
                    <label>
                      Email
                      <input
                        value={
                          workspace.user.demo
                            ? "Demo account — isolated to this session"
                            : workspace.user.email
                        }
                        readOnly
                      />
                    </label>
                    {workspace.user.demo && (
                      <button
                        className="button primary"
                        onClick={() => setModal("signup")}
                      >
                        Create your account
                        <ArrowRight size={16} />
                      </button>
                    )}
                    <hr />
                    <div className="settings-row">
                      <div>
                        <h3>
                          <Github size={18} />
                          GitHub connection
                        </h3>
                        <p>
                          {workspace.github
                            ? "Connected as " + workspace.github
                            : "Connect GitHub for repository selection and OAuth sign-in."}
                        </p>
                        <small>
                          Public repository access uses minimal OAuth scopes.
                          Private repository access requires a future GitHub App
                          integration.
                        </small>
                      </div>
                      <button
                        className="button"
                        onClick={() =>
                          workspace.user.demo
                            ? setModal("signup")
                            : window.location.assign(
                                new URL(
                                  "/api/auth/github",
                                  window.location.origin,
                                ).href,
                              )
                        }
                      >
                        {workspace.github ? "Reconnect" : "Connect GitHub"}
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <hr />
                    <h3>Data & retention</h3>
                    <p className="muted">
                      Reports retain file paths, redacted evidence and
                      environment variable names. Source files are analyzed in
                      memory and are not stored. Deleting a project removes its
                      full scan history.
                    </p>
                    <button className="button" onClick={signout}>
                      <LogOut size={15} />
                      Sign out
                    </button>
                  </section>
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Anchor size={13} />
              Find what sinks before you ship.
            </span>
            <span>
              DETERMINISTIC FIRST. EVIDENCE ALWAYS.
              <span className="footer-version">v0.1</span>
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {scanning && (
        <div className="scan-progress" role="status">
          <Radar size={20} className="spin" />
          <div>
            <strong>Running Hull Check</strong>
            <span>
              Inspecting repository evidence and production configuration…
            </span>
          </div>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={"modal " + (modal === "docs" ? "wide" : "")}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "project"
                ? "New project"
                : modal === "docs"
                  ? "Documentation"
                  : "Account and notifications"
            }
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "project" && (
              <NewProject
                githubConnected={!!workspace?.github}
                onCreated={async (id) => {
                  const data = await load();
                  setModal(null);
                  const p = data.projects.find((p: Project) => p.id === id);
                  if (p) {
                    openProject(p);
                    await run(p);
                  }
                }}
              />
            )}
            {(modal === "login" || modal === "signup") && (
              <AuthForm
                mode={modal}
                onSwitch={() =>
                  setModal(modal === "login" ? "signup" : "login")
                }
                onSuccess={async () => {
                  await load();
                  navigate("overview");
                  setModal(null);
                  setNotice("Welcome aboard. Your workspace is ready.");
                }}
              />
            )}
            {modal === "docs" && (
              <>
                <div className="modal-symbol">
                  <BookOpen size={24} />
                </div>
                <div className="eyebrow">THE SHIPWRECK FIELD GUIDE</div>
                <h2>Evidence before everything.</h2>
                <p>
                  Shipwreck checks production readiness, not code style. Here’s
                  how to get from repository to a safer launch.
                </p>
                <div className="doc-steps">
                  {[
                    [
                      "01",
                      "Connect a project",
                      "Enter a public GitHub repository, select a branch, and optionally add a production URL.",
                    ],
                    [
                      "02",
                      "Run a Hull Check",
                      "Independent deterministic checks inspect source and configuration. No code is executed and no repository content is sent to an AI provider.",
                    ],
                    [
                      "03",
                      "Inspect the evidence",
                      "Failed checks show a detected problem. “Unable to verify” means more evidence or human review is needed.",
                    ],
                    [
                      "04",
                      "Fix with your coding agent",
                      "Copy a detailed fix prompt into Codex, Claude Code, Cursor, or any agent. Rescan to track improvements.",
                    ],
                  ].map(([n, t, d]) => (
                    <div key={n}>
                      <span>{n}</span>
                      <div>
                        <h3>{t}</h3>
                        <p>{d}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="info-box">
                  <Terminal size={19} />
                  <div>
                    <strong>Run it locally</strong>
                    <code>npm run scan -- /path/to/repository</code>
                    <p>
                      For private repositories, scan a local checkout. Add
                      --json for a machine-readable report.
                    </p>
                  </div>
                </div>
              </>
            )}
            {modal === "notifications" && (
              <>
                <div className="modal-symbol">
                  <Bell size={24} />
                </div>
                <h2>Your launch watch</h2>
                <p>Latest findings across your projects.</p>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className="notification-row"
                    onClick={() => {
                      openProject(p);
                      setModal(null);
                    }}
                  >
                    <span className="amber-text">
                      <TriangleAlert size={20} />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.latest?.report.counts.critical ?? 0} critical
                        findings · {p.latest?.report.counts.warnings ?? 0} other
                        risks
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                {!projects.length && (
                  <p>No scans yet. Add a project to get started.</p>
                )}
              </>
            )}
          </section>
        </div>
      )}
      {finding && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFinding(null);
          }}
        >
          <aside
            className="finding-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={finding.title}
          >
            <div className="drawer-header">
              <span>
                <Shield size={16} /> FINDING DETAILS
              </span>
              <button
                aria-label="Close finding"
                onClick={() => setFinding(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="drawer-content">
              <div className="finding-labels">
                <span className={"severity " + finding.severity}>
                  {finding.severity}
                </span>
                <span className="number-tag">{finding.category}</span>
              </div>
              <h2>{finding.title}</h2>
              <div className="confidence">
                <span className="live-dot" />
                {finding.confidence} confidence <span>·</span>
                {finding.status === "unverified"
                  ? "Unable to verify"
                  : finding.status === "passed"
                    ? "Passed"
                    : "Detected problem"}
              </div>
              <section>
                <h3>What Shipwreck found</h3>
                <p>{finding.message}</p>
              </section>
              <section>
                <h3>Evidence</h3>
                <div className="evidence-list">
                  {finding.evidence.length ? (
                    finding.evidence.map((e, i) => (
                      <div key={i}>
                        <code>
                          <FileCode2 size={14} />
                          {e.file}
                          {e.line ? ":" + e.line : ""}
                        </code>
                        <p>{e.detail}</p>
                      </div>
                    ))
                  ) : (
                    <p>
                      No matching risk pattern was detected in the analyzed
                      files.
                    </p>
                  )}
                </div>
              </section>
              <section>
                <h3>Why it matters</h3>
                <p>{finding.why}</p>
              </section>
              <section>
                <h3>How to fix it</h3>
                <p>{finding.fix}</p>
              </section>
              <section className="fix-section">
                <div className="section-heading">
                  <h3>
                    <Sparkles size={16} /> Fix with AI
                  </h3>
                  <span className="demo-tag">NO AI CALL REQUIRED</span>
                </div>
                <p>
                  A ready-to-use prompt with the evidence your coding agent
                  needs.
                </p>
                <pre tabIndex={0}>{fixPrompt(finding)}</pre>
                <button
                  className="button primary full"
                  onClick={() => copy(fixPrompt(finding))}
                >
                  <Copy size={16} />
                  Copy fix prompt
                </button>
              </section>
            </div>
            <div className="drawer-footer">
              <ShieldCheck size={15} />
              Detected facts. Clearly labeled uncertainty.
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

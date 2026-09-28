"use client";
import type { Project } from "@/lib/server/workspace";
import type { CheckResult } from "@/lib/scanner/types";
import { ago, type Modal } from "@/lib/client";
import { Stat, RadarGraphic, Status, LayersIcon } from "./ui";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleHelp,
  Clock3,
  Code2,
  FolderGit2,
  GitBranch,
  Github,
  History,
  LoaderCircle,
  Plus,
  Radar,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  Waves,
} from "lucide-react";
export function Overview({
  page,
  projects,
  totals,
  repaired,
  scanning,
  filter,
  query,
  setModal,
  run,
  navigate,
  setFilter,
  setQuery,
  openProject,
  setFinding,
}: {
  page: string;
  projects: Project[];
  totals: { critical: number; risks: number; passed: number };
  repaired: number;
  scanning: string | null;
  filter: string;
  query: string;
  setModal: (modal: Modal) => void;
  run: (project: Project) => Promise<void>;
  navigate: (page: string) => void;
  setFilter: (filter: string) => void;
  setQuery: (query: string) => void;
  openProject: (project: Project, tab?: string) => void;
  setFinding: (finding: CheckResult) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> YOUR LAUNCH CONTROL CENTER
          </div>
          <h1>
            {page === "projects"
              ? "Your projects"
              : "Clear skies start with a Hull Check."}
          </h1>
          <p>
            {page === "projects"
              ? "Every application. Every environment. One clear picture."
              : "Know what could sink your app. Fix it before your users find it."}
          </p>
        </div>
        <button className="button primary" onClick={() => setModal("project")}>
          <Plus size={17} />
          New project
        </button>
      </div>
      {page === "overview" && (
        <>
          <section className="welcome-panel">
            <div className="welcome-copy">
              <div className="mini-label">
                <ShieldCheck size={15} /> PRODUCTION READINESS, VERIFIED.
              </div>
              <h2>
                Ship with confidence.
                <br />
                <span>Not crossed fingers.</span>
              </h2>
              <p>
                Your app passed the vibe check. Now make sure it
                <br className="desktop-break" /> survives production.
              </p>
              <div className="hero-actions">
                <button
                  className="button light"
                  disabled={!!scanning || !projects.length}
                  onClick={() => projects[0] && run(projects[0])}
                >
                  {scanning ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Radar size={16} />
                  )}{" "}
                  {scanning ? "Running Hull Check…" : "Run a Hull Check"}
                  <ArrowRight size={15} />
                </button>
                <button
                  className="text-button"
                  onClick={() => setModal("docs")}
                >
                  How it works
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
            <RadarGraphic />
            <div className="hero-coordinate">
              41° 24′ N &nbsp; 02° 10′ E <span>READY FOR WHAT’S AHEAD</span>
            </div>
          </section>
          <section className="stat-grid">
            <Stat
              title="Total projects"
              value={projects.length}
              icon={<FolderGit2 size={17} />}
              detail={
                <>
                  <span className="mint-text">
                    {projects.filter((p) => p.latest).length} monitored
                  </span>
                  <span>across your workspace</span>
                </>
              }
            />
            <Stat
              title="Critical findings"
              value={totals.critical}
              className="red-text"
              icon={<TriangleAlert size={17} />}
              detail={
                <>
                  <span className="red-text dot-label">Needs attention</span>
                  <span>includes unverified risks</span>
                </>
              }
              trend="red"
              values={[
                projects.reduce(
                  (n, p) =>
                    n +
                    (p.history?.[1]?.report.counts.critical ??
                      p.latest?.report.counts.critical ??
                      0),
                  0,
                ),
                totals.critical,
              ]}
            />
            <Stat
              title="Unresolved risks"
              value={totals.risks}
              className="amber-text"
              icon={<Shield size={17} />}
              detail={
                <>
                  <span className="amber-text">Review before launch</span>
                  <span>across all projects</span>
                </>
              }
              trend="amber"
              values={[
                projects.reduce(
                  (n, p) =>
                    n +
                    (p.history?.[1]?.report.counts.warnings ??
                      p.latest?.report.counts.warnings ??
                      0),
                  0,
                ),
                totals.risks,
              ]}
            />
            <Stat
              title="Critical findings repaired"
              value={repaired}
              icon={<CheckCheck size={17} />}
              detail={
                <>
                  <span className="mint-text">
                    <ArrowDownRight size={13} /> {repaired} fewer critical
                    findings
                  </span>
                  <span>since previous scans</span>
                </>
              }
              trend="mint"
              values={[0, repaired]}
            />
          </section>
        </>
      )}
      <section className="projects-section">
        <div className="section-heading">
          <div>
            <h2>
              Your projects{" "}
              <span className="number-tag">{projects.length}</span>
            </h2>
            <p>A fleet-wide view of what’s ready and what needs work.</p>
          </div>
          <button
            className="text-button"
            onClick={() =>
              navigate(page === "projects" ? "overview" : "projects")
            }
          >
            {page === "projects" ? "Back to overview" : "View all projects"}
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="table-toolbar">
          <div className="segmented">
            <button
              className={filter === "All projects" ? "selected" : ""}
              onClick={() => setFilter("All projects")}
            >
              All projects <span>{projects.length}</span>
            </button>
            <button
              className={filter === "Needs attention" ? "selected" : ""}
              onClick={() => setFilter("Needs attention")}
            >
              Needs attention
              <span className="amber-text">
                {
                  projects.filter(
                    (p) => p.latest && p.latest.report.status !== "Shipworthy",
                  ).length
                }
              </span>
            </button>
          </div>
          <label className="search-box">
            <Search size={15} />
            <input
              id="project-search"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </label>
        </div>
        <div className="project-table-wrap">
          <table className="project-table">
            <thead>
              <tr>
                <th>PROJECT</th>
                <th>PRODUCTION STATUS</th>
                <th>
                  FINDINGS <CircleHelp size={11} />
                </th>
                <th>
                  LAST HULL CHECK <ArrowDown size={11} />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projects
                .filter(
                  (p) =>
                    p.name.toLowerCase().includes(query.toLowerCase()) &&
                    (filter === "All projects" ||
                      p.latest?.report.status !== "Shipworthy"),
                )
                .map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="project-cell"
                        onClick={() => openProject(p)}
                      >
                        <span className={"project-icon icon-" + i}>
                          {i === 0 ? (
                            <LayersIcon />
                          ) : i === 1 ? (
                            <Terminal size={21} />
                          ) : (
                            <Waves size={22} />
                          )}
                        </span>
                        <span>
                          <strong>
                            {p.name}
                            <span className="project-demo">
                              {p.source === "demo" ? "DEMO" : ""}
                            </span>
                          </strong>
                          <small>
                            <Github size={12} />
                            {p.repository}
                            <span>·</span>
                            <GitBranch size={11} />
                            {p.branch}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <Status status={p.latest?.report.status} />
                    </td>
                    <td>
                      <div className="finding-counts">
                        <span className="red-text" title="Critical findings">
                          <TriangleAlert size={13} />
                          {p.latest?.report.counts.critical ?? "—"}
                        </span>
                        <span
                          className="amber-text"
                          title="Other unresolved risks"
                        >
                          <Shield size={13} />
                          {p.latest?.report.counts.warnings ?? "—"}
                        </span>
                        <span className="mint-text" title="Passed checks">
                          <Check size={14} />
                          {p.latest?.report.counts.passed ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="last-scan">
                        <Clock3 size={13} />
                        {ago(p.latest?.created_at)}
                      </span>
                    </td>
                    <td>
                      <button
                        className="row-arrow"
                        aria-label={"View " + p.name}
                        onClick={() => openProject(p)}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!projects.filter((p) =>
            p.name.toLowerCase().includes(query.toLowerCase()),
          ).length && (
            <div className="empty-state">
              <FolderGit2 size={28} />
              <h3>
                {projects.length
                  ? "No projects match your search"
                  : "Your first launch starts here"}
              </h3>
              <p>Connect a repository to find out what needs attention.</p>
              <button className="button" onClick={() => setModal("project")}>
                <Plus size={15} />
                Add project
              </button>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            <span className="live-dot" /> Repository evidence. Real findings. No
            guesswork.
          </span>
          <span>
            {projects.filter((p) => p.latest).length} projects scanned
          </span>
        </div>
      </section>
      {page === "overview" && (
        <div className="bottom-grid">
          <section className="panel activity-panel">
            <div className="section-heading">
              <h2>
                <History size={17} /> Recent activity
              </h2>
              <button
                className="icon-button"
                aria-label="View all scan history"
                onClick={() => navigate("checks")}
              >
                <ArrowUpRight size={16} />
              </button>
            </div>
            {projects
              .flatMap((p) =>
                (p.history ?? []).slice(0, 1).map((s) => ({ p, s })),
              )
              .slice(0, 3)
              .map(({ p, s }) => (
                <button
                  className="activity-row"
                  key={s.id}
                  onClick={() => openProject(p, "History")}
                >
                  <span className="activity-icon">
                    <Check size={15} />
                  </span>
                  <span>
                    <strong>
                      Hull Check completed <span>for</span> {p.name}
                    </strong>
                    <small>
                      {s.report.counts.passed} passed ·{" "}
                      {s.report.counts.critical} critical findings to review
                    </small>
                  </span>
                  <time>{ago(s.created_at)}</time>
                </button>
              ))}
          </section>
          <section className="panel agent-panel">
            <span className="agent-icon">
              <Sparkles size={21} />
            </span>
            <div className="mini-label">FROM FINDING TO FIX</div>
            <h2>
              Your coding agent.
              <br /> Our production context.
            </h2>
            <p>
              Turn every finding into a clear, evidence-backed
              <br />
              fix prompt. Less guessing. More shipping.
            </p>
            <button
              className="text-button mint-text"
              onClick={() => {
                const f = projects[0]?.latest?.report.results.find(
                  (r) => r.status === "unverified" || r.status === "failed",
                );
                if (f) setFinding(f);
                else setModal("docs");
              }}
            >
              Explore AI fix prompts
              <ArrowRight size={15} />
            </button>
            <div className="agent-tools">
              <span>
                <Terminal size={13} />
                Codex
              </span>
              <span>✳ Claude Code</span>
              <span>
                <Code2 size={13} />
                Cursor
              </span>
              <span>+ any agent</span>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

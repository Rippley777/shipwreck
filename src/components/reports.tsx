"use client";
import { useState } from "react";
import type { Project, StoredScan } from "@/lib/server/workspace";
import type { CheckResult } from "@/lib/scanner/types";
import { Status } from "./ui";
import {
  Check,
  ChevronRight,
  CircleHelp,
  History,
  Radar,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
export function HistoryList({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (p: Project, s: StoredScan) => void;
}) {
  return (
    <section className="panel padded">
      <div className="section-heading">
        <div>
          <h2>Scan history</h2>
          <p>Immutable reports from each repository snapshot.</p>
        </div>
        <History size={20} />
      </div>
      <div className="history-list">
        {projects
          .flatMap((p) => (p.history ?? []).map((s) => ({ p, s })))
          .sort(
            (a, b) =>
              new Date(b.s.created_at).getTime() -
              new Date(a.s.created_at).getTime(),
          )
          .map(({ p, s }) => (
            <button
              className="history-row"
              key={s.id}
              onClick={() => onOpen(p, s)}
            >
              <span className="activity-icon">
                <Radar size={18} />
              </span>
              <span>
                <strong>{p.name}</strong>
                <small>
                  {new Date(s.created_at).toLocaleString()} ·{" "}
                  {s.commit_sha?.slice(0, 12)}
                </small>
              </span>
              <Status status={s.report.status} />
              <span className="history-counts">
                <b className="red-text">{s.report.counts.critical} critical</b>
                <b className="amber-text">{s.report.counts.warnings} risks</b>
                <b className="mint-text">{s.report.counts.passed} passed</b>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
      </div>
      {projects.every((p) => !p.history?.length) && (
        <div className="empty-state">
          <History size={30} />
          <h3>Your history starts with a Hull Check</h3>
          <p>Scan a project to capture the first baseline.</p>
        </div>
      )}
    </section>
  );
}

export function Findings({
  results,
  onSelect,
}: {
  results: CheckResult[];
  onSelect: (r: CheckResult) => void;
}) {
  const [filter, setFilter] = useState("Action needed");
  const [category, setCategory] = useState("All categories");
  const items = results.filter(
    (r) =>
      (filter === "All checks"
        ? r.status !== "not_applicable"
        : filter === "Passed"
          ? r.status === "passed"
          : r.status === "failed" || r.status === "unverified") &&
      (category === "All categories" || r.category === category),
  );
  return (
    <section className="panel findings-panel">
      <div className="findings-toolbar">
        <div className="segmented">
          {["Action needed", "Passed", "All checks"].map((t) => (
            <button
              className={filter === t ? "selected" : ""}
              onClick={() => setFilter(t)}
              key={t}
            >
              {t}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>All categories</option>
          {[...new Set(results.map((r) => r.category))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="finding-list">
        {items.map((r, i) => (
          <button
            className="finding-row"
            key={r.id + i}
            onClick={() => onSelect(r)}
          >
            <span
              className={
                "finding-indicator " +
                (r.status === "passed" ? "passed" : r.severity)
              }
            >
              {r.status === "passed" ? (
                <Check size={19} />
              ) : r.status === "unverified" ? (
                <CircleHelp size={19} />
              ) : (
                <TriangleAlert size={19} />
              )}
            </span>
            <span className="finding-main">
              <strong>{r.title}</strong>
              <span>{r.message}</span>
              <small>
                <span>{r.category}</span>
                <span>·</span>
                <span>{r.evidence[0]?.file || "Repository analysis"}</span>
              </small>
            </span>
            <span
              className={
                "finding-state " +
                (r.status === "passed"
                  ? "mint-text"
                  : r.severity === "critical"
                    ? "red-text"
                    : "amber-text")
              }
            >
              {r.status === "unverified"
                ? "Unable to verify"
                : r.status === "passed"
                  ? "Passed"
                  : r.severity === "critical"
                    ? "Critical leak"
                    : "Risk detected"}
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {!items.length && (
        <div className="empty-state">
          <ShieldCheck size={32} />
          <h3>No findings in this view</h3>
          <p>Choose another category or run a Hull Check.</p>
        </div>
      )}
    </section>
  );
}

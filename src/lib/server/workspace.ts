import { randomUUID } from "node:crypto";
import { query } from "./db";
import { scan } from "../scanner";
import { projectFixture } from "../demo";
import type { ScanReport } from "../scanner/types";
export type Project = {
  id: string;
  name: string;
  repository: string;
  branch: string;
  production_url: string | null;
  source: "github" | "demo";
  created_at: string;
  latest?: StoredScan;
  history?: StoredScan[];
};
export type StoredScan = {
  id: string;
  project_id: string;
  commit_sha: string | null;
  report: ScanReport;
  created_at: string;
};
export async function saveScan(
  projectId: string,
  report: ScanReport,
  commit?: string,
) {
  const id = randomUUID();
  await query(
    "INSERT INTO scans (id,project_id,commit_sha,report) VALUES ($1,$2,$3,$4)",
    [id, projectId, commit ?? null, JSON.stringify(report)],
  );
  return id;
}
export async function seedDemo(userId: string) {
  for (const [i, name] of ["launchpad", "api-gateway", "dockside"].entries()) {
    const id = randomUUID();
    await query(
      "INSERT INTO projects (id,user_id,name,repository,branch,production_url,source) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, userId, name, "acme/" + name, "main", null, "demo"],
    );
    const report = scan({ files: projectFixture(name) });
    const oldFiles = projectFixture(name);
    oldFiles["migrations/001_cleanup.sql"] = "DROP TABLE legacy_customers;";
    const old = scan({ files: oldFiles });
    await query(
      "INSERT INTO scans (id,project_id,commit_sha,report,created_at) VALUES ($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        id,
        "demo-previous",
        JSON.stringify(old),
        new Date(Date.now() - (2 + i) * 86400000),
      ],
    );
    await saveScan(id, report, "demo-current");
  }
}
export async function workspace(userId: string) {
  const projects = await query<Project>(
    "SELECT id,name,repository,branch,production_url,source,created_at FROM projects WHERE user_id=$1 ORDER BY created_at ASC",
    [userId],
  );
  const scans = await query<StoredScan>(
    "SELECT s.* FROM scans s JOIN projects p ON s.project_id=p.id WHERE p.user_id=$1 ORDER BY s.created_at DESC",
    [userId],
  );
  return projects.map((p) => ({
    ...p,
    latest: scans.find((s) => s.project_id === p.id),
    history: scans.filter((s) => s.project_id === p.id),
  }));
}
export async function ownedProject(userId: string, id: string) {
  return (
    await query<Project>("SELECT * FROM projects WHERE id=$1 AND user_id=$2", [
      id,
      userId,
    ])
  )[0];
}

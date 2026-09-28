import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { scan } from "./lib/scanner";
import { allowedFile } from "./lib/server/github";
const root = path.resolve(process.argv[2] || ".");
const files: Record<string, string> = {};
let bytes = 0;
async function walk(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (
        ![
          "node_modules",
          ".git",
          ".next",
          ".shipwreck",
          "dist",
          "build",
          "coverage",
          "vendor",
        ].includes(entry.name)
      )
        await walk(absolute);
    } else if (allowedFile(relative)) {
      const value = await readFile(absolute, "utf8");
      bytes += Buffer.byteLength(value);
      if (bytes > 25_000_000 || Object.keys(files).length > 1500)
        throw new Error("Local scan exceeds 25 MB / 1500 file limit.");
      files[relative] = value;
    }
  }
}
await walk(root);
const report = scan({ files });
if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `\nSHIPWRECK · Find what sinks before you ship.\n\n${report.status}\n${report.filesAnalyzed} files · ${report.counts.applicable} applicable checks\n${report.counts.critical} critical findings · ${report.counts.warnings} risks · ${report.counts.passed} passed · ${report.counts.unverified} unable to verify\n`,
  );
  for (const r of report.results.filter(
    (r) => r.status === "failed" || r.status === "unverified",
  ))
    console.log(
      `${r.status === "failed" ? "!" : "?"} [${r.severity}] ${r.title}\n  ${r.message}\n  Fix: ${r.fix}\n`,
    );
}
process.exitCode = report.status === "Launch Blocked" ? 1 : 0;

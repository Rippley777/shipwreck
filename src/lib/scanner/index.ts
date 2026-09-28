import { checks } from "./checks";
import { environment, technologies } from "./analyze";
import type { CheckResult, ScanContext, ScanReport } from "./types";
export function scan(context: ScanContext): ScanReport {
  const start = performance.now();
  const results: CheckResult[] = checks.map(({ run, ...definition }) => {
    try {
      return { ...definition, ...run(context) };
    } catch {
      return {
        ...definition,
        status: "unverified",
        confidence: "low",
        message: "Unable to verify: this check could not complete.",
        evidence: [
          {
            file: "Scanner",
            detail: "The rule encountered an unsupported input.",
          },
        ],
      };
    }
  });
  results.sort(
    (a, b) =>
      ({ critical: 0, warning: 1, info: 2 })[a.severity] -
      { critical: 0, warning: 1, info: 2 }[b.severity],
  );
  const active = results.filter(
    (r) => r.status === "failed" || r.status === "unverified",
  );
  const counts = {
    critical: active.filter((r) => r.severity === "critical").length,
    warnings: active.filter((r) => r.severity !== "critical").length,
    passed: results.filter((r) => r.status === "passed").length,
    unverified: results.filter((r) => r.status === "unverified").length,
    applicable: results.filter((r) => r.status !== "not_applicable").length,
  };
  const status = results.some(
    (r) => r.status === "failed" && r.severity === "critical",
  )
    ? "Launch Blocked"
    : counts.critical
      ? "Needs Attention"
      : counts.warnings
        ? "Minor Risks"
        : "Shipworthy";
  return {
    results,
    environment: environment(context),
    technologies: technologies(context),
    filesAnalyzed: Object.keys(context.files).length,
    durationMs: Math.round(performance.now() - start),
    status,
    counts,
    coverage: counts.applicable
      ? Math.round((counts.passed / counts.applicable) * 100)
      : 0,
  };
}
export { fixPrompt } from "./prompt";

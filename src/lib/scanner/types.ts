export type Category =
  | "Security"
  | "Authentication"
  | "Environment"
  | "Database"
  | "Deployment"
  | "Reliability"
  | "Observability"
  | "Dependencies"
  | "API integrations"
  | "Cost risks"
  | "Data safety";
export type Severity = "critical" | "warning" | "info";
export type CheckStatus = "passed" | "failed" | "unverified" | "not_applicable";
export type Evidence = { file: string; line?: number; detail: string };
export type Observation = {
  url: string;
  status?: number;
  headers: Record<string, string>;
  cookies: string[];
  error?: string;
};
export type ScanContext = {
  files: Record<string, string>;
  observation?: Observation;
};
export type Outcome = {
  status: CheckStatus;
  confidence: "high" | "medium" | "low";
  message: string;
  evidence: Evidence[];
};
export type Check = {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  why: string;
  fix: string;
  run: (context: ScanContext) => Outcome;
};
export type CheckResult = Omit<Check, "run"> & Outcome;
export type EnvironmentVariable = {
  name: string;
  documented: boolean;
  referenced: boolean;
  secret: boolean;
  optional: boolean;
  locations: string[];
  production: "Unable to verify";
};
export type ScanReport = {
  results: CheckResult[];
  environment: EnvironmentVariable[];
  technologies: string[];
  filesAnalyzed: number;
  durationMs: number;
  status: "Shipworthy" | "Minor Risks" | "Needs Attention" | "Launch Blocked";
  counts: {
    critical: number;
    warnings: number;
    passed: number;
    unverified: number;
    applicable: number;
  };
  coverage: number;
};

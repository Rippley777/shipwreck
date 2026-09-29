import { environment, matches } from "./analyze";
import { authentication } from "./authentication";
import type { Check, Evidence, Outcome, ScanContext } from "./types";
const outcome = (
  status: Outcome["status"],
  message: string,
  evidence: Evidence[] = [],
  confidence: Outcome["confidence"] = "high",
): Outcome => ({ status, message, evidence, confidence });
const na = () =>
  outcome("not_applicable", "No applicable technology detected.");
const fact = (c: ScanContext, re: RegExp, detail: string, filter?: RegExp) =>
  matches(c, re, detail, filter);
const files = (c: ScanContext, re: RegExp) =>
  Object.keys(c.files)
    .filter((p) => re.test(p))
    .map((file) => ({ file, detail: "Configuration file detected." }));
const text = (c: ScanContext) => Object.values(c.files).join("\n");
const detection = (
  id: string,
  title: string,
  category: Check["category"],
  severity: Check["severity"],
  why: string,
  fix: string,
  re: RegExp,
  filter?: RegExp,
  uncertain = false,
): Check => ({
  id,
  title,
  category,
  severity,
  why,
  fix,
  run(c) {
    if (!Object.keys(c.files).length)
      return outcome(
        "unverified",
        "Unable to verify: no supported files were available.",
        [
          {
            file: "Repository analysis",
            detail:
              "The snapshot contained no supported source or configuration files.",
          },
        ],
        "low",
      );
    const e = fact(
      c,
      re,
      title + " pattern detected; source values omitted.",
      filter,
    );
    return e.length
      ? outcome(
          uncertain ? "unverified" : "failed",
          uncertain
            ? "Unable to verify: review this source pattern in context."
            : title + " detected in repository configuration.",
          e,
          uncertain ? "medium" : "high",
        )
      : outcome(
          "passed",
          "This specific risk pattern was not detected. Absence does not establish overall safety.",
        );
  },
});
const presence = (
  id: string,
  title: string,
  category: Check["category"],
  why: string,
  fix: string,
  re: RegExp,
  filter?: RegExp,
): Check => ({
  id,
  title,
  category,
  severity: "warning",
  why,
  fix,
  run(c) {
    const e = fact(c, re, title + " indicator detected.", filter);
    return e.length
      ? outcome(
          "passed",
          "Repository evidence detected; runtime configuration has not been verified.",
          e,
        )
      : outcome(
          "unverified",
          "Unable to verify " +
            title.toLowerCase() +
            " from the analyzed files.",
          [
            {
              file: "Repository analysis",
              detail:
                "No recognized configuration found in the analyzed snapshot.",
            },
          ],
          "medium",
        );
  },
});
export const checks: Check[] = [
  detection(
    "security.secrets",
    "Exposed credential pattern",
    "Security",
    "critical",
    "Committed credentials can allow unauthorized access to your services.",
    "Revoke the credential, rotate it, remove it from source and Git history, and use a secret manager.",
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bsk_live_[A-Za-z0-9]{20,}\b|\bAKIA[A-Z0-9]{16}\b/,
  ),
  detection(
    "security.cors",
    "Wildcard CORS configuration",
    "Security",
    "warning",
    "A wildcard origin permits any website to read eligible cross-origin responses.",
    "Restrict allowed origins to trusted clients and review credentialed requests.",
    /(?:Access-Control-Allow-Origin['"\s,:=]+|origin\s*:\s*)['"]\*['"]/,
  ),
  detection(
    "security.cookies",
    "Explicitly insecure cookie flags",
    "Security",
    "warning",
    "Session cookies without transport and script protections can expose sessions.",
    "Set Secure and HttpOnly on session cookies and choose an appropriate SameSite policy.",
    /(?:httpOnly|secure)\s*:\s*false/,
  ),
  detection(
    "security.public-secret",
    "Secret in a public environment namespace",
    "Security",
    "critical",
    "Public environment variables may be embedded in client JavaScript.",
    "Move sensitive credentials to server-only variables; rotate any credential already published.",
    /(?:NEXT_PUBLIC_|VITE_)[A-Z_]*(?:SECRET|PRIVATE_KEY|SECRET_KEY|DATABASE_URL|PASSWORD)/,
  ),
  detection(
    "security.tls",
    "TLS certificate verification disabled",
    "Security",
    "critical",
    "Disabling certificate verification can expose outbound traffic to interception.",
    "Remove the override and configure trusted certificates.",
    /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
  ),
  authentication,
  {
    id: "auth.secret",
    title: "Authentication secret documentation",
    category: "Authentication",
    severity: "warning",
    why: "Missing secret configuration may prevent safe session validation.",
    fix: "Document the session secret name in .env.example and provision a random production value.",
    run(c) {
      if (!/next-auth|@auth\/|express-session/.test(text(c))) return na();
      const e = environment(c).filter(
        (v) => /AUTH_SECRET|SESSION_SECRET/.test(v.name) && v.documented,
      );
      return e.length
        ? outcome(
            "passed",
            "Session secret name is documented.",
            e.map((v) => ({
              file: ".env.example",
              detail: v.name + " is documented; value not inspected.",
            })),
          )
        : outcome(
            "unverified",
            "Unable to verify a documented session secret.",
            [
              {
                file: ".env.example",
                detail: "No recognized session secret name was found.",
              },
            ],
          );
    },
  },
  detection(
    "auth.ownership",
    "Resource ownership needs review",
    "Authentication",
    "critical",
    "Authenticating a request does not prove the user owns the requested resource.",
    "Trace the request through authorization helpers. Constrain resource queries by the current user or tenant and test cross-user access.",
    /findUnique\(\s*\{\s*where:\s*\{\s*id:\s*(?:params|req|request)\./,
    /\.[jt]sx?$/,
    true,
  ),
  {
    id: "environment.documentation",
    title: "Undocumented environment variables",
    category: "Environment",
    severity: "warning",
    why: "A deployment can compile successfully and fail when a required variable is missing.",
    fix: "Add each required variable to .env.example with safe placeholder values and provision it in each environment.",
    run(c) {
      const e = environment(c).filter(
        (v) =>
          v.referenced &&
          !v.documented &&
          !["NODE_ENV", "PORT", "CI"].includes(v.name),
      );
      return e.length
        ? outcome(
            "failed",
            `${e.length} source variable${e.length === 1 ? " is" : "s are"} missing from environment documentation.`,
            e.map((v) => ({
              file: v.locations[0],
              detail: v.name + " is referenced but not documented.",
            })),
          )
        : outcome(
            "passed",
            "All recognized source environment references are documented.",
          );
    },
  },
  {
    id: "environment.unused",
    title: "Environment documentation drift",
    category: "Environment",
    severity: "info",
    why: "Stale variables make deployment configuration harder to maintain.",
    fix: "Confirm whether deployment tooling consumes these variables before removing them.",
    run(c) {
      const e = environment(c).filter((v) => v.documented && !v.referenced);
      return e.length
        ? outcome(
            "unverified",
            "Documented variables have no recognized references; external usage is unknown.",
            e.map((v) => ({
              file: ".env.example",
              detail: v.name + " has no recognized reference.",
            })),
            "medium",
          )
        : outcome("passed", "No unused documentation entries detected.");
    },
  },
  {
    id: "environment.committed",
    title: "Environment file in repository",
    category: "Environment",
    severity: "warning",
    why: "Environment files can accidentally publish private deployment configuration.",
    fix: "Remove sensitive environment files from tracking, ignore them, and rotate exposed credentials.",
    run(c) {
      const e = files(
        c,
        /(?:^|\/)\.env(?:\.(?:local|production|development))?$/,
      );
      return e.length
        ? outcome(
            "failed",
            "A non-template environment file is present. Values have not been stored.",
            e,
          )
        : outcome(
            "passed",
            "No non-template environment files found in this snapshot.",
          );
    },
  },
  {
    id: "database.migrations",
    title: "Database migrations",
    category: "Database",
    severity: "warning",
    why: "Untracked schema changes create inconsistent production databases.",
    fix: "Version schema migrations and document the production migration command.",
    run(c) {
      if (!/prisma|postgres|DATABASE_URL|drizzle|sequelize/.test(text(c)))
        return na();
      const e = files(c, /migrations?\/|schema\.prisma/);
      return e.length
        ? outcome(
            "passed",
            "Schema or migration files detected. Execution in production is unverified.",
            e,
          )
        : outcome(
            "unverified",
            "Unable to verify a versioned database schema.",
            [
              {
                file: "Repository analysis",
                detail:
                  "Database usage detected, but no recognized schema or migration path.",
              },
            ],
          );
    },
  },
  detection(
    "database.destructive",
    "Destructive database migration",
    "Data safety",
    "critical",
    "Destructive DDL may permanently remove customer data.",
    "Review data usage, take a verified backup, use an expand/contract migration, and test rollback or recovery.",
    /\b(?:DROP\s+(?:TABLE|DATABASE|COLUMN)|TRUNCATE\s+(?:TABLE\s+)?\w+)/i,
    /\.sql$/,
  ),
  {
    id: "database.backups",
    title: "Database backups could not be verified",
    category: "Data safety",
    severity: "critical",
    why: "A failed migration, accidental deletion, or provider failure could permanently destroy customer data.",
    fix: "Enable automated database backups, define a retention period, and perform a restore test. Connect provider evidence before marking this verified.",
    run(c) {
      if (!/postgres|DATABASE_URL|prisma|mysql|supabase/.test(text(c)))
        return na();
      return outcome(
        "unverified",
        "A database was detected, but production backup coverage requires provider evidence.",
        fact(
          c,
          /DATABASE_URL|postgres|prisma|mysql|supabase/,
          "Database configuration detected. Backup status is not available from source.",
        ),
        "medium",
      );
    },
  },
  presence(
    "database.pooling",
    "Database connection pooling",
    "Database",
    "Unbounded database connections can exhaust a production database.",
    "Review your provider connection limits and configure a bounded pool or a managed pooler.",
    /pgbouncer|connection_limit|pool_size|maxConnections|new Pool\(|pool:\s*\{/,
  ),
  {
    id: "deployment.container-user",
    title: "Container runs as root by default",
    category: "Deployment",
    severity: "warning",
    why: "Root containers increase the impact of a compromised process.",
    fix: "Add a non-root USER directive to the final build stage.",
    run(c) {
      const docker = Object.entries(c.files).filter(([p]) =>
        /(?:^|\/)Dockerfile$/.test(p),
      );
      if (!docker.length) return na();
      const bad = docker.filter(([, t]) => {
        const stage = t.split(/^FROM\s/gim).at(-1)!;
        const users = [...stage.matchAll(/^USER\s+(.+)$/gm)];
        return !users.length || /^(root|0)(?::|\s|$)/.test(users.at(-1)![1]);
      });
      return bad.length
        ? outcome(
            "failed",
            "Final container stage has no non-root USER directive.",
            bad.map(([file]) => ({
              file,
              detail:
                "Final-stage USER is absent or explicitly root; inherited image defaults are not verified.",
            })),
            "medium",
          )
        : outcome("passed", "Explicit non-root container user configured.");
    },
  },
  presence(
    "deployment.health",
    "Health endpoint or probe",
    "Deployment",
    "Without a readiness signal, a platform may route traffic to an unhealthy process.",
    "Add a lightweight health endpoint and configure your deployment readiness probe.",
    /HEALTHCHECK|readinessProbe|healthcheck|\/health|\/api\/health/,
  ),
  {
    id: "deployment.ci",
    title: "Continuous integration workflow",
    category: "Deployment",
    severity: "warning",
    why: "Automated checks catch regressions before deployment.",
    fix: "Add CI that installs pinned dependencies and runs type checking, tests and a production build.",
    run(c) {
      const e = files(c, /^\.github\/workflows\/.*\.ya?ml$|\.gitlab-ci\.yml$/);
      return e.length
        ? outcome(
            "passed",
            "CI configuration detected; workflow success is not verified.",
            e,
          )
        : outcome("unverified", "Unable to verify continuous integration.", [
            {
              file: "Repository analysis",
              detail: "No recognized CI workflow found.",
            },
          ]);
    },
  },
  detection(
    "deployment.dev-mode",
    "Development mode in deployment configuration",
    "Deployment",
    "warning",
    "Development servers may expose debugging information and perform poorly.",
    "Use a production build and production start command.",
    /NODE_ENV\s*[:=]\s*['"]?development|(?:CMD|command:).*\b(?:next dev|npm run dev)\b/,
    /Dockerfile|compose.*\.ya?ml|vercel\.json|render\.ya?ml/,
  ),
  presence(
    "reliability.timeouts",
    "Outbound request timeouts",
    "Reliability",
    "A stalled external service can consume worker capacity and leave users waiting.",
    "Set bounded timeouts on outbound requests and handle cancellation safely.",
    /AbortSignal\.timeout|AbortController|timeout\s*[:=]\s*\d|request_timeout/,
  ),
  presence(
    "reliability.shutdown",
    "Graceful shutdown handling",
    "Reliability",
    "Abrupt termination can interrupt requests and background jobs.",
    "For long-lived servers, handle SIGTERM, drain requests and close database connections; confirm managed runtime behavior.",
    /SIGTERM|SIGINT|gracefulShutdown|onApplicationShutdown/,
  ),
  presence(
    "observability.errors",
    "Error reporting",
    "Observability",
    "Production errors can remain invisible without a reporting destination.",
    "Configure an error reporting service and verify an intentional test error reaches it.",
    /@sentry\/|Sentry\.init|bugsnag|rollbar|@opentelemetry/,
  ),
  presence(
    "observability.logs",
    "Structured logging",
    "Observability",
    "Structured logs make failures searchable and connect events across requests.",
    "Use a structured logger with request IDs and redact credentials and personal data.",
    /"pino"|"winston"|structlog|slog\.|JSON\.stringify\(\s*\{\s*(?:level|timestamp|requestId)/,
  ),
  {
    id: "dependencies.lockfile",
    title: "Dependency lockfile",
    category: "Dependencies",
    severity: "warning",
    why: "Unpinned transitive dependencies make builds difficult to reproduce.",
    fix: "Commit a lockfile and use a frozen-lockfile install in CI.",
    run(c) {
      if (
        !Object.keys(c.files).some((p) =>
          /package\.json|Cargo\.toml|pyproject\.toml/.test(p),
        )
      )
        return na();
      const e = files(
        c,
        /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|uv\.lock|poetry\.lock)$/,
      );
      return e.length
        ? outcome("passed", "Dependency lockfile found.", e)
        : outcome("failed", "No supported dependency lockfile found.", [
            {
              file: "Repository analysis",
              detail:
                "A dependency manifest is present without a recognized lockfile.",
            },
          ]);
    },
  },
  detection(
    "dependencies.image-tag",
    "Unpinned container image",
    "Dependencies",
    "warning",
    "A mutable latest tag can introduce unexpected changes between deployments.",
    "Pin an explicit supported version or image digest and automate update reviews.",
    /^FROM\s+[^\s]+:latest(?:\s|$)/m,
    /Dockerfile$/,
  ),
  {
    id: "integrations.stripe",
    title: "Stripe webhook signature verification",
    category: "API integrations",
    severity: "critical",
    why: "Unverified webhook events can forge payment or subscription state.",
    fix: "Verify Stripe signatures against the raw request body using constructEvent and the webhook secret; test invalid signatures.",
    run(c) {
      const webhooks = Object.entries(c.files).filter(
        ([p, t]) => /webhook/i.test(p) && /stripe/i.test(t),
      );
      if (!webhooks.length) return na();
      const e = webhooks.filter(
        ([, t]) => !/constructEvent(?:Async)?\s*\(/.test(t),
      );
      return e.length
        ? outcome(
            "unverified",
            "Unable to verify signature validation in detected Stripe webhook files. Helpers may validate elsewhere.",
            e.map(([file]) => ({
              file,
              detail:
                "Stripe webhook file has no recognized constructEvent call.",
            })),
            "medium",
          )
        : outcome(
            "passed",
            "Stripe signature-verification call detected; runtime behavior remains untested.",
          );
    },
  },
  {
    id: "cost.ai-controls",
    title: "AI API usage controls",
    category: "Cost risks",
    severity: "warning",
    why: "Unbounded paid API requests may create unexpected bills.",
    fix: "Apply per-user quotas, rate limits, bounded output tokens and provider spending alerts.",
    run(c) {
      if (!/openai|anthropic/.test(text(c))) return na();
      const e = fact(
        c,
        /rateLimit|rate_limit|ratelimit|quota|max_tokens|max_output_tokens/,
        "AI usage-control indicator detected.",
      );
      return e.length
        ? outcome(
            "passed",
            "Usage-control indicators detected; enforcement must be verified.",
            e,
          )
        : outcome(
            "unverified",
            "Unable to verify limits around paid AI API usage.",
            fact(c, /openai|anthropic/, "Paid AI integration detected."),
            "medium",
          );
    },
  },
  ...(["https", "availability", "hsts", "nosniff", "cookies"] as const).map(
    (kind): Check => ({
      id: "url." + kind,
      title: {
        https: "HTTPS transport",
        availability: "Deployment availability",
        hsts: "Strict transport security",
        nosniff: "Content-type protection",
        cookies: "Production cookie flags",
      }[kind],
      category: kind === "availability" ? "Reliability" : "Security",
      severity: "warning",
      why: "Production HTTP configuration affects availability and browser safety.",
      fix: {
        https: "Serve the application over HTTPS with a valid certificate.",
        availability:
          "Check deployment health and resolve unsuccessful responses.",
        hsts: "Set Strict-Transport-Security after confirming HTTPS on all required hosts.",
        nosniff: "Set X-Content-Type-Options: nosniff.",
        cookies:
          "Review cookies and add Secure, HttpOnly and SameSite where appropriate.",
      }[kind],
      run(c) {
        const o = c.observation;
        if (!o) return na();
        if (o.error)
          return outcome("unverified", "Unable to verify: " + o.error, [
            {
              file: "Production URL",
              detail: "The safe external request could not complete.",
            },
          ]);
        const pass =
          kind === "https"
            ? o.url.startsWith("https:")
            : kind === "availability"
              ? !!o.status && o.status < 400
              : kind === "hsts"
                ? /max-age=[1-9]\d*/i.test(
                    o.headers["strict-transport-security"] || "",
                  )
                : kind === "nosniff"
                  ? o.headers["x-content-type-options"]?.toLowerCase() ===
                    "nosniff"
                  : o.cookies.every(
                      (v) =>
                        /;\s*secure(?:;|$)/i.test(v) &&
                        /;\s*httponly(?:;|$)/i.test(v) &&
                        /;\s*samesite=/i.test(v),
                    );
        if (kind === "cookies" && !o.cookies.length)
          return outcome(
            "unverified",
            "No cookies were set by this response; session cookies could not be inspected.",
            [{ file: o.url, detail: "Response had no Set-Cookie header." }],
          );
        return outcome(
          pass ? "passed" : "failed",
          pass
            ? "Expected HTTP configuration observed."
            : "Expected HTTP configuration was not observed.",
          [
            {
              file: o.url,
              detail:
                kind === "availability"
                  ? `HTTP ${o.status}`
                  : kind === "cookies"
                    ? `${o.cookies.length} cookies inspected; values discarded.`
                    : `${kind} check ${pass ? "passed" : "failed"} on the final response.`,
            },
          ],
        );
      },
    }),
  ),
];

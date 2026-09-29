import { isTestFile } from "./analyze";
import type { Check, Evidence } from "./types";

const provider =
  /^(?:next-auth|@auth\/[^/]+|@clerk\/[^/]+|@supabase\/ssr|passport|lucia|better-auth|express-session)(?:\/|$)/;

export const authentication: Check = {
  id: "auth.provider",
  title: "Authentication provider",
  category: "Authentication",
  severity: "warning",
  why: "Protected resources require a reliable way to establish user identity.",
  fix: "Inspect existing authentication and session controls before adding a provider. Verify rejected credentials, invalid/expired sessions, logout, and cross-user access to protected routes.",
  run({ files }) {
    const evidence: Evidence[] = [];
    const sources = Object.entries(files).filter(([file]) => !isTestFile(file));
    for (const [file, content] of sources) {
      if (/(?:^|\/)package\.json$/.test(file)) {
        try {
          const pkg = JSON.parse(content);
          if (
            Object.keys(pkg.dependencies ?? {}).some((name) =>
              provider.test(name),
            )
          )
            evidence.push({
              file,
              detail:
                "Authentication library declared as a runtime dependency; values omitted.",
            });
        } catch {
          /* Partial snapshots remain unverified. */
        }
      }
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      for (const match of content.matchAll(
        /(?:\bfrom\s*|\brequire\s*\(|\bimport\s*\(?)\s*["']([^"']+)["']/g,
      )) {
        if (provider.test(match[1]))
          evidence.push({
            file,
            line: content.slice(0, match.index).split("\n").length,
            detail: "Authentication library import detected; values omitted.",
          });
      }
    }
    if (evidence.length)
      return {
        status: "passed",
        confidence: "medium",
        message:
          "Authentication library evidence detected; runtime configuration and protected routes have not been verified.",
        evidence: evidence.slice(0, 12),
      };

    // Recognize a conservative subset of custom database-session implementations.
    // Require the lifecycle indicators together in one module; names alone, env
    // declarations, docs, or an unrelated cookie are insufficient evidence.
    for (const [file, content] of sources) {
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      const indicators: [RegExp, string][] = [
        [
          /randomBytes\(\s*(?:32|48|64)\s*\)/,
          "Cryptographically random session token indicator.",
        ],
        [
          /createHash\(\s*["']sha256["']\s*\)/,
          "Session token hashing indicator.",
        ],
        [
          /INSERT\s+INTO\s+sessions\s*\([^)]*token_hash[^)]*user_id[^)]*expires_at/i,
          "Database session issuance with user identity and expiry.",
        ],
        [
          /JOIN\s+sessions\b[^"'`]*token_hash\s*=\s*\$\d+[^"'`]*expires_at\s*>\s*NOW\(\)/i,
          "Database session lookup checks token hash and expiry.",
        ],
        [/\bcookies\(\)/, "Server cookie access indicator."],
        [/httpOnly\s*:\s*true/, "HttpOnly session cookie indicator."],
        [
          /DELETE\s+FROM\s+sessions\s+WHERE\s+token_hash\s*=\s*\$\d+/i,
          "Server-side session revocation indicator.",
        ],
      ];
      if (!indicators.every(([pattern]) => pattern.test(content))) continue;
      return {
        status: "passed",
        confidence: "medium",
        message:
          "Custom database-backed authentication/session evidence detected. This source check does not verify runtime configuration, credential validation, or route authorization; verify those separately.",
        evidence: indicators.map(([pattern, detail]) => ({
          file,
          line: content.slice(0, content.search(pattern)).split("\n").length,
          detail,
        })),
      };
    }
    return {
      status: "unverified",
      confidence: "medium",
      message:
        "Unable to verify authentication provider from the analyzed files.",
      evidence: [
        {
          file: "Repository analysis",
          detail:
            "No recognized authentication library or complete custom session indicators found in the analyzed snapshot. Existing controls may require manual review.",
        },
      ],
    };
  },
};

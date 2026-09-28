import type { Evidence, EnvironmentVariable, ScanContext } from "./types";
export const isTestFile = (path: string) =>
  /(?:^|\/)(?:__tests__|tests?|fixtures?|__fixtures__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(
    path,
  );
export const sourceFiles = (c: ScanContext) =>
  Object.entries(c.files).filter(
    ([p]) =>
      /\.(?:[cm]?[jt]sx?|py|go|rs|rb|php)$/.test(p) &&
      !/(?:test|spec|fixture|\.d\.ts)/i.test(p),
  );
export function matches(
  c: ScanContext,
  pattern: RegExp,
  description: string,
  filter?: RegExp,
): Evidence[] {
  const found: Evidence[] = [];
  for (const [file, content] of Object.entries(c.files)) {
    if (isTestFile(file) || (filter && !filter.test(file))) continue;
    content.split("\n").forEach((line, i) => {
      pattern.lastIndex = 0;
      if (pattern.test(line))
        found.push({ file, line: i + 1, detail: description });
    });
  }
  return found.slice(0, 12);
}
export function environment(c: ScanContext): EnvironmentVariable[] {
  const vars = new Map<string, EnvironmentVariable>();
  const add = (
    name: string,
    file: string,
    referenced: boolean,
    documented: boolean,
    optional = false,
  ) => {
    if (!/^[A-Z][A-Z0-9_]+$/.test(name)) return;
    const old = vars.get(name) ?? {
      name,
      documented: false,
      referenced: false,
      secret: /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|DATABASE_URL/.test(name),
      optional: false,
      locations: [],
      production: "Unable to verify" as const,
    };
    old.documented ||= documented;
    old.referenced ||= referenced;
    old.optional ||= optional;
    if (!old.locations.includes(file)) old.locations.push(file);
    vars.set(name, old);
  };
  for (const [file, text] of Object.entries(c.files)) {
    if (isTestFile(file)) continue;
    if (/(?:^|\/)\.env(?:\.|$)/.test(file))
      for (const m of text.matchAll(
        /^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/gm,
      ))
        add(m[1], file, false, /example|sample|template/.test(file));
    for (const m of text.matchAll(
      /(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]+)|(process\.env|os\.environ)\[['"]([A-Z][A-Z0-9_]+)['"]\]|(?:getenv|env::var)\(['"]([A-Z][A-Z0-9_]+)['"]/g,
    ))
      add(
        m[1] || m[3] || m[4],
        file,
        true,
        false,
        /^\s*(?:\?\?|\|\|)/.test(text.slice(m.index! + m[0].length)),
      );
    if (/docker|compose|\.ya?ml$|\.toml$|\.tf$/i.test(file)) {
      for (const m of text.matchAll(
        /\$\{([A-Z][A-Z0-9_]+)(?::[-?][^}]*)?\}|\b(?:ENV|ARG)\s+([A-Z][A-Z0-9_]+)|secrets\.([A-Z][A-Z0-9_]+)/g,
      ))
        add(m[1] || m[2] || m[3], file, true, false);
    }
  }
  return [...vars.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function technologies(c: ScanContext): string[] {
  const all = Object.values(c.files).join("\n");
  const indicators: [string, RegExp][] = [
    ["Next.js", /"next"\s*:/],
    ["React", /"react"\s*:/],
    ["PostgreSQL", /postgres|DATABASE_URL/],
    ["Prisma", /prisma/],
    ["Supabase", /supabase/],
    ["Clerk", /@clerk/],
    ["NextAuth", /next-auth|@auth\/core/],
    ["Stripe", /stripe/],
    ["OpenAI", /openai/],
    ["Redis", /redis/i],
    ["Sentry", /@sentry/],
    ["Docker", /FROM\s+\w/],
    ["Vercel", /vercel/],
  ];
  return [
    ...indicators.filter(([, re]) => re.test(all)).map(([name]) => name),
    ...(Object.keys(c.files).some((p) => p.startsWith(".github/workflows/"))
      ? ["GitHub Actions"]
      : []),
  ];
}

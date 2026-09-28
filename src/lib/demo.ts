export const demoFiles: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "launchpad",
    dependencies: {
      next: "16.0.0",
      react: "19.2.0",
      "next-auth": "5.0.0",
      prisma: "6.0.0",
      stripe: "18.0.0",
      openai: "5.0.0",
      pino: "9.0.0",
    },
  }),
  "package-lock.json": '{"lockfileVersion":3}',
  ".env.example":
    "DATABASE_URL=\nAUTH_SECRET=\nSTRIPE_SECRET_KEY=\nOPENAI_API_KEY=\n",
  "src/app/api/projects/[id]/route.ts": `import { auth } from '@/auth';\nexport async function GET(request, { params }) {\n  const session = await auth();\n  if (!session) return new Response(null, { status: 401 });\n  const project = await db.project.findUnique({ where: { id: params.id } });\n  return Response.json(project);\n}`,
  "src/lib/database.ts": `const database = process.env.DATABASE_URL;\nexport const pool = new Pool({ connectionString: database, max: 10 });`,
  "src/auth.ts": `import NextAuth from 'next-auth';\nexport const { auth } = NextAuth({ secret: process.env.AUTH_SECRET });`,
  "src/app/api/webhooks/stripe/route.ts": `import Stripe from 'stripe';\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY);\nconst secret = process.env.STRIPE_WEBHOOK_SECRET;\nexport function verify(body, signature) { return stripe.webhooks.constructEvent(body, signature, secret); }`,
  "src/lib/ai.ts": `import OpenAI from 'openai';\nconst ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10000 });\nexport const generate = (prompt) => ai.responses.create({ model: 'configured-model', input: prompt });`,
  "prisma/schema.prisma":
    'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}',
  Dockerfile:
    'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\nENV NODE_ENV=production\nUSER node\nHEALTHCHECK CMD wget -q --spider http://localhost:3000/api/health\nCMD ["npm", "start"]',
  ".github/workflows/ci.yml":
    "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci && npm test && npm run build",
  "src/server.ts": `process.on('SIGTERM', () => server.close());`,
};
export function projectFixture(name: string): Record<string, string> {
  const files = { ...demoFiles };
  if (name === "api-gateway") {
    files["src/app/api/projects/[id]/route.ts"] =
      "export const read = () => db.project.findMany({ where: { ownerId: user.id } });";
    files["src/monitoring.ts"] =
      "import * as Sentry from '@sentry/nextjs'; Sentry.init({});";
    files[".env.example"] += "STRIPE_WEBHOOK_SECRET=\n";
  }
  if (name === "dockside") {
    files["src/monitoring.ts"] =
      "import * as Sentry from '@sentry/nextjs'; Sentry.init({});";
    files["src/lib/ai.ts"] += "\nconst max_output_tokens = 1000;";
  }
  return files;
}

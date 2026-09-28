import { readFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
type DB = { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
const globalDB = globalThis as unknown as { shipwreckDB?: Promise<DB> };
async function connect(): Promise<DB> {
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL)
    throw new Error("APP_URL is required for production.");
  let db: DB;
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
    db = {
      async query<T>(sql: string, params: unknown[] = []) {
        const result = await pool.query(sql, params);
        return { rows: result.rows as T[] };
      },
    };
  } else {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ENABLE_DEMO !== "true" &&
      !process.env.EMBEDDED_DATABASE_PATH
    )
      throw new Error("DATABASE_URL is required for production.");
    const directory = process.env.EMBEDDED_DATABASE_PATH || ".shipwreck/data";
    await mkdir(directory, { recursive: true });
    const pg = new PGlite(path.resolve(/*turbopackIgnore: true*/ directory));
    await pg.waitReady;
    db = pg;
  }
  const directory = path.join(process.cwd(), "migrations");
  // All current migrations are idempotent; apply in filename order on upgrades.
  for (const migration of (await readdir(directory))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    const sql = await readFile(path.join(directory, migration), "utf8");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
  }
  return db;
}
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  globalDB.shipwreckDB ??= connect();
  return (await (await globalDB.shipwreckDB).query<T>(sql, params)).rows;
}

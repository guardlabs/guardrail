import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadEnvFiles } from "../env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(__dirname, "../../sql/001_wallets.sql");

loadEnvFiles();

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = await readFile(migrationPath, "utf8");
  const pool = new Pool({
    connectionString,
  });

  try {
    await pool.query(sql);
    process.stdout.write("Applied backend SQL migrations.\n");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

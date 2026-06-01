// Phase 46: migrate legacy post status values to the canonical vocabulary.
//   export_ready -> ready_to_post
//   posted       -> posted_manually
//   published    -> published_via_api
//
// Run from the repo root:
//   pnpm --filter @workspace/scripts exec node --env-file=../../artifacts/api-server/.env --import tsx src/migrate-post-statuses.ts
//
// Safe to re-run: each UPDATE is conditional on the legacy value.

import { pool } from "@workspace/db";

const MIGRATIONS: Array<{ from: string; to: string }> = [
  { from: "export_ready", to: "ready_to_post" },
  { from: "posted", to: "posted_manually" },
  { from: "published", to: "published_via_api" },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run with --env-file=artifacts/api-server/.env");
    process.exit(1);
  }

  for (const { from, to } of MIGRATIONS) {
    const result = await pool.query(`UPDATE posts SET status = $1 WHERE status = $2`, [to, from]);
    console.log(`  ${from.padEnd(14)} -> ${to.padEnd(20)}  (${result.rowCount} rows)`);
  }
  const tally = await pool.query<{ status: string; n: string }>(
    `SELECT status, COUNT(*)::text AS n FROM posts GROUP BY status ORDER BY status`,
  );
  console.log("\nFinal status distribution:");
  for (const row of tally.rows) console.log(`  ${row.status.padEnd(20)} ${row.n}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

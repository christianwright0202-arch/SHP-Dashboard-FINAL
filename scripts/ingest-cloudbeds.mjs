#!/usr/bin/env node
// Cloudbeds reservation-level ingest CLI.
//
//   npm run ingest:cloudbeds                 # parse data/cloudbeds_reservations.xlsx, print the quality report
//   npm run ingest:cloudbeds -- path.xlsx    # a different export
//   npm run ingest:cloudbeds -- --dry-run    # never write, even if Supabase creds are present
//   npm run ingest:cloudbeds -- --write      # force the Supabase upsert (otherwise it writes only if creds exist)
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the environment or a local .env file.
// Upserts into `cloudbeds_reservations` on (property, guest_name, check_in, reservation_date),
// so re-running an overlapping export updates rows instead of duplicating them.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as XLSXns from "xlsx";
import { parseCloudbedsRows, toDbRow } from "../src/cloudbeds/parseCloudbeds.js";

const XLSX = XLSXns.default || XLSXns;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const filePath = args.find((a) => !a.startsWith("--")) || "data/cloudbeds_reservations.xlsx";

// Minimal .env loader (no dependency) so the CLI shares the app's Supabase creds.
function loadEnv() {
  const p = resolve(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const abs = resolve(ROOT, filePath);
if (!existsSync(abs)) { console.error(`File not found: ${abs}`); process.exit(1); }

console.log(`Reading ${filePath} ...`);
const wb = XLSX.read(readFileSync(abs), { type: "buffer" });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });

const { reservations, report } = parseCloudbedsRows(rows);

console.log("\n==== Cloudbeds ingest — data quality ====");
console.log(`rows in file:      ${report.rowsIn}`);
console.log(`kept:              ${report.kept}`);
console.log(`dropped:           ${report.dropped}`, report.dropped ? report.dropReasons : "");
console.log(`by property:       ${JSON.stringify(report.byProperty)}`);
console.log("flags (guessed / cleaned):");
for (const [k, v] of Object.entries(report.flags).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
const cancelled = reservations.filter((r) => r.isCancelled).length;
const noShow = reservations.filter((r) => r.isNoShow).length;
const outliers = reservations.filter((r) => r.isRateOutlier).length;
console.log(`cancelled kept:    ${cancelled}`);
console.log(`no-show kept:      ${noShow}`);
console.log(`rate outliers:     ${outliers} (excluded from ADR, kept in revenue)`);

const haveCreds = !!(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY);
const shouldWrite = !flags.has("--dry-run") && (flags.has("--write") || haveCreds);

if (!shouldWrite) {
  console.log(`\nParse-only (no Supabase write). ${haveCreds ? "Pass --write to upsert." : "Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to write."}`);
  process.exit(0);
}
if (!haveCreds) { console.error("\n--write requested but Supabase creds are missing."); process.exit(1); }

const { createClient } = await import("@supabase/supabase-js");
const supa = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const dbRows = reservations.map(toDbRow);
const BATCH = 500;
let written = 0;
for (let i = 0; i < dbRows.length; i += BATCH) {
  const chunk = dbRows.slice(i, i + BATCH);
  const { error } = await supa
    .from("cloudbeds_reservations")
    .upsert(chunk, { onConflict: "property,guest_name,check_in,reservation_date" });
  if (error) { console.error(`\nUpsert failed at batch ${i / BATCH}:`, error.message); process.exit(1); }
  written += chunk.length;
  process.stdout.write(`\rupserted ${written}/${dbRows.length}`);
}
console.log(`\nDone. Upserted ${written} reservations into cloudbeds_reservations.`);

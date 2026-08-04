// SHP Dashboard — shared storage (Supabase), with safety rails.
//
// SAFETY HISTORY (do not simplify):
//  - The original version could destroy the shared dataset: if loadModel() failed for any reason,
//    the app kept its EMPTY starting model, marked itself "loaded", and then saved that empty model
//    over everyone's real data. One failed read = total data loss.
//  - A later version hardcoded the JSON column as "payload" and broke on tables using another name.
// So: the JSON column is DISCOVERED at runtime, reads throw loudly instead of returning null, and
// an empty model can never overwrite a populated record.

import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = "dashboard_state";
const MAIN_ID = "shp-main";
const MAX_BACKUPS = 12;

// Column names seen across setups; the real one is detected on first use.
const CANDIDATES = ["payload", "state", "data", "model", "json", "content", "value", "doc"];
const META_COLS = ["id", "created_at", "updated_at", "inserted_at"];

const client = (URL && KEY) ? createClient(URL, KEY) : null;
export const isConfigured = () => !!client;

let COL = null;
/** Find which column actually holds the JSON, so we never depend on one hardcoded name. */
async function detectColumn() {
  if (COL) return COL;
  if (!client) throw new Error("Supabase not configured");
  // 1) Read a row and look at its keys — most reliable.
  const probe = await client.from(TABLE).select("*").limit(1);
  if (!probe.error && probe.data && probe.data.length) {
    const keys = Object.keys(probe.data[0]).filter((k) => !META_COLS.includes(k));
    if (keys.length) { COL = keys[0]; return COL; }
  }
  // 2) Table empty (or select * blocked): try each candidate until one doesn't error.
  for (const c of CANDIDATES) {
    const t = await client.from(TABLE).select(`id, ${c}`).limit(1);
    if (!t.error) { COL = c; return COL; }
  }
  throw new Error(`Could not find the JSON column on "${TABLE}". Columns tried: ${CANDIDATES.join(", ")}`);
}
export async function detectedColumn() { try { return await detectColumn(); } catch { return null; } }

const parse = (v) => { if (v == null) return null; try { return typeof v === "string" ? JSON.parse(v) : v; } catch { throw new Error("stored payload was unreadable"); } };

/** Does this model actually contain anything worth keeping? */
export function modelHasData(m) {
  if (!m || typeof m !== "object") return false;
  for (const p of Object.values(m.properties || {})) {
    if (!p) continue;
    if (Object.keys(p.monthly || {}).length) return true;
    if (Object.keys(p.channelMonthly || {}).length) return true;
    if (p.snapshot) return true;
  }
  if ((m.events || []).length) return true;
  if (Object.keys(m.ads || {}).length) return true;
  return false;
}

/**
 * Returns the stored model, or null if no record exists yet.
 * THROWS if the database can't be reached — callers must treat that as "unknown", never "empty".
 */
export async function loadModel() {
  if (!client) return null; // not configured: browser-only mode
  const col = await detectColumn();
  const { data, error } = await client.from(TABLE).select(`id, ${col}`).eq("id", MAIN_ID).maybeSingle();
  if (error) throw new Error("loadModel failed: " + error.message);
  if (!data) return null; // genuinely no record yet
  return parse(data[col]);
}

/** Save the model. Refuses to wipe good data; keeps a rolling backup first. */
export async function saveModel(model, opts = {}) {
  if (!client) return { ok: false, reason: "not-configured" };
  let col;
  try { col = await detectColumn(); } catch (e) { return { ok: false, reason: e.message }; }

  if (!modelHasData(model) && !opts.allowEmpty) {
    let existing = null;
    try { existing = await loadModel(); } catch { return { ok: false, reason: "guard-load-failed" }; }
    if (modelHasData(existing)) {
      console.warn("saveModel BLOCKED: refusing to overwrite existing data with an empty model.");
      return { ok: false, reason: "blocked-empty-overwrite" };
    }
  }

  if (modelHasData(model)) { try { await writeBackup(col); } catch { /* best effort */ } }

  const row = { id: MAIN_ID };
  row[col] = JSON.stringify({ ...model, lastUpdated: new Date().toISOString() });
  const { error } = await client.from(TABLE).upsert(row, { onConflict: "id" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function writeBackup(col) {
  const { data } = await client.from(TABLE).select(`id, ${col}`).eq("id", MAIN_ID).maybeSingle();
  if (!data || data[col] == null) return;
  let cur; try { cur = parse(data[col]); } catch { return; }
  if (!modelHasData(cur)) return;
  const row = { id: "backup-" + new Date().toISOString().replace(/[:.]/g, "-") };
  row[col] = JSON.stringify(cur);
  await client.from(TABLE).upsert(row, { onConflict: "id" });
  await pruneBackups();
}

export async function listBackups() {
  if (!client) return [];
  const { data, error } = await client.from(TABLE).select("id").like("id", "backup-%");
  if (error || !data) return [];
  return data.map((r) => r.id).sort().reverse();
}

async function pruneBackups() {
  const ids = await listBackups();
  for (const id of ids.slice(MAX_BACKUPS)) { try { await client.from(TABLE).delete().eq("id", id); } catch {} }
}

export async function restoreBackup(id) {
  if (!client) throw new Error("not configured");
  const col = await detectColumn();
  const { data, error } = await client.from(TABLE).select(`id, ${col}`).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("backup not found");
  const model = parse(data[col]);
  const row = { id: MAIN_ID }; row[col] = JSON.stringify(model);
  const up = await client.from(TABLE).upsert(row, { onConflict: "id" });
  if (up.error) throw new Error(up.error.message);
  return model;
}

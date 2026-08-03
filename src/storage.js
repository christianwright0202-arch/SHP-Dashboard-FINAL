// SHP Dashboard — shared storage (Supabase), with safety rails.
//
// WHY THE RAILS: the previous version could silently destroy the shared dataset. If loadModel()
// failed for any reason (network blip, Supabase timeout), the app kept its EMPTY starting model,
// flipped to "loaded", and the save effect then wrote that empty model over everyone's real data.
// One failed read = total data loss. These functions now make that impossible:
//   1. loadModel THROWS on a real error and only returns null when the row genuinely doesn't exist,
//      so the app can tell "no data yet" apart from "couldn't reach the database".
//   2. saveModel refuses to overwrite a populated record with an empty one.
//   3. Every save first copies the current record to a timestamped backup that can be restored.

import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = "dashboard_state";
const MAIN_ID = "shp-main";
const MAX_BACKUPS = 12;

const client = (URL && KEY) ? createClient(URL, KEY) : null;
export const isConfigured = () => !!client;

// Does this model actually contain anything worth keeping?
export function modelHasData(m) {
  if (!m || typeof m !== "object") return false;
  const props = m.properties || {};
  for (const p of Object.values(props)) {
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
 * THROWS if the database could not be reached — callers must treat that as "unknown", never "empty".
 */
export async function loadModel() {
  if (!client) return null; // not configured: browser-only mode
  const { data, error } = await client.from(TABLE).select("payload").eq("id", MAIN_ID).maybeSingle();
  if (error) throw new Error("loadModel failed: " + error.message);
  if (!data) return null; // genuinely no record yet
  try {
    return typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
  } catch (e) {
    throw new Error("loadModel: stored payload was unreadable");
  }
}

/** Save the model. Refuses to wipe good data; keeps a rolling backup first. */
export async function saveModel(model, opts = {}) {
  if (!client) return { ok: false, reason: "not-configured" };
  const incomingHasData = modelHasData(model);

  // Guard: never let an empty model overwrite a populated one.
  if (!incomingHasData && !opts.allowEmpty) {
    let existing = null;
    try { existing = await loadModel(); } catch (e) { return { ok: false, reason: "guard-load-failed" }; }
    if (modelHasData(existing)) {
      console.warn("saveModel BLOCKED: refusing to overwrite existing data with an empty model.");
      return { ok: false, reason: "blocked-empty-overwrite" };
    }
  }

  // Backup the current record before overwriting it.
  if (incomingHasData) { try { await writeBackup(); } catch (e) { /* backup is best-effort */ } }

  const payload = JSON.stringify({ ...model, lastUpdated: new Date().toISOString() });
  const { error } = await client.from(TABLE).upsert({ id: MAIN_ID, payload }, { onConflict: "id" });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function writeBackup() {
  const { data } = await client.from(TABLE).select("payload").eq("id", MAIN_ID).maybeSingle();
  if (!data || !data.payload) return;
  const cur = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
  if (!modelHasData(cur)) return; // don't back up nothing
  const id = "backup-" + new Date().toISOString().replace(/[:.]/g, "-");
  await client.from(TABLE).upsert({ id, payload: JSON.stringify(cur) }, { onConflict: "id" });
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
  const stale = ids.slice(MAX_BACKUPS);
  for (const id of stale) { try { await client.from(TABLE).delete().eq("id", id); } catch (e) {} }
}

export async function restoreBackup(id) {
  if (!client) throw new Error("not configured");
  const { data, error } = await client.from(TABLE).select("payload").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("backup not found");
  const model = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
  await client.from(TABLE).upsert({ id: MAIN_ID, payload: JSON.stringify(model) }, { onConflict: "id" });
  return model;
}

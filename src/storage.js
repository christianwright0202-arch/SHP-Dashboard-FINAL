// storage.js — shared cloud storage for the SHP dashboard (Supabase).
// The whole dashboard "model" (everything your uploads produce) is saved as ONE row
// in a Supabase table called "dashboard_state". Every browser that opens the site
// reads that same row, so the whole team sees the same live data.
//
// Two settings come from Vercel environment variables (set once, see the walkthrough):
//   VITE_SUPABASE_URL       - your project's URL
//   VITE_SUPABASE_ANON_KEY  - your project's public "anon" key
// If either is missing, the app quietly falls back to browser-only mode (old behavior),
// so nothing breaks while you're setting it up.

import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL || "";
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// A single fixed row holds the shared dashboard. Everyone reads/writes this same id.
const ROW_ID = "shp-main";

const client = (URL && KEY) ? createClient(URL, KEY) : null;

// True when cloud storage is configured; the app can use this to show a badge if desired.
export const cloudEnabled = !!client;

// Load the shared dashboard model. Returns the saved model object, or null if none yet.
export async function loadModel() {
  if (!client) return null; // not configured -> browser-only fallback
  const { data, error } = await client
    .from("dashboard_state")
    .select("model")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) { console.warn("loadModel:", error.message); return null; }
  return data ? data.model : null;
}

// Save the shared dashboard model. Overwrites the single shared row.
// Debounced so rapid state changes don't hammer the database.
let saveTimer = null;
let lastPayload = null;
export async function saveModel(model) {
  if (!client) return; // not configured -> nothing to do
  lastPayload = model;
  if (saveTimer) clearTimeout(saveTimer);
  await new Promise((resolve) => {
    saveTimer = setTimeout(async () => {
      try {
        const { error } = await client
          .from("dashboard_state")
          .upsert({ id: ROW_ID, model: lastPayload, updated_at: new Date().toISOString() });
        if (error) console.warn("saveModel:", error.message);
      } catch (e) { console.warn("saveModel:", e.message); }
      resolve();
    }, 800);
  });
}

import { supabase, hasSupabase } from "./supabaseClient";

const KEY = "shp_dashboard_v1";

export async function loadModel() {
  if (hasSupabase) {
    const { data, error } = await supabase
      .from("dashboard")
      .select("data")
      .eq("id", KEY)
      .maybeSingle();
    if (error) { console.warn("Supabase load failed, using localStorage:", error.message); }
    else if (data) return data.data;
  }
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveModel(model) {
  // Always keep a local copy as a safety net.
  try { localStorage.setItem(KEY, JSON.stringify(model)); } catch (e) {}
  if (hasSupabase) {
    const { error } = await supabase
      .from("dashboard")
      .upsert({ id: KEY, data: model });
    if (error) console.warn("Supabase save failed:", error.message);
  }
}

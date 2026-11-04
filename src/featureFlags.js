// Feature flags for the new Cloudbeds / events / pace work.
//
// Default: ON in local dev (`npm run dev`), OFF on the deployed/built site — so nothing new is
// visible in production until it's ready. Override explicitly with VITE_ENABLE_CLOUDBEDS:
//   "1" / "true"  -> force ON  (e.g. to demo on a Vercel preview)
//   "0" / "false" -> force OFF (e.g. to hide it locally)
// import.meta.env must be accessed WITHOUT optional chaining so Vite statically replaces
// `import.meta.env.DEV` (true in `npm run dev`, false in `vite build`).
const ENV = import.meta.env || {};
function flag(raw, defaultValue) {
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || String(raw).toLowerCase() === "true";
}

// Gates the entire Cloudbeds ingest path + the new analysis pages built on it.
export const CLOUDBEDS_ENABLED = flag(ENV.VITE_ENABLE_CLOUDBEDS, import.meta.env.DEV === true);

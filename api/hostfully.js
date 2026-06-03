// Hostfully sync. Cursor pagination + revenue from /orders. ?debug=1 dumps a sample order.
const VERSION = "sync-v6-2026-06-03";
const BASE = "https://platform.hostfully.com/api/v3";

async function hfRaw(path, key) {
  try {
    const r = await fetch(BASE + path, { headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" } });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { error: e.message } }; }
}
async function hf(path, key) { const r = await hfRaw(path, key); if (!r.ok) { const e = new Error(`Hostfully ${path} -> ${r.status}`); e.detail = r.json; throw e; } return r.json; }
const arrOf = (o) => Array.isArray(o) ? o : (o && (o.leads || o.properties || o.agencies || o.orders || o.data || o.results) || []);
const nextCursor = (resp) => (resp && resp._paging && resp._paging._nextCursor) || (resp && resp._metadata && resp._metadata._nextCursor) || null;

// Cursor pagination; auto-detects whether the param is `cursor` or `_cursor`.
async function pageAll(base, key, cap = 200) {
  const seen = new Set(), all = []; const sep = base.includes("?") ? "&" : "?";
  const fetchPage = (cur, param) => hf(`${base}${sep}limit=100${cur ? `&${param}=${encodeURIComponent(cur)}` : ""}`, key);
  const ingest = (arr) => { let added = 0; for (const it of arr) { const id = it.uid || JSON.stringify(it); if (!seen.has(id)) { seen.add(id); all.push(it); added++; } } return added; };
  let resp = await fetchPage(null, "cursor"); ingest(arrOf(resp));
  let cur = nextCursor(resp), param = "cursor";
  if (cur) {
    let r2 = await fetchPage(cur, "cursor"); let added = ingest(arrOf(r2));
    if (added === 0) { r2 = await fetchPage(cur, "_cursor"); added = ingest(arrOf(r2)); if (added > 0) param = "_cursor"; }
    cur = added > 0 ? nextCursor(r2) : null;
    for (let i = 0; i < cap && cur; i++) { const r = await fetchPage(cur, param); const a = ingest(arrOf(r)); cur = nextCursor(r); if (!a || !cur) break; }
  }
  return all;
}

const statusOf = (l) => String(l.status || l.leadStatus || "").toUpperCase();
const isBooked = (l) => statusOf(l) === "BOOKED";
const dateOf = (l, k) => { const v = l[k + "LocalDateTime"] || l[k + "ZonedDateTime"] || l[k + "Date"] || l[k]; return v ? String(v).slice(0, 10) : null; };
function channelOf(l) {
  const s = String(l.channel || l.source || "").toUpperCase();
  if (s.includes("AIRBNB")) return "Airbnb";
  if (s.includes("VRBO") || s.includes("HOMEAWAY")) return "Vrbo";
  if (s.includes("BOOKING")) return "Booking.com";
  if (s.includes("EXPEDIA")) return "Expedia";
  if (s.includes("DIRECT") || s.includes("WEBSITE") || s.includes("MANUAL") || s.includes("DBS") || s.includes("WIDGET") || s === "HOSTFULLY") return "Direct";
  return "Other";
}
function moneyFrom(obj) {
  let best = 0;
  const want = /(grand_?total|total_?amount|^total$|payout|subtotal|^amount$|balance|^price$)/i;
  const skip = /count|score|night|guest|adult|child|pet|infant|tax|fee$|days|number|uid|id$/i;
  const walk = (o, d) => { if (!o || typeof o !== "object" || d > 6) return; for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object") { walk(v, d + 1); continue; } const n = Number(v); if (isFinite(n) && n > 0 && want.test(k) && !skip.test(k)) best = Math.max(best, n); } };
  walk(obj, 0); return best;
}
const orderMoney = async (uid, key) => { try { return moneyFrom(await hf(`/orders?leadUid=${uid}`, key)); } catch { return 0; } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const key = process.env.HOSTFULLY_API_KEY;
  const debug = (req.query && req.query.debug === "1") || (req.url || "").includes("debug=1");
  if (!key) return res.status(400).json({ error: "HOSTFULLY_API_KEY not set in Vercel" });
  try {
    let agencyUid = process.env.HOSTFULLY_AGENCY_UID || (arrOf(await hf("/agencies", key))[0] || {}).uid;
    const propList = await pageAll(`/properties?agencyUid=${agencyUid}`, key);
    const nameByUid = {}; propList.forEach((p) => { nameByUid[p.uid] = p.name || p.title || ""; });
    const leads = await pageAll(`/leads?agencyUid=${agencyUid}`, key);
    const booked = leads.filter(isBooked);

    if (debug) {
      const uid = (booked[0] || {}).uid;
      const sampleOrder = uid ? await hf(`/orders?leadUid=${uid}`, key).catch(() => null) : null;
      return res.status(200).json({
        version: VERSION, agencyUid,
        propertyCount: propList.length, propertyNames: propList.map((p) => p.name || p.title),
        leadCount: leads.length, bookedCount: booked.length,
        sampleOrder, sampleOrderMoney: sampleOrder ? moneyFrom(sampleOrder) : 0,
      });
    }

    // revenue per booked lead from /orders (chunked)
    const rows = [];
    for (let i = 0; i < booked.length; i += 12) {
      const chunk = booked.slice(i, i + 12);
      const amts = await Promise.all(chunk.map((l) => orderMoney(l.uid, key)));
      chunk.forEach((l, j) => {
        const ci = dateOf(l, "checkIn"); if (!ci || !(amts[j] > 0)) return;
        rows.push({ propertyName: nameByUid[l.propertyUid] || "", checkIn: ci, checkOut: dateOf(l, "checkOut"), amount: amts[j], source: channelOf(l) });
      });
    }
    return res.status(200).json({ version: VERSION, ok: true, count: rows.length, bookedCount: booked.length, propertyCount: propList.length, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message, detail: e.detail });
  }
}

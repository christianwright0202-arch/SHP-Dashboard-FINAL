// Hostfully sync. Cursor pagination + bulk orders (matched to leads). ?debug=1 dumps a sample order.
const VERSION = "sync-v7-2026-06-03";
const BASE = "https://platform.hostfully.com/api/v3";

async function hfRaw(path, key) {
  try {
    const r = await fetch(BASE + path, { headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" } });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { error: e.message } }; }
}
async function hf(path, key) { const r = await hfRaw(path, key); if (!r.ok) { const e = new Error(`${path} -> ${r.status}`); e.detail = r.json; throw e; } return r.json; }
const arrOf = (o) => Array.isArray(o) ? o : (o && (o.leads || o.properties || o.agencies || o.orders || o.data || o.results) || []);
const nextCursor = (r) => (r && r._paging && r._paging._nextCursor) || (r && r._metadata && r._metadata._nextCursor) || null;

async function pageAll(base, key, cap = 60) {
  const seen = new Set(), all = []; const sep = base.includes("?") ? "&" : "?";
  const get = (cur, param) => hf(`${base}${sep}limit=100${cur ? `&${param}=${encodeURIComponent(cur)}` : ""}`, key);
  const eat = (arr) => { let a = 0; for (const it of arr) { const id = it.uid || JSON.stringify(it); if (!seen.has(id)) { seen.add(id); all.push(it); a++; } } return a; };
  let resp = await get(null, "cursor").catch(() => null); if (!resp) return all;
  eat(arrOf(resp)); let cur = nextCursor(resp), param = "cursor";
  if (cur) {
    let r2 = await get(cur, "cursor").catch(() => null); let added = r2 ? eat(arrOf(r2)) : 0;
    if (added === 0) { r2 = await get(cur, "_cursor").catch(() => null); added = r2 ? eat(arrOf(r2)) : 0; if (added > 0) param = "_cursor"; }
    cur = added > 0 ? nextCursor(r2) : null;
    for (let i = 0; i < cap && cur; i++) { const r = await get(cur, param).catch(() => null); if (!r) break; const a = eat(arrOf(r)); cur = nextCursor(r); if (!a || !cur) break; }
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
// find a uid string anywhere in the object that belongs to a known lead
function leadUidIn(obj, set, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return null;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && set.has(v)) return v;
    if (v && typeof v === "object") { const f = leadUidIn(v, set, depth + 1); if (f) return f; }
  }
  return null;
}

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
    const bookedByUid = {}; booked.forEach((l) => { bookedByUid[l.uid] = l; });
    const bookedSet = new Set(Object.keys(bookedByUid));

    // bulk orders, matched to leads by uid
    const orders = await pageAll(`/orders?agencyUid=${agencyUid}`, key);
    const moneyByLead = {};
    for (const ord of orders) {
      const lu = ord.leadUid || (ord.lead && ord.lead.uid) || leadUidIn(ord, bookedSet);
      if (lu && bookedSet.has(lu)) moneyByLead[lu] = (moneyByLead[lu] || 0) + moneyFrom(ord);
    }

    if (debug) {
      return res.status(200).json({
        version: VERSION, agencyUid,
        propertyCount: propList.length, propertyNames: propList.map((p) => p.name || p.title),
        leadCount: leads.length, bookedCount: booked.length,
        orderCount: orders.length, ordersMatchedToBookings: Object.keys(moneyByLead).length,
        sampleOrder: orders[0] || null,
        sampleMatchedMoney: Object.values(moneyByLead)[0] || 0,
      });
    }

    const rows = booked.map((l) => ({
      propertyName: nameByUid[l.propertyUid] || "", checkIn: dateOf(l, "checkIn"), checkOut: dateOf(l, "checkOut"),
      amount: moneyByLead[l.uid] || 0, source: channelOf(l),
    })).filter((r) => r.checkIn && r.amount > 0);

    return res.status(200).json({ version: VERSION, ok: true, count: rows.length, bookedCount: booked.length, propertyCount: propList.length, orderCount: orders.length, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message, detail: e.detail });
  }
}

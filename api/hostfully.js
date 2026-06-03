// Hostfully sync + discovery. ?debug=1 reports pagination + financial-endpoint probes.
const VERSION = "probe-v5-2026-06-03";
const BASE = "https://platform.hostfully.com/api/v3";

async function hfRaw(path, key, method = "GET", body) {
  try {
    const r = await fetch(BASE + path, { method, headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 300) }; }
    return { path, ok: r.ok, status: r.status, json: j };
  } catch (e) { return { path, ok: false, status: 0, json: { error: e.message } }; }
}
async function hf(path, key) { const r = await hfRaw(path, key); if (!r.ok) { const e = new Error(`Hostfully ${path} -> ${r.status}`); e.detail = r.json; throw e; } return r.json; }
const arrOf = (o) => Array.isArray(o) ? o : (o && (o.leads || o.properties || o.agencies || o.data || o.results) || []);

async function pageAll(base, key, cap = 80) {
  const seen = new Set(); const all = [];
  for (let i = 0, offset = 0; i < cap; i++) {
    const resp = await hf(`${base}${base.includes("?") ? "&" : "?"}limit=100&offset=${offset}`, key);
    const arr = arrOf(resp); if (!arr.length) break;
    let added = 0; for (const it of arr) { const id = it.uid || JSON.stringify(it); if (!seen.has(id)) { seen.add(id); all.push(it); added++; } }
    offset += arr.length; if (added === 0) break;
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
  const walk = (o, d) => { if (!o || typeof o !== "object" || d > 5) return; for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object") { walk(v, d + 1); continue; } const n = Number(v); if (isFinite(n) && n > 0 && want.test(k) && !skip.test(k)) best = Math.max(best, n); } };
  walk(obj, 0); return best;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const key = process.env.HOSTFULLY_API_KEY;
  const debug = (req.query && req.query.debug === "1") || (req.url || "").includes("debug=1");
  if (!key) return res.status(400).json({ error: "HOSTFULLY_API_KEY not set in Vercel" });
  try {
    let agencyUid = process.env.HOSTFULLY_AGENCY_UID || (arrOf(await hf("/agencies", key))[0] || {}).uid;

    if (debug) {
      // 1) pagination probe: compare page at offset 0 vs offset 20
      const p0 = await hf(`/leads?agencyUid=${agencyUid}&limit=20&offset=0`, key);
      const p20 = await hf(`/leads?agencyUid=${agencyUid}&limit=20&offset=20`, key);
      const a0 = arrOf(p0), a20 = arrOf(p20);
      // 2) financial-endpoint probes on one BOOKED lead
      const allLeads = arrOf(await hf(`/leads?agencyUid=${agencyUid}&limit=100&offset=0`, key));
      const uid = (allLeads.find(isBooked) || {}).uid;
      const probes = [];
      if (uid) for (const path of [`/leads/${uid}/quote`, `/leads/${uid}/order`, `/leads/${uid}/financials`, `/leads/${uid}/transactions`, `/leads/${uid}/payments`, `/quotes?leadUid=${uid}`, `/orders?leadUid=${uid}`, `/leads/${uid}/checkoutQuote`]) {
        const r = await hfRaw(path, key);
        probes.push({ path, status: r.status, keys: r.json && !Array.isArray(r.json) ? Object.keys(r.json).slice(0, 12) : (Array.isArray(r.json) ? `array[${r.json.length}]` : null), money: moneyFrom(r.json || {}) });
      }
      return res.status(200).json({
        version: VERSION,
        agencyUid,
        pagination: { page0Count: a0.length, page0FirstUid: a0[0]?.uid, page20Count: a20.length, page20FirstUid: a20[0]?.uid, offsetWorks: a0[0]?.uid && a20[0]?.uid && a0[0].uid !== a20[0].uid, leadsPaging: p0._paging || p0._metadata || null },
        financialProbes: probes,
      });
    }

    const propList = await pageAll(`/properties?agencyUid=${agencyUid}`, key);
    const nameByUid = {}; propList.forEach((p) => { nameByUid[p.uid] = p.name || p.title || ""; });
    const leads = await pageAll(`/leads?agencyUid=${agencyUid}`, key);
    const booked = leads.filter(isBooked);
    const details = [];
    for (let i = 0; i < booked.length; i += 8) { const chunk = booked.slice(i, i + 8); const got = await Promise.all(chunk.map((l) => hfRaw(`/leads/${l.uid}`, key).then((r) => r.json).catch(() => null))); got.forEach((d, j) => details.push({ lead: chunk[j], detail: d })); }
    const rows = details.map(({ lead, detail }) => ({ propertyName: nameByUid[lead.propertyUid] || "", checkIn: dateOf(lead, "checkIn"), checkOut: dateOf(lead, "checkOut"), amount: moneyFrom(detail || {}) || moneyFrom(lead), source: channelOf(lead) })).filter((r) => r.checkIn && r.amount > 0);
    return res.status(200).json({ version: VERSION, ok: true, count: rows.length, bookedCount: booked.length, propertyCount: propList.length, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message, detail: e.detail });
  }
}

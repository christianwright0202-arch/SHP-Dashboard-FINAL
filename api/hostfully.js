// Pulls live data from Hostfully and returns normalized booking rows for the dashboard.
// Setup (Vercel -> Settings -> Environment Variables):
//   HOSTFULLY_API_KEY    = key from Agency Settings
//   HOSTFULLY_AGENCY_UID = agency UID (optional; auto-discovered if omitted)
//
// Add ?debug=1 to the URL to see exactly what Hostfully returns (for mapping).
const BASE = "https://platform.hostfully.com/api/v3";

async function hf(path, key) {
  const r = await fetch(BASE + path, { headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
  if (!r.ok) { const e = new Error(`Hostfully ${path} -> ${r.status}`); e.detail = json; throw e; }
  return json;
}
const arrOf = (o) => Array.isArray(o) ? o : (o?.leads || o?.properties || o?.agencies || o?.data || o?.results || o?._embedded?.leads || []);

const DEAD = /cancel|ignore|declin|closed|expired|archiv/i;
function leadAmount(l) {
  const c = [l.grandTotal, l.totalAmount, l.subTotalAmount, l.payoutAmount, l.total, l.amount, l.totalPrice, l.priceTotal,
    l && l.financials && l.financials.grandTotal, l && l.order && l.order.grandTotal, l && l.pricing && l.pricing.total, l && l.money && l.money.grandTotal];
  for (const x of c) { const n = Number(x); if (isFinite(n) && n > 0) return n; }
  return 0;
}
function leadSource(l) {
  const s = String(l.source || l.channel || l.platform || l.bookingSource || (l.booking && l.booking.source) || l.leadSource || "").toLowerCase();
  if (s.includes("airbnb")) return "Airbnb";
  if (s.includes("vrbo") || s.includes("homeaway")) return "Vrbo";
  if (s.includes("booking")) return "Booking.com";
  if (s.includes("expedia")) return "Expedia";
  if (s.includes("direct") || s.includes("website") || s.includes("manual") || s.includes("dbs") || s.includes("widget")) return "Direct";
  return "Other";
}
const dOf = (l) => l.checkInDate || l.arrivalDate || l.startDate || l.checkIn || l.fromDate || null;
const oOf = (l) => l.checkOutDate || l.departureDate || l.endDate || l.checkOut || l.toDate || null;
const statusOf = (l) => String(l.status || l.leadStatus || l.stage || "");

export default async function handler(req, res) {
  const key = process.env.HOSTFULLY_API_KEY;
  const debug = (req.query && req.query.debug === "1") || (req.url || "").includes("debug=1");
  if (!key) return res.status(400).json({ error: "HOSTFULLY_API_KEY not set in Vercel" });
  try {
    let agencyUid = process.env.HOSTFULLY_AGENCY_UID;
    if (!agencyUid) { const ag = await hf("/agencies", key); agencyUid = (arrOf(ag)[0] || {}).uid; }
    if (!agencyUid) return res.status(400).json({ error: "Could not resolve agency UID; set HOSTFULLY_AGENCY_UID" });

    const propsResp = await hf(`/properties?agencyUid=${agencyUid}&limit=200`, key);
    const propList = arrOf(propsResp);
    const nameByUid = {}; propList.forEach((p) => { nameByUid[p.uid] = p.name || p.title || ""; });

    let leads = [], offset = 0, lastResp = null;
    for (let i = 0; i < 25; i++) {
      const resp = await hf(`/leads?agencyUid=${agencyUid}&limit=100&offset=${offset}`, key);
      lastResp = resp; const arr = arrOf(resp);
      if (!arr.length) break;
      leads = leads.concat(arr);
      if (arr.length < 100) break;
      offset += 100;
    }

    if (debug) {
      return res.status(200).json({
        agencyUid,
        propertyCount: propList.length,
        propertyNames: Object.values(nameByUid).slice(0, 20),
        leadsResponseKeys: lastResp && !Array.isArray(lastResp) ? Object.keys(lastResp) : "array",
        rawLeadCount: leads.length,
        statusesSeen: [...new Set(leads.map(statusOf))],
        sampleLead: leads[0] || null,
      });
    }

    const rows = leads
      .filter((l) => !DEAD.test(statusOf(l)))
      .map((l) => ({ propertyName: nameByUid[l.propertyUid] || l.propertyName || "", checkIn: dOf(l), checkOut: oOf(l), amount: leadAmount(l), source: leadSource(l) }))
      .filter((r) => r.checkIn && r.amount > 0);

    return res.status(200).json({ ok: true, count: rows.length, properties: Object.values(nameByUid), rows });
  } catch (e) {
    return res.status(500).json({ error: e.message, detail: e.detail });
  }
}

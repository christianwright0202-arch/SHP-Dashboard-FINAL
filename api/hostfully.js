// Pulls live data from Hostfully and returns normalized booking rows for the dashboard.
// Setup (Vercel -> Settings -> Environment Variables):
//   HOSTFULLY_API_KEY    = key from Agency Settings
//   HOSTFULLY_AGENCY_UID = agency UID (optional; auto-discovered if omitted)
//
// ?debug=1  -> shows raw lead + lead-detail shape (for mapping)
const BASE = "https://platform.hostfully.com/api/v3";

async function hf(path, key) {
  const r = await fetch(BASE + path, { headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 400) }; }
  if (!r.ok) { const e = new Error(`Hostfully ${path} -> ${r.status}`); e.detail = json; throw e; }
  return json;
}
const arrOf = (o) => Array.isArray(o) ? o : (o && (o.leads || o.properties || o.agencies || o.data || o.results) || []);
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
// search an object (incl. nested) for the booking total
function moneyFrom(obj) {
  let best = 0;
  const want = /(grand_?total|total_?amount|^total$|payout|subtotal|amount|balance|price)/i;
  const skip = /count|score|id|night|guest|adult|child|pet|infant|tax|fee$|days|number/i;
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 4) return;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object") { walk(v, depth + 1); continue; }
      const n = Number(v);
      if (isFinite(n) && n > 0 && want.test(k) && !skip.test(k)) {
        // prefer grand/total over generic
        const weight = /grand/i.test(k) ? 3 : /^total$|total_?amount/i.test(k) ? 2 : 1;
        if (weight >= 2 || n > best) best = Math.max(best, n);
      }
    }
  };
  walk(obj, 0);
  return best;
}

export default async function handler(req, res) {
  const key = process.env.HOSTFULLY_API_KEY;
  const debug = (req.query && req.query.debug === "1") || (req.url || "").includes("debug=1");
  if (!key) return res.status(400).json({ error: "HOSTFULLY_API_KEY not set in Vercel" });
  try {
    let agencyUid = process.env.HOSTFULLY_AGENCY_UID;
    if (!agencyUid) { const ag = await hf("/agencies", key); agencyUid = (arrOf(ag)[0] || {}).uid; }

    const propsResp = await hf(`/properties?agencyUid=${agencyUid}&limit=200`, key);
    const propList = arrOf(propsResp);
    const nameByUid = {}; propList.forEach((p) => { nameByUid[p.uid] = p.name || p.title || ""; });

    let leads = [], offset = 0;
    for (let i = 0; i < 25; i++) {
      const resp = await hf(`/leads?agencyUid=${agencyUid}&limit=100&offset=${offset}`, key);
      const arr = arrOf(resp); if (!arr.length) break;
      leads = leads.concat(arr); if (arr.length < 100) break; offset += 100;
    }
    const booked = leads.filter(isBooked);

    // fetch detail for each booked lead (chunked) to get the dollar amount
    const detailFor = async (uid) => { try { return await hf(`/leads/${uid}`, key); } catch { return null; } };
    const details = [];
    for (let i = 0; i < booked.length; i += 8) {
      const chunk = booked.slice(i, i + 8);
      const got = await Promise.all(chunk.map((l) => detailFor(l.uid)));
      got.forEach((d, j) => details.push({ lead: chunk[j], detail: d }));
    }

    if (debug) {
      const sampleBooked = booked[0] || null;
      const sampleDetail = details.find((d) => d.detail)?.detail || null;
      return res.status(200).json({
        agencyUid, propertyCount: propList.length, propertyNames: Object.values(nameByUid),
        rawLeadCount: leads.length, bookedCount: booked.length, statusesSeen: [...new Set(leads.map(statusOf))],
        sampleBookedLead: sampleBooked,
        sampleBookedDetailKeys: sampleDetail ? Object.keys(sampleDetail) : null,
        sampleBookedDetail: sampleDetail,
        moneyExtractedFromDetail: sampleDetail ? moneyFrom(sampleDetail) : null,
        moneyExtractedFromLead: sampleBooked ? moneyFrom(sampleBooked) : null,
      });
    }

    const rows = details.map(({ lead, detail }) => {
      const amount = moneyFrom(detail || {}) || moneyFrom(lead);
      return { propertyName: nameByUid[lead.propertyUid] || "", checkIn: dateOf(lead, "checkIn"), checkOut: dateOf(lead, "checkOut"), amount, source: channelOf(lead) };
    }).filter((r) => r.checkIn && r.amount > 0);

    return res.status(200).json({ ok: true, count: rows.length, bookedCount: booked.length, properties: Object.values(nameByUid), rows });
  } catch (e) {
    return res.status(500).json({ error: e.message, detail: e.detail });
  }
}

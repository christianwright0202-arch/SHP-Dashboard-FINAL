// Pulls live data from Hostfully and returns normalized records the dashboard can merge.
// Setup (Vercel → Project → Settings → Environment Variables):
//   HOSTFULLY_API_KEY   = your key from Agency Settings
//   HOSTFULLY_AGENCY_UID = your agency UID (optional; auto-discovered if omitted)
const BASE = "https://platform.hostfully.com/api/v3";

async function hf(path, key) {
  const r = await fetch(BASE + path, { headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Hostfully ${path} -> ${r.status}`);
  return r.json();
}

// best-effort: pick the first numeric money field that exists on a lead
function leadAmount(lead) {
  const cands = [lead.grandTotal, lead.totalAmount, lead.subTotalAmount, lead.payoutAmount, lead.total, lead?.financials?.grandTotal, lead?.amount];
  for (const c of cands) { const n = Number(c); if (isFinite(n) && n > 0) return n; }
  return 0;
}
function leadSource(lead) {
  const s = String(lead.source || lead.channel || lead.platform || lead?.booking?.source || "").toLowerCase();
  if (s.includes("airbnb")) return "Airbnb";
  if (s.includes("vrbo") || s.includes("homeaway")) return "Vrbo";
  if (s.includes("booking")) return "Booking.com";
  if (s.includes("expedia")) return "Expedia";
  if (s.includes("direct") || s.includes("website") || s.includes("manual") || s.includes("dbs")) return "Direct";
  return "Other";
}

export default async function handler(req, res) {
  const key = process.env.HOSTFULLY_API_KEY;
  if (!key) return res.status(400).json({ error: "HOSTFULLY_API_KEY not set in Vercel" });
  try {
    // 1) agency
    let agencyUid = process.env.HOSTFULLY_AGENCY_UID;
    if (!agencyUid) { const ag = await hf("/agencies", key); agencyUid = (ag.agencies || ag.data || ag)[0]?.uid; }
    if (!agencyUid) return res.status(400).json({ error: "Could not resolve agency UID" });

    // 2) properties (uid -> name)
    const props = await hf(`/properties?agencyUid=${agencyUid}&limit=200`, key);
    const propList = props.properties || props.data || props || [];
    const nameByUid = {}; propList.forEach((p) => { nameByUid[p.uid] = p.name || p.title || ""; });

    // 3) booked leads (paginate)
    let leads = [], offset = 0;
    for (let i = 0; i < 20; i++) {
      const page = await hf(`/leads?agencyUid=${agencyUid}&limit=100&offset=${offset}`, key);
      const arr = page.leads || page.data || page || [];
      if (!arr.length) break;
      leads = leads.concat(arr);
      if (arr.length < 100) break;
      offset += 100;
    }

    // 4) keep BOOKED leads, return raw-ish rows for the client to map to its property model
    const rows = leads
      .filter((l) => /book/i.test(String(l.status || l.leadStatus || "")))
      .map((l) => ({
        propertyName: nameByUid[l.propertyUid] || l.propertyName || "",
        checkIn: l.checkInDate || l.arrivalDate || l.startDate || null,
        checkOut: l.checkOutDate || l.departureDate || l.endDate || null,
        amount: leadAmount(l),
        source: leadSource(l),
      }))
      .filter((r) => r.checkIn && r.amount > 0);

    return res.status(200).json({ ok: true, count: rows.length, properties: Object.values(nameByUid), rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

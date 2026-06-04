// Hostfully sync. Cursor pagination + per-lead orders (rent.netPrice), time-budgeted so it always returns.
const VERSION = "sync-v9-2026-06-03";
const BASE = "https://platform.hostfully.com/api/v3";
const DEADLINE_MS = 52000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

async function hfRaw(path, key) {
  try {
    const r = await fetch(BASE + path, { headers: { "X-HOSTFULLY-APIKEY": key, "Content-Type": "application/json" } });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { error: e.message } }; }
}
async function hf(path, key) { const r = await hfRaw(path, key); if (!r.ok) throw new Error(`${path} -> ${r.status}`); return r.json; }
const arrOf = (o) => Array.isArray(o) ? o : (o && (o.leads || o.properties || o.agencies || o.orders || o.data || o.results) || []);
const nextCursor = (r) => (r && r._paging && r._paging._nextCursor) || (r && r._metadata && r._metadata._nextCursor) || null;

// sequential cursor pagination (proven reliable)
async function pageAll(base, key, cap = 120) {
  const seen = new Set(), all = []; const sep = base.includes("?") ? "&" : "?";
  const get = (cur, p) => hf(`${base}${sep}limit=100${cur ? `&${p}=${encodeURIComponent(cur)}` : ""}`, key);
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
const orderRent = (o) => Number(o && o.rent && o.rent.netPrice) || Number(o && o.totalAmount) || 0;

async function leadMoney(uid, key) {
  for (let t = 0; t < 2; t++) {
    const r = await hfRaw(`/orders?leadUid=${uid}`, key);
    if (r.ok) return arrOf(r.json).reduce((s, o) => s + orderRent(o), 0);
    if (r.status === 429) { await sleep(450); continue; }
    return 0;
  }
  return 0;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const start = Date.now();
  const key = process.env.HOSTFULLY_API_KEY;
  const debug = (req.query && req.query.debug === "1") || (req.url || "").includes("debug=1");
  if (!key) return res.status(400).json({ error: "HOSTFULLY_API_KEY not set in Vercel" });
  try {
    let agencyUid = process.env.HOSTFULLY_AGENCY_UID || (arrOf(await hf("/agencies", key))[0] || {}).uid;
    const propList = await pageAll(`/properties?agencyUid=${agencyUid}`, key);
    const nameByUid = {}; propList.forEach((p) => { nameByUid[p.uid] = p.name || p.title || ""; });
    const leads = await pageAll(`/leads?agencyUid=${agencyUid}`, key);
    const booked = leads.filter(isBooked);
    // most-recent first so a partial run still covers what matters
    booked.sort((a, b) => (dateOf(b, "checkIn") || "").localeCompare(dateOf(a, "checkIn") || ""));

    if (debug) {
      const sampleMoney = booked.length ? await leadMoney(booked[0].uid, key) : 0;
      return res.status(200).json({ version: VERSION, propertyCount: propList.length, leadCount: leads.length, bookedCount: booked.length, sampleLeadMoney: sampleMoney, elapsedMs: Date.now() - start });
    }

    const moneyByLead = {}; let partial = false;
    for (let i = 0; i < booked.length; i += 25) {
      if (Date.now() - start > DEADLINE_MS) { partial = true; break; }
      const chunk = booked.slice(i, i + 25);
      const amts = await Promise.all(chunk.map((l) => leadMoney(l.uid, key)));
      chunk.forEach((l, j) => { if (amts[j] > 0) moneyByLead[l.uid] = amts[j]; });
    }

    const rows = booked.map((l) => ({
      propertyName: nameByUid[l.propertyUid] || "", checkIn: dateOf(l, "checkIn"), checkOut: dateOf(l, "checkOut"),
      amount: moneyByLead[l.uid] || 0, source: channelOf(l),
    })).filter((r) => r.checkIn && r.amount > 0);

    return res.status(200).json({ version: VERSION, ok: true, count: rows.length, bookedCount: booked.length, matched: Object.keys(moneyByLead).length, partial, propertyCount: propList.length, elapsedMs: Date.now() - start, rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

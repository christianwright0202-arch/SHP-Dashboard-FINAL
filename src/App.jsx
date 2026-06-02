import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, AreaChart,
} from "recharts";
import * as XLSX from "xlsx";
import { loadModel, saveModel } from "./storage";
import {
  Upload, TrendingUp, TrendingDown, AlertTriangle, Calendar, Sparkles,
  LayoutGrid, Building2, MessageSquare, Send, RefreshCw, Trash2, FileText,
  DollarSign, Percent, BedDouble, Gauge, Loader2, ChevronRight, X, Target, Search,
} from "lucide-react";

/* ============================================================
   SHP REPORTING DASHBOARD
   ============================================================ */

const C = {
  bg: "#edeef0",
  panel: "#ffffff",
  border: "#e2e5e9",
  borderStrong: "#d3d7dd",
  ink: "#1b2330",
  sub: "#566273",
  muted: "#6b7280",
  faint: "#9aa1ad",
  slate: "#243244",
  good: "#1f7a4d",
  bad: "#cf3a3a",
  track: "#f3f4f6",
};

const PROPERTIES = [
  { id: "soma", name: "Hotel SOMA", short: "SOMA", color: "#e07b1f", location: "Fort Worth", units: 31, market: "fortworth", match: /soma/i },
  { id: "rambler", name: "The Rambler Inn", short: "Rambler", color: "#cf3a3a", location: "Fort Worth", units: 22, market: "fortworth", match: /rambler/i },
  { id: "ryan", name: "The Ryan", short: "Ryan", color: "#173a63", location: "Arlington", units: 18, market: "arlington", match: /(ballpark|rogers|ryan)/i },
  { id: "kress", name: "Kress", short: "Kress", color: "#1f7a4d", location: "Fort Worth", units: 7, market: "fortworth", match: /kress/i },
  { id: "harley", name: "Harley", short: "Harley", color: "#6a3da8", location: "Fort Worth", units: 3, market: "fortworth", match: /harley/i },
];
const PROP_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_IDX = Object.fromEntries(MONTHS.map((m, i) => [m.toLowerCase(), i]));
const OTA_COLORS = { Airbnb: "#e23b3b", Vrbo: "#1668e3", Expedia: "#f5c518", "Booking.com": "#f08a24", Direct: "#1f7a4d", Other: "#94a3b8" };

const MODEL = { properties: {}, events: [], eventsSource: "none", lastUpdated: null };

/* ---------------- parsing helpers ---------------- */
const num = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "").replace(/%$/, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
};
const pct = (v) => {
  if (v == null || v === "") return null;
  const isPctStr = typeof v === "string" && v.includes("%");
  let n = num(v);
  if (n == null) return null;
  if (isPctStr) n = n / 100;
  else if (n > 1.5) n = n / 100; // 87 -> 0.87
  return n;
};
const daysInMonth = (year, mIdx) => new Date(year, mIdx + 1, 0).getDate();
const norm = (s) => String(s ?? "").toLowerCase().trim();

function classifyListing(name) {
  const n = norm(name);
  for (const p of PROPERTIES) if (p.match.test(n)) return p.id;
  return null;
}
function guessPropertyFromFilename(fn) {
  const n = norm(fn);
  for (const p of PROPERTIES) {
    if (p.match.test(n)) return p.id;
    if (n.includes(p.id) || n.includes(norm(p.short))) return p.id;
  }
  return null;
}
function sourceLabel(raw) {
  const n = norm(raw);
  if (n.includes("airbnb")) return "Airbnb";
  if (n.includes("vrbo") || n.includes("homeaway")) return "Vrbo";
  if (n.includes("booking")) return "Booking.com";
  if (n.includes("expedia")) return "Expedia";
  if (n.includes("direct") || n.includes("website") || n.includes("hostfully") || n.includes("cloudbeds")) return "Direct";
  return "Other";
}
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") { const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null; if (d) return new Date(d.y, d.m - 1, d.d); }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const mkey = (y, mIdx) => `${y}-${String(mIdx + 1).padStart(2, "0")}`;

/* find header row: row containing the most KPI keywords */
const KW = ["listing", "revenue", "occupancy", "occ", "adr", "revpar", "source", "date", "nights", "accommodations", "check in", "check-in", "af"];
function detectHeader(rows) {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = (rows[i] || []).map(norm);
    const score = cells.reduce((a, c) => a + (KW.some((k) => c.includes(k)) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 2 ? best : -1;
}
function colFinder(headers) {
  const h = headers.map(norm);
  return (...keys) => {
    for (const k of keys) {
      const i = h.findIndex((x) => x.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
}

/* Ingest one sheet -> array of normalized records */
function ingestSheet(rows, ctx) {
  const out = [];
  const hr = detectHeader(rows);
  if (hr < 0) return out;
  const headers = rows[hr].map((x) => String(x ?? ""));
  const find = colFinder(headers);
  const body = rows.slice(hr + 1);

  // detect format
  const hasSource = find("source") >= 0;
  const hasCheckin = find("check in", "check-in", "checkin") >= 0;
  const hasListing = find("listing") >= 0;
  const dateCol = find("date");
  // monthly RevPAR style: a "date" col with month names + year-suffixed revenue cols
  const yearRevCols = headers.map((hd, i) => {
    const m = String(hd).match(/revenue\D*(\d{4})/i) || String(hd).match(/rental revenue\D*(\d{4})/i);
    return m ? { i, year: +m[1] } : null;
  }).filter(Boolean);
  const yearRevparCols = headers.map((hd, i) => { const m = String(hd).match(/revpar\D*(\d{4})/i); return m ? { i, year: +m[1] } : null; }).filter(Boolean);
  const yearNightsCols = headers.map((hd, i) => { const m = String(hd).match(/(accommodations booked|nights)\D*(\d{4})/i); return m ? { i, year: +m[2] } : null; }).filter(Boolean);

  if (hasSource && hasCheckin) {
    // RESERVATION-LEVEL
    const cSrc = find("source"), cIn = find("check in", "check-in", "checkin"), cList = find("listing");
    const cNights = find("nights"), cAF = find("af", "accommodation fare", "fare", "revenue"), cADR = find("adr");
    for (const r of body) {
      const list = r[cList]; const prop = classifyListing(list) || ctx.propOverride;
      if (!prop) continue;
      const d = toDate(r[cIn]); if (!d) continue;
      let rev = num(r[cAF]);
      const nights = num(r[cNights]) || 0;
      if (rev == null && cADR >= 0) rev = (num(r[cADR]) || 0) * nights;
      if (rev == null) continue;
      out.push({ kind: "res", prop, month: mkey(d.getFullYear(), d.getMonth()), year: d.getFullYear(), mIdx: d.getMonth(), revenue: rev, nights, source: sourceLabel(r[cSrc]) });
    }
    return out;
  }

  if (yearRevCols.length && dateCol >= 0) {
    // MONTHLY TIME-SERIES (RevPAR report)
    const prop = ctx.propOverride || guessPropertyFromFilename(ctx.filename) || classifyListing(ctx.filename);
    for (const r of body) {
      const mlabel = norm(r[dateCol]); const mIdx = MONTH_IDX[mlabel.slice(0, 3)];
      if (mIdx == null) continue;
      for (const yc of yearRevCols) {
        const rev = num(r[yc.i]); if (rev == null) continue;
        const revparC = yearRevparCols.find((x) => x.year === yc.year);
        const nightsC = yearNightsCols.find((x) => x.year === yc.year);
        out.push({
          kind: "monthly", prop: prop || "unknown", month: mkey(yc.year, mIdx), year: yc.year, mIdx,
          revenue: rev, nights: nightsC ? num(r[nightsC.i]) : null,
          revpar: revparC ? num(r[revparC.i]) : null,
        });
      }
    }
    return out;
  }

  if (hasListing) {
    // LISTING-LEVEL KPI SNAPSHOT (annual or single-period)
    const cList = find("listing");
    const cOcc = find("occupancy", "occ %", "occ");
    const cRev = find("rental revenue", "revenue");
    const cADR = find("adr"); const cRevpar = find("revpar");
    const cRevLY = headers.findIndex((hd) => /revenue.*(ly|2025|2024)/i.test(hd) || /\(2025\)/.test(hd));
    const thisYear = ctx.asYear || new Date().getFullYear();
    for (const r of body) {
      const list = r[cList]; if (!list || norm(list) === "total") continue;
      const prop = classifyListing(list) || ctx.propOverride; if (!prop) continue;
      const rev = cRev >= 0 ? num(r[cRev]) : null; if (rev == null) continue;
      out.push({
        kind: "snapshot", prop, year: thisYear, month: ctx.snapMonth || `${thisYear}-00`,
        revenue: rev, occ: cOcc >= 0 ? pct(r[cOcc]) : null,
        adr: cADR >= 0 ? num(r[cADR]) : null, revpar: cRevpar >= 0 ? num(r[cRevpar]) : null,
        revenueLY: cRevLY >= 0 ? num(r[cRevLY]) : null,
      });
    }
    return out;
  }
  return out;
}

/* merge normalized records into the data model */
function applyRecords(model, records) {
  const next = JSON.parse(JSON.stringify(model));
  for (const rec of records) {
    if (!rec.prop || rec.prop === "unknown") continue;
    const p = (next.properties[rec.prop] = next.properties[rec.prop] || { monthly: {}, ota: {}, snapshot: null });
    const isAnnualSnap = rec.kind === "snapshot" && (!rec.month || rec.month.endsWith("-00"));
    if (isAnnualSnap) {
      const s = (p.snapshot = p.snapshot || { year: rec.year, revenue: 0, revenueLY: 0, occSum: 0, occN: 0, adrSum: 0, adrN: 0, revparSum: 0, revparN: 0 });
      s.year = rec.year; s.revenue += rec.revenue || 0;
      if (rec.revenueLY != null) s.revenueLY += rec.revenueLY;
      if (rec.occ != null) { s.occSum += rec.occ; s.occN++; }
      if (rec.adr != null) { s.adrSum += rec.adr; s.adrN++; }
      if (rec.revpar != null) { s.revparSum += rec.revpar; s.revparN++; }
    } else {
      const cur = (p.monthly[rec.month] = p.monthly[rec.month] || { revenue: 0, nights: 0 });
      if (rec.kind === "res") {
        cur.revenue += rec.revenue; cur.nights += rec.nights || 0;
        p.ota[rec.source] = (p.ota[rec.source] || 0) + rec.revenue;
      } else {
        cur.revenue = rec.revenue;
        if (rec.nights != null) cur.nights = rec.nights;
        if (rec.revpar != null) cur.revpar = rec.revpar;
        if (rec.occ != null) cur.occ = rec.occ;
        if (rec.adr != null) cur.adr = rec.adr;
        if (rec.revenueLY != null) cur.revenueLY = rec.revenueLY;
      }
    }
  }
  next.lastUpdated = new Date().toISOString();
  return next;
}

/* derive KPIs for a property */
function deriveProperty(pid, model) {
  const p = model.properties[pid];
  const meta = PROP_BY_ID[pid];
  if (!p) return null;
  const keys = Object.keys(p.monthly).filter((k) => !k.endsWith("-00")).sort();
  const series = keys.map((k) => {
    const [y, m] = k.split("-").map(Number);
    const d = p.monthly[k];
    const days = daysInMonth(y, m - 1);
    const avail = meta.units * days;
    const occ = d.occ != null ? d.occ : d.nights ? Math.min(1, d.nights / avail) : null;
    const adr = d.adr != null ? d.adr : d.nights ? d.revenue / d.nights : null;
    const revpar = d.revpar != null ? d.revpar : avail ? d.revenue / avail : null;
    return { key: k, year: y, mIdx: m - 1, label: `${MONTHS[m - 1]} '${String(y).slice(2)}`, monthName: MONTHS[m - 1], revenue: d.revenue, occ, adr, revpar, nights: d.nights };
  });
  const snap = p.snapshot && p.snapshot.revenue ? p.snapshot : null;
  // Use the most recent month that actually has revenue (skip empty future months like unbooked Oct/Nov/Dec)
  const withData = series.filter((s) => (s.revenue || 0) > 0 || (s.nights || 0) > 0);
  let latest = withData[withData.length - 1] || null;
  let prev = withData[withData.length - 2] || null;
  // If we have a snapshot but no monthly series, use the snapshot as latest
  // If we have monthly series, prefer it — but also try to fill in occ/adr/revpar from snapshot if missing
  if (!latest && snap) {
    latest = {
      label: `YTD ${snap.year}`, monthName: null, year: snap.year, isSnapshot: true,
      revenue: snap.revenue,
      occ: snap.occN ? snap.occSum / snap.occN : null,
      adr: snap.adrN ? snap.adrSum / snap.adrN : null,
      revpar: snap.revparN ? snap.revparSum / snap.revparN : null,
      nights: null,
    };
  }
  // YOY: build month-indexed compare across years
  const byYear = {};
  series.forEach((s) => { (byYear[s.year] = byYear[s.year] || {})[s.mIdx] = s; });
  const years = Object.keys(byYear).map(Number).sort();
  const curY = years[years.length - 1], priorY = years[years.length - 2];
  const yoy = curY != null ? MONTHS.map((mn, i) => ({
    month: mn,
    [curY]: byYear[curY]?.[i]?.revenue ?? null,
    [priorY]: priorY != null ? (byYear[priorY]?.[i]?.revenue ?? null) : null,
  })) : [];
  const ota = Object.entries(p.ota || {}).map(([name, value]) => ({ name, value }));
  return { pid, meta, series, latest, prev, snap, yoy, years, curY, priorY, ota, raw: p };
}

function fmtMoney(v, d = 0) { if (v == null) return "—"; return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }); }
function fmtPct(v) { if (v == null) return "—"; return (v * 100).toFixed(1) + "%"; }
function delta(cur, prev) { if (cur == null || prev == null || prev === 0) return null; return (cur - prev) / Math.abs(prev); }

/* ---------------- Claude API ---------------- */
async function callClaude({ messages, system, tools, max_tokens = 1000 }) {
  const body = { model: "claude-sonnet-4-6", max_tokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-password": import.meta.env.VITE_APP_PASSWORD || "" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
function snapshotForAI(model) {
  const lines = [];
  for (const pid of Object.keys(model.properties)) {
    const d = deriveProperty(pid, model); if (!d || !d.latest) continue;
    const L = d.latest;
    lines.push(`${d.meta.name} (${d.meta.location}, ${d.meta.units} units) — latest ${L.label}: Revenue ${fmtMoney(L.revenue)}, Occ ${fmtPct(L.occ)}, ADR ${fmtMoney(L.adr)}, RevPAR ${fmtMoney(L.revpar)}.` +
      (d.priorY != null ? ` Prior-year ${L.monthName} rev: ${fmtMoney(d.yoy.find((y) => y.month === L.monthName)?.[d.priorY])}.` : "") +
      (d.ota.length ? ` OTA mix: ${d.ota.map((o) => o.name + " " + fmtMoney(o.value)).join(", ")}.` : ""));
  }
  return lines.join("\n") || "No data loaded yet.";
}

/* ---------------- file reading ---------------- */
function readFileAsArrayBuffer(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); }); }
function readFileAsBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); }); }

async function extractFromImageOrPdf(file) {
  const b64 = await readFileAsBase64(file);
  const isPdf = /pdf$/i.test(file.name);
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: b64 } };
  const prompt = `Extract hotel KPI data from this report. Return ONLY JSON, no markdown: a list under key "records". Each record: {"property": one of [Hotel SOMA, The Rambler Inn, The Ryan, Kress, Harley], "month": "YYYY-MM" if known else null, "revenue": number, "occ": 0-1 or null, "adr": number or null, "revpar": number or null}. If a value is unknown use null.`;
  const txt = await callClaude({ messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }], max_tokens: 1500 });
  const clean = txt.replace(/```json|```/g, "").trim();
  let parsed; try { parsed = JSON.parse(clean); } catch { return []; }
  const arr = parsed.records || parsed || [];
  return arr.map((r) => {
    const pid = PROPERTIES.find((p) => norm(p.name) === norm(r.property) || p.match.test(norm(r.property)))?.id;
    return pid ? { kind: "snapshot", prop: pid, year: r.month ? +r.month.slice(0, 4) : new Date().getFullYear(), month: r.month || `${new Date().getFullYear()}-00`, revenue: num(r.revenue) || 0, occ: pct(r.occ), adr: num(r.adr), revpar: num(r.revpar) } : null;
  }).filter(Boolean);
}

/* ============================================================
   COMPONENT
   ============================================================ */
function Dashboard() {
  const [model, setModel] = useState(MODEL);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState("overview");
  const [ingestMsg, setIngestMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [propOverride, setPropOverride] = useState("auto");
  const fileRef = useRef(null);

  // persistence
  useEffect(() => {
    (async () => {
      try { const m = await loadModel(); if (m) setModel(m); } catch (e) {}
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    (async () => { try { await saveModel(model); } catch (e) {} })();
  }, [model, loaded]);

  const handleFiles = useCallback(async (files) => {
    setBusy(true); setIngestMsg(null);
    let added = 0, errors = [];
    for (const file of files) {
      try {
        const ext = file.name.split(".").pop().toLowerCase();
        let records = [];
        if (["xlsx", "xls", "csv", "tsv"].includes(ext)) {
          const buf = await readFileAsArrayBuffer(file);
          const wb = XLSX.read(buf, { type: "array", cellDates: true });
          const ctx = { filename: file.name, propOverride: propOverride !== "auto" ? propOverride : null };
          for (const sn of wb.SheetNames) {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" });
            records.push(...ingestSheet(rows, ctx));
          }
        } else if (["png", "jpg", "jpeg", "pdf"].includes(ext)) {
          records = await extractFromImageOrPdf(file);
          if (propOverride !== "auto") records = records.map((r) => ({ ...r, prop: propOverride }));
        } else { errors.push(`${file.name}: unsupported type`); continue; }
        if (records.length) { setModel((m) => applyRecords(m, records)); added += records.length; }
        else errors.push(`${file.name}: no recognizable rows`);
      } catch (e) { errors.push(`${file.name}: ${e.message}`); }
    }
    setBusy(false);
    setIngestMsg({ ok: added > 0, text: added ? `Ingested ${added} records.` : "Nothing ingested. " + errors.join("; "), errors });
  }, [propOverride]);

  const onDrop = (e) => { e.preventDefault(); if (e.dataTransfer.files?.length) handleFiles([...e.dataTransfer.files]); };

  const hasData = Object.keys(model.properties).length > 0;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.ink, fontFamily: "'Georgia', 'Times New Roman', serif" }}>
      <style>{`
        *{box-sizing:border-box}
        .ui{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif}
        .navbtn{transition:all .15s}
        ::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:${C.borderStrong};border-radius:6px}
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* SIDEBAR */}
        <aside className="ui" style={{ width: 232, background: C.slate, color: "#e8ecf2", padding: "22px 14px", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
          <div style={{ padding: "0 8px 18px" }}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: "#8ea0b8", fontWeight: 700 }}>SIDECAR HOSPITALITY</div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 23, fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>SHP Reporting<br />Dashboard</div>
          </div>
          <NavItem icon={<LayoutGrid size={17} />} label="Overview" active={page === "overview"} onClick={() => setPage("overview")} color="#8ea0b8" />
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#6c7d96", margin: "16px 8px 6px", fontWeight: 700 }}>PROPERTIES</div>
          {PROPERTIES.map((p) => (
            <NavItem key={p.id} icon={<Building2 size={17} />} label={p.name} active={page === p.id} onClick={() => setPage(p.id)} color={p.color} dot />
          ))}
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#6c7d96", margin: "16px 8px 6px", fontWeight: 700 }}>INTELLIGENCE</div>
          <NavItem icon={<Calendar size={17} />} label="Events" active={page === "events"} onClick={() => setPage("events")} color="#8ea0b8" />
          <NavItem icon={<MessageSquare size={17} />} label="Ask the Board" active={page === "ask"} onClick={() => setPage("ask")} color="#8ea0b8" />
          <NavItem icon={<Search size={17} />} label="Data Audit" active={page === "audit"} onClick={() => setPage("audit")} color="#8ea0b8" />

          <div style={{ marginTop: 24, padding: "0 8px" }}>
            <div style={{ fontSize: 10, color: "#6c7d96" }}>
              {model.lastUpdated ? "Updated " + new Date(model.lastUpdated).toLocaleString() : "No data yet"}
            </div>
            {hasData && (
              <button className="ui navbtn" onClick={() => { if (confirm("Clear all stored data?")) setModel(MODEL); }}
                style={{ marginTop: 10, fontSize: 11, background: "transparent", color: "#9fb0c6", border: `1px solid #3a4a5f`, borderRadius: 7, padding: "5px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Trash2 size={12} /> Reset data
              </button>
            )}
          </div>
        </aside>

        {/* MAIN */}
        <main style={{ flex: 1, minWidth: 0 }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {/* Top upload bar */}
          <div className="ui" style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "12px 28px", display: "flex", alignItems: "center", gap: 14, position: "sticky", top: 0, zIndex: 5 }}>
            <input ref={fileRef} type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.png,.jpg,.jpeg,.pdf" style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.length) handleFiles([...e.target.files]); e.target.value = ""; }} />
            <button className="navbtn" onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ background: C.slate, color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              {busy ? <Loader2 size={15} className="spin" style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={15} />} Upload data
            </button>
            <span style={{ fontSize: 12, color: C.muted }}>.xlsx · .csv · .png · .jpg · .pdf — drag & drop anywhere</span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.muted }}>Assign to:</span>
              <select value={propOverride} onChange={(e) => setPropOverride(e.target.value)}
                style={{ fontSize: 12, padding: "6px 8px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", color: C.ink }}>
                <option value="auto">Auto-detect</option>
                {PROPERTIES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>

          {ingestMsg && (
            <div className="ui" style={{ margin: "12px 28px 0", padding: "10px 14px", borderRadius: 9, fontSize: 13, background: ingestMsg.ok ? "#eaf6ef" : "#fdeeee", color: ingestMsg.ok ? C.good : C.bad, border: `1px solid ${ingestMsg.ok ? "#cfe9da" : "#f2cccc"}`, display: "flex", justifyContent: "space-between" }}>
              <span>{ingestMsg.text}</span>
              <X size={15} style={{ cursor: "pointer" }} onClick={() => setIngestMsg(null)} />
            </div>
          )}

          <div style={{ padding: "26px 28px 60px" }}>
            {!loaded ? <div className="ui" style={{ color: C.muted }}>Loading…</div>
              : page === "overview" ? <Overview model={model} hasData={hasData} onUpload={() => fileRef.current?.click()} goto={setPage} />
                : page === "events" ? <Events model={model} setModel={setModel} onFiles={handleFiles} />
                  : page === "ask" ? <AskPage model={model} />
                    : page === "audit" ? <AuditPage model={model} />
                    : <PropertyPage pid={page} model={model} />}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------------- nav ---------------- */
function NavItem({ icon, label, active, onClick, color, dot }) {
  return (
    <button className="navbtn ui" onClick={onClick}
      style={{ width: "100%", textAlign: "left", background: active ? "rgba(255,255,255,.10)" : "transparent", color: active ? "#fff" : "#c4cfde", border: "none", borderLeft: `3px solid ${active ? color : "transparent"}`, borderRadius: 7, padding: "9px 11px", fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
      {dot ? <span style={{ width: 9, height: 9, borderRadius: 9, background: color, flexShrink: 0 }} /> : <span style={{ color }}>{icon}</span>}
      {label}
    </button>
  );
}

/* ---------------- KPI cards ---------------- */
function KpiRow({ d, accent }) {
  const L = d?.latest;
  const dRev = d?.prev ? delta(L?.revenue, d.prev.revenue) : null;
  const dOcc = d?.prev ? delta(L?.occ, d.prev.occ) : null;
  const dAdr = d?.prev ? delta(L?.adr, d.prev.adr) : null;
  const dRp = d?.prev ? delta(L?.revpar, d.prev.revpar) : null;
  const cards = [
    { label: "Revenue", icon: <DollarSign size={16} />, val: fmtMoney(L?.revenue), dl: dRev },
    { label: "Occupancy", icon: <Percent size={16} />, val: fmtPct(L?.occ), dl: dOcc },
    { label: "ADR", icon: <BedDouble size={16} />, val: fmtMoney(L?.adr), dl: dAdr },
    { label: "RevPAR", icon: <Gauge size={16} />, val: fmtMoney(L?.revpar), dl: dRp },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 20px", borderTop: `3px solid ${accent}` }}>
          <div className="ui" style={{ display: "flex", alignItems: "center", gap: 7, color: C.muted, fontSize: 12, fontWeight: 600, letterSpacing: .3, textTransform: "uppercase" }}>
            <span style={{ color: accent }}>{c.icon}</span>{c.label}
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 30, fontWeight: 700, marginTop: 8, color: C.ink }}>{c.val}</div>
          {c.dl != null && (
            <div className="ui" style={{ marginTop: 4, fontSize: 12.5, fontWeight: 600, color: c.dl >= 0 ? C.good : C.bad, display: "flex", alignItems: "center", gap: 4 }}>
              {c.dl >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {(c.dl * 100).toFixed(1)}% MoM
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Panel({ title, right, children, style }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, ...style }}>
      <div className="ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: .4, color: C.sub, textTransform: "uppercase" }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}
function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, margin: 0, color: C.ink }}>{children}</h1>
      {sub && <div className="ui" style={{ color: C.muted, fontSize: 13.5, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ---------------- charts ---------------- */
function YoyChart({ d }) {
  if (!d?.yoy?.length || d.priorY == null) return <Empty text="Year-over-year appears once a prior-year file is loaded." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={d.yoy} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
        <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey={String(d.priorY)} fill="#c9d0da" radius={[4, 4, 0, 0]} name={`${d.priorY}`} />
        <Bar dataKey={String(d.curY)} fill={d.meta.color} radius={[4, 4, 0, 0]} name={`${d.curY}`} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
function OtaChart({ d }) {
  if (!d?.ota?.length) return <Empty text="OTA mix appears when reservation-level data (with a SOURCE column) is loaded." />;
  const total = d.ota.reduce((a, o) => a + o.value, 0);
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <ResponsiveContainer width={200} height={200}>
        <PieChart>
          <Pie data={d.ota} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={2}>
            {d.ota.map((o) => <Cell key={o.name} fill={OTA_COLORS[o.name] || OTA_COLORS.Other} />)}
          </Pie>
          <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="ui" style={{ flex: 1, minWidth: 160 }}>
        {d.ota.sort((a, b) => b.value - a.value).map((o) => (
          <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", fontSize: 13, borderBottom: `1px solid ${C.track}` }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: OTA_COLORS[o.name] || OTA_COLORS.Other }} />
            <span style={{ flex: 1, color: C.ink }}>{o.name}</span>
            <span style={{ fontWeight: 600 }}>{fmtMoney(o.value)}</span>
            <span style={{ color: C.muted, width: 44, textAlign: "right" }}>{((o.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function TrendChart({ series, dataKey, color, fmt }) {
  if (!series?.length) return <Empty text="No monthly series yet." />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={series} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
        <defs><linearGradient id={"g" + dataKey + color} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} /><stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient></defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={fmt} width={48} />
        <Tooltip formatter={(v) => (dataKey === "occ" ? fmtPct(v) : fmtMoney(v))} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.4} fill={`url(#g${dataKey}${color})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
function Empty({ text }) { return <div className="ui" style={{ color: C.faint, fontSize: 13, padding: "30px 6px", textAlign: "center" }}>{text}</div>; }

/* ---------------- OVERVIEW ---------------- */
function Overview({ model, hasData, onUpload, goto }) {
  const derived = useMemo(() => PROPERTIES.map((p) => deriveProperty(p.id, model)).filter(Boolean), [model]);
  // portfolio current-month rollup
  const portfolio = useMemo(() => {
    let rev = 0, nights = 0, avail = 0, adrW = 0, adrN = 0, occSum = 0, occN = 0;
    derived.forEach((d) => {
      if (!d.latest) return; const L = d.latest;
      rev += L.revenue || 0;
      nights += L.nights || 0;
      if (L.mIdx != null) { const days = daysInMonth(L.year, L.mIdx); avail += d.meta.units * days; }
      if (L.adr != null) { adrW += L.adr * (L.nights || 1); adrN += (L.nights || 1); }
      if (L.occ != null) { occSum += L.occ; occN++; }
    });
    const occ = avail ? Math.min(1, nights / avail) : (occN ? occSum / occN : null);
    const adr = adrN ? adrW / adrN : null;
    return { latest: { revenue: rev, occ, adr, revpar: adr && occ ? adr * occ : null, nights }, prev: null };
  }, [derived]);

  const compare = derived.map((d) => ({ name: d.meta.short, revenue: d.latest?.revenue || 0, color: d.meta.color }));

  // Portfolio-wide OTA channel mix (sum every property's channel revenue)
  const portfolioOta = useMemo(() => {
    const totals = {};
    derived.forEach((d) => { (d.ota || []).forEach((o) => { totals[o.name] = (totals[o.name] || 0) + o.value; }); });
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [derived]);

  return (
    <div>
      <SectionTitle sub="Portfolio performance, current month across all properties">Portfolio Overview</SectionTitle>
      {!hasData && (
        <div className="ui" onClick={onUpload} style={{ cursor: "pointer", border: `2px dashed ${C.borderStrong}`, borderRadius: 16, padding: "46px 24px", textAlign: "center", background: "#fafbfc", marginBottom: 22 }}>
          <Upload size={26} style={{ color: C.muted }} />
          <div style={{ fontWeight: 600, marginTop: 10, color: C.ink }}>Drop your first file to begin</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>RevPAR reports, KPI trackers, reservation exports, or a PDF/screenshot — it'll auto-route to the right property.</div>
        </div>
      )}

      <KpiRow d={portfolio} accent={C.slate} />

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 16 }}>
        <Panel title="Revenue by property — current month">
          {compare.some((c) => c.revenue) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={compare} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>{compare.map((c) => <Cell key={c.name} fill={c.color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty text="Load data to compare properties." />}
        </Panel>
        <Panel title="Channel mix — all properties">
          <OtaChart d={{ ota: portfolioOta }} />
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}><DailyFocus model={model} /></div>

      <div style={{ marginTop: 16 }}><Alerts model={model} /></div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16, marginTop: 16 }}>
        {derived.map((d) => (
          <div key={d.pid} onClick={() => goto(d.pid)} style={{ cursor: "pointer", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, borderLeft: `4px solid ${d.meta.color}` }}>
            <div className="ui" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, color: C.ink }}>{d.meta.name}</div>
              <ChevronRight size={16} style={{ color: C.faint }} />
            </div>
            <div className="ui" style={{ fontSize: 11.5, color: C.muted }}>{d.meta.location} · {d.meta.units} units · {d.latest?.label || "—"}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
              <Mini label="Rev" val={fmtMoney(d.latest?.revenue)} />
              <Mini label="Occ" val={fmtPct(d.latest?.occ)} />
              <Mini label="ADR" val={fmtMoney(d.latest?.adr)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function Mini({ label, val }) {
  return <div><div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4 }}>{label}</div><div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 700 }}>{val}</div></div>;
}

/* ---------------- PROPERTY PAGE ---------------- */
function PropertyPage({ pid, model }) {
  const d = useMemo(() => deriveProperty(pid, model), [pid, model]);
  const meta = PROP_BY_ID[pid];
  if (!d) return (<><SectionTitle sub={`${meta.location} · ${meta.units} units`}>{meta.name}</SectionTitle><Panel title="No data"><Empty text={`Upload a file for ${meta.name} (or any combined export) to populate this page.`} /></Panel></>);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <span style={{ width: 16, height: 16, borderRadius: 5, background: meta.color }} />
        <div><h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 700, margin: 0 }}>{meta.name}</h1>
          <div className="ui" style={{ color: C.muted, fontSize: 13.5 }}>{meta.location} · {meta.units} units · latest {d.latest?.label || "—"}</div></div>
      </div>
      <KpiRow d={d} accent={meta.color} />
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 16 }}>
        <Panel title="Year-over-year revenue"><YoyChart d={d} /></Panel>
        <Panel title="OTA channel mix"><OtaChart d={d} /></Panel>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Panel title="Revenue trend"><TrendChart series={d.series} dataKey="revenue" color={meta.color} fmt={(v) => "$" + (v / 1000).toFixed(0) + "k"} /></Panel>
        <Panel title="Occupancy trend"><TrendChart series={d.series} dataKey="occ" color={meta.color} fmt={(v) => (v * 100).toFixed(0) + "%"} /></Panel>
        <Panel title="ADR trend"><TrendChart series={d.series} dataKey="adr" color={meta.color} fmt={(v) => "$" + v.toFixed(0)} /></Panel>
        <Panel title="RevPAR trend"><TrendChart series={d.series} dataKey="revpar" color={meta.color} fmt={(v) => "$" + v.toFixed(0)} /></Panel>
      </div>
      <div style={{ marginTop: 16 }}><PropertyAdvisor d={d} /></div>
    </div>
  );
}

/* ---------------- DAILY FOCUS ---------------- */
function DailyFocus({ model }) {
  const [txt, setTxt] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const out = await callClaude({
        system: "You are the revenue strategist inside Christian's SHP hotel/STR dashboard. Be concrete and operational. Prioritize pricing moves and revenue generation, and reducing OTA dependency in favor of direct bookings. No fluff.",
        messages: [{ role: "user", content: `Today is ${new Date().toDateString()}. Here is the current portfolio data:\n\n${snapshotForAI(model)}\n\nGive me TODAY'S FOCUS: the 3 highest-leverage actions to take right now to drive revenue — naming specific properties and whether it's a pricing move, an occupancy push, or an OTA→direct play. Keep each to one tight sentence. Format as 3 numbered lines.` }],
        max_tokens: 600,
      });
      setTxt(out);
    } catch (e) { setErr("Couldn't reach the model — try again."); }
    setBusy(false);
  };
  return (
    <Panel title="Today's focus" right={<button className="ui" onClick={run} disabled={busy} style={btnSm}>{busy ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />} Generate</button>}>
      {err && <div className="ui" style={{ color: C.bad, fontSize: 13 }}>{err}</div>}
      {!txt && !err && <div className="ui" style={{ color: C.faint, fontSize: 13 }}>Click generate for today's three highest-leverage revenue moves.</div>}
      {txt && <div className="ui" style={{ fontSize: 14, lineHeight: 1.65, color: C.ink, whiteSpace: "pre-wrap" }}>{txt}</div>}
    </Panel>
  );
}

/* ---------------- ALERTS ---------------- */
function Alerts({ model }) {
  const alerts = useMemo(() => {
    const out = [];
    PROPERTIES.forEach((p) => {
      const d = deriveProperty(p.id, model); if (!d || !d.latest) return;
      const L = d.latest;
      if (L.occ != null && L.occ < 0.45) out.push({ sev: L.occ < 0.25 ? "high" : "med", prop: p, kind: "Low occupancy", detail: `${fmtPct(L.occ)} in ${L.label} — below 45% target.` });
      if (d.prev && L.occ != null && d.prev.occ != null) { const dd = delta(L.occ, d.prev.occ); if (dd != null && dd < -0.15) out.push({ sev: "med", prop: p, kind: "Occupancy dropping", detail: `down ${(dd * 100).toFixed(0)}% MoM.` }); }
      if (d.prev && L.adr != null && d.prev.adr != null) { const dd = delta(L.adr, d.prev.adr); if (dd != null && dd < -0.12) out.push({ sev: "med", prop: p, kind: "Rate softening", detail: `ADR down ${(dd * 100).toFixed(0)}% MoM to ${fmtMoney(L.adr)}.` }); }
      if (d.priorY != null) { const py = d.yoy.find((y) => y.month === L.monthName)?.[d.priorY]; const dd = delta(L.revenue, py); if (dd != null && dd < -0.2) out.push({ sev: "high", prop: p, kind: "Revenue below last year", detail: `${L.monthName} rev down ${(dd * 100).toFixed(0)}% YoY.` }); }
    });
    return out.sort((a, b) => (a.sev === "high" ? -1 : 1));
  }, [model]);
  return (
    <Panel title="Alerts — low occupancy & rate watch">
      {!alerts.length ? <Empty text="No threshold breaches detected. Load more data to sharpen the watch." />
        : <div style={{ display: "grid", gap: 8 }}>
          {alerts.map((a, i) => (
            <div key={i} className="ui" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, background: a.sev === "high" ? "#fdeeee" : "#fff7e8", border: `1px solid ${a.sev === "high" ? "#f2cccc" : "#f3e2bf"}` }}>
              <AlertTriangle size={16} style={{ color: a.sev === "high" ? C.bad : "#b7791f", flexShrink: 0 }} />
              <span style={{ width: 9, height: 9, borderRadius: 9, background: a.prop.color }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{a.prop.name}</span>
              <span style={{ fontSize: 13, color: C.sub }}>· {a.kind} — {a.detail}</span>
            </div>
          ))}
        </div>}
    </Panel>
  );
}

/* ---------------- PROPERTY ADVISOR ---------------- */
function PropertyAdvisor({ d }) {
  const [txt, setTxt] = useState(null); const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const L = d.latest;
      const ctx = `${d.meta.name} (${d.meta.location}, ${d.meta.units} units). Latest ${L?.label}: Rev ${fmtMoney(L?.revenue)}, Occ ${fmtPct(L?.occ)}, ADR ${fmtMoney(L?.adr)}, RevPAR ${fmtMoney(L?.revpar)}. ` +
        (d.priorY != null ? `Prior-year ${L?.monthName}: ${fmtMoney(d.yoy.find((y) => y.month === L?.monthName)?.[d.priorY])}. ` : "") +
        (d.ota.length ? `OTA mix: ${d.ota.map((o) => o.name + " " + fmtMoney(o.value)).join(", ")}.` : "");
      const out = await callClaude({
        system: "You are the revenue strategist for this single property in Christian's SHP dashboard. Diagnose what looks off and prescribe specific pricing / occupancy / channel moves. Prioritize revenue and shifting OTA share to direct. Tight and operational.",
        messages: [{ role: "user", content: `${ctx}\n\nWhat's working, what's off, and what should I do this week? 3-4 short bullets.` }],
        max_tokens: 700,
      });
      setTxt(out);
    } catch (e) { setTxt("Couldn't reach the model — try again."); }
    setBusy(false);
  };
  return (
    <Panel title={`${d.meta.name} — strategist read`} right={<button className="ui" onClick={run} disabled={busy} style={{ ...btnSm, background: d.meta.color }}>{busy ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />} Analyze</button>}>
      {!txt ? <div className="ui" style={{ color: C.faint, fontSize: 13 }}>Get a focused read on this property's pricing, occupancy, and channel mix.</div>
        : <div className="ui" style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{txt}</div>}
    </Panel>
  );
}

/* ---------------- ASK PAGE ---------------- */
function AskPage({ model }) {
  const [msgs, setMsgs] = useState([]); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!input.trim() || busy) return;
    const q = input.trim(); setInput(""); const hist = [...msgs, { role: "user", content: q }]; setMsgs(hist); setBusy(true);
    try {
      const out = await callClaude({
        system: `You are the analyst embedded in Christian's SHP Reporting Dashboard. Answer using the data below. Be specific with numbers, flag anomalies, and bias toward revenue-driving and OTA→direct recommendations.\n\nCURRENT DATA:\n${snapshotForAI(model)}`,
        messages: hist.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 900,
      });
      setMsgs([...hist, { role: "assistant", content: out }]);
    } catch (e) { setMsgs([...hist, { role: "assistant", content: "Couldn't reach the model — try again." }]); }
    setBusy(false);
  };
  return (
    <div>
      <SectionTitle sub="Ask anything about your numbers — pricing, anomalies, what to do next">Ask the Board</SectionTitle>
      <Panel title="Conversation" style={{ minHeight: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 300, marginBottom: 14 }}>
          {!msgs.length && <div className="ui" style={{ color: C.faint, fontSize: 13.5 }}>Try: "Which property is bleeding the most revenue vs last year and why?" · "Where should I cut rates this week?" · "Who's most OTA-dependent?"</div>}
          {msgs.map((m, i) => (
            <div key={i} className="ui" style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "82%", background: m.role === "user" ? C.slate : "#f4f6f8", color: m.role === "user" ? "#fff" : C.ink, padding: "11px 15px", borderRadius: 13, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.content}</div>
          ))}
          {busy && <div className="ui" style={{ color: C.muted, fontSize: 13, display: "flex", gap: 7, alignItems: "center" }}><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> thinking…</div>}
        </div>
        <div style={{ display: "flex", gap: 9 }}>
          <input className="ui" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask about your portfolio…"
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, outline: "none" }} />
          <button className="ui" onClick={send} disabled={busy} style={{ background: C.slate, color: "#fff", border: "none", borderRadius: 10, padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 600 }}><Send size={15} /> Send</button>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------- EVENTS ---------------- */
function Events({ model, setModel, onFiles }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const pull = async () => {
    setBusy(true); setErr(null);
    try {
      const out = await callClaude({
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: "You find demand-driving events for hotel revenue managers. Return ONLY JSON, no markdown.",
        messages: [{ role: "user", content: `Find notable upcoming events (next ~90 days from ${new Date().toDateString()}) that drive lodging demand in (A) Fort Worth — TCU sports & events, Dickies Arena, Will Rogers Memorial Center, Fort Worth Convention Center; and (B) Arlington — AT&T Stadium, Globe Life Field, UTA, and Arlington Convention Center. Return JSON: {"events":[{"date":"YYYY-MM-DD","name":"...","venue":"...","market":"Fort Worth" or "Arlington","impact":"high|med|low"}]}. Sort by date.` }],
        max_tokens: 1500,
      });
      const clean = out.replace(/```json|```/g, "").trim();
      const m = clean.match(/\{[\s\S]*\}/); const parsed = JSON.parse(m ? m[0] : clean);
      setModel((mod) => ({ ...mod, events: parsed.events || [], eventsSource: "ai", lastUpdated: new Date().toISOString() }));
    } catch (e) { setErr("Couldn't pull events — try again, or upload a calendar file."); }
    setBusy(false);
  };
  const onUpload = async (files) => {
    setBusy(true); setErr(null);
    try {
      const f = files[0]; const buf = await readFileAsArrayBuffer(f);
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const ev = rows.map((r) => {
        const keys = Object.keys(r); const get = (kk) => { const k = keys.find((x) => norm(x).includes(kk)); return k ? r[k] : ""; };
        const dRaw = get("date"); const dd = toDate(dRaw);
        return { date: dd ? dd.toISOString().slice(0, 10) : String(dRaw), name: get("name") || get("event") || "", venue: get("venue") || get("location") || "", market: get("market") || get("city") || "", impact: norm(get("impact")) || "med" };
      }).filter((e) => e.name);
      setModel((mod) => ({ ...mod, events: ev, eventsSource: "upload", lastUpdated: new Date().toISOString() }));
    } catch (e) { setErr("Couldn't read that calendar file. Expected columns: date, name, venue, market, impact."); }
    setBusy(false);
  };
  const events = model.events || [];
  const fw = events.filter((e) => norm(e.market).includes("fort") || norm(e.market).includes("fw"));
  const arl = events.filter((e) => norm(e.market).includes("arling"));
  const impactColor = (i) => (norm(i).includes("high") ? C.bad : norm(i).includes("low") ? C.faint : "#b7791f");
  return (
    <div>
      <SectionTitle sub="Demand drivers across Fort Worth & Arlington — price into them early">Events & Demand Calendar</SectionTitle>
      <div className="ui" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={pull} disabled={busy} style={{ ...btnSm, padding: "9px 15px", fontSize: 13 }}>{busy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />} Pull events (AI + web)</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) onUpload([...e.target.files]); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...btnSm, background: "#fff", color: C.ink, border: `1px solid ${C.border}`, padding: "9px 15px", fontSize: 13 }}><FileText size={14} /> Upload calendar</button>
        <span style={{ fontSize: 12, color: C.muted }}>{model.eventsSource === "ai" ? "Source: AI web pull" : model.eventsSource === "upload" ? "Source: your upload" : "No events loaded"}</span>
      </div>
      {err && <div className="ui" style={{ color: C.bad, fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[{ title: "Fort Worth", list: fw }, { title: "Arlington", list: arl }].map((col) => (
          <Panel key={col.title} title={col.title}>
            {!col.list.length ? <Empty text="No events yet — pull or upload above." />
              : <div style={{ display: "grid", gap: 8 }}>
                {col.list.map((e, i) => (
                  <div key={i} className="ui" style={{ display: "flex", gap: 11, padding: "10px 12px", borderRadius: 10, background: "#f8f9fb", border: `1px solid ${C.track}` }}>
                    <div style={{ width: 60, flexShrink: 0, fontSize: 12, fontWeight: 700, color: C.sub }}>{e.date ? new Date(e.date + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{e.venue}</div>
                    </div>
                    <span style={{ alignSelf: "center", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: impactColor(e.impact), border: `1px solid ${impactColor(e.impact)}`, borderRadius: 6, padding: "2px 7px" }}>{e.impact || "med"}</span>
                  </div>
                ))}
              </div>}
          </Panel>
        ))}
      </div>
    </div>
  );
}

const btnSm = { background: "#243244", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };

/* ---------------- DATA AUDIT ---------------- */
function AuditPage({ model }) {
  const [openProp, setOpenProp] = useState(null);
  const derived = useMemo(() => PROPERTIES.map((p) => deriveProperty(p.id, model)).filter(Boolean), [model]);

  if (!derived.length) {
    return (<><SectionTitle sub="See exactly how every number is calculated">Data Audit</SectionTitle><Panel title="No data"><Empty text="Upload data first, then come back to inspect how each figure is computed." /></Panel></>);
  }

  return (
    <div>
      <SectionTitle sub="Trace every KPI back to its raw inputs and formula — nothing is a black box">Data Audit</SectionTitle>

      <Panel title="How each metric is calculated" style={{ marginBottom: 16 }}>
        <div className="ui" style={{ fontSize: 13.5, lineHeight: 1.8, color: C.sub }}>
          <div><b>Revenue</b> = sum of accommodation revenue from your uploaded files for that month (taxes/fees excluded if your export excludes them).</div>
          <div><b>Occupancy</b> = nights sold ÷ available nights, where available nights = (units × days in month). If your file already states occupancy, that value is used directly.</div>
          <div><b>ADR</b> (Average Daily Rate) = revenue ÷ nights sold. If your file states ADR, that is used directly.</div>
          <div><b>RevPAR</b> (Revenue Per Available Room) = ADR × Occupancy. If your file states RevPAR, that is used directly.</div>
          <div><b>Channel mix</b> = revenue grouped by the booking source column in reservation-level files.</div>
          <div style={{ marginTop: 8, color: C.muted, fontSize: 12.5 }}>Unit counts used: {PROPERTIES.map((p) => `${p.short} ${p.units}`).join(" · ")}. A value shown in <span style={{ color: C.good, fontWeight: 600 }}>green “from file”</span> came straight from your upload; <span style={{ color: "#b7791f", fontWeight: 600 }}>amber “computed”</span> was derived by the formula above.</div>
        </div>
      </Panel>

      {derived.map((d) => {
        const isOpen = openProp === d.pid;
        return (
          <div key={d.pid} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 12, borderLeft: `4px solid ${d.meta.color}`, overflow: "hidden" }}>
            <div className="ui" onClick={() => setOpenProp(isOpen ? null : d.pid)} style={{ cursor: "pointer", padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 11, height: 11, borderRadius: 11, background: d.meta.color }} />
              <span style={{ fontWeight: 700, color: C.ink }}>{d.meta.name}</span>
              <span style={{ fontSize: 12.5, color: C.muted }}>· {d.meta.units} units · {d.series.length} month(s) of data{d.raw?.snapshot ? " + annual snapshot" : ""}</span>
              <ChevronRight size={17} style={{ marginLeft: "auto", color: C.faint, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
            </div>
            {isOpen && (
              <div style={{ padding: "0 18px 18px" }}>
                <div style={{ overflowX: "auto" }}>
                  <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: .4 }}>
                        {["Month", "Revenue (input)", "Nights sold", "Available (units×days)", "Occupancy", "ADR", "RevPAR"].map((h) => (
                          <th key={h} style={{ padding: "8px 10px", borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.series.map((s) => {
                        const days = daysInMonth(s.year, s.mIdx);
                        const avail = d.meta.units * days;
                        const dd = d.raw.monthly[s.key] || {};
                        const occFromFile = dd.occ != null, adrFromFile = dd.adr != null, revparFromFile = dd.revpar != null;
                        return (
                          <tr key={s.key} style={{ borderBottom: `1px solid ${C.track}` }}>
                            <td style={{ padding: "8px 10px", fontWeight: 600 }}>{s.label}</td>
                            <td style={{ padding: "8px 10px" }}>{fmtMoney(s.revenue)}</td>
                            <td style={{ padding: "8px 10px" }}>{s.nights != null ? s.nights : "—"}</td>
                            <td style={{ padding: "8px 10px", color: C.muted }}>{d.meta.units} × {days} = {avail}</td>
                            <AuditCell value={fmtPct(s.occ)} fromFile={occFromFile} />
                            <AuditCell value={fmtMoney(s.adr)} fromFile={adrFromFile} />
                            <AuditCell value={fmtMoney(s.revpar)} fromFile={revparFromFile} />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {d.ota?.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="ui" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: .4, color: C.muted, marginBottom: 6 }}>Channel revenue (from reservation source column)</div>
                    <div className="ui" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {d.ota.sort((a, b) => b.value - a.value).map((o) => (
                        <span key={o.name} style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 8, background: "#f4f6f8", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: OTA_COLORS[o.name] || OTA_COLORS.Other }} />
                          {o.name}: {fmtMoney(o.value)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {d.raw?.snapshot && (
                  <div className="ui" style={{ marginTop: 14, fontSize: 12.5, color: C.muted }}>
                    Annual snapshot on file (used only when no monthly data exists): revenue {fmtMoney(d.raw.snapshot.revenue)}{d.raw.snapshot.revenueLY ? `, prior-year ${fmtMoney(d.raw.snapshot.revenueLY)}` : ""}.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function AuditCell({ value, fromFile }) {
  return (
    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
      {value}
      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: fromFile ? "#1f7a4d" : "#b7791f" }}>{value === "—" ? "" : fromFile ? "from file" : "computed"}</span>
    </td>
  );
}


export default function App() {
  const required = import.meta.env.VITE_APP_PASSWORD || "";
  const [unlocked, setUnlocked] = useState(!required);
  const [entry, setEntry] = useState("");
  const [bad, setBad] = useState(false);

  if (unlocked) return <Dashboard />;

  const tryUnlock = () => {
    if (entry === required) setUnlocked(true);
    else { setBad(true); setEntry(""); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#edeef0", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif" }}>
      <div style={{ background: "#fff", border: "1px solid #e2e5e9", borderRadius: 16, padding: 36, width: 360, boxShadow: "0 8px 30px rgba(20,30,50,.08)" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: "#8ea0b8", fontWeight: 700 }}>SIDECAR HOSPITALITY</div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 700, color: "#1b2330", marginTop: 4, marginBottom: 18 }}>SHP Reporting Dashboard</div>
        <input
          type="password" value={entry} autoFocus
          onChange={(e) => { setEntry(e.target.value); setBad(false); }}
          onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
          placeholder="Enter password"
          style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${bad ? "#cf3a3a" : "#e2e5e9"}`, fontSize: 15, outline: "none", boxSizing: "border-box" }}
        />
        {bad && <div style={{ color: "#cf3a3a", fontSize: 12.5, marginTop: 8 }}>Incorrect password.</div>}
        <button onClick={tryUnlock}
          style={{ width: "100%", marginTop: 14, background: "#243244", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          Unlock
        </button>
      </div>
    </div>
  );
}

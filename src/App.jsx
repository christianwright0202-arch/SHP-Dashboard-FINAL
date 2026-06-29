import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, AreaChart, ReferenceLine,
} from "recharts";
import * as XLSX from "xlsx";
import { loadModel, saveModel } from "./storage";
import {
  Upload, TrendingUp, TrendingDown, AlertTriangle, Calendar, Sparkles,
  LayoutGrid, Building2, MessageSquare, Send, RefreshCw, Trash2, FileText,
  DollarSign, Percent, BedDouble, Gauge, Loader2, ChevronRight, X, Target, Search, MapPin, Activity, Trophy, Briefcase, Plus,
} from "lucide-react";

/* ============================================================
   SHP REPORTING DASHBOARD
   ============================================================ */

const C = {
  bg: "#edeef0",
  panel: "#ffffff",
  border: "#e2e5e9",
  borderStrong: "#d3d7dd",
  ink: "#14274d",
  sub: "#566273",
  muted: "#6b7280",
  faint: "#9aa1ad",
  slate: "#243244",
  good: "#1f7a4d",
  bad: "#cf3a3a",
  track: "#f3f4f6",
};

const REGIONS = [
  { id: "fortworth", name: "Fort Worth" },
  { id: "arlington", name: "Arlington" },
];
const PROPERTIES = [
  // Fort Worth
  { id: "soma", name: "Hotel SOMA", short: "SOMA", color: "#e07b1f", location: "Fort Worth", units: 31, market: "fortworth", goal: 100000, match: /soma/i },
  { id: "kress", name: "Kress", short: "Kress", color: "#1f7a4d", location: "Fort Worth", units: 7, market: "fortworth", goal: 45000, match: /kress/i },
  { id: "harley", name: "Harley", short: "Harley", color: "#6a3da8", location: "Fort Worth", units: 3, market: "fortworth", goal: 30000, match: /harley/i },
  // Arlington
  { id: "rambler", name: "The Rambler Inn", short: "Rambler", color: "#cf3a3a", location: "Arlington", units: 22, market: "arlington", goal: 100000, match: /rambler/i },
  { id: "ryan", name: "The Ryan", short: "Ryan", color: "#173a63", location: "Arlington", units: 18, market: "arlington", goal: 60000, match: /(ballpark|ryan)/i },
  { id: "woodbrook", name: "Woodbrook", short: "Woodbrook", color: "#138a8a", location: "Arlington", units: 1, market: "arlington", goal: 8000, match: /woodbrook/i },
  { id: "rogers", name: "Rogers", short: "Rogers", color: "#b5651d", location: "Arlington", units: 2, market: "arlington", goal: 16000, match: /rogers/i },
];
// Default OTA commission rates for net-of-fee view (editable assumption)
const CHANNEL_FEES = { Airbnb: 0.15, Vrbo: 0.08, Expedia: 0.17, "Booking.com": 0.15, Direct: 0, Other: 0.12 };
const PROPS_IN = (region) => PROPERTIES.filter((p) => p.market === region);
const PROP_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_IDX = Object.fromEntries(MONTHS.map((m, i) => [m.toLowerCase(), i]));
const OTA_COLORS = { Airbnb: "#e23b3b", Vrbo: "#1668e3", Expedia: "#f5c518", "Booking.com": "#f08a24", Direct: "#1f7a4d", Other: "#94a3b8" };

const MODEL = { properties: {}, ads: {}, events: [], eventsSource: "none", lastUpdated: null, goals: {}, activity: [], deals: [] };

// World Cup window + AT&T Stadium (Dallas Stadium), Arlington fixtures
const WC_START = "2026-06-12", WC_END = "2026-07-15";
const WORLD_CUP_MATCHES = [
  { date: "2026-06-14", teams: "Netherlands vs Japan", round: "Group", tier: 2 },
  { date: "2026-06-17", teams: "England vs Croatia", round: "Group", tier: 3 },
  { date: "2026-06-22", teams: "Argentina vs Austria", round: "Group", tier: 3 },
  { date: "2026-06-25", teams: "Group Stage (TBD)", round: "Group", tier: 1 },
  { date: "2026-06-27", teams: "Argentina vs Jordan", round: "Group", tier: 3 },
  { date: "2026-06-30", teams: "Round of 32", round: "Knockout", tier: 2 },
  { date: "2026-07-03", teams: "Round of 32", round: "Knockout", tier: 2 },
  { date: "2026-07-06", teams: "Round of 16", round: "Knockout", tier: 3 },
  { date: "2026-07-14", teams: "Semifinal", round: "Knockout", tier: 4 },
];
const WC_MATCH_BY_DATE = Object.fromEntries(WORLD_CUP_MATCHES.map((m) => [m.date, m]));
const WC_TIER_COLOR = { 1: "#9aa1ad", 2: "#3b7dd8", 3: "#e07b1f", 4: "#c0392b" };

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
  if (n.includes("expedia")) return "Expedia";
  if (n.includes("website") || n.includes("engine") || n.includes("walk") || n.includes("direct") || n.includes("hostfully") || n.includes("cloudbeds") || n.includes("manual")) return "Direct";
  if (n.includes("booking")) return "Booking.com";
  return "Other";
}
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") { const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null; if (d) return new Date(d.y, d.m - 1, d.d); }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const mkey = (y, mIdx) => `${y}-${String(mIdx + 1).padStart(2, "0")}`;
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseUnits = (name) => { const m = String(name || "").match(/--\s*(\d+)\s*units/i); return m ? +m[1] : 1; };
// pull a year-month from a filename like "Bookingcom_SOMA_2026-06.csv"
function monthFromFilename(fn) {
  const s = String(fn || "");
  let m = s.match(/(20\d\d)[-_.]?(0[1-9]|1[0-2])(?!\d)/); if (m) return { y: +m[1], m: +m[2] - 1 };
  const mm = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[-_ ]*(20\d\d)?/);
  if (mm && MONTH_IDX[mm[1]] != null) return { y: mm[2] ? +mm[2] : new Date().getFullYear(), m: MONTH_IDX[mm[1]] };
  m = s.match(/\b(0[1-9]|1[0-2])[-_.](20\d\d)\b/); if (m) return { y: +m[2], m: +m[1] - 1 };
  return null;
}
const money = (v) => { const n = parseFloat(String(v ?? "").replace(/[$,%\s]/g, "")); return isFinite(n) ? n : 0; };
function wcDateList() {
  const out = []; const s = new Date(WC_START + "T00:00"); const e = new Date(WC_END + "T00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(isoDate(d));
  return out;
}

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

/* find a "Month YYYY" label near the header row (used by the monthly KPI tracker) */
const MONTH_YEAR_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i;
function findMonthYearNear(rows, hr) {
  for (let i = Math.max(0, hr - 3); i <= hr; i++) {
    for (const cell of (rows[i] || [])) {
      const m = String(cell).match(MONTH_YEAR_RE);
      if (m) return { mIdx: MONTH_IDX[m[1].toLowerCase().slice(0, 3)], year: +m[2] };
    }
  }
  return null;
}

/* Ingest one sheet -> array of normalized records */
function ingestSheet(rows, ctx) {
  const out = [];

  // AD SPEND REPORTS — Expedia TravelAds (daily, has Date) or Booking.com (campaign totals, no Date)
  {
    const N = rows.map((r) => (r || []).map(norm));
    const hi = N.findIndex((r) => r.some((c) => c.includes("campaign")) && r.some((c) => c === "spend"));
    if (hi >= 0) {
      const H = N[hi]; const find = (pred) => H.findIndex(pred);
      const isExpedia = H.some((c) => c.includes("gross bookings")) || H.includes("date");
      const isBooking = H.some((c) => c.includes("return on ad spend")) || H.some((c) => c.includes("revenue per booking"));
      const cCamp = find((c) => c.includes("campaign"));
      const cSpend = find((c) => c === "spend");
      if (cCamp >= 0 && cSpend >= 0 && (isExpedia || isBooking)) {
        const channel = isExpedia ? "Expedia" : "Booking.com";
        const cRev = isExpedia ? find((c) => c === "gross bookings total") : find((c) => c === "revenue");
        const cBook = isExpedia ? find((c) => c === "bookings total") : find((c) => c === "bookings");
        const cDate = find((c) => c === "date");
        const cImp = find((c) => c === "impressions");
        const cClicks = find((c) => c === "clicks");
        const fm = monthFromFilename(ctx.filename);
        for (let i = hi + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r) continue;
          const camp = String(r[cCamp] ?? ""); const cl = norm(camp);
          if (!cl || cl.includes("grand total") || cl === "total") continue;
          const prop = classifyListing(camp) || ctx.propOverride; if (!prop) continue;
          let y, mo;
          if (cDate >= 0 && r[cDate]) { const dt = r[cDate] instanceof Date ? r[cDate] : toDate(r[cDate]); if (dt && !isNaN(dt.getTime())) { y = dt.getFullYear(); mo = dt.getMonth(); } }
          if (mo == null && fm) { y = fm.y; mo = fm.m; }
          if (mo == null) { const now = new Date(); y = now.getFullYear(); mo = now.getMonth(); }
          const spend = money(r[cSpend]); const rev = cRev >= 0 ? money(r[cRev]) : 0;
          const bookings = cBook >= 0 ? money(r[cBook]) : 0; const imp = cImp >= 0 ? money(r[cImp]) : 0; const clk = cClicks >= 0 ? money(r[cClicks]) : 0;
          if (!spend && !rev && !bookings) continue;
          out.push({ kind: "ad", prop, channel, year: y, mIdx: mo, month: mkey(y, mo), spend, revenue: rev, bookings, impressions: imp, clicks: clk });
        }
        if (out.length) return out;
      }
    }
  }

  const hr = detectHeader(rows);
  if (hr < 0) return out;
  const headers = rows[hr].map((x) => String(x ?? ""));
  const find = colFinder(headers);
  const colWhere = (pred) => headers.findIndex((h) => pred(norm(h)));
  const body = rows.slice(hr + 1);
  const guessProp = () => ctx.propOverride || guessPropertyFromFilename(ctx.filename) || classifyListing(ctx.filename);

  // 0) WORLD CUP daily data (filename flags it; only sheets with a Date column are used)
  if (/world\s*cup|worldcup/i.test(ctx.filename || "")) {
    const cList = find("listing"), cDate = find("date"), cOcc = find("occupancy"), cRev = find("rental revenue", "revenue");
    if (cDate < 0) return out; // skip the totals/overview sheet — recomputed from daily
    for (const r of body) {
      const prop = classifyListing(r[cList]) || ctx.propOverride; if (!prop) continue;
      const d = toDate(r[cDate]); if (!d) continue;
      const units = parseUnits(r[cList]);
      const occ = cOcc >= 0 ? (pct(r[cOcc]) || 0) : 0;
      out.push({ kind: "wc", prop, date: isoDate(d), units, booked: occ * units, revenue: num(r[cRev]) || 0 });
    }
    return out;
  }

  // 0b) CLOUDBEDS-STYLE CHANNEL PRODUCTION (stacked header, leading blank col, merged month cells)
  {
    const N = rows.map((r) => (r || []).map(norm));
    const stayRow = N.findIndex((r) => r.some((c) => c.includes("stay date")));
    const hasResSrcAnywhere = N.some((r) => r.some((c) => c.includes("reservation source")));
    if (stayRow >= 0 && hasResSrcAnywhere) {
      const hrow = N[stayRow];
      const cStay = hrow.findIndex((c) => c.includes("stay date"));
      const cCat = hrow.findIndex((c) => c.includes("source category"));
      const cSrc = hrow.findIndex((c, i) => c.includes("reservation source") && !c.includes("category") && i !== cCat);
      // "This year" Rooms Sold / Total Room Revenue = leftmost exact matches across the header rows
      let cRooms = -1, cRev = -1;
      for (let i = 0; i <= stayRow && i < N.length; i++) {
        if (cRooms < 0) { const j = N[i].indexOf("rooms sold"); if (j >= 0) cRooms = j; }
        if (cRev < 0) { const j = N[i].findIndex((c) => c === "total room revenue" || c === "room revenue"); if (j >= 0) cRev = j; }
      }
      if (cStay >= 0 && cSrc >= 0 && cRev >= 0) {
        // property name from a "Property" label row, else filename
        let propName = "";
        for (const r of rows) { const arr = r || []; const j = arr.findIndex((c) => norm(c) === "property"); if (j >= 0) { for (let k = j + 1; k < arr.length; k++) { if (String(arr[k] ?? "").trim()) { propName = String(arr[k]).trim(); break; } } if (propName) break; } }
        const prop = ctx.propOverride || classifyListing(propName) || guessPropertyFromFilename(ctx.filename) || classifyListing(ctx.filename);
        const yr = new Date().getFullYear();
        let curMonth = null; const parsed = [];
        for (let i = stayRow + 1; i < rows.length; i++) {
          const r = rows[i]; if (!r) continue;
          const mlabel = norm(r[cStay]).slice(0, 3);
          if (MONTH_IDX[mlabel] != null) curMonth = MONTH_IDX[mlabel]; // carry forward merged month
          if (curMonth == null) continue;
          const srcRaw = r[cSrc]; const sn = norm(srcRaw);
          if (!sn || sn === "-") continue; // subtotal / empty row
          const rev = num(r[cRev]); if (rev == null) continue;
          const rooms = cRooms >= 0 ? (num(r[cRooms]) || 0) : 0;
          parsed.push({ month: mkey(yr, curMonth), year: yr, mIdx: curMonth, revenue: rev, nights: rooms, source: sourceLabel(srcRaw) });
        }
        if (parsed.length) {
          if (prop) return parsed.map((p) => ({ kind: "res", prop, ...p }));
          // We read the channel report but it names no property — summarize and ask the user to assign one.
          const channels = {}; const monthsSet = new Set(); let totalRevenue = 0;
          parsed.forEach((p) => { channels[p.source] = (channels[p.source] || 0) + p.revenue; monthsSet.add(MONTHS[p.mIdx]); totalRevenue += p.revenue; });
          return [{ kind: "needprop", report: "channel mix", months: [...monthsSet], totalRevenue, channels }];
        }
      }
    }
  }

  // detect format
  const hasSource = find("source") >= 0;
  const hasCheckin = find("check in", "check-in", "checkin") >= 0;
  const hasListing = find("listing") >= 0;
  const hasStayDate = find("stay date") >= 0;
  const hasResSource = find("reservation source") >= 0;
  const hasBookedNights = colWhere((h) => h.includes("booked nights")) >= 0;
  const hasPickup = colWhere((h) => h.includes("pickup")) >= 0 || colWhere((h) => h.includes("booking window")) >= 0;
  const dateCol = find("date");
  const yearRevCols = headers.map((hd, i) => {
    const m = String(hd).match(/revenue\D*(\d{4})/i);
    return m ? { i, year: +m[1] } : null;
  }).filter(Boolean);
  const yearRevparCols = headers.map((hd, i) => { const m = String(hd).match(/revpar\D*(\d{4})/i); return m ? { i, year: +m[1] } : null; }).filter(Boolean);
  const yearNightsCols = headers.map((hd, i) => { const m = String(hd).match(/(accommodations booked|nights)\D*(\d{4})/i); return m ? { i, year: +m[2] } : null; }).filter(Boolean);

  // 1) RESERVATION-LEVEL (one row per booking)
  if (hasSource && hasCheckin) {
    const cSrc = find("source"), cIn = find("check in", "check-in", "checkin"), cList = find("listing");
    const cNights = find("nights"), cAF = find("af", "accommodation fare", "fare", "revenue"), cADR = find("adr");
    for (const r of body) {
      const prop = classifyListing(r[cList]) || ctx.propOverride; if (!prop) continue;
      const d = toDate(r[cIn]); if (!d) continue;
      let rev = num(r[cAF]); const nights = num(r[cNights]) || 0;
      if (rev == null && cADR >= 0) rev = (num(r[cADR]) || 0) * nights;
      if (rev == null) continue;
      out.push({ kind: "res", prop, month: mkey(d.getFullYear(), d.getMonth()), year: d.getFullYear(), mIdx: d.getMonth(), revenue: rev, nights, source: sourceLabel(r[cSrc]) });
    }
    return out;
  }

  // 2) CHANNEL PRODUCTION (Stay Date + Reservation Source + Total Room Revenue) -> channel mix + monthly revenue
  if (hasResSource && hasStayDate) {
    const cStay = find("stay date");
    const cCat = colWhere((h) => h.includes("source category"));
    const cDetail = colWhere((h) => h.includes("reservation source") && !h.includes("category"));
    const cRooms = find("rooms sold"), cRev = find("total room revenue", "room revenue", "revenue");
    const prop = guessProp(); const yr = new Date().getFullYear();
    for (const r of body) {
      const mIdx = MONTH_IDX[norm(r[cStay]).slice(0, 3)]; if (mIdx == null) continue;
      const rev = num(r[cRev]); if (rev == null || rev <= 0) continue;
      const cat = cCat >= 0 ? norm(r[cCat]) : "";
      const src = cat.includes("direct") ? "Direct" : sourceLabel(cDetail >= 0 ? r[cDetail] : r[cCat]);
      out.push({ kind: "res", prop: prop || "unknown", month: mkey(yr, mIdx), year: yr, mIdx, revenue: rev, nights: num(r[cRooms]) || 0, source: src });
    }
    return out;
  }

  // 3) PACE / PICKUP report (Listing + Booked Nights + Pickup / Booking Window)
  if (hasListing && (hasBookedNights || hasPickup)) {
    const cList = find("listing");
    const cBN = colWhere((h) => h === "booked nights");
    const cBNs = colWhere((h) => h === "booked nights stly");
    const cBNl = colWhere((h) => h === "booked nights ly");
    const cP7 = colWhere((h) => h.includes("pickup") && h.includes("7 day") && !h.includes("stly"));
    const cP30 = colWhere((h) => h.includes("pickup") && h.includes("30 day") && !h.includes("stly"));
    const cBk = colWhere((h) => h === "number of bookings");
    const cBW = colWhere((h) => h.includes("median booking window"));
    for (const r of body) {
      const prop = classifyListing(r[cList]) || ctx.propOverride; if (!prop) continue;
      out.push({
        kind: "pace", prop,
        bookedNights: cBN >= 0 ? num(r[cBN]) || 0 : 0,
        bookedNightsSTLY: cBNs >= 0 ? num(r[cBNs]) || 0 : 0,
        bookedNightsLY: cBNl >= 0 ? num(r[cBNl]) || 0 : 0,
        pickup7: cP7 >= 0 ? num(r[cP7]) || 0 : 0,
        pickup30: cP30 >= 0 ? num(r[cP30]) || 0 : 0,
        bookings: cBk >= 0 ? num(r[cBk]) || 0 : 0,
        bookingWindow: cBW >= 0 ? num(r[cBW]) : null,
      });
    }
    return out;
  }

  // 4) MONTHLY TIME-SERIES (RevPAR report: Date + Revenue YYYY columns)
  if (yearRevCols.length && dateCol >= 0) {
    const prop = guessProp();
    for (const r of body) {
      const mIdx = MONTH_IDX[norm(r[dateCol]).slice(0, 3)]; if (mIdx == null) continue;
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

  // 5) LISTING-LEVEL KPIs — supports MULTIPLE stacked month sections (Jan, Feb, ... each its own block)
  if (hasListing) {
    const cList = find("listing");
    const cOcc = find("occupancy", "occ %", "occ");
    const cRev = find("rental revenue", "revenue");
    const cADR = find("adr"); const cRevpar = find("revpar");
    const cRevLY = colWhere((h) => h.includes("revenue") && h.includes("ly"));
    const cMonth = colWhere((h) => h === "month" || h === "period" || h === "month/year");
    const bareMonth = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/;
    let curYear = ctx.asYear || new Date().getFullYear();
    let curMonth = null;
    for (const row of rows) {
      // update current month/year if this row carries a month label (with or without a year)
      for (const cell of row) {
        if (cell instanceof Date && cell.getDate() === 1 && cell.getFullYear() > 2015) { curMonth = cell.getMonth(); curYear = cell.getFullYear(); break; }
        const s = String(cell); const my = s.match(MONTH_YEAR_RE);
        if (my) { curMonth = MONTH_IDX[my[1].toLowerCase().slice(0, 3)]; curYear = +my[2]; break; }
        const mo = norm(s).match(bareMonth);
        if (mo) { curMonth = MONTH_IDX[mo[1].slice(0, 3)]; break; }
      }
      if (row.some((c) => norm(c).includes("listing name"))) continue; // header row
      // an explicit Month/Period column (one value per row) is the most reliable source
      if (cMonth >= 0) {
        const mc = row[cMonth];
        const dt = mc instanceof Date ? mc : toDate(mc);
        if (dt && !isNaN(dt.getTime())) { curMonth = dt.getMonth(); curYear = dt.getFullYear(); }
      }
      const list = row[cList]; if (!list || norm(list) === "total" || norm(list) === "listing name") continue;
      const prop = classifyListing(list) || ctx.propOverride; if (!prop) continue;
      const rev = cRev >= 0 ? num(row[cRev]) : null; if (rev == null) continue;
      const occ = cOcc >= 0 ? pct(row[cOcc]) : null;
      const revLY = cRevLY >= 0 ? num(row[cRevLY]) : null;
      if (curMonth != null) {
        const nights = occ != null ? occ * daysInMonth(curYear, curMonth) : null;
        out.push({ kind: "listingmonth", prop, year: curYear, mIdx: curMonth, month: mkey(curYear, curMonth), monthLY: mkey(curYear - 1, curMonth), revenue: rev, nights, revenueLY: revLY });
      } else {
        out.push({ kind: "snapshot", prop, year: curYear, month: ctx.snapMonth || `${curYear}-00`, revenue: rev, occ, adr: cADR >= 0 ? num(row[cADR]) : null, revpar: cRevpar >= 0 ? num(row[cRevpar]) : null, revenueLY: revLY });
      }
    }
    return out;
  }
  return out;
}

/* merge normalized records into the data model */
function applyRecords(model, records) {
  const next = JSON.parse(JSON.stringify(model));

  // PASS 1: figure out which buckets this batch will write, so a re-upload REPLACES rather than double-counts
  const touch = {};
  const adTouch = {};
  for (const rec of records) {
    if (!rec.prop || rec.prop === "unknown") continue;
    if (rec.kind === "ad") { (adTouch[rec.prop] = adTouch[rec.prop] || new Set()).add(rec.channel + "||" + rec.month); continue; }
    const t = (touch[rec.prop] = touch[rec.prop] || { months: new Set(), wcDates: new Set(), snapshot: false, pace: false });
    if (rec.kind === "listingmonth") { t.months.add(rec.month); if (rec.monthLY) t.months.add(rec.monthLY); }
    else if (rec.kind === "res" || rec.kind === "monthly") t.months.add(rec.month);
    else if (rec.kind === "wc") t.wcDates.add(rec.date);
    else if (rec.kind === "pace") t.pace = true;
    else if (rec.kind === "snapshot" && (!rec.month || rec.month.endsWith("-00"))) t.snapshot = true;
    else if (rec.kind === "monthly") t.months.add(rec.month);
  }
  for (const pid of Object.keys(touch)) {
    const p = (next.properties[pid] = next.properties[pid] || { monthly: {}, ota: {}, otaByMonth: {}, snapshot: null });
    p.otaByMonth = p.otaByMonth || {};
    for (const m of touch[pid].months) { delete p.monthly[m]; delete p.otaByMonth[m]; }
    if (touch[pid].wcDates.size) { p.wc = p.wc || {}; for (const dte of touch[pid].wcDates) delete p.wc[dte]; }
    if (touch[pid].pace) p.pace = null;
    if (touch[pid].snapshot) p.snapshot = null;
  }
  for (const pid of Object.keys(adTouch)) {
    next.ads = next.ads || {}; const pa = (next.ads[pid] = next.ads[pid] || {});
    for (const ck of adTouch[pid]) { const [ch, mo] = ck.split("||"); if (pa[ch]) delete pa[ch][mo]; }
  }

  // PASS 2: apply (accumulate within this single batch)
  for (const rec of records) {
    if (!rec.prop || rec.prop === "unknown") continue;
    if (rec.kind === "ad") {
      next.ads = next.ads || {};
      const pa = (next.ads[rec.prop] = next.ads[rec.prop] || {});
      const ch = (pa[rec.channel] = pa[rec.channel] || {});
      const m = (ch[rec.month] = ch[rec.month] || { spend: 0, revenue: 0, bookings: 0, impressions: 0, clicks: 0 });
      m.spend += rec.spend || 0; m.revenue += rec.revenue || 0; m.bookings += rec.bookings || 0; m.impressions += rec.impressions || 0; m.clicks += rec.clicks || 0;
      continue;
    }
    const p = (next.properties[rec.prop] = next.properties[rec.prop] || { monthly: {}, ota: {}, otaByMonth: {}, snapshot: null });

    if (rec.kind === "wc") {
      const w = (p.wc = p.wc || {});
      const day = (w[rec.date] = w[rec.date] || { revenue: 0, booked: 0, units: 0 });
      day.revenue += rec.revenue || 0; day.booked += rec.booked || 0; day.units += rec.units || 0;
      continue;
    }
    if (rec.kind === "pace") {
      const pc = (p.pace = p.pace || { bookedNights: 0, bookedNightsSTLY: 0, bookedNightsLY: 0, pickup7: 0, pickup30: 0, bookings: 0, bwSum: 0, bwN: 0 });
      pc.bookedNights += rec.bookedNights || 0; pc.bookedNightsSTLY += rec.bookedNightsSTLY || 0; pc.bookedNightsLY += rec.bookedNightsLY || 0;
      pc.pickup7 += rec.pickup7 || 0; pc.pickup30 += rec.pickup30 || 0; pc.bookings += rec.bookings || 0;
      if (rec.bookingWindow != null) { pc.bwSum += rec.bookingWindow; pc.bwN++; }
      continue;
    }
    if (rec.kind === "listingmonth") {
      const cur = (p.monthly[rec.month] = p.monthly[rec.month] || { revenue: 0, nights: 0 });
      cur.revenue += rec.revenue || 0;
      if (rec.nights != null) cur.nights = (cur.nights || 0) + rec.nights;
      if (rec.revenueLY != null) {
        const ly = (p.monthly[rec.monthLY] = p.monthly[rec.monthLY] || { revenue: 0, nights: 0 });
        ly.revenue += rec.revenueLY || 0;
      }
      continue;
    }

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
        const obm = (p.otaByMonth = p.otaByMonth || {});
        const mo = (obm[rec.month] = obm[rec.month] || {});
        mo[rec.source] = (mo[rec.source] || 0) + rec.revenue;
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

  // PASS 3: rebuild each property's flat channel total from the monthly channel buckets (always idempotent)
  for (const pid of Object.keys(next.properties)) {
    const p = next.properties[pid];
    if (p.otaByMonth) {
      p.ota = {};
      for (const m of Object.keys(p.otaByMonth)) for (const [src, v] of Object.entries(p.otaByMonth[m])) p.ota[src] = (p.ota[src] || 0) + v;
    }
  }
  next.lastUpdated = new Date().toISOString();
  return next;
}

/* build an activity log by diffing two models after an upload */
function buildActivity(before, after, fname) {
  const entries = []; const ts = new Date().toISOString();
  for (const pid of Object.keys(after.properties)) {
    const bd = before.properties[pid] ? deriveProperty(pid, before) : null;
    const ad = deriveProperty(pid, after);
    if (!ad) continue;
    const bRev = bd?.currentMonth?.revenue || 0; const aRev = ad.currentMonth?.revenue || 0;
    if (Math.abs(aRev - bRev) > 1) {
      entries.push({ ts, pid, text: `${ad.meta.name}: ${ad.currentMonth.label} revenue ${bRev ? "updated to" : "set to"} ${fmtMoney(aRev)}${bRev ? ` (was ${fmtMoney(bRev)})` : ""}` });
    }
  }
  if (!entries.length) entries.push({ ts, pid: null, text: `Loaded ${fname}` });
  return entries;
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

  // Live calendar awareness — recomputed every render, so it rolls over automatically each month.
  const now = new Date();
  const curMonthKey = mkey(now.getFullYear(), now.getMonth());
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = mkey(prevD.getFullYear(), prevD.getMonth());
  const cmRow = series.find((s) => s.key === curMonthKey);
  const pmRow = series.find((s) => s.key === prevMonthKey);
  const lyRow = series.find((s) => s.year === now.getFullYear() - 1 && s.mIdx === now.getMonth());
  const thisYear = now.getFullYear();
  const ytd = series.filter((s) => s.year === thisYear && s.mIdx <= now.getMonth()).reduce((a, s) => a + (s.revenue || 0), 0);
  const ytdPrior = series.filter((s) => s.year === thisYear - 1 && s.mIdx <= now.getMonth()).reduce((a, s) => a + (s.revenue || 0), 0);
  const currentMonth = {
    key: curMonthKey,
    label: `${MONTHS[now.getMonth()]} ${thisYear}`,
    revenue: cmRow ? (cmRow.revenue || 0) : 0,
    prevRevenue: pmRow ? (pmRow.revenue || 0) : null,
    lyRevenue: lyRow ? (lyRow.revenue || 0) : null,
    lyLabel: `${MONTHS[now.getMonth()]} ${now.getFullYear() - 1}`,
    nights: cmRow ? (cmRow.nights ?? null) : null,
    occ: cmRow ? (cmRow.occ ?? null) : null,
    adr: cmRow ? (cmRow.adr ?? null) : null,
    revpar: cmRow ? (cmRow.revpar ?? null) : null,
    prevOcc: pmRow ? (pmRow.occ ?? null) : null,
    prevAdr: pmRow ? (pmRow.adr ?? null) : null,
    prevRevpar: pmRow ? (pmRow.revpar ?? null) : null,
    has: !!cmRow,
  };
  // run-rate forecast for the current month
  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const dayOfMonth = now.getDate();
  const fracElapsed = dayOfMonth / dim;
  const onBooks = currentMonth.revenue;
  // early in the month, advance bookings dominate, so on-the-books is the best estimate;
  // later, blend in a run-rate projection
  const runRate = fracElapsed > 0 ? onBooks / fracElapsed : onBooks;
  const projection = fracElapsed < 0.5 ? Math.max(onBooks, runRate * 0.5 + onBooks * 0.5) : runRate;
  const forecast = { onBooks, projection, fracElapsed, dim, dayOfMonth };

  const otaByMonth = p.otaByMonth || {};
  const goal = (model.goals && model.goals[pid] != null) ? model.goals[pid] : (meta.goal || null);

  return { pid, meta, series, latest, prev, snap, yoy, byYear, years, curY, priorY, ota, raw: p, currentMonth, ytd, ytdPrior, ytdYear: thisYear, forecast, otaByMonth, goal, pace: p.pace ? { ...p.pace, bookingWindow: p.pace.bwN ? p.pace.bwSum / p.pace.bwN : null } : null };
}
// Aggregate ad spend/revenue/ROAS per channel for a property
function deriveAds(model, pid) {
  const a = model.ads && model.ads[pid];
  if (!a || !Object.keys(a).length) return null;
  const channels = Object.keys(a).map((ch) => {
    const months = Object.keys(a[ch]).sort().map((mk) => {
      const [y, m] = mk.split("-").map(Number); const d = a[ch][mk];
      return { key: mk, label: `${MONTHS[m - 1]} ${y}`, ...d, roas: d.spend > 0 ? d.revenue / d.spend : null };
    });
    const tot = months.reduce((t, r) => ({ spend: t.spend + (r.spend || 0), revenue: t.revenue + (r.revenue || 0), bookings: t.bookings + (r.bookings || 0) }), { spend: 0, revenue: 0, bookings: 0 });
    return { channel: ch, months, total: { ...tot, roas: tot.spend > 0 ? tot.revenue / tot.spend : null } };
  });
  const spend = channels.reduce((s, c) => s + c.total.spend, 0);
  const revenue = channels.reduce((s, c) => s + c.total.revenue, 0);
  return { channels, blended: { spend, revenue, roas: spend > 0 ? revenue / spend : null } };
}

// Composite property health score (0-100)
function healthScore(d) {
  if (!d || !d.latest) return null;
  const L = d.latest;
  const occScore = L.occ != null ? Math.min(1, L.occ / 0.75) : 0.5;           // target 75% occ
  const goalScore = d.goal ? Math.min(1, (d.currentMonth.revenue || 0) / d.goal) : 0.5;
  let yoyScore = 0.5;
  if (d.priorY != null) { const py = d.yoy.find((y) => y.month === L.monthName)?.[d.priorY]; const dd = delta(L.revenue, py); if (dd != null) yoyScore = Math.max(0, Math.min(1, 0.5 + dd)); }
  const paceScore = d.pace && d.pace.bookedNightsSTLY ? Math.max(0, Math.min(1, d.pace.bookedNights / d.pace.bookedNightsSTLY)) : 0.5;
  const score = Math.round((occScore * 0.3 + goalScore * 0.3 + yoyScore * 0.25 + paceScore * 0.15) * 100);
  return { score, parts: { occScore, goalScore, yoyScore, paceScore } };
}

// Build the normalized 5-card KPI object for a single property
function buildKpi(d) {
  return {
    currentMonthRevenue: d.currentMonth.revenue,
    currentMonthLabel: d.currentMonth.label,
    currentMonthDelta: (d.currentMonth.lyRevenue != null && d.currentMonth.lyRevenue > 0) ? delta(d.currentMonth.revenue, d.currentMonth.lyRevenue) : null,
    currentMonthLY: d.currentMonth.lyRevenue,
    currentMonthLYLabel: d.currentMonth.lyLabel,
    ytdRevenue: d.ytd,
    ytdLabel: `${d.ytdYear} YTD`,
    ytdDelta: d.ytdPrior > 0 ? delta(d.ytd, d.ytdPrior) : null,
    occ: d.currentMonth.occ ?? null, adr: d.currentMonth.adr ?? null, revpar: d.currentMonth.revpar ?? null,
    metricLabel: d.currentMonth.label,
    occDelta: delta(d.currentMonth.occ, d.currentMonth.prevOcc),
    adrDelta: delta(d.currentMonth.adr, d.currentMonth.prevAdr),
    revparDelta: delta(d.currentMonth.revpar, d.currentMonth.prevRevpar),
  };
}

// Aggregate World Cup daily data across a scope of properties
function deriveWorldCup(model, propIds) {
  const ids = propIds && propIds.length ? propIds : PROPERTIES.map((p) => p.id);
  const dates = wcDateList();
  let tRev = 0, tBooked = 0, tUnitNights = 0;
  const byDate = dates.map((date) => {
    let rev = 0, booked = 0, units = 0;
    ids.forEach((pid) => { const day = model.properties[pid]?.wc?.[date]; if (day) { rev += day.revenue; booked += day.booked; units += day.units; } });
    tRev += rev; tBooked += booked; tUnitNights += units;
    return { date, revenue: rev, booked, units, occ: units ? booked / units : null, adr: booked ? rev / booked : null, revpar: units ? rev / units : null, match: WC_MATCH_BY_DATE[date] || null };
  });
  const has = byDate.some((d) => d.units > 0);
  const totals = { revenue: tRev, occ: tUnitNights ? tBooked / tUnitNights : null, adr: tBooked ? tRev / tBooked : null, revpar: tUnitNights ? tRev / tUnitNights : null };
  let mdBooked = 0, mdUnits = 0, nmBooked = 0, nmUnits = 0;
  byDate.forEach((d) => { if (d.match) { mdBooked += d.booked; mdUnits += d.units; } else { nmBooked += d.booked; nmUnits += d.units; } });
  return { byDate, totals, has, matchOcc: mdUnits ? mdBooked / mdUnits : null, nonMatchOcc: nmUnits ? nmBooked / nmUnits : null };
}

function fmtMoney(v, d = 0) { if (v == null) return "—"; return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }); }
function fmtPct(v) { if (v == null) return "—"; return (v * 100).toFixed(1) + "%"; }
function delta(cur, prev) { if (cur == null || prev == null || prev === 0) return null; return (cur - prev) / Math.abs(prev); }

/* ---------------- Claude API ---------------- */
async function callClaude({ messages, system, tools, max_tokens = 1000 }) {
  let convo = messages.slice();
  for (let turn = 0; turn < 4; turn++) {
    const body = { model: "claude-sonnet-4-6", max_tokens, messages: convo };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-password": import.meta.env.VITE_APP_PASSWORD || "" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = "API " + res.status;
      try { const e = await res.json(); msg = (e && e.error && (e.error.message || e.error)) || msg; } catch {}
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    const data = await res.json();
    // web search can pause mid-turn; resend the partial assistant turn to let it finish
    if (data.stop_reason === "pause_turn" && Array.isArray(data.content)) {
      convo = convo.concat([{ role: "assistant", content: data.content }]);
      continue;
    }
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  }
  throw new Error("The model kept searching without finishing — try again.");
}
function extractJson(s) {
  const clean = String(s || "").replace(/```json|```/g, "");
  const start = clean.indexOf("{"); const end = clean.lastIndexOf("}");
  return start >= 0 && end > start ? clean.slice(start, end + 1) : clean.trim();
}
function snapshotForAI(model, propIds) {
  const lines = [];
  const ids = propIds && propIds.length ? propIds : Object.keys(model.properties);
  for (const pid of ids) {
    if (!model.properties[pid]) continue;
    const d = deriveProperty(pid, model); if (!d || !d.latest) continue;
    const L = d.latest;
    lines.push(`${d.meta.name} (${d.meta.location}, ${d.meta.units} units) — latest ${L.label}: Revenue ${fmtMoney(L.revenue)}, Occ ${fmtPct(L.occ)}, ADR ${fmtMoney(L.adr)}, RevPAR ${fmtMoney(L.revpar)}.` +
      ` Current month (${d.currentMonth.label}) rev ${fmtMoney(d.currentMonth.revenue)}; ${d.ytdYear} YTD ${fmtMoney(d.ytd)}.` +
      (d.priorY != null ? ` Prior-year ${L.monthName} rev: ${fmtMoney(d.yoy.find((y) => y.month === L.monthName)?.[d.priorY])}.` : "") +
      (d.pace ? ` Pace: ${d.pace.bookedNights} booked nights vs ${d.pace.bookedNightsSTLY} same-time-last-year; pickup 7d ${d.pace.pickup7}, 30d ${d.pace.pickup30}.` : "") +
      (d.ota.length ? ` Channel mix: ${d.ota.map((o) => o.name + " " + fmtMoney(o.value)).join(", ")}.` : ""));
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
  const [hfDebug, setHfDebug] = useState(null);
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
    let added = 0, errors = [], routed = {}, prompts = [];
    for (const file of files) {
      try {
        const ext = file.name.split(".").pop().toLowerCase();
        let records = [];
        if (["xlsx", "xls", "csv", "tsv"].includes(ext)) {
          const buf = await readFileAsArrayBuffer(file);
          const wb = XLSX.read(buf, { type: "array", cellDates: true });
          const ctx = { filename: file.name, propOverride: propOverride !== "auto" ? propOverride : null };
          const SKIP_SHEET = /daily|weekly|analysis|title option|^sheet\s*\d+\s*$/i;
          for (const sn of wb.SheetNames) {
            if (wb.SheetNames.length > 1 && SKIP_SHEET.test(String(sn).trim())) continue; // raw logs/scratch tabs poison property attribution
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "" });
            records.push(...ingestSheet(rows, ctx));
          }
        } else if (["png", "jpg", "jpeg", "pdf"].includes(ext)) {
          records = await extractFromImageOrPdf(file);
          if (propOverride !== "auto") records = records.map((r) => ({ ...r, prop: propOverride }));
        } else { errors.push(`${file.name}: unsupported type`); continue; }
        // a parsed report that couldn't be tied to a property → tell the user what we read and how to assign it
        const need = records.find((r) => r.kind === "needprop");
        records = records.filter((r) => r.kind !== "needprop");
        if (need && !records.length) {
          const chans = Object.entries(need.channels).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtMoney(v)}`).join(", ");
          prompts.push(`Read "${file.name}" — a ${need.report} report covering ${need.months.join(", ")}, ${fmtMoney(need.totalRevenue)} total (${chans}) — but it doesn't name a property. Set the "Assign to" dropdown above to the right property and re-upload, or put the property name in the filename (e.g. SOMA, Rambler).`);
          continue;
        }
        records.forEach((r) => { if (r.prop && r.prop !== "unknown") routed[r.prop] = (routed[r.prop] || 0) + 1; });
        if (records.length) {
          setModel((m) => {
            const before = m;
            const after = applyRecords(m, records);
            after.activity = buildActivity(before, after, file.name).concat(after.activity || []).slice(0, 40);
            return after;
          });
          added += records.length;
        } else errors.push(`${file.name}: no recognizable rows`);
      } catch (e) { errors.push(`${file.name}: ${e.message}`); }
    }
    setBusy(false);
    const routedTxt = Object.keys(routed).length ? " → " + Object.keys(routed).map((id) => `${PROP_BY_ID[id]?.name || id} (${routed[id]})`).join(", ") : "";
    if (prompts.length && !added) setIngestMsg({ ok: false, text: prompts.join(" "), errors });
    else setIngestMsg({ ok: added > 0, text: added ? `Ingested ${added} records${routedTxt}.${prompts.length ? " " + prompts.join(" ") : ""}` : "Nothing ingested. " + errors.join("; "), errors });
  }, [propOverride]);

  const onDrop = (e) => { e.preventDefault(); if (e.dataTransfer.files?.length) handleFiles([...e.dataTransfer.files]); };

  const runHfDebug = useCallback(async () => {
    setBusy(true);
    try { const dr = await fetch("/api/hostfully?debug=1"); const dj = await dr.json(); setHfDebug(JSON.stringify(dj, null, 2)); }
    catch (e) { setHfDebug("Could not reach the diagnostics endpoint: " + e.message); }
    setBusy(false);
  }, []);

  const refreshHostfully = useCallback(async () => {
    setBusy(true); setIngestMsg(null); setHfDebug(null);
    const showDebug = async (note) => {
      try { const dr = await fetch("/api/hostfully?debug=1"); const dj = await dr.json(); setHfDebug(JSON.stringify(dj, null, 2)); } catch (e) {}
      setIngestMsg({ ok: false, text: note });
    };
    try {
      const res = await fetch("/api/hostfully");
      const data = await res.json();
      if (!res.ok) { await showDebug(data.error || "Hostfully request failed — diagnostic shown below."); setBusy(false); return; }
      const records = [];
      for (const r of data.rows || []) {
        const prop = classifyListing(r.propertyName); if (!prop) continue;
        const d = toDate(r.checkIn); if (!d) continue;
        const out = r.checkOut ? toDate(r.checkOut) : null;
        const nights = out ? Math.max(1, Math.round((out - d) / 86400000)) : 1;
        records.push({ kind: "res", prop, month: mkey(d.getFullYear(), d.getMonth()), year: d.getFullYear(), mIdx: d.getMonth(), revenue: r.amount, nights, source: r.source });
      }
      if (!records.length) { await showDebug(`Hostfully connected (${data.bookedCount || 0} bookings, ${data.count || 0} with revenue) but none mapped to a property. Diagnostic shown below.`); setBusy(false); return; }
      const routed = {}; records.forEach((r) => { routed[r.prop] = (routed[r.prop] || 0) + 1; });
      setModel((m) => { const after = applyRecords(m, records); after.activity = [{ ts: new Date().toISOString(), pid: null, text: `Synced ${records.length} bookings from Hostfully` }].concat(after.activity || []).slice(0, 40); return after; });
      setIngestMsg({ ok: true, text: `Synced ${records.length} Hostfully bookings → ` + Object.keys(routed).map((id) => `${PROP_BY_ID[id]?.short} (${routed[id]})`).join(", ") });
    } catch (e) {
      await showDebug(e.message.includes("not set") ? "Add HOSTFULLY_API_KEY in Vercel to enable this." : `Hostfully sync failed: ${e.message}`);
    }
    setBusy(false);
  }, []);

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
          <NavItem icon={<Trophy size={17} />} label="World Cup" active={page === "worldcup"} onClick={() => setPage("worldcup")} color="#f0b21b" />
          {REGIONS.map((rg) => (
            <div key={rg.id}>
              <button className="navbtn ui" onClick={() => setPage("region:" + rg.id)}
                style={{ width: "100%", textAlign: "left", background: page === "region:" + rg.id ? "rgba(255,255,255,.10)" : "transparent", color: "#dfe6ef", border: "none", borderRadius: 7, padding: "9px 11px", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 2 }}>
                <MapPin size={15} style={{ color: "#8ea0b8" }} /> {rg.name}
              </button>
              {PROPS_IN(rg.id).map((p) => (
                <div key={p.id} style={{ paddingLeft: 12 }}>
                  <NavItem icon={<Building2 size={16} />} label={p.name} active={page === p.id} onClick={() => setPage(p.id)} color={p.color} dot />
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#6c7d96", margin: "16px 8px 6px", fontWeight: 700 }}>INTELLIGENCE</div>
          <NavItem icon={<Calendar size={17} />} label="Events" active={page === "events"} onClick={() => setPage("events")} color="#8ea0b8" />
          <NavItem icon={<TrendingUp size={17} />} label="Ad Performance" active={page === "ads"} onClick={() => setPage("ads")} color="#8ea0b8" />
          <NavItem icon={<MessageSquare size={17} />} label="Ask the Board" active={page === "ask"} onClick={() => setPage("ask")} color="#8ea0b8" />
          <NavItem icon={<Search size={17} />} label="Data Audit" active={page === "audit"} onClick={() => setPage("audit")} color="#8ea0b8" />
          <NavItem icon={<Briefcase size={17} />} label="Sales Pipeline" active={page === "sales"} onClick={() => setPage("sales")} color="#8ea0b8" />

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
                : page === "worldcup" ? <WorldCupPage model={model} onUpload={() => fileRef.current?.click()} />
                : page.startsWith("region:") ? <RegionPage region={page.split(":")[1]} model={model} goto={setPage} />
                : page === "events" ? <Events model={model} setModel={setModel} onFiles={handleFiles} />
                  : page === "ask" ? <AskPage model={model} />
                    : page === "audit" ? <AuditPage model={model} setModel={setModel} />
                    : page === "ads" ? <AdPage model={model} />
                    : page === "sales" ? <SalesPipeline model={model} setModel={setModel} />
                    : <PropertyPage pid={page} model={model} setModel={setModel} />}
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
function KpiRow({ k, accent }) {
  const cards = [
    { label: "Current Month Revenue", sub: k.currentMonthLY != null ? `${k.currentMonthLabel} · LY ${fmtMoney(k.currentMonthLY)}` : k.currentMonthLabel, icon: <DollarSign size={15} />, val: fmtMoney(k.currentMonthRevenue), dl: k.currentMonthDelta, dlLabel: "YoY" },
    { label: "YTD Revenue", sub: k.ytdLabel, icon: <Calendar size={15} />, val: fmtMoney(k.ytdRevenue), dl: k.ytdDelta, dlLabel: "YoY" },
    { label: "Occupancy", sub: k.metricLabel, icon: <Percent size={15} />, val: fmtPct(k.occ), dl: k.occDelta, dlLabel: "MoM" },
    { label: "ADR", sub: k.metricLabel, icon: <BedDouble size={15} />, val: fmtMoney(k.adr), dl: k.adrDelta, dlLabel: "MoM" },
    { label: "RevPAR", sub: k.metricLabel, icon: <Gauge size={15} />, val: fmtMoney(k.revpar), dl: k.revparDelta, dlLabel: "MoM" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 12 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "15px 16px", borderTop: `3px solid ${accent}` }}>
          <div className="ui" style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: .3, textTransform: "uppercase", lineHeight: 1.25, minHeight: 26 }}>
            <span style={{ color: accent, flexShrink: 0 }}>{c.icon}</span>{c.label}
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 25, fontWeight: 700, marginTop: 7, color: C.ink }}>{c.val}</div>
          <div className="ui" style={{ fontSize: 10.5, color: C.faint, marginTop: 2 }}>{c.sub}</div>
          {c.dl != null && (
            <div className="ui" style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: c.dl >= 0 ? C.good : C.bad, display: "flex", alignItems: "center", gap: 4 }}>
              {c.dl >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {(c.dl * 100).toFixed(1)}% {c.dlLabel}
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
  const [showOcc, setShowOcc] = useState(false);
  if (!d?.yoy?.length || d.priorY == null) return <Empty text="Year-over-year appears once a prior-year file is loaded." />;
  const data = d.yoy.map((row, i) => ({ ...row, occ: d.byYear?.[d.curY]?.[i]?.occ ?? null }));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <button onClick={() => setShowOcc((s) => !s)} style={{ fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 7, cursor: "pointer", border: `1px solid ${showOcc ? d.meta.color : C.border}`, background: showOcc ? d.meta.color : "#fff", color: showOcc ? "#fff" : C.sub }}>
          {showOcc ? "Hide occupancy" : "Show occupancy"}
        </button>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="rev" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
          {showOcc && <YAxis yAxisId="occ" orientation="right" domain={[0, 1]} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => (v * 100).toFixed(0) + "%"} />}
          <Tooltip formatter={(v, name) => name === "Occupancy" ? fmtPct(v) : fmtMoney(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="rev" dataKey={String(d.priorY)} fill="#c9d0da" radius={[4, 4, 0, 0]} name={`${d.priorY}`} />
          <Bar yAxisId="rev" dataKey={String(d.curY)} fill={d.meta.color} radius={[4, 4, 0, 0]} name={`${d.curY}`} />
          {showOcc && <ReferenceLine yAxisId="occ" y={0.7} stroke={C.bad} strokeDasharray="5 4" strokeWidth={1.5} label={{ value: "70% goal", position: "insideTopRight", fontSize: 10, fill: C.bad }} />}
          {showOcc && <Line yAxisId="occ" type="monotone" dataKey="occ" name="Occupancy" stroke={C.ink} strokeWidth={2.5} dot={{ r: 2.5, fill: C.ink }} connectNulls />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
const STANDARD_CHANNELS = ["Airbnb", "Vrbo", "Expedia", "Booking.com", "Direct"];
function OtaChart({ d }) {
  const map = {}; (d?.ota || []).forEach((o) => { map[o.name] = (map[o.name] || 0) + o.value; });
  const total = Object.values(map).reduce((a, v) => a + v, 0);
  // always show all five standard channels (plus any extras like "Other"), even at $0
  const names = [...STANDARD_CHANNELS, ...Object.keys(map).filter((n) => !STANDARD_CHANNELS.includes(n))];
  const rows = names.map((name) => ({ name, value: map[name] || 0 }));
  const pieData = rows.filter((r) => r.value > 0);
  if (!total) return <Empty text="Channel mix appears once channel/reservation data (with a source column) is loaded. All five channels will populate here." />;
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <ResponsiveContainer width={200} height={200}>
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={2}>
            {pieData.map((o) => <Cell key={o.name} fill={OTA_COLORS[o.name] || OTA_COLORS.Other} />)}
          </Pie>
          <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="ui" style={{ flex: 1, minWidth: 160 }}>
        {rows.sort((a, b) => b.value - a.value).map((o) => (
          <div key={o.name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", fontSize: 13, borderBottom: `1px solid ${C.track}`, opacity: o.value ? 1 : 0.5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: OTA_COLORS[o.name] || OTA_COLORS.Other }} />
            <span style={{ flex: 1, color: C.ink }}>{o.name}</span>
            <span style={{ fontWeight: 600 }}>{fmtMoney(o.value)}</span>
            <span style={{ color: C.muted, width: 44, textAlign: "right" }}>{total ? ((o.value / total) * 100).toFixed(0) : 0}%</span>
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

/* ---------------- OVERVIEW + REGION (shared PortfolioView) ---------------- */
function Overview({ model, hasData, onUpload, goto }) {
  return <PortfolioView model={model} props={PROPERTIES} title="Portfolio Overview" sub="Everything under SHP management, across Fort Worth & Arlington" accent={C.slate} goto={goto} hasData={hasData} onUpload={onUpload} channelTitle="Channel mix — entire portfolio" />;
}
function RegionPage({ region, model, goto }) {
  const rg = REGIONS.find((r) => r.id === region);
  const props = PROPS_IN(region);
  return <PortfolioView model={model} props={props} title={rg ? rg.name : "Region"} sub={`${props.length} properties in ${rg ? rg.name : region}`} accent={C.slate} goto={goto} hasData channelTitle={`Channel mix — ${rg ? rg.name : region}`} regionMode />;
}

function PortfolioView({ model, props, title, sub, accent, goto, hasData, onUpload, channelTitle, regionMode }) {
  const propIds = props.map((p) => p.id);
  const derived = useMemo(() => props.map((p) => deriveProperty(p.id, model)).filter(Boolean), [model, propIds.join()]);

  const kpi = useMemo(() => {
    const now = new Date();
    let cmRev = 0, cmLY = 0, ytdRev = 0, ytdPrior = 0, nights = 0, avail = 0, adrW = 0, adrN = 0, occSum = 0, occN = 0, cmLabel = "", ytdLabel = "";
    derived.forEach((d) => {
      cmRev += d.currentMonth.revenue || 0; cmLY += d.currentMonth.lyRevenue || 0; ytdRev += d.ytd || 0; ytdPrior += d.ytdPrior || 0;
      cmLabel = d.currentMonth.label; ytdLabel = `${d.ytdYear} YTD`;
      const cm = d.currentMonth;
      if (cm && cm.has) {
        nights += cm.nights || 0;
        avail += d.meta.units * daysInMonth(now.getFullYear(), now.getMonth());
        if (cm.adr != null) { adrW += cm.adr * (cm.nights || 1); adrN += (cm.nights || 1); }
        if (cm.occ != null) { occSum += cm.occ; occN++; }
      }
    });
    const occ = avail ? Math.min(1, nights / avail) : (occN ? occSum / occN : null);
    const adr = adrN ? adrW / adrN : null;
    return {
      currentMonthRevenue: cmRev, currentMonthLabel: cmLabel || "Current month",
      currentMonthDelta: cmLY > 0 ? delta(cmRev, cmLY) : null, currentMonthLY: cmLY > 0 ? cmLY : null, currentMonthLYLabel: `${MONTHS[now.getMonth()]} ${now.getFullYear() - 1}`,
      ytdRevenue: ytdRev, ytdLabel: ytdLabel || "YTD", ytdDelta: ytdPrior > 0 ? delta(ytdRev, ytdPrior) : null,
      occ, adr, revpar: adr && occ ? adr * occ : null, metricLabel: cmLabel || "current month",
      occDelta: null, adrDelta: null, revparDelta: null,
    };
  }, [derived]);

  const compare = derived.map((d) => ({ name: d.meta.short, revenue: d.currentMonth?.revenue || 0, color: d.meta.color }));
  const portfolioOta = useMemo(() => {
    const totals = {};
    derived.forEach((d) => { (d.ota || []).forEach((o) => { totals[o.name] = (totals[o.name] || 0) + o.value; }); });
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [derived]);

  return (
    <div>
      <SectionTitle sub={sub}>{title}</SectionTitle>
      {!hasData && onUpload && (
        <div className="ui" onClick={onUpload} style={{ cursor: "pointer", border: `2px dashed ${C.borderStrong}`, borderRadius: 16, padding: "46px 24px", textAlign: "center", background: "#fafbfc", marginBottom: 22 }}>
          <Upload size={26} style={{ color: C.muted }} />
          <div style={{ fontWeight: 600, marginTop: 10, color: C.ink }}>Drop your first file to begin</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>RevPAR reports, KPI trackers, channel production, pace reports, or a PDF/screenshot — name the file with the property and it auto-routes.</div>
        </div>
      )}

      <KpiRow k={kpi} accent={accent} />
      <PeriodBreakdown derived={derived} accent={accent} />

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
        <Panel title={channelTitle}><OtaChart d={{ ota: portfolioOta }} /></Panel>
      </div>

      <div style={{ marginTop: 16 }}><PacePanel derived={derived} title="Pace & pickup — booked nights vs. same time last year" /></div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <ForecastPanel derived={derived} />
        <Leaderboard derived={derived} />
      </div>

      <div style={{ marginTop: 16 }}><ChannelOverTime derived={derived} /></div>
      <div style={{ marginTop: 16 }}><HealthBoard derived={derived} goto={goto} /></div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 16 }}>
        <div><DailyFocus model={model} propIds={propIds} /></div>
        <div style={{ display: "grid", gap: 16 }}>
          <ActivityFeed model={model} propIds={propIds} />
          <SlackDigest model={model} propIds={propIds} />
        </div>
      </div>
      <div style={{ marginTop: 16 }}><Alerts model={model} propIds={propIds} /></div>
    </div>
  );
}
function Mini({ label, val }) {
  return <div><div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4 }}>{label}</div><div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 700 }}>{val}</div></div>;
}

/* period toggle (MTD / QTD / YTD / trailing 12) with per-property drill-down */
const PERIODS = [{ id: "mtd", label: "This month" }, { id: "qtd", label: "This quarter" }, { id: "ytd", label: "YTD" }, { id: "t12", label: "Last 12 mo" }];
function periodRange(id) {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  if (id === "mtd") return (s) => s.year === y && s.mIdx === m;
  if (id === "qtd") { const qs = Math.floor(m / 3) * 3; return (s) => s.year === y && s.mIdx >= qs && s.mIdx <= m; }
  if (id === "ytd") return (s) => s.year === y && s.mIdx <= m;
  const cutoff = new Date(y, m - 11, 1); return (s) => { const sd = new Date(s.year, s.mIdx, 1); return sd >= cutoff && sd <= new Date(y, m, 1); };
}
function PeriodBreakdown({ derived, accent }) {
  const [period, setPeriod] = useState("mtd");
  const [open, setOpen] = useState(false);
  const inRange = periodRange(period);
  const rows = derived.map((d) => ({ name: d.meta.short, color: d.meta.color, rev: d.series.filter(inRange).reduce((a, s) => a + (s.revenue || 0), 0) }))
    .filter((r) => r.rev > 0).sort((a, b) => b.rev - a.rev);
  const total = rows.reduce((a, r) => a + r.rev, 0);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 18px", marginTop: 16 }}>
      <div className="ui" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {PERIODS.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)} style={{ background: period === p.id ? accent : "#fff", color: period === p.id ? "#fff" : C.sub, border: `1px solid ${period === p.id ? accent : C.border}`, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{p.label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="ui" style={{ fontSize: 12, color: C.muted }}>Revenue</span>
          <span style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 700, color: C.ink }}>{fmtMoney(total)}</span>
          <button className="ui" onClick={() => setOpen(!open)} style={{ background: "transparent", border: "none", color: accent, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>{open ? "Hide" : "Drill down"}</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          {!rows.length ? <Empty text="No revenue in this period yet." /> : rows.map((r) => (
            <div key={r.name} className="ui" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: r.color }} />
              <span style={{ width: 90, fontSize: 13 }}>{r.name}</span>
              <div style={{ flex: 1, background: C.track, borderRadius: 5, height: 8 }}><div style={{ width: `${(r.rev / rows[0].rev) * 100}%`, height: "100%", borderRadius: 5, background: r.color }} /></div>
              <span style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 700 }}>{fmtMoney(r.rev)}</span>
              <span style={{ width: 44, textAlign: "right", fontSize: 12, color: C.muted }}>{total ? ((r.rev / total) * 100).toFixed(0) : 0}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- PACE & PICKUP ---------------- */
function PacePanel({ derived, title }) {
  const withPace = derived.filter((d) => d.pace);
  if (!withPace.length) return (
    <Panel title={title}><Empty text="Pace appears when a pace/pickup report (booked nights, pickup, booking window) is loaded." /></Panel>
  );
  const tot = withPace.reduce((a, d) => ({
    bn: a.bn + d.pace.bookedNights, stly: a.stly + d.pace.bookedNightsSTLY,
    p7: a.p7 + d.pace.pickup7, p30: a.p30 + d.pace.pickup30,
    bw: a.bw + (d.pace.bookingWindow || 0), bwN: a.bwN + (d.pace.bookingWindow != null ? 1 : 0),
  }), { bn: 0, stly: 0, p7: 0, p30: 0, bw: 0, bwN: 0 });
  const vsStly = tot.stly ? (tot.bn - tot.stly) / tot.stly : null;
  const chart = withPace.map((d) => ({ name: d.meta.short, "This year": d.pace.bookedNights, "Last year (STLY)": d.pace.bookedNightsSTLY, color: d.meta.color }));
  return (
    <Panel title={title}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        <PaceStat label="Booked nights" value={tot.bn} sub={vsStly != null ? `${vsStly >= 0 ? "+" : ""}${(vsStly * 100).toFixed(0)}% vs last year` : null} good={vsStly >= 0} />
        <PaceStat label="Pickup last 7 days" value={tot.p7} sub="net new booked nights" />
        <PaceStat label="Pickup last 30 days" value={tot.p30} sub="net new booked nights" />
        <PaceStat label="Avg booking window" value={tot.bwN ? Math.round(tot.bw / tot.bwN) : "—"} sub="days out" raw />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chart} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: C.muted }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Last year (STLY)" fill="#c9d0da" radius={[4, 4, 0, 0]} />
          <Bar dataKey="This year" fill={C.slate} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
function PaceStat({ label, value, sub, good, raw }) {
  return (
    <div style={{ background: "#f8f9fb", border: `1px solid ${C.track}`, borderRadius: 11, padding: "12px 14px" }}>
      <div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "Georgia,serif", fontSize: 23, fontWeight: 700, marginTop: 5 }}>{raw ? value : (typeof value === "number" ? value.toLocaleString() : value)}</div>
      {sub && <div className="ui" style={{ fontSize: 11.5, marginTop: 2, color: good == null ? C.muted : good ? C.good : C.bad }}>{sub}</div>}
    </div>
  );
}

/* ---------------- FORECAST ---------------- */
function ForecastPanel({ derived }) {
  const agg = derived.reduce((a, d) => {
    a.onBooks += d.forecast?.onBooks || 0; a.proj += d.forecast?.projection || 0;
    a.goal += d.goal || 0; a.frac = d.forecast?.fracElapsed ?? a.frac; a.label = d.currentMonth?.label || a.label;
    return a;
  }, { onBooks: 0, proj: 0, goal: 0, frac: 0, label: "" });
  const toGoal = agg.goal ? agg.proj / agg.goal : null;
  return (
    <Panel title="Month-end forecast (run-rate)">
      <div className="ui" style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>{agg.label} · {(agg.frac * 100).toFixed(0)}% of month elapsed</div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        <div><div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700 }}>On the books</div><div style={{ fontFamily: "Georgia,serif", fontSize: 25, fontWeight: 700 }}>{fmtMoney(agg.onBooks)}</div></div>
        <div><div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700 }}>Projected month-end</div><div style={{ fontFamily: "Georgia,serif", fontSize: 25, fontWeight: 700, color: "#14274d" }}>{fmtMoney(agg.proj)}</div></div>
        {agg.goal > 0 && <div><div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700 }}>vs Goal</div><div style={{ fontFamily: "Georgia,serif", fontSize: 25, fontWeight: 700, color: toGoal >= 1 ? C.good : C.bad }}>{fmtPct(toGoal)}</div></div>}
      </div>
      <div className="ui" style={{ fontSize: 11, color: C.faint, marginTop: 10 }}>Projection blends on-the-books with run-rate; most accurate once the month is underway and with daily pacing data.</div>
    </Panel>
  );
}

/* ---------------- LEADERBOARD ---------------- */
function Leaderboard({ derived }) {
  const [metric, setMetric] = useState("revpar");
  const rows = derived.map((d) => {
    const py = d.priorY != null ? d.yoy.find((y) => y.month === d.latest?.monthName)?.[d.priorY] : null;
    const yoy = py ? delta(d.latest?.revenue, py) : null;
    const goalAtt = d.goal ? (d.currentMonth?.revenue || 0) / d.goal : null;
    return { name: d.meta.short, color: d.meta.color, revpar: d.latest?.revpar ?? null, yoy, goal: goalAtt };
  }).filter((r) => r[metric] != null).sort((a, b) => (b[metric] || -1) - (a[metric] || -1));
  const fmt = (v) => metric === "revpar" ? fmtMoney(v) : fmtPct(v);
  const max = Math.max(...rows.map((r) => Math.abs(r[metric] || 0)), 1);
  return (
    <Panel title="Leaderboard" right={
      <select value={metric} onChange={(e) => setMetric(e.target.value)} className="ui" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.border}` }}>
        <option value="revpar">RevPAR</option><option value="yoy">YoY growth</option><option value="goal">Goal attainment</option>
      </select>}>
      {!rows.length ? <Empty text="Load data to rank properties." /> : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={r.name} className="ui" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 18, fontWeight: 700, color: C.faint, fontSize: 13 }}>{i + 1}</span>
              <span style={{ width: 9, height: 9, borderRadius: 9, background: r.color }} />
              <span style={{ width: 86, fontSize: 13, fontWeight: 600 }}>{r.name}</span>
              <div style={{ flex: 1, background: C.track, borderRadius: 5, height: 8 }}>
                <div style={{ width: `${Math.max(3, (Math.abs(r[metric] || 0) / max) * 100)}%`, height: "100%", borderRadius: 5, background: r.color }} />
              </div>
              <span style={{ width: 64, textAlign: "right", fontSize: 13, fontWeight: 700 }}>{fmt(r[metric])}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- CHANNEL OVER TIME + NET-OF-FEE ---------------- */
function ChannelOverTime({ derived }) {
  const [net, setNet] = useState(false);
  const monthly = {};
  derived.forEach((d) => {
    Object.entries(d.otaByMonth || {}).forEach(([m, chans]) => {
      const row = (monthly[m] = monthly[m] || {});
      Object.entries(chans).forEach(([c, v]) => { row[c] = (row[c] || 0) + (net ? v * (1 - (CHANNEL_FEES[c] ?? 0.12)) : v); });
    });
  });
  const months = Object.keys(monthly).sort();
  const data = months.map((m) => { const [y, mo] = m.split("-").map(Number); return { label: `${MONTHS[mo - 1]} '${String(y).slice(2)}`, ...monthly[m] }; });
  const present = STANDARD_CHANNELS.filter((c) => data.some((d) => d[c]));
  return (
    <Panel title="Channel contribution over time" right={
      <button className="ui" onClick={() => setNet(!net)} style={{ fontSize: 12, padding: "5px 11px", borderRadius: 7, border: `1px solid ${C.border}`, background: net ? "#14274d" : "#fff", color: net ? "#fff" : C.sub, cursor: "pointer", fontWeight: 600 }}>
        {net ? "Net of fees" : "Gross"}
      </button>}>
      {!data.length ? <Empty text="Load channel-level data (your Channel Production export) to see this." /> : (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
            <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {present.map((c) => <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={OTA_COLORS[c]} fill={OTA_COLORS[c]} fillOpacity={0.55} />)}
          </AreaChart>
        </ResponsiveContainer>
      )}
      {net && <div className="ui" style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>Net applies assumed commissions: Airbnb 15%, Booking.com 15%, Expedia 17%, Vrbo 8%, Direct 0%.</div>}
    </Panel>
  );
}

/* ---------------- HEALTH SCORES ---------------- */
function HealthBoard({ derived, goto }) {
  const scored = derived.map((d) => ({ d, h: healthScore(d) })).filter((x) => x.h).sort((a, b) => a.h.score - b.h.score);
  const ring = (score, color) => {
    const c = score >= 70 ? C.good : score >= 45 ? "#b7791f" : C.bad;
    return (
      <svg width="54" height="54" viewBox="0 0 54 54">
        <circle cx="27" cy="27" r="22" fill="none" stroke={C.track} strokeWidth="6" />
        <circle cx="27" cy="27" r="22" fill="none" stroke={c} strokeWidth="6" strokeDasharray={`${(score / 100) * 138} 138`} strokeLinecap="round" transform="rotate(-90 27 27)" />
        <text x="27" y="32" textAnchor="middle" fontSize="15" fontWeight="700" fill={C.ink} fontFamily="Georgia,serif">{score}</text>
      </svg>
    );
  };
  return (
    <Panel title="Property health — composite score (occupancy · goal · YoY · pace)">
      {!scored.length ? <Empty text="Load data to score properties." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 12 }}>
          {scored.map(({ d, h }) => (
            <div key={d.pid} onClick={() => goto && goto(d.pid)} className="ui" style={{ cursor: goto ? "pointer" : "default", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 11, background: "#f8f9fb", border: `1px solid ${C.track}`, borderLeft: `4px solid ${d.meta.color}` }}>
              {ring(h.score, d.meta.color)}
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{d.meta.short}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{h.score >= 70 ? "Healthy" : h.score >= 45 ? "Watch" : "Needs attention"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- ACTIVITY FEED ---------------- */
function ActivityFeed({ model, propIds }) {
  const items = (model.activity || []).filter((a) => !propIds || !a.pid || propIds.includes(a.pid)).slice(0, 12);
  return (
    <Panel title="Recent activity">
      {!items.length ? <Empty text="Changes show here after each upload." /> : (
        <div style={{ display: "grid", gap: 9 }}>
          {items.map((a, i) => (
            <div key={i} className="ui" style={{ display: "flex", gap: 9, fontSize: 12.5, color: C.sub, borderBottom: `1px solid ${C.track}`, paddingBottom: 8 }}>
              <Activity size={14} style={{ color: a.pid ? PROP_BY_ID[a.pid]?.color : C.faint, flexShrink: 0, marginTop: 2 }} />
              <div><div>{a.text}</div><div style={{ fontSize: 10.5, color: C.faint }}>{new Date(a.ts).toLocaleString()}</div></div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------------- GOAL TRACKER ---------------- */
function GoalTracker({ d, model, setModel }) {
  const goal = d.goal || 0;
  const rev = d.currentMonth?.revenue || 0;
  const pct = goal ? rev / goal : null;
  const frac = d.forecast?.fracElapsed || 0;
  const onTrack = pct != null ? pct >= frac : null;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(goal);
  const save = () => { const n = Number(val) || 0; setModel((m) => ({ ...m, goals: { ...(m.goals || {}), [d.pid]: n } })); setEditing(false); };
  return (
    <Panel title={`Monthly goal — ${d.currentMonth?.label || ""}`} right={
      editing
        ? <span className="ui" style={{ display: "flex", gap: 6 }}><input value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 90, fontSize: 12, padding: "4px 7px", borderRadius: 6, border: `1px solid ${C.border}` }} /><button onClick={save} style={{ ...btnSm, padding: "5px 10px" }}>Save</button></span>
        : <button className="ui" onClick={() => { setVal(goal); setEditing(true); }} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", color: C.sub, cursor: "pointer" }}>Edit goal</button>
    }>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 30, fontWeight: 700, color: d.meta.color }}>{fmtMoney(rev)}</div>
        <div className="ui" style={{ color: C.muted, fontSize: 14 }}>of {fmtMoney(goal)} goal</div>
        {pct != null && <div className="ui" style={{ marginLeft: "auto", fontWeight: 700, fontSize: 18, color: pct >= 1 ? C.good : C.ink }}>{fmtPct(pct)}</div>}
      </div>
      <div style={{ background: C.track, borderRadius: 8, height: 14, marginTop: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, (pct || 0) * 100)}%`, height: "100%", background: d.meta.color, borderRadius: 8 }} />
        <div title="Today's pace marker" style={{ position: "absolute", left: `${Math.min(100, frac * 100)}%`, top: -3, bottom: -3, width: 2, background: C.ink }} />
      </div>
      {onTrack != null && (
        <div className="ui" style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: onTrack ? C.good : C.bad }}>
          {onTrack ? "On pace" : "Behind pace"} — {fmtPct(pct)} of goal with {(frac * 100).toFixed(0)}% of the month elapsed
          {!onTrack && goal ? `. Need ${fmtMoney(goal - rev)} more.` : "."}
        </div>
      )}
    </Panel>
  );
}


/* ---------------- PROPERTY PAGE ---------------- */
function PropertyPage({ pid, model, setModel }) {
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
      <KpiRow k={buildKpi(d)} accent={meta.color} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <GoalTracker d={d} model={model} setModel={setModel} />
        <ForecastPanel derived={[d]} />
      </div>
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
      <div style={{ marginTop: 16 }}><PacePanel derived={[d]} title="Pace & pickup" /></div>
      <div style={{ marginTop: 16 }}><ChannelOverTime derived={[d]} /></div>
      {deriveAds(model, pid) && <div style={{ marginTop: 16 }}><AdPanel ads={deriveAds(model, pid)} color={meta.color} /></div>}
      <div style={{ marginTop: 16 }}><YoyReport d={d} /></div>
      <div style={{ marginTop: 16 }}><PropertyAdvisor d={d} /></div>
    </div>
  );
}

/* ---------------- HISTORICAL MONTHLY REPORT (YoY) ---------------- */
function YoyReport({ d }) {
  const cur = d.curY, prior = d.priorY;
  if (cur == null) return null;
  const pctd = (x, y) => (x != null && y != null && y !== 0) ? (x - y) / y : null;
  const monthRows = MONTHS.map((mn, i) => ({ mn, a: d.byYear[cur]?.[i] || null, b: prior != null ? (d.byYear[prior]?.[i] || null) : null })).filter((r) => r.a || r.b);
  if (!monthRows.length) return null;
  const totA = monthRows.reduce((s, r) => s + (r.a?.revenue || 0), 0);
  const totB = monthRows.reduce((s, r) => s + (r.b?.revenue || 0), 0);
  const dCell = (x, y) => { const p = pctd(x, y); return p == null ? <span style={{ color: C.faint }}>—</span> : <span style={{ color: p >= 0 ? C.good : C.bad, fontWeight: 600 }}>{p >= 0 ? "+" : ""}{(p * 100).toFixed(0)}%</span>; };
  const m$ = (v) => v != null ? fmtMoney(v) : "—";
  const pc = (v) => v != null ? fmtPct(v) : "—";
  return (
    <Panel title="Historical monthly report — year over year" right={prior != null ? <span className="ui" style={{ fontSize: 12.5, color: C.muted }}>{cur} vs {prior}</span> : null}>
      {prior == null && <div className="ui" style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>No prior-year data on file yet, so this shows {cur} actuals. Once a file with last-year columns is uploaded, the comparison fills in automatically.</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
          <thead>
            <tr style={{ color: C.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: .3, textAlign: "right" }}>
              <th style={{ padding: "7px 9px", textAlign: "left", borderBottom: `2px solid ${C.border}` }}>Month</th>
              <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>Rev {cur}</th>
              {prior != null && <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>Rev {prior}</th>}
              {prior != null && <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>Δ</th>}
              <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>Occ {cur}</th>
              {prior != null && <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>Occ {prior}</th>}
              <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>ADR {cur}</th>
              {prior != null && <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>ADR {prior}</th>}
              <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>RevPAR {cur}</th>
              {prior != null && <th style={{ padding: "7px 9px", borderBottom: `2px solid ${C.border}` }}>RevPAR {prior}</th>}
            </tr>
          </thead>
          <tbody>
            {monthRows.map((r) => (
              <tr key={r.mn} style={{ borderBottom: `1px solid ${C.track}`, textAlign: "right" }}>
                <td style={{ padding: "6px 9px", textAlign: "left", fontWeight: 600 }}>{r.mn}</td>
                <td style={{ padding: "6px 9px" }}>{m$(r.a?.revenue)}</td>
                {prior != null && <td style={{ padding: "6px 9px", color: C.muted }}>{m$(r.b?.revenue)}</td>}
                {prior != null && <td style={{ padding: "6px 9px" }}>{dCell(r.a?.revenue, r.b?.revenue)}</td>}
                <td style={{ padding: "6px 9px" }}>{pc(r.a?.occ)}</td>
                {prior != null && <td style={{ padding: "6px 9px", color: C.muted }}>{pc(r.b?.occ)}</td>}
                <td style={{ padding: "6px 9px" }}>{m$(r.a?.adr)}</td>
                {prior != null && <td style={{ padding: "6px 9px", color: C.muted }}>{m$(r.b?.adr)}</td>}
                <td style={{ padding: "6px 9px" }}>{m$(r.a?.revpar)}</td>
                {prior != null && <td style={{ padding: "6px 9px", color: C.muted }}>{m$(r.b?.revpar)}</td>}
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${C.border}`, textAlign: "right", fontWeight: 700 }}>
              <td style={{ padding: "8px 9px", textAlign: "left" }}>Total</td>
              <td style={{ padding: "8px 9px" }}>{fmtMoney(totA)}</td>
              {prior != null && <td style={{ padding: "8px 9px", color: C.muted }}>{fmtMoney(totB)}</td>}
              {prior != null && <td style={{ padding: "8px 9px" }}>{dCell(totA, totB)}</td>}
              <td colSpan={prior != null ? 6 : 3} />
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------------- AD PERFORMANCE ---------------- */
const roasColor = (r) => r == null ? "#94a3b8" : r < 2 ? "#c0392b" : r < 8 ? "#b7791f" : "#1f7a4d";
function AdPanel({ ads, color }) {
  const b = ads.blended;
  return (
    <Panel title="Ad performance — Expedia & Booking.com" right={b.roas != null ? <span className="ui" style={{ fontSize: 13, fontWeight: 700, color: roasColor(b.roas) }}>{b.roas.toFixed(1)}:1 blended ROAS</span> : null}>
      <div style={{ display: "flex", gap: 22, marginBottom: 14, flexWrap: "wrap" }}>
        <Mini label="Total ad spend" val={fmtMoney(b.spend)} />
        <Mini label="Ad-attributed revenue" val={fmtMoney(b.revenue)} />
        <div><div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .4 }}>Blended ROAS</div><div style={{ fontFamily: "Georgia,serif", fontSize: 18, fontWeight: 700, color: roasColor(b.roas) }}>{b.roas != null ? `${b.roas.toFixed(1)}:1` : "—"}</div></div>
      </div>
      {ads.channels.map((c) => (
        <div key={c.channel} style={{ marginBottom: 16 }}>
          <div className="ui" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: C.ink, fontSize: 13.5, marginBottom: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: OTA_COLORS[c.channel] || OTA_COLORS.Other }} />{c.channel}
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: roasColor(c.total.roas), fontWeight: 700 }}>{c.total.roas != null ? `${c.total.roas.toFixed(1)}:1` : "—"}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ color: C.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: .3, textAlign: "right" }}>
                  <th style={{ padding: "6px 9px", textAlign: "left", borderBottom: `2px solid ${C.border}` }}>Month</th>
                  <th style={{ padding: "6px 9px", borderBottom: `2px solid ${C.border}` }}>Spend</th>
                  <th style={{ padding: "6px 9px", borderBottom: `2px solid ${C.border}` }}>Revenue</th>
                  <th style={{ padding: "6px 9px", borderBottom: `2px solid ${C.border}` }}>Bookings</th>
                  <th style={{ padding: "6px 9px", borderBottom: `2px solid ${C.border}` }}>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {c.months.map((m) => (
                  <tr key={m.key} style={{ borderBottom: `1px solid ${C.track}`, textAlign: "right" }}>
                    <td style={{ padding: "6px 9px", textAlign: "left", fontWeight: 600 }}>{m.label}</td>
                    <td style={{ padding: "6px 9px" }}>{fmtMoney(m.spend)}</td>
                    <td style={{ padding: "6px 9px" }}>{fmtMoney(m.revenue)}</td>
                    <td style={{ padding: "6px 9px", color: C.muted }}>{m.bookings || 0}</td>
                    <td style={{ padding: "6px 9px", fontWeight: 700, color: roasColor(m.roas) }}>{m.roas != null ? `${m.roas.toFixed(1)}:1` : "—"}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${C.border}`, textAlign: "right", fontWeight: 700 }}>
                  <td style={{ padding: "7px 9px", textAlign: "left" }}>Total</td>
                  <td style={{ padding: "7px 9px" }}>{fmtMoney(c.total.spend)}</td>
                  <td style={{ padding: "7px 9px" }}>{fmtMoney(c.total.revenue)}</td>
                  <td style={{ padding: "7px 9px", color: C.muted }}>{c.total.bookings || 0}</td>
                  <td style={{ padding: "7px 9px", color: roasColor(c.total.roas) }}>{c.total.roas != null ? `${c.total.roas.toFixed(1)}:1` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="ui" style={{ fontSize: 11.5, color: C.muted, display: "flex", gap: 14, flexWrap: "wrap", marginTop: 2 }}>
        <span><span style={{ color: roasColor(1) }}>●</span> below 2:1 break-even</span>
        <span><span style={{ color: roasColor(4) }}>●</span> 2–8:1 (above break-even, below 8:1 floor)</span>
        <span><span style={{ color: roasColor(10) }}>●</span> 8:1+ (target 10–12:1)</span>
      </div>
    </Panel>
  );
}
function AdPage({ model }) {
  const withAds = PROPERTIES.filter((p) => model.ads && model.ads[p.id] && Object.keys(model.ads[p.id]).length);
  return (
    <div>
      <SectionTitle sub="Expedia TravelAds & Booking.com ad spend, revenue, and ROAS by property">Ad Performance</SectionTitle>
      {!withAds.length ? (
        <Panel title="No ad data yet"><Empty text="Upload an Expedia TravelAds report (daily) or a Booking.com campaign report (name the file with the month, e.g. Bookingcom_SOMA_2026-06.csv). Property and channel are detected automatically." /></Panel>
      ) : withAds.map((p) => (
        <div key={p.id} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 10px" }}>
            <span style={{ width: 13, height: 13, borderRadius: 4, background: p.color }} />
            <span style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 700 }}>{p.name}</span>
          </div>
          <AdPanel ads={deriveAds(model, p.id)} color={p.color} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- DAILY FOCUS ---------------- */
function DailyFocus({ model, propIds }) {
  const [txt, setTxt] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const out = await callClaude({
        system: "You are the revenue strategist inside Christian's SHP hotel/STR dashboard. Be concrete and operational. Prioritize pricing moves and revenue generation, and reducing OTA dependency in favor of direct bookings. No fluff.",
        messages: [{ role: "user", content: `Today is ${new Date().toDateString()}. Here is the current portfolio data:\n\n${snapshotForAI(model, propIds)}\n\nGive me TODAY'S FOCUS: the 3 highest-leverage actions to take right now to drive revenue — naming specific properties and whether it's a pricing move, an occupancy push, or an OTA→direct play. Keep each to one tight sentence. Format as 3 numbered lines.` }],
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
function Alerts({ model, propIds }) {
  const alerts = useMemo(() => {
    const out = [];
    const list = propIds && propIds.length ? PROPERTIES.filter((p) => propIds.includes(p.id)) : PROPERTIES;
    list.forEach((p) => {
      const d = deriveProperty(p.id, model); if (!d || !d.latest) return;
      const L = d.latest;
      if (L.occ != null && L.occ < 0.45) out.push({ sev: L.occ < 0.25 ? "high" : "med", prop: p, kind: "Low occupancy", detail: `${fmtPct(L.occ)} in ${L.label} — below 45% target.` });
      if (d.prev && L.occ != null && d.prev.occ != null) { const dd = delta(L.occ, d.prev.occ); if (dd != null && dd < -0.15) out.push({ sev: "med", prop: p, kind: "Occupancy dropping", detail: `down ${(dd * 100).toFixed(0)}% MoM.` }); }
      if (d.prev && L.adr != null && d.prev.adr != null) { const dd = delta(L.adr, d.prev.adr); if (dd != null && dd < -0.12) out.push({ sev: "med", prop: p, kind: "Rate softening", detail: `ADR down ${(dd * 100).toFixed(0)}% MoM to ${fmtMoney(L.adr)}.` }); }
      if (d.priorY != null) { const py = d.yoy.find((y) => y.month === L.monthName)?.[d.priorY]; const dd = delta(L.revenue, py); if (dd != null && dd < -0.2) out.push({ sev: "high", prop: p, kind: "Revenue below last year", detail: `${L.monthName} rev down ${(dd * 100).toFixed(0)}% YoY.` }); }
    });
    return out.sort((a, b) => (a.sev === "high" ? -1 : 1));
  }, [model, (propIds || []).join()]);
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
      const today = new Date(); const end = new Date(today.getTime() + 90 * 86400000);
      const out = await callClaude({
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
        system: "You are a research assistant for a hotel revenue manager. Search the web for real, specific, dated events. Output ONLY a single JSON object — no prose, no markdown fences, no citations text.",
        messages: [{ role: "user", content: `Search the web for notable events between ${today.toISOString().slice(0, 10)} and ${end.toISOString().slice(0, 10)} that drive hotel/short-term-rental demand in these two markets:\n(A) Fort Worth, TX — TCU sports, Dickies Arena concerts/events, Will Rogers Memorial Center, Fort Worth Convention Center, Stockyards events.\n(B) Arlington, TX — AT&T Stadium (Cowboys, concerts, FIFA World Cup 2026 matches), Globe Life Field (Texas Rangers home games), UT Arlington, Arlington Convention Center, Six Flags events.\nReturn ONLY this JSON shape and nothing else:\n{"events":[{"date":"YYYY-MM-DD","name":"...","venue":"...","market":"Fort Worth","impact":"high"}]}\nUse market exactly "Fort Worth" or "Arlington". Use impact "high" for stadium/arena-scale events, "med" for mid-size, "low" for minor. Sort by date. Include at least 8 events per market if available.` }],
        max_tokens: 4096,
      });
      const parsed = JSON.parse(extractJson(out));
      const events = (parsed.events || []).filter((e) => e && e.name && e.date);
      if (!events.length) throw new Error("No events came back — try again.");
      setModel((mod) => ({ ...mod, events, eventsSource: "ai", lastUpdated: new Date().toISOString() }));
    } catch (e) { setErr("Couldn't pull events: " + (e.message || "unknown error") + ". You can also upload a calendar file."); }
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
function AuditPage({ model, setModel }) {
  const [openProp, setOpenProp] = useState(null);
  const derived = useMemo(() => PROPERTIES.map((p) => deriveProperty(p.id, model)).filter(Boolean), [model]);
  const year = new Date().getFullYear();

  const clearProp = (pid) => {
    if (!window.confirm(`Delete ALL stored data for ${PROP_BY_ID[pid]?.name}? The months stay listed so you can re-upload files or type correct numbers in.`)) return;
    setModel((m) => {
      const next = JSON.parse(JSON.stringify(m));
      next.properties[pid] = { monthly: {}, ota: {}, otaByMonth: {}, snapshot: null, pace: null, wc: {} };
      next.lastUpdated = new Date().toISOString();
      return next;
    });
  };

  const setCell = (pid, monthKey, field, raw) => {
    setModel((m) => {
      const next = JSON.parse(JSON.stringify(m));
      const p = (next.properties[pid] = next.properties[pid] || { monthly: {}, ota: {}, otaByMonth: {}, snapshot: null });
      const cur = (p.monthly[monthKey] = p.monthly[monthKey] || { revenue: 0, nights: 0 });
      const [y, mo] = monthKey.split("-").map(Number);
      const days = daysInMonth(y, mo - 1); const units = PROP_BY_ID[pid].units;
      const val = raw === "" ? null : Number(String(raw).replace(/[$,%\s]/g, ""));
      if (field === "revenue") { cur.revenue = val || 0; delete cur.adr; delete cur.revpar; }
      if (field === "occ") { const occ = val == null ? null : (val > 1.5 ? val / 100 : val); cur.occ = occ; cur.nights = occ != null ? Math.round(occ * units * days) : 0; delete cur.adr; delete cur.revpar; }
      next.lastUpdated = new Date().toISOString();
      return next;
    });
  };

  if (!derived.length) {
    return (<><SectionTitle sub="Inspect and edit every number">Data Audit</SectionTitle><Panel title="No data"><Empty text="Upload data first (or just open a property below and type the numbers in)." /></Panel></>);
  }

  return (
    <div>
      <SectionTitle sub="Trace every KPI to its inputs — and edit any number directly">Data Audit</SectionTitle>

      <Panel title="Edit mode" style={{ marginBottom: 16 }}>
        <div className="ui" style={{ fontSize: 13.5, lineHeight: 1.7, color: C.sub }}>
          Type a new <b>Revenue</b> or <b>Occupancy %</b> in any cell below and press Enter (or click away) — it saves instantly and recalculates ADR, RevPAR, goals, forecasts, and the charts everywhere. Use this to correct a wrong figure or fill in a month before presenting. ADR and RevPAR are computed for you. All 12 months of {year} are listed for each property so you can fill any gap.
        </div>
      </Panel>

      {derived.map((d) => {
        const isOpen = openProp === d.pid;
        const existing = d.series.map((s) => s.key);
        const monthKeys = [...new Set([...existing, ...Array.from({ length: 12 }, (_, i) => mkey(year, i))])].sort();
        return (
          <div key={d.pid} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 12, borderLeft: `4px solid ${d.meta.color}`, overflow: "hidden" }}>
            <div className="ui" onClick={() => setOpenProp(isOpen ? null : d.pid)} style={{ cursor: "pointer", padding: "14px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 11, height: 11, borderRadius: 11, background: d.meta.color }} />
              <span style={{ fontWeight: 700, color: C.ink }}>{d.meta.name}</span>
              <span style={{ fontSize: 12.5, color: C.muted }}>· {d.meta.units} units · {year} YTD {fmtMoney(d.ytd)}</span>
              <ChevronRight size={17} style={{ marginLeft: "auto", color: C.faint, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
            </div>
            {isOpen && (
              <div style={{ padding: "0 18px 18px" }}>
                <div className="ui" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button onClick={() => clearProp(d.pid)} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 7, border: "1px solid #f2cccc", background: "#fdf3f3", color: C.bad, cursor: "pointer", fontWeight: 600 }}>
                    Clear all data for this property
                  </button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: .4 }}>
                        {["Month", "Revenue (edit)", "Occupancy % (edit)", "Nights", "ADR", "RevPAR"].map((h) => (
                          <th key={h} style={{ padding: "8px 10px", borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {monthKeys.map((key) => {
                        const [y, mo] = key.split("-").map(Number);
                        const days = daysInMonth(y, mo - 1); const avail = d.meta.units * days;
                        const dd = d.raw.monthly[key] || {};
                        const rev = dd.revenue || 0;
                        const occ = dd.occ != null ? dd.occ : (dd.nights ? Math.min(1, dd.nights / avail) : null);
                        const nights = dd.nights != null ? dd.nights : (occ != null ? Math.round(occ * avail) : null);
                        const adr = dd.adr != null ? dd.adr : (nights ? rev / nights : null);
                        const revpar = dd.revpar != null ? dd.revpar : (avail ? rev / avail : null);
                        return (
                          <tr key={key} style={{ borderBottom: `1px solid ${C.track}` }}>
                            <td style={{ padding: "6px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{MONTHS[mo - 1]} {y}</td>
                            <td style={{ padding: "6px 10px" }}><EditNum value={rev || ""} prefix="$" onCommit={(v) => setCell(d.pid, key, "revenue", v)} /></td>
                            <td style={{ padding: "6px 10px" }}><EditNum value={occ != null ? (occ * 100).toFixed(1) : ""} suffix="%" width={70} onCommit={(v) => setCell(d.pid, key, "occ", v)} /></td>
                            <td style={{ padding: "6px 10px", color: C.muted }}>{nights != null ? nights : "—"}</td>
                            <td style={{ padding: "6px 10px" }}>{fmtMoney(adr)}</td>
                            <td style={{ padding: "6px 10px" }}>{fmtMoney(revpar)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {d.ota?.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="ui" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: .4, color: C.muted, marginBottom: 6 }}>Channel revenue on file</div>
                    <div className="ui" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {d.ota.sort((a, b) => b.value - a.value).map((o) => (
                        <span key={o.name} style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 8, background: "#f4f6f8", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: OTA_COLORS[o.name] || OTA_COLORS.Other }} />{o.name}: {fmtMoney(o.value)}
                        </span>
                      ))}
                    </div>
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
function EditNum({ value, onCommit, prefix, suffix, width = 95 }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {prefix && <span style={{ color: C.muted, fontSize: 12 }}>{prefix}</span>}
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="—" style={{ width, fontSize: 13, padding: "5px 7px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff" }} />
      {suffix && <span style={{ color: C.muted, fontSize: 12 }}>{suffix}</span>}
    </span>
  );
}

/* ---------------- SALES PIPELINE (group/corporate CRM) ---------------- */
const DEAL_STAGES = [
  { id: "lead", label: "Lead", color: "#8ea0b8" },
  { id: "proposal", label: "Proposal", color: "#3b7dd8" },
  { id: "contract", label: "Contract Out", color: "#e07b1f" },
  { id: "won", label: "Won", color: "#1f7a4d" },
  { id: "lost", label: "Lost", color: "#cf3a3a" },
];
function SalesPipeline({ model, setModel }) {
  const deals = model.deals || [];
  const [adding, setAdding] = useState(false);
  const blank = { id: "", company: "", contact: "", property: "soma", value: "", nights: "", stage: "lead", arrival: "", notes: "" };
  const [form, setForm] = useState(blank);

  const upsert = (deal) => setModel((m) => {
    const list = m.deals || [];
    const exists = list.some((x) => x.id === deal.id);
    const next = exists ? list.map((x) => (x.id === deal.id ? deal : x)) : [...list, deal];
    return { ...m, deals: next };
  });
  const removeDeal = (id) => setModel((m) => ({ ...m, deals: (m.deals || []).filter((x) => x.id !== id) }));
  const move = (deal, stage) => upsert({ ...deal, stage, ...(stage === "won" ? { wonAt: new Date().toISOString() } : {}) });
  const submit = () => {
    if (!form.company) return;
    const d = { ...form, id: form.id || "d" + Date.now(), value: Number(form.value) || 0, nights: Number(form.nights) || 0, createdAt: form.createdAt || new Date().toISOString() };
    upsert(d); setForm(blank); setAdding(false);
  };

  // funnel metrics
  const open = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const decided = won.length + lost.length;
  const winRate = decided ? won.length / decided : null;
  const avgWon = won.length ? won.reduce((a, d) => a + (d.value || 0), 0) / won.length : null;
  const pipelineValue = open.reduce((a, d) => a + (d.value || 0), 0);
  const wonValue = won.reduce((a, d) => a + (d.value || 0), 0);
  const ttc = (() => {
    const days = won.filter((d) => d.wonAt && d.createdAt).map((d) => (new Date(d.wonAt) - new Date(d.createdAt)) / 86400000);
    return days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
  })();

  const field = (k, label, props = {}) => (
    <label className="ui" style={{ fontSize: 11.5, color: C.muted, display: "block" }}>{label}
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props}
        style={{ width: "100%", marginTop: 3, fontSize: 13, padding: "7px 9px", borderRadius: 7, border: `1px solid ${C.border}`, boxSizing: "border-box" }} />
    </label>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <div><h1 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 700, margin: 0 }}>Sales Pipeline</h1>
          <div className="ui" style={{ color: C.muted, fontSize: 13.5 }}>Group, corporate & convention bookings across the portfolio</div></div>
        <button className="ui" onClick={() => { setForm(blank); setAdding(true); }} style={{ ...btnSm, marginLeft: "auto" }}><Plus size={14} /> New deal</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, margin: "16px 0" }}>
        <FunnelStat label="Open pipeline" value={fmtMoney(pipelineValue)} sub={`${open.length} active deals`} />
        <FunnelStat label="Won (booked)" value={fmtMoney(wonValue)} sub={`${won.length} deals`} good />
        <FunnelStat label="Win rate" value={winRate != null ? fmtPct(winRate) : "—"} sub={decided ? `${won.length}/${decided} decided` : "no closed deals"} />
        <FunnelStat label="Avg deal size" value={avgWon != null ? fmtMoney(avgWon) : "—"} sub="won deals" />
        <FunnelStat label="Avg time to close" value={ttc != null ? ttc + " days" : "—"} sub="lead → won" />
      </div>

      {adding && (
        <Panel title={form.id ? "Edit deal" : "New deal"} style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {field("company", "Company / group")}
            {field("contact", "Contact")}
            <label className="ui" style={{ fontSize: 11.5, color: C.muted, display: "block" }}>Property
              <select value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value })} style={{ width: "100%", marginTop: 3, fontSize: 13, padding: "7px 9px", borderRadius: 7, border: `1px solid ${C.border}` }}>
                {PROPERTIES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {field("value", "Est. value ($)", { type: "number" })}
            {field("nights", "Room nights", { type: "number" })}
            {field("arrival", "Arrival date", { type: "date" })}
            <label className="ui" style={{ fontSize: 11.5, color: C.muted, display: "block" }}>Stage
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} style={{ width: "100%", marginTop: 3, fontSize: 13, padding: "7px 9px", borderRadius: 7, border: `1px solid ${C.border}` }}>
                {DEAL_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <div style={{ gridColumn: "span 2" }}>{field("notes", "Notes")}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={submit} style={btnSm}>Save deal</button>
            <button onClick={() => setAdding(false)} className="ui" style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer" }}>Cancel</button>
          </div>
        </Panel>
      )}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${DEAL_STAGES.length},1fr)`, gap: 10, alignItems: "start" }}>
        {DEAL_STAGES.map((stage) => {
          const col = deals.filter((d) => d.stage === stage.id);
          const sum = col.reduce((a, d) => a + (d.value || 0), 0);
          return (
            <div key={stage.id} style={{ background: "#f4f5f7", borderRadius: 12, padding: 10, minHeight: 120 }}>
              <div className="ui" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: stage.color }} />
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>{stage.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>{col.length} · {fmtMoney(sum)}</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {col.map((d) => (
                  <div key={d.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 9, padding: 10, borderLeft: `3px solid ${PROP_BY_ID[d.property]?.color || C.muted}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{d.company}</span>
                      <span className="ui" style={{ display: "flex", gap: 4 }}>
                        <button title="Edit" onClick={() => { setForm({ ...blank, ...d, value: String(d.value || ""), nights: String(d.nights || "") }); setAdding(true); }} style={iconBtn}>✎</button>
                        <button title="Delete" onClick={() => removeDeal(d.id)} style={iconBtn}>×</button>
                      </span>
                    </div>
                    <div className="ui" style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{PROP_BY_ID[d.property]?.short}{d.contact ? " · " + d.contact : ""}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12 }}>
                      <span style={{ fontWeight: 700 }}>{fmtMoney(d.value)}</span>
                      {d.nights ? <span style={{ color: C.muted }}>{d.nights} nts</span> : null}
                    </div>
                    {d.arrival && <div className="ui" style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>Arrives {d.arrival}</div>}
                    <select value={d.stage} onChange={(e) => move(d, e.target.value)} className="ui" style={{ width: "100%", marginTop: 7, fontSize: 11, padding: "4px 6px", borderRadius: 6, border: `1px solid ${C.border}`, color: C.sub }}>
                      {DEAL_STAGES.map((s) => <option key={s.id} value={s.id}>Move to: {s.label}</option>)}
                    </select>
                  </div>
                ))}
                {!col.length && <div className="ui" style={{ fontSize: 11, color: C.faint, textAlign: "center", padding: "10px 0" }}>—</div>}
              </div>
            </div>
          );
        })}
      </div>
      {!deals.length && <div className="ui" style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 20 }}>No deals yet. Click "New deal" to start tracking group & corporate leads.</div>}
    </div>
  );
}
const iconBtn = { background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: "#94a3b8", lineHeight: 1, padding: "0 2px" };
function FunnelStat({ label, value, sub, good }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
      <div className="ui" style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: .3, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: "Georgia,serif", fontSize: 22, fontWeight: 700, marginTop: 6, color: good ? C.good : C.ink }}>{value}</div>
      {sub && <div className="ui" style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ---------------- SLACK DIGEST ---------------- */
function SlackDigest({ model, propIds }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const text = await callClaude({
        system: "You write concise daily revenue digests for a hotel/STR ops team. Plain text, Slack-friendly, with a few bullet lines. No preamble.",
        messages: [{ role: "user", content: `Write a short Slack digest for ${new Date().toDateString()} from this data:\n\n${snapshotForAI(model, propIds)}\n\nInclude: portfolio revenue on the books this month, the standout property, and one action. Keep under 120 words.` }],
        max_tokens: 500,
      });
      const res = await fetch("/api/slack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Slack not configured"); }
      setMsg({ ok: true, text: "Digest sent to Slack." });
    } catch (e) { setMsg({ ok: false, text: e.message === "Slack not configured" ? "Add SLACK_WEBHOOK_URL in Vercel to enable this." : "Couldn't send — check the webhook setup." }); }
    setBusy(false);
  };
  return (
    <Panel title="Slack digest" right={<button className="ui" onClick={send} disabled={busy} style={btnSm}>{busy ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />} Send now</button>}>
      <div className="ui" style={{ fontSize: 13, color: C.sub }}>Push a one-tap summary of today's numbers to your team's Slack channel.</div>
      {msg && <div className="ui" style={{ marginTop: 8, fontSize: 12.5, color: msg.ok ? C.good : C.bad }}>{msg.text}</div>}
    </Panel>
  );
}

/* ---------------- WORLD CUP ---------------- */
const WC_SCOPES = [{ id: "all", label: "Portfolio" }, { id: "fortworth", label: "Fort Worth" }, { id: "arlington", label: "Arlington" }];
function wcHeat(occ) {
  if (occ == null) return "#ffffff";
  const t = Math.max(0, Math.min(1, occ));
  const r = Math.round(243 + (23 - 243) * t), g = Math.round(246 + (58 - 246) * t), b = Math.round(250 + (104 - 250) * t);
  return `rgb(${r},${g},${b})`;
}
function scopeBtn(active, color) {
  return { background: active ? color : "#fff", color: active ? "#fff" : C.sub, border: `1px solid ${active ? color : C.border}`, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
}
function WorldCupPage({ model, onUpload }) {
  const [scope, setScope] = useState("all");
  const propIds = useMemo(() => {
    if (scope === "all") return PROPERTIES.map((p) => p.id);
    if (scope === "fortworth" || scope === "arlington") return PROPS_IN(scope).map((p) => p.id);
    return [scope];
  }, [scope]);
  const wc = useMemo(() => deriveWorldCup(model, propIds), [model, propIds.join()]);
  const accent = PROP_BY_ID[scope] ? PROP_BY_ID[scope].color : "#f0b21b";

  const cards = [
    { label: "World Cup Revenue", icon: <DollarSign size={15} />, val: fmtMoney(wc.totals.revenue) },
    { label: "World Cup Occupancy %", icon: <Percent size={15} />, val: fmtPct(wc.totals.occ) },
    { label: "World Cup ADR", icon: <BedDouble size={15} />, val: fmtMoney(wc.totals.adr) },
    { label: "World Cup RevPAR", icon: <Gauge size={15} />, val: fmtMoney(wc.totals.revpar) },
  ];

  const weeks = useMemo(() => {
    const first = new Date(WC_START + "T00:00");
    const lead = first.getDay();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    wc.byDate.forEach((d) => cells.push(d));
    while (cells.length % 7 !== 0) cells.push(null);
    const wk = []; for (let i = 0; i < cells.length; i += 7) wk.push(cells.slice(i, i + 7));
    return wk;
  }, [wc]);

  const flags = wc.byDate.filter((d) => d.match && d.occ != null && d.occ < 0.7 && d.units > 0).sort((a, b) => (a.occ || 0) - (b.occ || 0));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <Trophy size={26} style={{ color: "#f0b21b" }} />
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, margin: 0 }}>World Cup 2026</h1>
      </div>
      <div className="ui" style={{ color: C.muted, fontSize: 13.5, marginBottom: 16 }}>June 12 – July 15 · AT&T Stadium (Arlington) hosts 9 matches incl. the July 14 semifinal</div>

      <div className="ui" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        {WC_SCOPES.map((s) => <button key={s.id} onClick={() => setScope(s.id)} style={scopeBtn(scope === s.id, "#f0b21b")}>{s.label}</button>)}
        <span style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
        {PROPERTIES.map((p) => <button key={p.id} onClick={() => setScope(p.id)} style={scopeBtn(scope === p.id, p.color)}>{p.short}</button>)}
      </div>

      {!wc.has && (
        <div className="ui" onClick={onUpload} style={{ cursor: "pointer", border: `2px dashed ${C.borderStrong}`, borderRadius: 16, padding: "40px 24px", textAlign: "center", background: "#fafbfc", marginBottom: 20 }}>
          <Upload size={24} style={{ color: C.muted }} />
          <div style={{ fontWeight: 600, marginTop: 8, color: C.ink }}>Upload your World Cup KPI file</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 3 }}>A file named with "World Cup" containing a per-date sheet — it auto-loads here.</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", borderTop: `3px solid ${accent}` }}>
            <div className="ui" style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 11, fontWeight: 700, letterSpacing: .3, textTransform: "uppercase" }}>
              <span style={{ color: accent }}>{c.icon}</span>{c.label}
            </div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 27, fontWeight: 700, marginTop: 7, color: C.ink }}>{c.val}</div>
          </div>
        ))}
      </div>

      {wc.matchOcc != null && wc.nonMatchOcc != null && (
        <div className="ui" style={{ marginTop: 12, fontSize: 13, color: C.sub, background: "#fffaf0", border: "1px solid #f3e2bf", borderRadius: 10, padding: "9px 14px" }}>
          Match-day occupancy <b>{fmtPct(wc.matchOcc)}</b> vs. non-match-day <b>{fmtPct(wc.nonMatchOcc)}</b>
          {wc.nonMatchOcc > 0 && <> — a {((wc.matchOcc / wc.nonMatchOcc - 1) * 100).toFixed(0)}% lift on game days.</>}
        </div>
      )}

      <Panel title="Demand calendar — occupancy heat & match days" style={{ marginTop: 16 }}>
        <div className="ui" style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textAlign: "center", textTransform: "uppercase", letterSpacing: .5, paddingBottom: 2 }}>{d}</div>
          ))}
          {weeks.flat().map((cell, i) => {
            if (!cell) return <div key={i} />;
            const d = new Date(cell.date + "T00:00");
            const dark = (cell.occ || 0) > 0.55;
            return (
              <div key={i} title={`${cell.date}: ${fmtPct(cell.occ)} occ, ${fmtMoney(cell.revenue)}`}
                style={{ background: wcHeat(cell.occ), border: `1px solid ${cell.match ? WC_TIER_COLOR[cell.match.tier] : C.border}`, borderRadius: 9, padding: "6px 7px", minHeight: 80, position: "relative" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: dark ? "#fff" : C.ink }}>{d.getDate()}</div>
                {cell.match && (
                  <div style={{ fontSize: 8.5, fontWeight: 700, color: "#fff", background: WC_TIER_COLOR[cell.match.tier], borderRadius: 5, padding: "1px 4px", marginTop: 2, lineHeight: 1.25 }}>
                    {cell.match.tier === 4 ? "★ " : "⚽ "}{cell.match.teams}
                  </div>
                )}
                <div style={{ position: "absolute", bottom: 5, left: 7, right: 7 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: dark ? "#fff" : C.ink }}>{cell.occ != null ? (cell.occ * 100).toFixed(0) + "%" : "—"}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: dark ? "#fff" : C.ink }}>{cell.revenue ? fmtMoney(cell.revenue) : ""}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ui" style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: C.muted, flexWrap: "wrap" }}>
          <span>Shade = occupancy</span>
          {[[1, "Group (TBD)"], [3, "Marquee group"], [2, "Knockout"], [4, "Semifinal"]].map(([t, l]) => (
            <span key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: WC_TIER_COLOR[t] }} />{l}</span>
          ))}
        </div>
      </Panel>

      <Panel title="Daily revenue across the window" style={{ marginTop: 16 }}>
        {wc.has ? (
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={wc.byDate.map((d) => ({ label: d.date.slice(5), revenue: d.revenue, m: !!d.match }))} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.track} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
              <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
                {wc.byDate.map((d, i) => <Cell key={i} fill={d.match ? WC_TIER_COLOR[d.match.tier] : "#c9d0da"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty text="Upload World Cup data to see daily revenue." />}
      </Panel>

      <Panel title="Match schedule — occupancy & revenue per game date" style={{ marginTop: 16 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="ui" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: .4 }}>
                {["Date", "Match", "Round", "Occupancy", "Revenue", "ADR"].map((h) => <th key={h} style={{ padding: "8px 10px", borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {WORLD_CUP_MATCHES.map((m) => {
                const day = wc.byDate.find((d) => d.date === m.date);
                return (
                  <tr key={m.date} style={{ borderBottom: `1px solid ${C.track}` }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{new Date(m.date + "T00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</td>
                    <td style={{ padding: "8px 10px" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: WC_TIER_COLOR[m.tier], marginRight: 7 }} />{m.teams}</td>
                    <td style={{ padding: "8px 10px", color: C.muted }}>{m.round}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{fmtPct(day?.occ)}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtMoney(day?.revenue)}</td>
                    <td style={{ padding: "8px 10px" }}>{fmtMoney(day?.adr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {flags.length > 0 && (
        <Panel title="Pricing opportunities — match days still under 70% booked" style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gap: 8 }}>
            {flags.map((d) => (
              <div key={d.date} className="ui" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 10, background: "#fffaf0", border: "1px solid #f3e2bf" }}>
                <Target size={16} style={{ color: "#b7791f", flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{d.match.teams}</span>
                <span style={{ fontSize: 13, color: C.sub }}>· {new Date(d.date + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} — only {fmtPct(d.occ)} booked at {fmtMoney(d.adr)} ADR. Demand is here; push rate or fill.</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
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

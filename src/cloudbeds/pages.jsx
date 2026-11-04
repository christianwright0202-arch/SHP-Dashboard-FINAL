// Cloudbeds analysis pages: Game Day, Event Calendar, Pace, Cancellations.
// All behind the CLOUDBEDS_ENABLED flag (wired in App.jsx). They read reservations from the shared
// store (Supabase in prod, in-app upload locally) and the verified event dataset.

import React, { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Cell } from "recharts";
import { useCloudbedsData, cloudbedsConfigured } from "./dataStore.js";
import {
  occupancyByMonth, adr, cancellationStats, alos, leadTimeStats, channelMix,
  paceVsSTLY, pickup, onTheBooks, eventLift, ymKey,
} from "./kpis.js";
import { EVENTS } from "../events/eventsData.js";
import { buildEventIndex, eventsOnDate, PROPERTY_MARKET } from "../events/eventModel.js";
import {
  T, fmtMoney, fmtPct, fmtNum, SectionTitle, Panel, Metric, MetricRow, FilterBar,
  rangeBounds, Empty, impactColor,
} from "./ui.jsx";

const TODAY = "2026-11-04";
const MARKET_OF = { "Hotel SOMA": "Fort Worth", "The Rambler Inn": "Arlington" };

export const CLOUDBEDS_NAV = [
  { id: "cb:gameday", label: "Game Day" },
  { id: "cb:calendar", label: "Event Calendar" },
  { id: "cb:pace", label: "Pace" },
  { id: "cb:cancellations", label: "Cancellations" },
];

function applyFilters(reservations, filters) {
  const { from, to } = rangeBounds(filters.range, new Date(TODAY));
  return reservations.filter((r) => {
    if (filters.property !== "ALL" && r.property !== filters.property) return false;
    if (from && (!r.checkIn || r.checkIn < from)) return false;
    if (to && (!r.checkIn || r.checkIn > to)) return false;
    return true;
  });
}

function filteredEvents(filters) {
  const { from, to } = rangeBounds(filters.range, new Date(TODAY));
  return EVENTS.filter((e) => {
    if (filters.property !== "ALL" && e.market !== MARKET_OF[filters.property]) return false;
    if (filters.confirmedOnly && !e.confirmed) return false;
    if (from && e.date < from) return false;
    if (to && (e.endDate || e.date) > to) return false;
    return true;
  });
}

function NeedData({ store }) {
  if (store.loading) return <Empty text="Loading reservations…" />;
  if (store.error) return <Empty text={`Couldn't load reservations: ${store.error}`} />;
  return (
    <Empty text={cloudbedsConfigured()
      ? "No Cloudbeds reservations yet. Upload an export with “Upload Cloudbeds reservations”, or run npm run ingest:cloudbeds."
      : "No Cloudbeds data in this session. Click “Upload Cloudbeds reservations” at the top to load an export."} />
  );
}

/* ---------------- EVENT CALENDAR ---------------- */
function EventCalendarPage({ filters, store }) {
  const events = filteredEvents(filters);
  const res = applyFilters(store.reservations, { ...filters, range: "all" });
  // base ADR per property for lift comparison
  const baseAdr = useMemo(() => ({
    "Hotel SOMA": eventLift(res, EVENTS, { property: "Hotel SOMA" }).baseAdr,
    "The Rambler Inn": eventLift(res, EVENTS, { property: "The Rambler Inn" }).baseAdr,
  }), [store.reservations, filters.property]);
  const index = useMemo(() => buildEventIndex(EVENTS), []);

  const rows = events.map((ev) => {
    const prop = ev.market === "Fort Worth" ? "Hotel SOMA" : "The Rambler Inn";
    const dates = []; let d = new Date(ev.date + "T00:00"); const end = new Date((ev.endDate || ev.date) + "T00:00");
    for (; d <= end; d.setDate(d.getDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    let rev = 0, n = 0;
    for (const r of store.reservations) {
      if (r.property !== prop || r.isCancelled || r.isNoShow || !r.adrEligible || !r.checkIn || !r.nights) continue;
      const s = new Date(r.checkIn + "T00:00");
      for (let i = 0; i < r.nights; i++) { const dd = new Date(s); dd.setDate(dd.getDate() + i); if (dates.includes(dd.toISOString().slice(0, 10))) { rev += (r.accommodationTotal / r.nights) / (r.roomsCount || 1); n++; } }
    }
    const obsAdr = n >= 3 ? rev / n : null;
    const base = baseAdr[prop];
    const lift = (obsAdr != null && base) ? (obsAdr - base) / base : null;
    return { ev, obsAdr, n, lift };
  });

  return (
    <div>
      <SectionTitle sub="Verified demand calendar — dates checked against official sources, with the ADR your rooms actually captured on each event">Event Calendar</SectionTitle>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>{events.length} events{filters.confirmedOnly ? " (confirmed only)" : ""}. “Captured ADR” is the ADR-eligible nightly rate your rooms earned on those dates; lift is vs the property’s non-event average.</div>
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(({ ev, obsAdr, n, lift }, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, borderLeft: `4px solid ${impactColor(ev.impact)}` }}>
            <div style={{ width: 92, flexShrink: 0, fontSize: 12, fontWeight: 700, color: T.sub }}>
              {new Date(ev.date + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
              {ev.endDate && ev.endDate !== ev.date ? "–" + new Date(ev.endDate + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: T.ink }}>{ev.name} {!ev.confirmed && <span style={{ fontSize: 10, color: T.warn, border: `1px solid ${T.warn}`, borderRadius: 5, padding: "0 4px", marginLeft: 4 }}>unconfirmed</span>}</div>
              <div style={{ fontSize: 11.5, color: T.muted }}>{ev.venue} · {ev.market}</div>
            </div>
            {obsAdr != null && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{fmtMoney(obsAdr)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: lift >= 0 ? T.good : T.bad }}>{lift >= 0 ? "+" : ""}{fmtPct(lift, 0)} <span style={{ color: T.faint, fontWeight: 400 }}>({n}n)</span></div>
              </div>
            )}
            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: impactColor(ev.impact), border: `1px solid ${impactColor(ev.impact)}`, borderRadius: 6, padding: "2px 7px" }}>{ev.impact}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- GAME DAY ---------------- */
function GameDayPage({ filters, store }) {
  const upcoming = filteredEvents({ ...filters, range: "all" })
    .filter((e) => (e.endDate || e.date) >= TODAY && e.impact !== "low")
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 24);
  const hasData = store.reservations.length > 0;

  const rows = upcoming.map((ev) => {
    const prop = ev.market === "Fort Worth" ? "Hotel SOMA" : "The Rambler Inn";
    const ym = ymKey(ev.date);
    const pace = hasData ? paceVsSTLY(store.reservations, { property: prop, targetYm: ym, asOf: TODAY.replace(/(\d{4})-(\d{2})-(\d{2})/, "$2/$3/$1") }) : null;
    const pk = hasData ? pickup(store.reservations, { property: prop, targetYm: ym, fromAsOf: shiftIso(TODAY, -30), toAsOf: TODAY }) : null;
    return { ev, prop, pace, pk };
  });

  return (
    <div>
      <SectionTitle sub="Upcoming demand events and how your booking pace into them compares to the same point last year">Game Day</SectionTitle>
      {!hasData && <div style={{ marginBottom: 12 }}><NeedData store={store} /></div>}
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map(({ ev, prop, pace, pk }, i) => (
          <Panel key={i} style={{ borderLeft: `4px solid ${impactColor(ev.impact)}` }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: T.ink }}>{ev.name}</div>
                <div style={{ fontSize: 12, color: T.muted }}>{new Date(ev.date + "T00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })} · {ev.venue} · {prop}</div>
              </div>
              {pace && (
                <>
                  <Mini label={`On the books (${ev.date.slice(0, 7)})`} value={fmtNum(pace.current)} sub="room-nights" />
                  <Mini label="vs last year" value={`${pace.diff >= 0 ? "+" : ""}${fmtNum(pace.diff)}`} sub={pace.pct != null ? `${pace.pct >= 0 ? "+" : ""}${fmtPct(pace.pct, 0)}` : "—"} tone={pace.diff >= 0 ? "good" : "bad"} />
                  <Mini label="Pickup 30d" value={`${pk.pickupRoomNights >= 0 ? "+" : ""}${fmtNum(pk.pickupRoomNights)}`} sub="room-nights" />
                </>
              )}
            </div>
          </Panel>
        ))}
        {!upcoming.length && <Empty text="No upcoming events in this market/range." />}
      </div>
    </div>
  );
}

const Mini = ({ label, value, sub, tone }) => (
  <div style={{ flex: "0 0 auto", minWidth: 110 }}>
    <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: tone === "good" ? T.good : tone === "bad" ? T.bad : T.ink }}>{value}</div>
    {sub && <div style={{ fontSize: 10.5, color: T.faint }}>{sub}</div>}
  </div>
);

const shiftIso = (iso, days) => { const d = new Date(iso + "T00:00"); d.setDate(d.getDate() + days); return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`; };

/* ---------------- PACE ---------------- */
function PacePage({ filters, store }) {
  const prop = filters.property === "ALL" ? "The Rambler Inn" : filters.property;
  const months = useMemo(() => {
    const set = new Set();
    for (const r of store.reservations) if (r.property === prop && r.checkIn) set.add(r.checkIn.slice(0, 7));
    return [...set].sort();
  }, [store.reservations, prop]);
  const future = months.filter((m) => m >= TODAY.slice(0, 7));
  const [target, setTarget] = useState(null);
  const ym = target || future[0] || months[months.length - 1];

  if (!store.reservations.length) return (<div><SectionTitle sub="Booking pace vs same-time-last-year">Pace</SectionTitle><NeedData store={store} /></div>);

  const asOf = TODAY.replace(/(\d{4})-(\d{2})-(\d{2})/, "$2/$3/$1");
  const pace = ym ? paceVsSTLY(store.reservations, { property: prop, targetYm: ym, asOf }) : null;
  const pk = ym ? pickup(store.reservations, { property: prop, targetYm: ym, fromAsOf: shiftIso(TODAY, -30), toAsOf: TODAY }) : null;
  // booking curve: cumulative room-nights for this target month by lead-time bucket
  const curve = ym ? buildBookingCurve(store.reservations, prop, ym) : [];

  return (
    <div>
      <SectionTitle sub="Booking pace into a target month vs the same point last year (STLY)">Pace — {prop.replace("The ", "")}</SectionTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: T.muted }}>Target month:</span>
        <select value={ym || ""} onChange={(e) => setTarget(e.target.value)} style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}` }}>
          {months.map((m) => <option key={m} value={m}>{new Date(m + "-01T00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>)}
        </select>
      </div>
      {pace && (
        <>
          <MetricRow>
            <Metric label="On the books" value={fmtNum(pace.current)} sub="room-nights" formula="Room-nights for the target month from reservations booked on or before today (cancellations excluded)." />
            <Metric label="Same time last yr" value={fmtNum(pace.stly)} sub="room-nights" formula="Same measure one year earlier: target month −12 months, as-of date −12 months." />
            <Metric label="Pace vs STLY" value={`${pace.diff >= 0 ? "+" : ""}${fmtNum(pace.diff)}`} sub={pace.pct != null ? fmtPct(pace.pct, 0) : "—"} tone={pace.diff >= 0 ? "good" : "bad"} formula="On the books minus same-time-last-year room-nights." />
            <Metric label="Pickup (30 days)" value={`${pk.pickupRoomNights >= 0 ? "+" : ""}${fmtNum(pk.pickupRoomNights)}`} sub="room-nights added" formula="Change in on-the-books for this month over the last 30 days." />
          </MetricRow>
          <Panel title="Booking curve — how this month filled by lead time">
            {curve.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={curve} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.track} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: T.muted }} />
                  <YAxis tick={{ fontSize: 11, fill: T.muted }} />
                  <Tooltip formatter={(v) => [fmtNum(v), "room-nights booked"]} />
                  <Line type="monotone" dataKey="cumulative" stroke={T.accent} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty text="No bookings for this month yet." />}
          </Panel>
        </>
      )}
    </div>
  );
}

function buildBookingCurve(reservations, property, targetYm) {
  // bucket room-nights by booking lead time (days before check-in), then show cumulative as lead shrinks
  const buckets = [180, 120, 90, 60, 45, 30, 21, 14, 7, 3, 0];
  const counts = new Array(buckets.length).fill(0);
  for (const r of reservations) {
    if (r.property !== property || r.isCancelled || r.isNoShow || !r.checkIn) continue;
    const s = new Date(r.checkIn + "T00:00");
    let nAhead = 0;
    for (let i = 0; i < (r.nights || 0); i++) { const d = new Date(s); d.setDate(d.getDate() + i); if (d.toISOString().slice(0, 7) === targetYm) nAhead += (r.roomsCount || 1); }
    if (!nAhead || r.leadTimeDays == null) continue;
    let bi = buckets.findIndex((b) => r.leadTimeDays >= b);
    if (bi < 0) bi = buckets.length - 1;
    counts[bi] += nAhead;
  }
  let cum = 0;
  return buckets.map((b, i) => { cum += counts[i]; return { bucket: b === 0 ? "0d" : `${b}d`, cumulative: cum }; });
}

/* ---------------- CANCELLATIONS ---------------- */
function CancellationsPage({ filters, store }) {
  const res = applyFilters(store.reservations, filters);
  if (!store.reservations.length) return (<div><SectionTitle sub="Cancellation and no-show behavior">Cancellations</SectionTitle><NeedData store={store} /></div>);

  const s = cancellationStats(res);
  const byMonth = useMemo(() => {
    const m = {};
    for (const r of res) { if (!r.checkIn) continue; const k = r.checkIn.slice(0, 7); (m[k] = m[k] || { total: 0, cancelled: 0 }); m[k].total++; if (r.isCancelled) m[k].cancelled++; }
    return Object.entries(m).sort().map(([ym, v]) => ({ ym: ym.slice(2), rate: v.total ? v.cancelled / v.total : 0, cancelled: v.cancelled }));
  }, [store.reservations, filters.property, filters.range]);
  const byChannel = useMemo(() => {
    const m = {};
    for (const r of res) { const k = r.channel || "Other"; (m[k] = m[k] || { total: 0, cancelled: 0 }); m[k].total++; if (r.isCancelled) m[k].cancelled++; }
    return Object.entries(m).map(([ch, v]) => ({ ch, rate: v.total ? v.cancelled / v.total : 0, total: v.total })).sort((a, b) => b.rate - a.rate);
  }, [store.reservations, filters.property, filters.range]);
  const timing = useMemo(() => {
    const b = { "0-1d": 0, "2-7d": 0, "8-30d": 0, "31-90d": 0, "90d+": 0 };
    for (const r of res) { if (!r.isCancelled || r.cancelDaysBeforeArrival == null) continue; const v = r.cancelDaysBeforeArrival; b[v <= 1 ? "0-1d" : v <= 7 ? "2-7d" : v <= 30 ? "8-30d" : v <= 90 ? "31-90d" : "90d+"]++; }
    return Object.entries(b).map(([bucket, n]) => ({ bucket, n }));
  }, [store.reservations, filters.property, filters.range]);

  return (
    <div>
      <SectionTitle sub="How often bookings cancel or no-show, when, and through which channel">Cancellations</SectionTitle>
      <MetricRow>
        <Metric label="Cancellation rate" value={fmtPct(s.cancellationRate)} sub={`${s.cancelled} of ${s.total}`} tone={s.cancellationRate > 0.2 ? "bad" : undefined} formula="Cancelled reservations ÷ total reservations in range." />
        <Metric label="No-show rate" value={fmtPct(s.noShowRate)} sub={`${s.noShow} of ${s.total}`} formula="No-show reservations ÷ total reservations in range." />
        <Metric label="Lost room-nights" value={fmtNum(s.lostRoomNights)} sub="cancelled + no-show" formula="Nights × rooms for every cancelled or no-show reservation." />
        <Metric label="ALOS (stayed)" value={alos(res)?.toFixed(2) ?? "—"} sub="nights / stay" formula="Average nights per stayed reservation (cancellations excluded)." />
      </MetricRow>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Panel title="Cancellation rate by check-in month">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={byMonth} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.track} />
              <XAxis dataKey="ym" tick={{ fontSize: 10, fill: T.muted }} />
              <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: T.muted }} />
              <Tooltip formatter={(v) => fmtPct(v)} />
              <Bar dataKey="rate" fill={T.slate} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Cancellation rate by channel">
          <div style={{ display: "grid", gap: 7 }}>
            {byChannel.map((c) => (
              <div key={c.ch} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 92, fontSize: 12, color: T.sub }}>{c.ch}</div>
                <div style={{ flex: 1, background: T.track, borderRadius: 5, height: 16, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, c.rate * 100)}%`, background: c.rate > 0.25 ? T.bad : T.slate, height: "100%" }} />
                </div>
                <div style={{ width: 70, textAlign: "right", fontSize: 12, fontWeight: 600 }}>{fmtPct(c.rate)} <span style={{ color: T.faint, fontWeight: 400 }}>({c.total})</span></div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="When cancellations happen (before arrival)">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={timing} margin={{ top: 8, right: 10, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.track} />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: T.muted }} />
              <YAxis tick={{ fontSize: 11, fill: T.muted }} />
              <Tooltip formatter={(v) => [fmtNum(v), "cancellations"]} />
              <Bar dataKey="n" fill={T.warn} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------- DISPATCHER ---------------- */
const DEFAULT_FILTERS = { property: "ALL", range: "all", includeExcluded: false, confirmedOnly: false };

export function CloudbedsPage({ page }) {
  const store = useCloudbedsData();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const show = page === "cb:calendar" ? { confirmedToggle: true } : page === "cb:cancellations" ? { adrToggle: false } : {};
  return (
    <div>
      <FilterBar filters={filters} setFilters={setFilters} show={show} />
      {page === "cb:gameday" && <GameDayPage filters={filters} store={store} />}
      {page === "cb:calendar" && <EventCalendarPage filters={filters} store={store} />}
      {page === "cb:pace" && <PacePage filters={filters} store={store} />}
      {page === "cb:cancellations" && <CancellationsPage filters={filters} store={store} />}
    </div>
  );
}

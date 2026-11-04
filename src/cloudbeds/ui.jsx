// Shared UI for the Cloudbeds analysis pages: filter bar, metric tiles with formula tooltips,
// section headers, formatting. Light theme consistent with the rest of the dashboard. Mobile-friendly
// (flex-wrap + min-width:0 so tiles/charts reflow on a phone).

import React, { useState } from "react";

export const T = {
  ink: "#0f172a", sub: "#334155", muted: "#64748b", faint: "#94a3b8",
  border: "#e2e8f0", track: "#eef2f7", panel: "#ffffff", bg: "#f6f8fb",
  slate: "#243244", good: "#15803d", bad: "#b91c1c", warn: "#b45309", accent: "#2563eb",
};

export const fmtMoney = (v, c = false) => v == null || isNaN(v) ? "—" : c
  ? (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`)
  : `$${Math.round(v).toLocaleString()}`;
export const fmtPct = (v, d = 1) => v == null || isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`;
export const fmtNum = (v) => v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString();

export function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: T.ink, margin: 0, fontFamily: "Georgia, serif" }}>{children}</h1>
      {sub && <div style={{ fontSize: 13.5, color: T.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, children, right, style }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: "16px 18px", ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          {title && <div style={{ fontWeight: 700, color: T.ink, fontSize: 14.5 }}>{title}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Metric tile with an ⓘ that reveals the formula on hover/tap. */
export function Metric({ label, value, formula, sub, tone }) {
  const [open, setOpen] = useState(false);
  const color = tone === "good" ? T.good : tone === "bad" ? T.bad : T.ink;
  return (
    <div style={{ flex: "1 1 150px", minWidth: 140, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10.5, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{label}</span>
        {formula && (
          <span onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((o) => !o)}
            style={{ cursor: "help", width: 14, height: 14, borderRadius: 7, border: `1px solid ${T.faint}`, color: T.faint, fontSize: 9.5, lineHeight: "12px", textAlign: "center", userSelect: "none" }}>i</span>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>{sub}</div>}
      {open && formula && (
        <div style={{ position: "absolute", top: "100%", left: 10, zIndex: 20, marginTop: 4, width: 220, background: T.ink, color: "#fff", fontSize: 11.5, lineHeight: 1.5, padding: "8px 10px", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}>{formula}</div>
      )}
    </div>
  );
}

export const MetricRow = ({ children }) => <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>{children}</div>;

export const PROPERTIES = ["ALL", "Hotel SOMA", "The Rambler Inn"];
export const RANGES = [
  { id: "all", label: "All dates" },
  { id: "2025", label: "2025" },
  { id: "2026", label: "2026" },
  { id: "last90", label: "Last 90 days" },
  { id: "next90", label: "Next 90 days" },
];

/** Resolve a range preset to {from,to} ISO (inclusive), relative to `today`. */
export function rangeBounds(id, today = new Date()) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (id === "2025") return { from: "2025-01-01", to: "2025-12-31" };
  if (id === "2026") return { from: "2026-01-01", to: "2026-12-31" };
  if (id === "last90") return { from: iso(new Date(today.getTime() - 90 * 86400000)), to: iso(today) };
  if (id === "next90") return { from: iso(today), to: iso(new Date(today.getTime() + 90 * 86400000)) };
  return { from: null, to: null };
}

const chip = (active) => ({
  fontSize: 12, padding: "5px 11px", borderRadius: 8, cursor: "pointer", fontWeight: 600,
  border: `1px solid ${active ? T.slate : T.border}`, background: active ? T.slate : "#fff", color: active ? "#fff" : T.sub,
});

/** Global filter bar shared by every Cloudbeds page. `filters` + `setFilters` are owned by the dispatcher. */
export function FilterBar({ filters, setFilters, show = {} }) {
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {PROPERTIES.map((p) => <span key={p} onClick={() => set({ property: p })} style={chip(filters.property === p)}>{p === "ALL" ? "Both" : p.replace("The ", "")}</span>)}
      </div>
      <div style={{ width: 1, height: 20, background: T.border }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {RANGES.map((r) => <span key={r.id} onClick={() => set({ range: r.id })} style={chip(filters.range === r.id)}>{r.label}</span>)}
      </div>
      {show.adrToggle && (
        <>
          <div style={{ width: 1, height: 20, background: T.border }} />
          <span onClick={() => set({ includeExcluded: !filters.includeExcluded })} style={chip(filters.includeExcluded)} title="Include Extended Stay 30+ and Friends & Family in ADR">
            {filters.includeExcluded ? "ADR: all rates" : "ADR: excl. LOS/F&F"}
          </span>
        </>
      )}
      {show.confirmedToggle && (
        <span onClick={() => set({ confirmedOnly: !filters.confirmedOnly })} style={chip(filters.confirmedOnly)} title="Hide events sourced only from ticket aggregators">
          {filters.confirmedOnly ? "Confirmed only" : "All events"}
        </span>
      )}
    </div>
  );
}

export function Empty({ text }) {
  return <div style={{ color: T.muted, fontSize: 13.5, padding: "28px 8px", textAlign: "center" }}>{text}</div>;
}

export const impactColor = (i) => (i === "high" ? T.bad : i === "low" ? T.faint : T.warn);

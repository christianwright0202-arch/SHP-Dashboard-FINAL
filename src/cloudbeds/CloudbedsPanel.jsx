// In-app "Upload Cloudbeds reservations" button + the Data Audit quality report.
// Self-contained so App.jsx only imports two components and places them (a few lines), per the
// "don't grow App.jsx" rule. Entirely separate from the Hostfully ingestSheet path.

import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { parseCloudbedsRows, toDbRow } from "./parseCloudbeds.js";
import { setCloudbedsData } from "./dataStore.js";

const REPORT_KEY = "cloudbeds_last_report";
const TABLE = "cloudbeds_reservations";

// The columns that identify a Cloudbeds reservations export (vs a Hostfully/RevPAR sheet).
const SIGNATURE = ["Property", "Check in Date", "Accommodation Total", "Reservation Date", "Source", "Guest Status"];

const supa = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

const readReport = () => { try { return JSON.parse(localStorage.getItem(REPORT_KEY) || "null"); } catch { return null; } };
const saveReport = (r) => { try { localStorage.setItem(REPORT_KEY, JSON.stringify(r)); } catch {} };

function looksLikeCloudbeds(headers) {
  const set = new Set(headers.map((h) => String(h).trim().toLowerCase()));
  return SIGNATURE.filter((s) => set.has(s.toLowerCase())).length >= 5;
}

export function CloudbedsUploadButton({ canEdit = true }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { kind: "ok"|"warn"|"err", msg }
  const inputRef = React.useRef(null);

  async function handleFile(file) {
    setBusy(true); setStatus({ kind: "info", msg: `Reading ${file.name}…` });
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
      if (!looksLikeCloudbeds(headers)) {
        setStatus({ kind: "err", msg: "This doesn't look like a Cloudbeds reservations export (missing expected columns). Use the regular “Upload data” button for Hostfully/RevPAR sheets." });
        setBusy(false); return;
      }
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
      const { reservations, report } = parseCloudbedsRows(rows);
      report.uploadedAt = new Date().toISOString();
      report.fileName = file.name;
      setCloudbedsData(reservations, report); // make the analysis pages show this data immediately

      if (!supa) {
        saveReport(report);
        setStatus({ kind: "warn", msg: `Parsed ${report.kept} reservations (${report.dropped} dropped). Supabase isn't configured in this build, so nothing was saved — see the quality report on the Data Audit page.` });
        setBusy(false); return;
      }

      const dbRows = reservations.map(toDbRow);
      const BATCH = 500;
      for (let i = 0; i < dbRows.length; i += BATCH) {
        setStatus({ kind: "info", msg: `Saving ${Math.min(i + BATCH, dbRows.length)}/${dbRows.length}…` });
        const { error } = await supa.from(TABLE).upsert(dbRows.slice(i, i + BATCH), { onConflict: "property,guest_name,check_in,reservation_date" });
        if (error) throw new Error(error.message);
      }
      report.written = dbRows.length;
      saveReport(report);
      setStatus({ kind: "ok", msg: `Saved ${dbRows.length} reservations to Cloudbeds. ${report.dropped} dropped. See the Data Audit page for the full quality report.` });
    } catch (e) {
      setStatus({ kind: "err", msg: "Upload failed: " + e.message });
    }
    setBusy(false);
  }

  if (!canEdit) return null;
  const color = { ok: "#15803d", warn: "#b45309", err: "#b91c1c", info: "#475569" }[status?.kind] || "#475569";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.length) handleFile(e.target.files[0]); e.target.value = ""; }} />
      <button className="navbtn" onClick={() => inputRef.current?.click()} disabled={busy}
        style={{ background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 9, padding: "9px 14px", fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Uploading…" : "Upload Cloudbeds reservations"}
      </button>
      {status && <span style={{ fontSize: 11.5, color, maxWidth: 420 }}>{status.msg}</span>}
    </span>
  );
}

export function CloudbedsAuditReport() {
  const [report, setReport] = useState(null);
  const [liveCount, setLiveCount] = useState(null);
  useEffect(() => {
    setReport(readReport());
    if (supa) supa.from(TABLE).select("id", { count: "exact", head: true }).then(({ count }) => setLiveCount(count ?? null)).catch(() => {});
  }, []);

  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "16px 18px", marginBottom: 16 };
  const label = { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 };
  if (!report && liveCount == null) {
    return (
      <div style={card}>
        <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>Cloudbeds reservations</div>
        <div style={{ fontSize: 13, color: "#64748b" }}>No Cloudbeds export uploaded yet. Use the “Upload Cloudbeds reservations” button at the top, or run <code>npm run ingest:cloudbeds</code>.</div>
      </div>
    );
  }
  const flags = report?.flags || {};
  const stat = (k, v) => (<div><div style={label}>{k}</div><div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{v}</div></div>);
  return (
    <div style={card}>
      <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>Cloudbeds reservations — data quality</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, marginBottom: 14 }}>
        {liveCount != null && stat("In database", liveCount.toLocaleString())}
        {report && stat("Rows in file", report.rowsIn?.toLocaleString())}
        {report && stat("Kept", report.kept?.toLocaleString())}
        {report && stat("Dropped", report.dropped?.toLocaleString())}
      </div>
      {report && (
        <>
          <div style={{ ...label, marginBottom: 6 }}>Cleaned / guessed</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", marginBottom: 10 }}>
            {Object.entries(flags).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} style={{ fontSize: 11.5, background: "#f1f5f9", color: "#334155", borderRadius: 6, padding: "3px 8px" }}>{k}: <b>{v}</b></span>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
            By property: {Object.entries(report.byProperty || {}).map(([p, n]) => `${p} ${n}`).join(" · ")}
            {report.fileName ? ` · from ${report.fileName}` : ""}
            {report.uploadedAt ? ` · ${new Date(report.uploadedAt).toLocaleString()}` : ""}
          </div>
        </>
      )}
    </div>
  );
}

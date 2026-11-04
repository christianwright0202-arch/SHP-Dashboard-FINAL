// Shared reservation store for the Cloudbeds analysis pages.
// Data comes from Supabase (cloudbeds_reservations) in production, or from an in-app upload this
// session (so the pages work locally without Supabase). A tiny pub/sub keeps pages in sync.

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supa = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

export const cloudbedsConfigured = () => !!supa;

let STORE = { reservations: [], loaded: false, loading: false, source: "none", error: null, count: 0 };
const subs = new Set();
const notify = () => { for (const fn of subs) fn(STORE); };

const num = (v) => (v == null || v === "" ? null : Number(v));

/** Map a cloudbeds_reservations DB row back to the in-memory reservation shape the KPIs expect. */
export function dbRowToRes(d) {
  return {
    property: d.property, name: d.guest_name, roomNumber: d.room_number,
    accommodationTotal: num(d.accommodation_total), amountPaid: num(d.amount_paid),
    checkIn: d.check_in, checkOut: d.check_out, nights: d.nights, roomsCount: d.rooms_count || 1,
    roomType: d.room_type, rooms: null, multiRoom: d.multi_room, promoCode: d.promo_code, rawRoomType: d.raw_room_type,
    reservationDate: d.reservation_date, channel: d.channel, collectType: d.collect_type, rawSource: d.raw_source,
    status: d.status, isCancelled: d.is_cancelled, isNoShow: d.is_no_show, cancellationDate: d.cancellation_date,
    nightlyRate: num(d.nightly_rate), isRateOutlier: d.is_rate_outlier,
    isExtendedStay: d.is_extended_stay, isFriendsFamily: d.is_friends_family, adrEligible: d.adr_eligible,
    leadTimeDays: d.lead_time_days, cancelDaysBeforeArrival: d.cancel_days_before_arrival,
  };
}

/** Called by the in-app upload button so the pages show the freshly parsed data immediately. */
export function setCloudbedsData(reservations, report) {
  STORE = { reservations, loaded: true, loading: false, source: "upload", error: null, count: reservations.length, report };
  notify();
}

/** Load all reservations from Supabase, paginating past the 1000-row cap. */
export async function loadFromSupabase() {
  if (!supa) return { ok: false, reason: "not-configured" };
  STORE = { ...STORE, loading: true }; notify();
  try {
    const page = 1000; let from = 0; const all = [];
    for (;;) {
      const { data, error } = await supa.from("cloudbeds_reservations").select("*").order("check_in", { ascending: true }).range(from, from + page - 1);
      if (error) throw new Error(error.message);
      all.push(...data);
      if (data.length < page) break;
      from += page;
    }
    STORE = { reservations: all.map(dbRowToRes), loaded: true, loading: false, source: "supabase", error: null, count: all.length };
    notify();
    return { ok: true, count: all.length };
  } catch (e) {
    STORE = { ...STORE, loading: false, error: e.message };
    notify();
    return { ok: false, reason: e.message };
  }
}

/** React hook: current store, auto-loading from Supabase once if configured and nothing is loaded yet. */
export function useCloudbedsData() {
  const [s, setS] = useState(STORE);
  useEffect(() => {
    const fn = (x) => setS({ ...x });
    subs.add(fn);
    if (!STORE.loaded && !STORE.loading && supa) loadFromSupabase().catch(() => {});
    return () => subs.delete(fn);
  }, []);
  return s;
}

// Hotel KPI engine over cleaned Cloudbeds reservations. Pure functions, unit-tested.
//
//   Occupancy = occupied room-nights / available room-nights
//   ADR       = ADR-eligible room revenue / ADR-eligible room-nights   (excludes outliers, extended-stay, F&F)
//   RevPAR    = total room revenue / available room-nights             (all real revenue)
//   Pace/STLY, pickup, cancellation rate, no-show rate, lead time, ALOS, channel mix, event lift.
//
// "Room-nights" are the occupancy unit (a 2-room booking for 3 nights = 6 room-nights).

import { PROPERTY_CONFIG, expandStayNights, parseDateMDY, toISO, daysBetween } from "./parseCloudbeds.js";
import { buildEventIndex, eventsOnDate, PROPERTY_MARKET } from "../events/eventModel.js";

export const ymKey = (iso) => (iso ? iso.slice(0, 7) : null);
export const roomsFor = (property) => PROPERTY_CONFIG[property]?.rooms || null;
export const daysInMonth = (y, m1to12) => new Date(y, m1to12, 0).getDate();

const active = (r) => !r.isCancelled && !r.isNoShow; // occupied = stayed

/** Every occupied room-night across all reservations (one row per occupied room per night). */
export function allStayNights(reservations) {
  const out = [];
  for (const r of reservations) for (const sn of expandStayNights(r)) out.push(sn);
  return out;
}

const addTo = (bag, k, n = 1) => { bag[k] = (bag[k] || 0) + n; };

/** Occupancy + ADR + RevPAR per property per calendar month. */
export function occupancyByMonth(reservations, { events } = {}) {
  const nights = allStayNights(reservations);
  const index = events ? buildEventIndex(events) : null;
  const occ = {}, rev = {}, adrRev = {}, adrN = {}, evNights = {}, evRev = {};
  for (const sn of nights) {
    const ym = ymKey(sn.date);
    const k = `${sn.property}|${ym}`;
    addTo(occ, k);
    if (sn.revenue != null) addTo(rev, k, sn.revenue);
    if (sn.adrEligible && sn.revenue != null) { addTo(adrRev, k, sn.revenue); addTo(adrN, k); }
    if (index) {
      const market = PROPERTY_MARKET[sn.property];
      if (market && eventsOnDate(index, market, sn.date).length) { addTo(evNights, k); if (sn.revenue != null) addTo(evRev, k, sn.revenue); }
    }
  }
  return Object.keys(occ).map((k) => {
    const [property, ym] = k.split("|");
    const [y, m] = ym.split("-").map(Number);
    const rooms = roomsFor(property);
    const available = rooms ? rooms * daysInMonth(y, m) : null;
    const occupied = occ[k];
    return {
      property, ym, occupied, available,
      occupancy: available ? occupied / available : null,
      roomRevenue: rev[k] || 0,
      adr: adrN[k] ? adrRev[k] / adrN[k] : null,
      revpar: available ? (rev[k] || 0) / available : null,
      eventNights: evNights[k] || 0,
      eventRevenue: evRev[k] || 0,
    };
  }).sort((a, b) => a.property.localeCompare(b.property) || a.ym.localeCompare(b.ym));
}

/** Portfolio/property ADR over an arbitrary set of reservations (ADR-eligible room-nights only). */
export function adr(reservations) {
  let rev = 0, n = 0;
  for (const sn of allStayNights(reservations)) if (sn.adrEligible && sn.revenue != null) { rev += sn.revenue; n++; }
  return n ? rev / n : null;
}

/** Cancellation + no-show rates (reservation-level) and the room-nights lost to cancellation. */
export function cancellationStats(reservations, filter = () => true) {
  const rs = reservations.filter(filter);
  const total = rs.length;
  const cancelled = rs.filter((r) => r.isCancelled).length;
  const noShow = rs.filter((r) => r.isNoShow).length;
  let lostRoomNights = 0;
  for (const r of rs) if (r.isCancelled || r.isNoShow) lostRoomNights += (r.nights || 0) * (r.roomsCount || 1);
  return {
    total, cancelled, noShow,
    cancellationRate: total ? cancelled / total : null,
    noShowRate: total ? noShow / total : null,
    lostRoomNights,
  };
}

/** Average length of stay (nights) across stayed reservations. */
export function alos(reservations) {
  const rs = reservations.filter((r) => active(r) && r.nights > 0);
  if (!rs.length) return null;
  return rs.reduce((s, r) => s + r.nights, 0) / rs.length;
}

/** Booking lead time (reservation_date -> check_in), in days: average + simple buckets. */
export function leadTimeStats(reservations) {
  const vals = reservations.filter((r) => active(r) && r.leadTimeDays != null && r.leadTimeDays >= 0).map((r) => r.leadTimeDays);
  if (!vals.length) return { avg: null, median: null, buckets: {} };
  const sorted = [...vals].sort((a, b) => a - b);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const buckets = { "0-7": 0, "8-30": 0, "31-90": 0, "91-180": 0, "181+": 0 };
  for (const v of vals) buckets[v <= 7 ? "0-7" : v <= 30 ? "8-30" : v <= 90 ? "31-90" : v <= 180 ? "91-180" : "181+"]++;
  return { avg, median, count: vals.length, buckets };
}

/** Channel mix by room-nights and revenue (stayed nights). */
export function channelMix(reservations) {
  const nights = {}, rev = {};
  for (const sn of allStayNights(reservations)) { addTo(nights, sn.channel || "Other"); if (sn.revenue != null) addTo(rev, sn.channel || "Other", sn.revenue); }
  const totalN = Object.values(nights).reduce((a, b) => a + b, 0);
  return Object.keys(nights).map((ch) => ({ channel: ch, roomNights: nights[ch], revenue: rev[ch] || 0, shareNights: totalN ? nights[ch] / totalN : 0 }))
    .sort((a, b) => b.roomNights - a.roomNights);
}

/**
 * On-the-books room-nights for a target stay month, counting only reservations booked on/before `asOf`.
 * This is the building block for pace (STLY) and pickup.
 */
export function onTheBooks(reservations, { property, targetYm, asOf }) {
  const asOfD = asOf ? parseDateMDY(asOf) : null;
  let roomNights = 0, revenue = 0, bookings = 0;
  for (const r of reservations) {
    if (property && r.property !== property) continue;
    if (r.isCancelled || r.isNoShow) continue;
    if (asOfD) { const rd = parseDateMDY(r.reservationDate); if (!rd || rd > asOfD) continue; }
    // count this reservation's nights that fall within targetYm
    const start = parseDateMDY(r.checkIn); if (!start) continue;
    let nAhead = 0;
    for (let i = 0; i < (r.nights || 0); i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (ymKey(toISO(d)) === targetYm) nAhead += (r.roomsCount || 1);
    }
    if (nAhead > 0) { roomNights += nAhead; bookings++; if (r.accommodationTotal != null && r.nights) revenue += (r.accommodationTotal / r.nights) * (nAhead / (r.roomsCount || 1)); }
  }
  return { property: property || "ALL", targetYm, asOf: asOf || null, roomNights, revenue, bookings };
}

/**
 * Pace vs same-time-last-year: compares on-the-books for a target month at an as-of date against the
 * equivalent point one year earlier (target month and as-of both shifted back 12 months).
 */
export function paceVsSTLY(reservations, { property, targetYm, asOf }) {
  const shiftYm = (ym, dy) => { const [y, m] = ym.split("-").map(Number); return `${y + dy}-${String(m).padStart(2, "0")}`; };
  const shiftIso = (iso, dy) => { const d = parseDateMDY(iso); return toISO(new Date(d.getFullYear() + dy, d.getMonth(), d.getDate())); };
  const cur = onTheBooks(reservations, { property, targetYm, asOf });
  const stly = onTheBooks(reservations, { property, targetYm: shiftYm(targetYm, -1), asOf: asOf ? shiftIso(asOf, -1) : null });
  return {
    property: property || "ALL", targetYm, asOf: asOf || null,
    current: cur.roomNights, stly: stly.roomNights,
    diff: cur.roomNights - stly.roomNights,
    pct: stly.roomNights ? (cur.roomNights - stly.roomNights) / stly.roomNights : null,
    currentRevenue: cur.revenue, stlyRevenue: stly.revenue,
  };
}

/** Pickup = change in on-the-books for a target month between two as-of dates. */
export function pickup(reservations, { property, targetYm, fromAsOf, toAsOf }) {
  const a = onTheBooks(reservations, { property, targetYm, asOf: fromAsOf });
  const b = onTheBooks(reservations, { property, targetYm, asOf: toAsOf });
  return { property: property || "ALL", targetYm, fromAsOf, toAsOf, pickupRoomNights: b.roomNights - a.roomNights, pickupRevenue: b.revenue - a.revenue };
}

/**
 * Event lift: ADR and occupancy-proxy on event nights vs non-event nights for a property (or all),
 * optionally within a date range. Returns the lift ratio so you can say "event nights run +X% ADR".
 */
export function eventLift(reservations, events, { property, from, to } = {}) {
  const index = buildEventIndex(events);
  const inRange = (iso) => (!from || iso >= from) && (!to || iso <= to);
  let evRev = 0, evN = 0, baseRev = 0, baseN = 0, evAdrN = 0, evAdrRev = 0, baseAdrN = 0, baseAdrRev = 0;
  for (const sn of allStayNights(reservations)) {
    if (property && sn.property !== property) continue;
    if (!inRange(sn.date)) continue;
    const market = PROPERTY_MARKET[sn.property];
    const isEvent = market && eventsOnDate(index, market, sn.date).length > 0;
    if (isEvent) { evN++; if (sn.revenue != null) evRev += sn.revenue; if (sn.adrEligible && sn.revenue != null) { evAdrN++; evAdrRev += sn.revenue; } }
    else { baseN++; if (sn.revenue != null) baseRev += sn.revenue; if (sn.adrEligible && sn.revenue != null) { baseAdrN++; baseAdrRev += sn.revenue; } }
  }
  const evAdr = evAdrN ? evAdrRev / evAdrN : null;
  const baseAdr = baseAdrN ? baseAdrRev / baseAdrN : null;
  return {
    property: property || "ALL",
    eventNights: evN, baseNights: baseN,
    eventAdr: evAdr, baseAdr,
    adrLiftPct: (evAdr != null && baseAdr) ? (evAdr - baseAdr) / baseAdr : null,
    eventRevenue: evRev, baseRevenue: baseRev,
  };
}

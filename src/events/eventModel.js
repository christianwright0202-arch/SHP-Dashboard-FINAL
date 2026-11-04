// Event model + tagging. Pure functions shared by KPIs, the Game Day / Event Calendar / Pace pages,
// and their tests. Verified event data lives in ./eventsData.js; this file is the logic over it.
//
// Event shape: { date:"YYYY-MM-DD", endDate?:"YYYY-MM-DD", name, venue, market, category, impact, source }
//   - market is "Fort Worth" or "Arlington" (matches the existing dashboard events model)
//   - impact is "high" | "med" | "low"
//   - endDate is inclusive; omit for single-day events

import { parseDateMDY, toISO } from "../cloudbeds/parseCloudbeds.js";

// Which market each Cloudbeds property sits in (only these two properties exist in the Cloudbeds export).
export const PROPERTY_MARKET = {
  "Hotel SOMA": "Fort Worth",
  "The Rambler Inn": "Arlington",
};

const IMPACT_RANK = { high: 3, med: 2, low: 1 };
export const topImpact = (evs) => evs.reduce((best, e) => (IMPACT_RANK[e.impact] || 0) > (IMPACT_RANK[best] || 0) ? e.impact : best, null);

/** Inclusive list of ISO dates an event covers (handles multi-day events via endDate). */
export function eventDateList(ev) {
  const start = parseDateMDY(ev.date);
  if (!start) return [];
  const end = ev.endDate ? parseDateMDY(ev.endDate) : start;
  const out = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(toISO(d));
    if (out.length > 400) break; // guard against a bad endDate
  }
  return out;
}

/** Index events for O(1) lookup by "market|date". */
export function buildEventIndex(events) {
  const index = new Map();
  for (const ev of events || []) {
    for (const iso of eventDateList(ev)) {
      const key = `${ev.market}|${iso}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(ev);
    }
  }
  return index;
}

/** Events active in a market on a given ISO date. */
export function eventsOnDate(index, market, isoDate) {
  return index.get(`${market}|${isoDate}`) || [];
}

/**
 * Tag stay-night rows (from expandStayNights) with the events active that night in the property's market.
 * Adds: events (names[]), eventNames (joined), eventImpact (top), isEventNight.
 */
export function tagStayNights(stayNights, events) {
  const index = buildEventIndex(events);
  return stayNights.map((sn) => {
    const market = PROPERTY_MARKET[sn.property] || null;
    const evs = market ? eventsOnDate(index, market, sn.date) : [];
    return {
      ...sn,
      events: evs.map((e) => e.name),
      eventNames: evs.map((e) => e.name).join("; ") || null,
      eventImpact: topImpact(evs),
      isEventNight: evs.length > 0,
    };
  });
}

/**
 * Tag a reservation by whether ANY of its occupied nights fall on an event in its market, and by the
 * event nearest its check-in (useful for "which event drove this booking").
 */
export function tagReservationEvents(res, index) {
  const market = PROPERTY_MARKET[res.property] || null;
  if (!market || !res.checkIn || !res.nights) return { ...res, eventNames: null, isEventStay: false, eventImpact: null };
  const start = parseDateMDY(res.checkIn);
  const hit = new Set();
  let impact = null;
  for (let i = 0; i < res.nights; i++) {
    const d = toISO(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    for (const ev of eventsOnDate(index, market, d)) {
      hit.add(ev.name);
      if ((IMPACT_RANK[ev.impact] || 0) > (IMPACT_RANK[impact] || 0)) impact = ev.impact;
    }
  }
  return { ...res, eventNames: hit.size ? [...hit].join("; ") : null, isEventStay: hit.size > 0, eventImpact: impact };
}

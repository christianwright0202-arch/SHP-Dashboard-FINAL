// Cloudbeds reservation-level ingest — PURE functions, no DOM / no network, so the same code
// runs in the browser upload path, the Node CLI (scripts/ingest-cloudbeds.mjs), and Vitest.
// This is entirely SEPARATE from App.jsx's Hostfully `ingestSheet`; it is never imported there.

// Room inventory per property (confirm with the user before trusting occupancy denominators).
export const PROPERTY_CONFIG = {
  "Hotel SOMA": { rooms: 35 },        // 31 casitas + 4 Airstreams
  "The Rambler Inn": { rooms: 24 },
};

export const RATE_OUTLIER_HIGH = 1500;
export const RATE_OUTLIER_LOW = 25;

const SOMA_TYPES = [
  "Signature Casita with Reserved Parking", // longest first so startsWith matches before "Signature Casita"
  "Signature Casita",
  "Premium Courtyard Casita",
  "Accessible Private Casita",
  "Deluxe Vintage Airstream",
];
const RAMBLER_TYPES = [
  "Premium 2 Bedroom Suite",
  "Grand Queen Suite",
  "Signature Music Theme King Suite",
  "Signature Rangers Theme King Suite",
  "Signature Cowboys Theme King Suite", // keyword-mapped from Airbnb titles only; never appears verbatim
  "Deluxe King Suite",
];
const ALL_TYPES = [...SOMA_TYPES, ...RAMBLER_TYPES];

/** Parse a Cloudbeds "MM/DD/YYYY" string (also tolerates Date / Excel serial) → Date at local midnight, or null. */
export function parseDateMDY(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && isFinite(v)) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // our own toISO() output, parsed back as LOCAL midnight
  if (iso) { const d = new Date(+iso[1], +iso[2] - 1, +iso[3]); return isNaN(d.getTime()) ? null : d; }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  let yy = +m[3]; if (yy < 100) yy += 2000;
  const d = new Date(yy, +m[1] - 1, +m[2]);
  return isNaN(d.getTime()) ? null : d;
}

export const toISO = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;
export const daysBetween = (a, b) => (a && b) ? Math.round((b.getTime() - a.getTime()) / 86400000) : null;

const money = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return isFinite(n) ? n : null;
};

/** Nights: recompute from check-in/out (authoritative); fall back to the file's Nights only if dates are unusable. */
export function recomputeNights(checkIn, checkOut, fileNights) {
  const diff = daysBetween(checkIn, checkOut);
  if (diff != null && diff > 0) return diff;
  const fn = Number(fileNights);
  return isFinite(fn) && fn > 0 ? fn : 0;
}

// `hard` = a confident, unambiguous identity (exact canonical type or a bare room number). Only hard
// parts can prove a comma-joined string is a real multi-room booking rather than one title with commas.
function canonicalizeOne(p, property) {
  if (/^\d+$/.test(p)) return { type: "Unknown (room # only)", roomNumberOnly: true, hard: true };
  for (const c of ALL_TYPES) if (p === c) return { type: c, hard: true };
  // Airbnb-titled Rambler variants (Cloudbeds truncates these titles) → keyword map.
  if (/\b2\s*br\b|2\s*bed/i.test(p)) return { type: "Premium 2 Bedroom Suite", guessed: true };
  if (/rangers/i.test(p)) return { type: "Signature Rangers Theme King Suite", guessed: true };
  if (/music/i.test(p)) return { type: "Signature Music Theme King Suite", guessed: true };
  if (/cowboys/i.test(p)) return { type: "Signature Cowboys Theme King Suite", guessed: true };
  if (/penthouse|industrial chic|at&t|rambler inn|globe life|balcony|arlington|stadium|luxury suite|suite \|/i.test(p))
    return { type: "Deluxe King Suite", guessed: true };
  for (const c of ALL_TYPES) if (p.startsWith(c)) return { type: c };
  return { type: p || "Unknown", unmapped: true };
}

/**
 * Split promo codes / group names out of the room type, detect multi-room bookings and bare room numbers,
 * and map to a canonical type. Returns { canonicalType, rooms, promoCode, roomsCount, multiRoom, rawTitle,
 * roomNumberOnly, guessed, unmapped }.
 */
export function normalizeRoomType(raw, property) {
  const original = String(raw ?? "").trim();
  const promos = [];
  const pullPromos = (s) => { [...s.matchAll(/\(([^)]*)\)/g)].forEach((x) => { const v = x[1].trim(); if (v) promos.push(v); }); return s.replace(/\([^)]*\)/g, "").trim(); };
  if (!original) return { canonicalType: "Unknown", rooms: ["Unknown"], promoCode: null, roomsCount: 1, multiRoom: false, rawTitle: "", roomNumberOnly: false, guessed: false, unmapped: true };

  const rawParts = original.split(",").map((s) => s.trim()).filter(Boolean);
  const partCanon = rawParts.map((part) => canonicalizeOne(pullPromos(part), property));
  const hardCount = partCanon.filter((c) => c.hard).length;
  // A real multi-room booking = comma-joined parts that are each confidently identifiable (>=2 hard).
  // Anything else with commas is one Airbnb title that merely contains commas, so keep it whole.
  const isMultiRoom = rawParts.length > 1 && hardCount >= 2;

  let canon, roomsCount;
  if (isMultiRoom) {
    canon = partCanon; roomsCount = rawParts.length;
  } else {
    canon = [canonicalizeOne(pullPromos(original), property)]; roomsCount = 1;
  }
  return {
    canonicalType: canon.length > 1 ? "Multiple rooms" : canon[0].type,
    rooms: canon.map((c) => c.type),
    promoCode: promos.length ? [...new Set(promos)].join(", ") : null,
    roomsCount,
    multiRoom: canon.length > 1,
    rawTitle: original,
    roomNumberOnly: canon.every((c) => c.roomNumberOnly),
    guessed: canon.some((c) => c.guessed),
    unmapped: canon.some((c) => c.unmapped),
  };
}

/** Source string → { channel, collectType, rawSource }. */
export function mapSource(raw) {
  const s = String(raw ?? "").trim();
  const low = s.toLowerCase();
  let collectType = null;
  if (low.includes("channel collect")) collectType = "Channel Collect";
  else if (low.includes("hotel collect")) collectType = "Hotel Collect";
  const base = s.replace(/\([^)]*\)/g, "").trim();
  let channel = "Other";
  if (/website|booking engine|walk-?in|phone/i.test(base)) channel = "Direct";
  else if (/expedia/i.test(base)) channel = "Expedia";
  else if (/booking\.com/i.test(base)) channel = "Booking.com";
  else if (/airbnb/i.test(base)) channel = "Airbnb";
  else if (/vrbo|homeaway/i.test(base)) channel = "Vrbo";
  else if (/agoda|priceline/i.test(base)) channel = "Agoda/Priceline";
  else if (/extended stay/i.test(base)) channel = "Extended Stay";
  return { channel, collectType, rawSource: s };
}

/** Status + Guest Status → normalized status; REJECT guests count as Cancelled. */
export function classifyStatus(status, guestStatus) {
  const gs = String(guestStatus ?? "").trim().toUpperCase();
  const st = String(status ?? "").trim();
  if (gs === "REJECT") return { status: "Cancelled", isCancelled: true, isNoShow: false, rejected: true };
  return {
    status: st,
    isCancelled: st === "Cancelled",
    isNoShow: st === "No Show",
    rejected: false,
  };
}

export function computeNightlyRate(accomTotal, nights) {
  if (accomTotal == null || !nights) return null;
  return accomTotal / nights;
}
export function isRateOutlier(rate) {
  return rate == null || rate > RATE_OUTLIER_HIGH || rate < RATE_OUTLIER_LOW;
}

/** Field accessor tolerant of header spacing/case. */
function field(row, name) {
  if (row[name] !== undefined) return row[name];
  const k = Object.keys(row).find((h) => h.trim().toLowerCase() === name.toLowerCase());
  return k ? row[k] : "";
}

/** One raw row (header→value object) → a cleaned reservation record + per-row quality notes. */
export function deriveReservation(row) {
  const property = String(field(row, "Property") ?? "").trim();
  const name = String(field(row, "Name") ?? "").trim();
  const checkIn = parseDateMDY(field(row, "Check in Date"));
  const checkOut = parseDateMDY(field(row, "Check out Date"));
  const reservationDate = parseDateMDY(field(row, "Reservation Date"));
  const cancellationDate = parseDateMDY(field(row, "Cancellation Date"));
  const fileNights = field(row, "Nights");
  const nights = recomputeNights(checkIn, checkOut, fileNights);
  const accommodationTotal = money(field(row, "Accommodation Total"));
  const amountPaid = money(field(row, "Amount Paid"));
  const rt = normalizeRoomType(field(row, "Room Type"), property);
  const src = mapSource(field(row, "Source"));
  const stat = classifyStatus(field(row, "Status"), field(row, "Guest Status"));
  const nightlyRate = computeNightlyRate(accommodationTotal, nights);
  const outlier = isRateOutlier(nightlyRate);
  // ADR policy (confirmed with owner): Extended Stay 30+ and Friends & Family are kept in revenue
  // but excluded from ADR by default. Rate outliers are always excluded from ADR too.
  const isExtendedStay = src.channel === "Extended Stay";
  const isFriendsFamily = /\bfam\b|fam\d|friends?\s*(and|&|\+)?\s*family/i.test(rt.promoCode || "");
  const adrEligible = !outlier && !isExtendedStay && !isFriendsFamily;
  const notes = [];
  const fn = Number(fileNights);
  if (!(isFinite(fn) && fn > 0)) notes.push("nights-blank-or-zero");
  else if (fn !== nights) notes.push("nights-recomputed");
  if (accommodationTotal != null && accommodationTotal < 0) notes.push("negative-total");
  if (outlier) notes.push("rate-outlier");
  if (rt.roomNumberOnly) notes.push("roomtype-number-only");
  if (rt.guessed) notes.push("roomtype-keyword-mapped");
  if (rt.unmapped) notes.push("roomtype-unmapped");
  if (stat.rejected) notes.push("guest-reject->cancelled");
  if (!checkIn) notes.push("no-checkin-date");
  return {
    key: [property, name, toISO(checkIn), toISO(reservationDate)].join("|"),
    property, name,
    roomNumber: String(field(row, "Room Number") ?? "").trim(),
    accommodationTotal, amountPaid,
    checkIn: toISO(checkIn), checkOut: toISO(checkOut),
    nights, fileNights: isFinite(fn) ? fn : null,
    roomType: rt.canonicalType, rooms: rt.rooms, roomsCount: rt.roomsCount, multiRoom: rt.multiRoom,
    promoCode: rt.promoCode, rawRoomType: rt.rawTitle,
    reservationDate: toISO(reservationDate),
    channel: src.channel, collectType: src.collectType, rawSource: src.rawSource,
    status: stat.status, isCancelled: stat.isCancelled, isNoShow: stat.isNoShow,
    cancellationDate: toISO(cancellationDate),
    nightlyRate, isRateOutlier: outlier,
    isExtendedStay, isFriendsFamily, adrEligible,
    leadTimeDays: daysBetween(reservationDate, checkIn),
    cancelDaysBeforeArrival: stat.isCancelled ? daysBetween(cancellationDate, checkIn) : null,
    _notes: notes,
  };
}

/** Parse an array of raw rows (header→value objects) → { reservations, report }. */
export function parseCloudbedsRows(rows) {
  const reservations = [];
  const report = { rowsIn: rows.length, kept: 0, dropped: 0, dropReasons: {}, flags: {}, byProperty: {} };
  const bump = (bag, k) => { bag[k] = (bag[k] || 0) + 1; };
  for (const row of rows) {
    const r = deriveReservation(row);
    if (!r.property || !r.checkIn) { report.dropped++; bump(report.dropReasons, !r.property ? "no-property" : "no-checkin-date"); continue; }
    r._notes.forEach((n) => bump(report.flags, n));
    bump(report.byProperty, r.property);
    reservations.push(r);
    report.kept++;
  }
  return { reservations, report };
}

/** Map a cleaned reservation to a snake_case row for the `cloudbeds_reservations` Supabase table. */
export function toDbRow(r) {
  return {
    property: r.property,
    guest_name: r.name,
    room_number: r.roomNumber || null,
    accommodation_total: r.accommodationTotal,
    amount_paid: r.amountPaid,
    check_in: r.checkIn,
    check_out: r.checkOut,
    nights: r.nights,
    room_type: r.roomType,
    rooms_count: r.roomsCount,
    multi_room: r.multiRoom,
    promo_code: r.promoCode,
    raw_room_type: r.rawRoomType,
    reservation_date: r.reservationDate,
    channel: r.channel,
    collect_type: r.collectType,
    raw_source: r.rawSource,
    status: r.status,
    is_cancelled: r.isCancelled,
    is_no_show: r.isNoShow,
    cancellation_date: r.cancellationDate,
    nightly_rate: r.nightlyRate,
    is_rate_outlier: r.isRateOutlier,
    is_extended_stay: r.isExtendedStay,
    is_friends_family: r.isFriendsFamily,
    adr_eligible: r.adrEligible,
    lead_time_days: r.leadTimeDays,
    cancel_days_before_arrival: r.cancelDaysBeforeArrival,
  };
}

/**
 * Stay-night (room-night) expansion for occupancy/ADR math — only OCCUPIED nights, so Cancelled and
 * No Show reservations are excluded here (they stay in the reservation table for cancellation analysis).
 * A multi-room booking contributes roomsCount room-nights per night, with revenue divided evenly.
 */
export function expandStayNights(res) {
  const out = [];
  if (res.isCancelled || res.isNoShow || !res.checkIn || !res.nights) return out;
  const start = parseDateMDY(res.checkIn);
  const roomsCount = res.roomsCount || 1;
  const perRoomNightRevenue = (res.accommodationTotal != null && res.nights) ? res.accommodationTotal / (res.nights * roomsCount) : null;
  for (let i = 0; i < res.nights; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    for (let rm = 0; rm < roomsCount; rm++) {
      out.push({
        date: toISO(d), property: res.property, roomType: res.rooms[rm] || res.roomType,
        channel: res.channel, collectType: res.collectType,
        revenue: perRoomNightRevenue, nightlyRate: res.nightlyRate, isRateOutlier: res.isRateOutlier,
        status: res.status, key: res.key, name: res.name, promoCode: res.promoCode,
      });
    }
  }
  return out;
}

import { describe, it, expect } from "vitest";
import {
  parseDateMDY, toISO, daysBetween, recomputeNights, normalizeRoomType,
  mapSource, classifyStatus, computeNightlyRate, isRateOutlier,
  deriveReservation, parseCloudbedsRows, expandStayNights,
} from "./parseCloudbeds.js";

describe("parseDateMDY", () => {
  it("parses MM/DD/YYYY strings", () => {
    expect(toISO(parseDateMDY("03/05/2025"))).toBe("2025-03-05");
    expect(toISO(parseDateMDY("12/31/2026"))).toBe("2026-12-31");
  });
  it("returns null for blank/invalid", () => {
    expect(parseDateMDY("")).toBeNull();
    expect(parseDateMDY(null)).toBeNull();
    expect(parseDateMDY("not a date")).toBeNull();
  });
});

describe("recomputeNights", () => {
  it("computes nights from check-in/out when file Nights is blank", () => {
    expect(recomputeNights(parseDateMDY("03/01/2025"), parseDateMDY("03/04/2025"), "")).toBe(3);
  });
  it("recomputes even when file Nights disagrees (dates are authoritative)", () => {
    expect(recomputeNights(parseDateMDY("03/01/2025"), parseDateMDY("03/04/2025"), 1)).toBe(3);
  });
  it("falls back to file Nights when dates are unusable", () => {
    expect(recomputeNights(null, null, 2)).toBe(2);
  });
  it("returns 0 when nothing usable", () => {
    expect(recomputeNights(null, null, 0)).toBe(0);
    expect(recomputeNights(null, null, "")).toBe(0);
  });
  it("handles same-day (0-night) rows via fallback", () => {
    expect(recomputeNights(parseDateMDY("03/01/2025"), parseDateMDY("03/01/2025"), "")).toBe(0);
  });
});

describe("normalizeRoomType", () => {
  it("strips a parenthetical promo code", () => {
    const r = normalizeRoomType("Signature Casita (STAYSOMA15)", "Hotel SOMA");
    expect(r.canonicalType).toBe("Signature Casita");
    expect(r.promoCode).toBe("STAYSOMA15");
    expect(r.roomsCount).toBe(1);
    expect(r.multiRoom).toBe(false);
  });
  it("splits a comma-joined multi-room booking and counts rooms", () => {
    const r = normalizeRoomType("Accessible Private Casita (SOMAFAM15), Premium Courtyard Casita (SOMAFAM15)", "Hotel SOMA");
    expect(r.roomsCount).toBe(2);
    expect(r.multiRoom).toBe(true);
    expect(r.canonicalType).toBe("Multiple rooms");
    expect(r.rooms).toEqual(["Accessible Private Casita", "Premium Courtyard Casita"]);
    expect(r.promoCode).toBe("SOMAFAM15"); // deduped
  });
  it("maps a bare room number to Unknown (room # only)", () => {
    const r = normalizeRoomType("421", "Hotel SOMA");
    expect(r.canonicalType).toBe("Unknown (room # only)");
    expect(r.roomNumberOnly).toBe(true);
  });
  it("keyword-maps a truncated Airbnb title to a canonical Rambler type", () => {
    const cowboys = normalizeRoomType("Walk to AT&T Stadium | Deluxe Cowboys Theme", "The Rambler Inn");
    expect(cowboys.canonicalType).toBe("Signature Cowboys Theme King Suite");
    expect(cowboys.guessed).toBe(true);
    expect(cowboys.rawTitle).toBe("Walk to AT&T Stadium | Deluxe Cowboys Theme");

    const twoBr = normalizeRoomType("Upscale 2 BR Suite near Stadium", "The Rambler Inn");
    expect(twoBr.canonicalType).toBe("Premium 2 Bedroom Suite");

    const rangers = normalizeRoomType("New Rangers Theme Stay by Globe Life", "The Rambler Inn");
    expect(rangers.canonicalType).toBe("Signature Rangers Theme King Suite");
  });
  it("keeps the exact canonical type when it matches verbatim", () => {
    expect(normalizeRoomType("Deluxe Vintage Airstream", "Hotel SOMA").canonicalType).toBe("Deluxe Vintage Airstream");
    expect(normalizeRoomType("Signature Casita with Reserved Parking", "Hotel SOMA").canonicalType).toBe("Signature Casita with Reserved Parking");
  });
  it("handles blank room type", () => {
    const r = normalizeRoomType("", "Hotel SOMA");
    expect(r.roomsCount).toBe(1);
    expect(r.canonicalType).toBe("Unknown");
  });
});

describe("mapSource", () => {
  it("maps direct sources", () => {
    expect(mapSource("Website/Booking Engine").channel).toBe("Direct");
    expect(mapSource("Walk-In").channel).toBe("Direct");
    expect(mapSource("Phone").channel).toBe("Direct");
  });
  it("extracts collect type from the parenthetical", () => {
    expect(mapSource("Expedia (Channel Collect Booking)")).toMatchObject({ channel: "Expedia", collectType: "Channel Collect" });
    expect(mapSource("Booking.com (Hotel Collect Booking)")).toMatchObject({ channel: "Booking.com", collectType: "Hotel Collect" });
  });
  it("maps OTA channels", () => {
    expect(mapSource("Airbnb (API)").channel).toBe("Airbnb");
    expect(mapSource("Vrbo (API)").channel).toBe("Vrbo");
    expect(mapSource("Agoda / Priceline").channel).toBe("Agoda/Priceline");
  });
  it("maps Extended Stay", () => {
    expect(mapSource("Extended Stay 30+ Nights").channel).toBe("Extended Stay");
  });
});

describe("classifyStatus", () => {
  it("treats a REJECT guest status as Cancelled", () => {
    const r = classifyStatus("Confirmed", "REJECT");
    expect(r.status).toBe("Cancelled");
    expect(r.isCancelled).toBe(true);
    expect(r.rejected).toBe(true);
  });
  it("passes through normal statuses", () => {
    expect(classifyStatus("Checked Out", "")).toMatchObject({ status: "Checked Out", isCancelled: false });
    expect(classifyStatus("No Show", "")).toMatchObject({ status: "No Show", isNoShow: true });
    expect(classifyStatus("Cancelled", "")).toMatchObject({ isCancelled: true });
  });
});

describe("rate + outliers", () => {
  it("computes nightly rate as total / nights", () => {
    expect(computeNightlyRate(600, 3)).toBe(200);
  });
  it("flags high, low, negative, and null rates as outliers", () => {
    expect(isRateOutlier(200)).toBe(false);
    expect(isRateOutlier(1800)).toBe(true);
    expect(isRateOutlier(10)).toBe(true);
    expect(isRateOutlier(-50)).toBe(true);
    expect(isRateOutlier(null)).toBe(true);
  });
});

describe("deriveReservation", () => {
  const row = {
    "Property": "Hotel SOMA", "Name": "Jane Doe", "Room Number": "421",
    "Accommodation Total": "600", "Amount Paid": "600",
    "Check in Date": "03/01/2025", "Check out Date": "03/04/2025", "Nights": "",
    "Room Type": "Signature Casita (STAYSOMA15)", "Reservation Date": "02/01/2025",
    "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "", "Cancellation Date": "",
  };
  it("derives nights, rate, lead time and a stable key", () => {
    const r = deriveReservation(row);
    expect(r.nights).toBe(3);
    expect(r.nightlyRate).toBe(200);
    expect(r.isRateOutlier).toBe(false);
    expect(r.leadTimeDays).toBe(28); // 02/01 -> 03/01
    expect(r.channel).toBe("Direct");
    expect(r.roomType).toBe("Signature Casita");
    expect(r.promoCode).toBe("STAYSOMA15");
    expect(r.key).toBe("Hotel SOMA|Jane Doe|2025-03-01|2025-02-01");
    expect(r._notes).toContain("nights-blank-or-zero");
  });
  it("marks ADR eligibility (excludes extended stay, friends & family, and outliers)", () => {
    expect(deriveReservation(row).adrEligible).toBe(true);
    expect(deriveReservation({ ...row, "Source": "Extended Stay 30+ Nights" }).isExtendedStay).toBe(true);
    expect(deriveReservation({ ...row, "Source": "Extended Stay 30+ Nights" }).adrEligible).toBe(false);
    expect(deriveReservation({ ...row, "Room Type": "Signature Casita (SOMAFAM15)" }).isFriendsFamily).toBe(true);
    expect(deriveReservation({ ...row, "Room Type": "Signature Casita (SOMAFAM15)" }).adrEligible).toBe(false);
    // $9000 / 3 nights = $3000/night -> outlier -> not ADR eligible
    expect(deriveReservation({ ...row, "Accommodation Total": "9000" }).adrEligible).toBe(false);
  });
  it("computes cancel lead time for cancelled rows", () => {
    const r = deriveReservation({ ...row, "Status": "Cancelled", "Cancellation Date": "02/20/2025" });
    expect(r.isCancelled).toBe(true);
    expect(r.cancelDaysBeforeArrival).toBe(9); // 02/20 -> 03/01
  });
});

describe("parseCloudbedsRows", () => {
  it("keeps cancelled rows and reports flags", () => {
    const rows = [
      { "Property": "Hotel SOMA", "Name": "A", "Check in Date": "03/01/2025", "Check out Date": "03/03/2025", "Accommodation Total": "400", "Room Type": "Signature Casita", "Reservation Date": "01/01/2025", "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "" },
      { "Property": "Hotel SOMA", "Name": "B", "Check in Date": "03/05/2025", "Check out Date": "03/06/2025", "Accommodation Total": "200", "Room Type": "Signature Casita", "Reservation Date": "02/01/2025", "Source": "Airbnb (API)", "Status": "Cancelled", "Guest Status": "" },
      { "Property": "", "Name": "C", "Check in Date": "", "Room Type": "", "Status": "Confirmed" }, // dropped
    ];
    const { reservations, report } = parseCloudbedsRows(rows);
    expect(reservations).toHaveLength(2);
    expect(report.kept).toBe(2);
    expect(report.dropped).toBe(1);
    expect(reservations.some((r) => r.isCancelled)).toBe(true); // cancelled kept
  });
});

describe("expandStayNights", () => {
  it("expands an active reservation to one row per occupied night", () => {
    const res = deriveReservation({
      "Property": "Hotel SOMA", "Name": "A", "Check in Date": "03/01/2025", "Check out Date": "03/04/2025",
      "Accommodation Total": "600", "Room Type": "Signature Casita", "Reservation Date": "01/01/2025",
      "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "",
    });
    const nights = expandStayNights(res);
    expect(nights).toHaveLength(3);
    expect(nights.map((n) => n.date)).toEqual(["2025-03-01", "2025-03-02", "2025-03-03"]);
    expect(nights[0].revenue).toBe(200);
  });
  it("produces roomsCount x nights room-nights for multi-room bookings", () => {
    const res = deriveReservation({
      "Property": "Hotel SOMA", "Name": "A", "Check in Date": "03/01/2025", "Check out Date": "03/03/2025",
      "Accommodation Total": "800", "Room Type": "Signature Casita, Premium Courtyard Casita",
      "Reservation Date": "01/01/2025", "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "",
    });
    const nights = expandStayNights(res);
    expect(nights).toHaveLength(4); // 2 nights x 2 rooms
    expect(nights[0].revenue).toBe(200); // 800 / (2 nights * 2 rooms)
  });
  it("excludes cancelled and no-show reservations from occupancy", () => {
    const cancelled = deriveReservation({
      "Property": "Hotel SOMA", "Name": "A", "Check in Date": "03/01/2025", "Check out Date": "03/04/2025",
      "Accommodation Total": "600", "Room Type": "Signature Casita", "Reservation Date": "01/01/2025",
      "Source": "Website/Booking Engine", "Status": "Cancelled", "Guest Status": "",
    });
    expect(expandStayNights(cancelled)).toHaveLength(0);
  });
});

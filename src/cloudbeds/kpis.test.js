import { describe, it, expect } from "vitest";
import {
  occupancyByMonth, adr, cancellationStats, alos, leadTimeStats,
  channelMix, onTheBooks, paceVsSTLY, pickup, eventLift,
} from "./kpis.js";
import { parseCloudbedsRows } from "./parseCloudbeds.js";

// Helper to build raw rows concisely.
const row = (o) => ({
  "Property": "The Rambler Inn", "Name": "G", "Room Type": "Deluxe King Suite",
  "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "",
  "Accommodation Total": "600", "Check in Date": "03/01/2025", "Check out Date": "03/04/2025",
  "Reservation Date": "01/01/2025", ...o,
});
const parse = (rows) => parseCloudbedsRows(rows).reservations;

describe("occupancyByMonth", () => {
  it("computes occupancy, ADR and RevPAR against the room count", () => {
    const res = parse([row({ "Name": "A", "Check in Date": "03/01/2025", "Check out Date": "03/04/2025", "Accommodation Total": "600" })]);
    const m = occupancyByMonth(res).find((x) => x.property === "The Rambler Inn" && x.ym === "2025-03");
    expect(m.occupied).toBe(3);
    expect(m.available).toBe(24 * 31); // 744
    expect(m.occupancy).toBeCloseTo(3 / 744, 6);
    expect(m.adr).toBe(200); // 600 / 3 nights
    expect(m.revpar).toBeCloseTo(600 / 744, 6);
  });
});

describe("adr excludes ineligible nights", () => {
  it("drops extended-stay and friends & family from ADR but keeps eligible", () => {
    const res = parse([
      row({ "Name": "A", "Accommodation Total": "600" }),                          // 200/night, eligible
      row({ "Name": "B", "Source": "Extended Stay 30+ Nights", "Accommodation Total": "300" }), // excluded
    ]);
    expect(adr(res)).toBe(200); // only A's 3 nights count
  });
});

describe("cancellationStats", () => {
  it("counts cancellations, no-shows and lost room-nights", () => {
    const res = parse([
      row({ "Name": "A" }),
      row({ "Name": "B", "Status": "Cancelled" }),
      row({ "Name": "C", "Status": "No Show" }),
    ]);
    const s = cancellationStats(res);
    expect(s.total).toBe(3);
    expect(s.cancelled).toBe(1);
    expect(s.noShow).toBe(1);
    expect(s.cancellationRate).toBeCloseTo(1 / 3, 6);
    expect(s.lostRoomNights).toBe(6); // B(3) + C(3)
  });
});

describe("alos", () => {
  it("averages length of stay over stayed reservations only", () => {
    const res = parse([
      row({ "Name": "A", "Check in Date": "03/01/2025", "Check out Date": "03/04/2025" }), // 3
      row({ "Name": "B", "Check in Date": "03/01/2025", "Check out Date": "03/02/2025" }), // 1
      row({ "Name": "C", "Status": "Cancelled", "Check in Date": "03/01/2025", "Check out Date": "03/10/2025" }), // excluded
    ]);
    expect(alos(res)).toBe(2); // (3+1)/2
  });
});

describe("leadTimeStats", () => {
  it("averages booking lead time", () => {
    const res = parse([
      row({ "Name": "A", "Reservation Date": "02/01/2025", "Check in Date": "03/01/2025" }), // 28
      row({ "Name": "B", "Reservation Date": "02/20/2025", "Check in Date": "03/01/2025" }), //  9
    ]);
    const s = leadTimeStats(res);
    expect(s.avg).toBeCloseTo(18.5, 6);
    expect(s.count).toBe(2);
  });
});

describe("channelMix", () => {
  it("splits room-nights by channel", () => {
    const res = parse([
      row({ "Name": "A", "Source": "Website/Booking Engine" }),      // Direct, 3 nights
      row({ "Name": "B", "Source": "Airbnb (API)", "Check in Date": "03/01/2025", "Check out Date": "03/02/2025" }), // Airbnb, 1 night
    ]);
    const mix = channelMix(res);
    const direct = mix.find((m) => m.channel === "Direct");
    const airbnb = mix.find((m) => m.channel === "Airbnb");
    expect(direct.roomNights).toBe(3);
    expect(airbnb.roomNights).toBe(1);
    expect(direct.shareNights).toBeCloseTo(0.75, 6);
  });
});

describe("pace / STLY / pickup", () => {
  // A booking for June 2025 made in March 2025, and the equivalent for June 2024 made in March 2024.
  const res = parse([
    row({ "Name": "cur", "Reservation Date": "03/15/2025", "Check in Date": "06/10/2025", "Check out Date": "06/13/2025" }),
    row({ "Name": "stly", "Reservation Date": "03/15/2024", "Check in Date": "06/10/2024", "Check out Date": "06/13/2024" }),
    row({ "Name": "late", "Reservation Date": "05/20/2025", "Check in Date": "06/20/2025", "Check out Date": "06/23/2025" }),
  ]);
  it("counts only room-nights booked on or before the as-of date", () => {
    const otb = onTheBooks(res, { property: "The Rambler Inn", targetYm: "2025-06", asOf: "04/01/2025" });
    expect(otb.roomNights).toBe(3); // "cur" only; "late" booked in May is excluded
  });
  it("compares pace to same-time-last-year", () => {
    const p = paceVsSTLY(res, { property: "The Rambler Inn", targetYm: "2025-06", asOf: "04/01/2025" });
    expect(p.current).toBe(3);
    expect(p.stly).toBe(3);
    expect(p.diff).toBe(0);
    expect(p.pct).toBe(0);
  });
  it("measures pickup between two as-of snapshots", () => {
    const pk = pickup(res, { property: "The Rambler Inn", targetYm: "2025-06", fromAsOf: "04/01/2025", toAsOf: "06/01/2025" });
    expect(pk.pickupRoomNights).toBe(3); // the "late" May booking (3 nights) shows up by June 1
  });
});

describe("eventLift", () => {
  const events = [{ date: "2025-03-02", name: "Big Game", venue: "AT&T Stadium", market: "Arlington", impact: "high" }];
  it("compares ADR on event nights vs non-event nights", () => {
    const res = parse([
      // 1-night stay on the event night 3/2: $300/night.
      row({ "Name": "A", "Check in Date": "03/02/2025", "Check out Date": "03/03/2025", "Accommodation Total": "300" }),
      // a non-event-week stay in March at a lower rate: $300/3 = $100/night
      row({ "Name": "B", "Check in Date": "03/20/2025", "Check out Date": "03/23/2025", "Accommodation Total": "300" }),
    ]);
    const lift = eventLift(res, events, { property: "The Rambler Inn" });
    expect(lift.eventNights).toBe(1);   // only 3/2
    expect(lift.baseNights).toBe(3);    // B's three nights
    expect(lift.eventAdr).toBe(300);
    expect(lift.baseAdr).toBe(100);
    expect(lift.adrLiftPct).toBeCloseTo(2, 6); // +200%
  });
});

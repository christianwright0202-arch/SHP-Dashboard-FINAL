import { describe, it, expect } from "vitest";
import { eventDateList, buildEventIndex, eventsOnDate, tagStayNights, tagReservationEvents, PROPERTY_MARKET } from "./eventModel.js";
import { deriveReservation, expandStayNights } from "../cloudbeds/parseCloudbeds.js";

const EVENTS = [
  { date: "2025-09-14", name: "Cowboys vs Giants", venue: "AT&T Stadium", market: "Arlington", category: "nfl", impact: "high" },
  { date: "2025-09-13", endDate: "2025-09-15", name: "Big Festival", venue: "Downtown", market: "Fort Worth", category: "festival", impact: "med" },
];

describe("eventDateList", () => {
  it("returns a single date for a one-day event", () => {
    expect(eventDateList(EVENTS[0])).toEqual(["2025-09-14"]);
  });
  it("expands a multi-day event inclusively", () => {
    expect(eventDateList(EVENTS[1])).toEqual(["2025-09-13", "2025-09-14", "2025-09-15"]);
  });
});

describe("event index + window tagging", () => {
  const index = buildEventIndex(EVENTS);
  it("finds events by market + date", () => {
    expect(eventsOnDate(index, "Arlington", "2025-09-14").map((e) => e.name)).toEqual(["Cowboys vs Giants"]);
    expect(eventsOnDate(index, "Fort Worth", "2025-09-14").map((e) => e.name)).toEqual(["Big Festival"]);
    expect(eventsOnDate(index, "Arlington", "2025-09-15")).toEqual([]); // Cowboys game is single-day
  });
  it("does not cross markets", () => {
    expect(eventsOnDate(index, "Fort Worth", "2025-09-14").length).toBe(1);
    expect(eventsOnDate(index, "Arlington", "2025-09-13")).toEqual([]);
  });
});

describe("tagStayNights", () => {
  it("tags the Rambler (Arlington) night that lands on the Cowboys game", () => {
    const res = deriveReservation({
      "Property": "The Rambler Inn", "Name": "G", "Check in Date": "09/13/2025", "Check out Date": "09/15/2025",
      "Accommodation Total": "600", "Room Type": "Deluxe King Suite", "Reservation Date": "08/01/2025",
      "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "",
    });
    const tagged = tagStayNights(expandStayNights(res), EVENTS);
    expect(tagged.map((t) => t.isEventNight)).toEqual([false, true]); // 9/13 no, 9/14 yes
    expect(tagged[1].eventNames).toBe("Cowboys vs Giants");
  });
  it("ignores events from the other market", () => {
    const res = deriveReservation({
      "Property": "Hotel SOMA", "Name": "H", "Check in Date": "09/14/2025", "Check out Date": "09/15/2025",
      "Accommodation Total": "200", "Room Type": "Signature Casita", "Reservation Date": "08/01/2025",
      "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "",
    });
    const tagged = tagStayNights(expandStayNights(res), EVENTS);
    expect(tagged[0].eventNames).toBe("Big Festival"); // Fort Worth festival, not the Cowboys game
  });
});

describe("tagReservationEvents", () => {
  it("flags a reservation whose stay overlaps any event night", () => {
    const index = buildEventIndex(EVENTS);
    const res = deriveReservation({
      "Property": "The Rambler Inn", "Name": "G", "Check in Date": "09/14/2025", "Check out Date": "09/15/2025",
      "Accommodation Total": "500", "Room Type": "Deluxe King Suite", "Reservation Date": "08/01/2025",
      "Source": "Website/Booking Engine", "Status": "Checked Out", "Guest Status": "",
    });
    const tagged = tagReservationEvents(res, index);
    expect(tagged.isEventStay).toBe(true);
    expect(tagged.eventNames).toBe("Cowboys vs Giants");
  });
});

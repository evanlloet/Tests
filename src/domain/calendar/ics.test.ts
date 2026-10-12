import { describe, expect, it } from "vitest";
import { parseIcs } from "./ics";

const VTIMEZONE_ROMANCE = `BEGIN:VTIMEZONE
TZID:Romance Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE`;

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN\r\n${VTIMEZONE_ROMANCE}\r\n${body}\r\nEND:VCALENDAR`;
const window = { windowStart: new Date("2024-01-01T00:00:00Z"), windowEnd: new Date("2027-12-31T00:00:00Z") };

describe("ICS", () => {
  it("convertit les fuseaux Windows d'Outlook", () => {
    const res = parseIcs(
      wrap(`BEGIN:VEVENT
UID:evt-1
SUMMARY:Pharmacie Lemoine
LOCATION:Caen
DTSTART;TZID=Romance Standard Time:20260615T090000
DTEND;TZID=Romance Standard Time:20260615T094500
END:VEVENT`),
      window,
    );
    expect(res.events).toHaveLength(1);
    expect(res.events[0]!.start.toISOString()).toBe("2026-06-15T07:00:00.000Z");
    expect(res.events[0]!.end.toISOString()).toBe("2026-06-15T07:45:00.000Z");
    expect(res.events[0]!.sourceTimezone).toBe("Romance Standard Time");
  });

  it("utilise la définition VTIMEZONE pour un fuseau au nom inconnu", () => {
    const ics = wrap(`BEGIN:VEVENT
UID:evt-2
SUMMARY:Visite
DTSTART;TZID=Romance Standard Time:20260115T090000
DTEND;TZID=Romance Standard Time:20260115T100000
END:VEVENT`).replace(/Romance Standard Time/g, "Fuseau Maison");
    const res = parseIcs(ics, window);
    expect(res.events[0]!.start.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(res.warnings).toHaveLength(0);
  });

  it("gère UTC, journées entières et annulations", () => {
    const res = parseIcs(
      wrap(`BEGIN:VEVENT
UID:a
SUMMARY:Pharmacie du Port
DTSTART:20260616T120000Z
DTEND:20260616T130000Z
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:b
SUMMARY:Congés
DTSTART;VALUE=DATE:20260720
DTEND;VALUE=DATE:20260725
END:VEVENT`),
      window,
    );
    const port = res.events.find((e) => e.uid === "a")!;
    expect(port.isCancelled).toBe(true);
    expect(port.start.toISOString()).toBe("2026-06-16T12:00:00.000Z");
    const conges = res.events.find((e) => e.uid === "b")!;
    expect(conges.allDay).toBe(true);
    expect(conges.start.toISOString()).toBe("2026-07-19T22:00:00.000Z");
    expect(conges.end.toISOString()).toBe("2026-07-24T22:00:00.000Z");
  });

  it("développe les récurrences avec exceptions et dates exclues", () => {
    const res = parseIcs(
      wrap(`BEGIN:VEVENT
UID:serie
SUMMARY:Pharmacie Lemoine
DTSTART;TZID=Romance Standard Time:20260615T090000
DTEND;TZID=Romance Standard Time:20260615T100000
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Romance Standard Time:20260622T090000
END:VEVENT
BEGIN:VEVENT
UID:serie
RECURRENCE-ID;TZID=Romance Standard Time:20260629T090000
SUMMARY:Pharmacie Lemoine (déplacé)
DTSTART;TZID=Romance Standard Time:20260630T140000
DTEND;TZID=Romance Standard Time:20260630T150000
END:VEVENT`),
      window,
    );
    expect(res.events.map((e) => [e.title, e.start.toISOString()])).toEqual([
      ["Pharmacie Lemoine", "2026-06-15T07:00:00.000Z"],
      ["Pharmacie Lemoine (déplacé)", "2026-06-30T12:00:00.000Z"],
      ["Pharmacie Lemoine", "2026-07-06T07:00:00.000Z"],
    ]);
    expect(res.events.every((e) => e.isRecurring)).toBe(true);
    expect(new Set(res.events.map((e) => e.sourceKey)).size).toBe(3);
  });

  it("borne l'expansion à la fenêtre demandée", () => {
    const res = parseIcs(
      wrap(`BEGIN:VEVENT
UID:daily
SUMMARY:Point quotidien
DTSTART:20200101T080000Z
DTEND:20200101T081500Z
RRULE:FREQ=DAILY
END:VEVENT`),
      { windowStart: new Date("2026-06-01T00:00:00Z"), windowEnd: new Date("2026-06-08T00:00:00Z") },
    );
    expect(res.events).toHaveLength(7);
  });

  it("produit des clés stables (import rejouable)", () => {
    const ics = wrap(`BEGIN:VEVENT
UID:evt-1
SUMMARY:Pharmacie Lemoine
DTSTART:20260615T070000Z
DTEND:20260615T074500Z
END:VEVENT`);
    expect(parseIcs(ics, window).events[0]!.sourceKey).toBe(parseIcs(ics, window).events[0]!.sourceKey);
  });
});

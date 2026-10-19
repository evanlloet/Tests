import { describe, expect, it } from "vitest";
import { buildAgendaStats, daySectors, type StatsVisit } from "./agenda-stats";

const RENNES = { lat: 48.1113, lng: -1.68 };
const CAEN = { lat: 49.18, lng: -0.37 };
const CHERBOURG = { lat: 49.63, lng: -1.62 };
let n = 0;
const v = (day: string, hhmm: string, pharmacyId: string, dep: string, location: { lat: number; lng: number }, mode: "onsite" | "phone" = "onsite"): StatsVisit => ({
  id: `v${n++}`,
  day,
  start: new Date(`${day}T${hhmm}:00+02:00`),
  end: new Date(new Date(`${day}T${hhmm}:00+02:00`).getTime() + 3_600_000),
  pharmacyId,
  pharmacyName: pharmacyId,
  city: null,
  departmentCode: dep,
  location,
  mode,
  pendingReview: false,
  reason: null,
});

describe("statistiques du secteur", () => {
  it("détermine 1 ou 2 secteurs par journée", () => {
    expect(daySectors(["14", "14", "14", "14", "61"])).toEqual(["14"]);
    expect(daySectors(["14", "14", "14", "50", "50", "50", "50"])).toEqual(["50", "14"]);
  });

  it("compare la vraie semaine à la semaine type, avec hôtels et téléphone", () => {
    const stats = buildAgendaStats({
      visits: [
        v("2026-09-28", "10:00", "p1", "14", CAEN),
        v("2026-09-28", "14:00", "p2", "14", CAEN),
        v("2026-09-28", "16:00", "p9", "53", { lat: 48.3, lng: -0.61 }, "phone"),
        v("2026-09-29", "10:00", "p3", "50", CHERBOURG),
        v("2026-09-29", "14:00", "p4", "50", CHERBOURG),
        v("2026-11-02", "10:00", "p1", "14", CAEN),
      ],
      nights: [{ night: "2026-09-28", hotel: "Hôtel test", city: "Caen", postalCode: "14000", departmentCode: "14", location: CAEN }],
      teleworkDays: [],
      clients: [
        { id: "p1", name: "P1", city: null, departmentCode: "14", category: "A" },
        { id: "p5", name: "P5", city: null, departmentCode: "14", category: "B" },
      ],
      home: RENNES,
      template: { 1: ["14"], 2: ["14"] },
      targets: { A: 4, B: 4, C: 4, D: 3 },
      today: "2026-10-19",
      tz: "Europe/Paris",
    });
    expect(stats.kpis).toMatchObject({ onsite: 4, phone: 1, nights: 1, fieldDays: 2, upcoming: 1, clientsSeen: 1, clients: 2 });
    const monday = stats.weekdays.find((w) => w.weekday === 1)!;
    const tuesday = stats.weekdays.find((w) => w.weekday === 2)!;
    expect(monday.templateMatch).toBe(1);
    expect(tuesday.templateMatch).toBe(0);
    expect(tuesday.sectors[0]!.code).toBe("50");
    // Le mardi part de l'hôtel de Caen, pas du domicile
    const day = stats.lastMonth.find((d) => d.day === "2026-09-29")!;
    expect(day.startFrom).toBe("Caen");
    expect(stats.hotels.byWeekday[0]!.nights).toBe(1);
    expect(stats.notSeen.map((c) => c.id)).toEqual(["p5"]);
  });
});

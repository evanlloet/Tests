import { describe, expect, it } from "vitest";
import { learnFromFeedback, learnHabits, type AssistantFeedback, type Habits } from "./learning";
import { buildPlan, type PlannerClient } from "./planner";

const RENNES = { lat: 48.1113, lng: -1.68 };
const CAEN = { lat: 49.18, lng: -0.37 };
const CHERBOURG = { lat: 49.63, lng: -1.62 };
const LAVAL = { lat: 48.07, lng: -0.77 };
const near = (p: { lat: number; lng: number }, i: number) => ({ lat: p.lat + (i % 5) * 0.03, lng: p.lng + Math.floor(i / 5) * 0.03 });

const clients: PlannerClient[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `cal-${i}`, name: `Pharmacie Calvados ${i}`, city: "Caen", departmentCode: "14", location: near(CAEN, i) })),
  ...Array.from({ length: 12 }, (_, i) => ({ id: `man-${i}`, name: `Pharmacie Manche ${i}`, city: "Cherbourg", departmentCode: "50", location: near(CHERBOURG, i) })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `may-${i}`, name: `Pharmacie Mayenne ${i}`, city: "Laval", departmentCode: "53", location: near(LAVAL, i) })),
].map((c, i) => ({ ...c, category: i % 6 === 0 ? ("A" as const) : ("D" as const), perYear: i % 6 === 0 ? 4 : 3, lastOnsite: "2026-06-01", fileNextVisit: null }));

const habits: Habits = {
  sectorShare: { 1: { "14": 0.8, "50": 0.2 }, 2: { "50": 0.7, "14": 0.3 }, 3: { "50": 0.6, "14": 0.4 }, 4: { "53": 0.6, "50": 0.4 }, 5: { "35": 0.5, "53": 0.5 } },
  visitsPerDay: { 1: 5, 2: 5, 3: 4, 4: 4, 5: 4 },
  startMinutes: { 1: 600, 2: 570, 3: 570, 4: 570, 5: 570 },
  endMinutes: { 1: 1050, 2: 1050, 3: 1020, 4: 1020, 5: 960 },
  visitMinutes: 60,
  hotelShare: { 1: 0.8, 2: 0.6, 3: 0.1, 4: 0, 5: 0 },
  hotels: { "50": { name: "Hôtel du Port (test)", city: "Cherbourg", location: CHERBOURG, nights: 12 } },
  fieldDaysPerWeek: 4.5,
  daysAnalysed: 150,
};
const noLearning = learnFromFeedback([], "2026-10-19", (c) => c, (wd) => String(wd));
const base = { today: "2026-10-19", horizonDays: 14, clients, existing: [], blockedDays: new Map(), habits, home: RENNES, hotelThresholdKm: 150 };

describe("assistant de planification", () => {
  it("suit les habitudes : Calvados le lundi, Manche le mardi avec une nuit d'hôtel entre les deux", () => {
    const { days } = buildPlan({ ...base, learning: noLearning });
    const monday = days.find((d) => d.day === "2026-10-26")!;
    const tuesday = days.find((d) => d.day === "2026-10-27")!;
    expect(monday.sectors).toEqual(["14"]);
    expect(tuesday.sectors).toEqual(["50"]);
    expect(monday.proposals.length).toBe(5);
    expect(monday.proposals.every((p) => p.departmentCode === "14")).toBe(true);
    expect(monday.hotel?.name).toBe("Hôtel du Port (test)");
    expect(tuesday.startsFromHotel).toBe(true);
    // Horaires indicatifs à partir de l'heure habituelle, sans chevauchement
    expect(monday.proposals[0]!.start).toBe(600);
    for (let i = 1; i < monday.proposals.length; i++) expect(monday.proposals[i]!.start).toBeGreaterThanOrEqual(monday.proposals[i - 1]!.end);
  });

  it("ne propose pas deux fois la même cliente et respecte les jours bloqués", () => {
    const { days } = buildPlan({ ...base, learning: noLearning, blockedDays: new Map([["2026-10-27", "Congés"]]) });
    const ids = days.flatMap((d) => d.proposals.map((p) => p.pharmacyId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(days.find((d) => d.day === "2026-10-27")!.status).toBe("blocked");
  });

  it("complète une journée déjà entamée autour de ses rendez-vous", () => {
    const { days } = buildPlan({
      ...base,
      learning: noLearning,
      existing: [{ id: "rdv", day: "2026-10-22", start: 600, end: 660, pharmacyId: "may-1", title: "Pharmacie Mayenne 1", departmentCode: "53", location: near(LAVAL, 1), kind: "visit", mode: "onsite" }],
    });
    const thursday = days.find((d) => d.day === "2026-10-22")!;
    expect(thursday.sectors).toEqual(["53"]);
    expect(thursday.proposals.length).toBe(3);
    expect(thursday.proposals.some((p) => p.start < 660 && p.end > 600)).toBe(false);
  });

  it("apprend des refus : un secteur refusé le mardi n'est plus proposé ce jour-là", () => {
    const refusals: AssistantFeedback[] = [1, 2, 3].map(() => ({
      kind: "day",
      action: "rejected",
      day: "2026-10-13",
      weekday: 2,
      departmentCode: "50",
      pharmacyId: null,
      reason: "other_sector",
      until: null,
      createdOn: "2026-10-15",
    }));
    const learning = learnFromFeedback(refusals, "2026-10-19", (c) => c, (wd) => String(wd));
    expect(learning.sectorFactor[2]!["50"]).toBeLessThan(0.5);
    const { days } = buildPlan({ ...base, learning });
    // Mardi 20 : sans les refus ce serait la Manche (habitude 70 %)
    expect(buildPlan({ ...base, learning: noLearning }).days.find((d) => d.day === "2026-10-20")!.sectors).toEqual(["50"]);
    expect(days.find((d) => d.day === "2026-10-20")!.sectors).toEqual(["14"]);
    expect(learning.insights.join(" ")).toMatch(/refusez souvent/);
  });

  it("reporte une cliente et évite son jour de fermeture", () => {
    const fb: AssistantFeedback[] = [
      { kind: "client_day", action: "rejected", day: "2026-10-26", weekday: 1, departmentCode: "14", pharmacyId: "cal-0", reason: "client_unavailable_weekday", until: null, createdOn: "2026-10-19" },
      { kind: "client_day", action: "rejected", day: "2026-10-26", weekday: 1, departmentCode: "14", pharmacyId: "cal-1", reason: "too_soon", until: "2026-11-25", createdOn: "2026-10-19" },
    ];
    const { days } = buildPlan({ ...base, learning: learnFromFeedback(fb, "2026-10-19", (c) => c, (wd) => String(wd)) });
    for (const d of days) {
      if (d.weekday === 1) expect(d.proposals.some((p) => p.pharmacyId === "cal-0")).toBe(false);
      expect(d.proposals.some((p) => p.pharmacyId === "cal-1")).toBe(false);
    }
  });

  it("tire les habitudes de l'agenda passé", () => {
    const day = (d: string, sectors: string[], onsite: number, firstStart: number) => ({
      day: d,
      weekday: new Date(`${d}T12:00:00Z`).getUTCDay() || 7,
      onsite,
      phone: 0,
      sectors,
      matchesTemplate: null,
      firstStart,
      lastEnd: firstStart + 420,
      startFrom: "domicile",
      night: null,
      km: null,
      driveMinutes: null,
      farthestKm: null,
      telework: false,
      visits: [],
    });
    const h = learnHabits(
      [day("2026-09-07", ["14"], 5, 600), day("2026-09-14", ["14"], 6, 600), day("2026-09-21", ["61"], 5, 570), day("2026-09-08", ["50"], 4, 570)],
      [{ night: "2026-09-07", hotel: "Hôtel test", city: "Caen", postalCode: "14000", departmentCode: "14", location: CAEN }],
      { 1: ["14"] },
      [60, 60, 30],
    );
    expect(Object.entries(h.sectorShare[1]!).sort((a, b) => b[1] - a[1])[0]![0]).toBe("14");
    expect(h.visitsPerDay[1]).toBe(5);
    expect(h.startMinutes[1]).toBe(600);
    expect(h.visitMinutes).toBe(60);
    expect(h.hotels["14"]!.name).toBe("Hôtel test");
  });
});

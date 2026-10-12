import { describe, expect, it } from "vitest";
import { computeRewards, computeStreak, LEVELS, POINTS, type RewardFacts } from "./gamification";
import { dayMood, dayMoodKey, avatarFor } from "./mood";

const base: RewardFacts = {
  today: "2026-10-14", // mercredi
  doneVisits: [],
  reports: [],
  manualValidations: 0,
  calendarImports: 0,
  kmSaved: 0,
  plansApplied: 0,
  pharmacies: { total: 0, geolocated: 0, categorized: 0 },
  visitedDepartments: [],
  workdays: [],
};

describe("points et niveaux", () => {
  it("part de zéro au niveau Graine", () => {
    const r = computeRewards(base);
    expect(r.points).toBe(0);
    expect(r.level).toMatchObject({ index: 0, name: "Graine", nextName: "Pousse", progress: 0 });
    expect(r.badges.every((b) => !b.unlocked)).toBe(true);
  });

  it("récompense la qualité du suivi, pas seulement le volume", () => {
    const r = computeRewards({
      ...base,
      doneVisits: [
        { day: "2026-10-13", pharmacyId: "p1", category: "A", departmentCode: "14", rescued: true },
        { day: "2026-10-14", pharmacyId: "p2", category: "B", departmentCode: "14", rescued: false },
      ],
      reports: [{ day: "2026-10-14" }],
      manualValidations: 3,
      calendarImports: 2,
      kmSaved: 12.4,
      workdays: [
        { day: "2026-10-13", visits: 1, closedVisits: 1, balanced: true },
        { day: "2026-10-14", visits: 1, closedVisits: 1, balanced: false },
      ],
    });
    expect(r.points).toBe(2 * POINTS.visitDone + POINTS.report + POINTS.rescue + POINTS.balancedDay + 3 * POINTS.manualValidation + 12 + POINTS.firstImport);
    expect(r.todayPoints).toBe(POINTS.visitDone + POINTS.report);
    expect(r.badges.find((b) => b.key === "first-visit")!.unlocked).toBe(true);
    expect(r.badges.find((b) => b.key === "archivist")!.unlocked).toBe(true);
  });

  it("calcule la progression vers le niveau suivant", () => {
    const visits = Array.from({ length: 20 }, (_, i) => ({ day: "2026-01-05", pharmacyId: `p${i}`, category: null, departmentCode: null, rescued: false }));
    const r = computeRewards({ ...base, doneVisits: visits });
    expect(r.points).toBe(200);
    expect(r.level.name).toBe(LEVELS[1]!.name);
    expect(r.level.progress).toBeCloseTo(0.5);
  });
});

describe("série douce", () => {
  const d = (day: string, visits: number, closed: number) => ({ day, visits, closedVisits: closed, balanced: false });
  it("n'est pas cassée par un jour sans visite ni par la journée en cours", () => {
    const s = computeStreak([d("2026-10-08", 3, 3), d("2026-10-09", 2, 2), d("2026-10-12", 4, 4), d("2026-10-14", 3, 1)], "2026-10-14");
    expect(s).toEqual({ current: 3, best: 3 });
  });
  it("repart à zéro après une journée passée non clôturée", () => {
    const s = computeStreak([d("2026-10-08", 3, 3), d("2026-10-09", 2, 1), d("2026-10-12", 4, 4)], "2026-10-14");
    expect(s).toEqual({ current: 1, best: 1 });
  });
});

describe("défis de la semaine", () => {
  it("suit la clôture des visites de la semaine en cours", () => {
    const r = computeRewards({
      ...base,
      workdays: [
        { day: "2026-10-09", visits: 5, closedVisits: 0, balanced: false }, // semaine précédente : ignorée
        { day: "2026-10-12", visits: 3, closedVisits: 3, balanced: true },
        { day: "2026-10-13", visits: 4, closedVisits: 2, balanced: false },
      ],
    });
    const close = r.challenges.find((c) => c.key === "close-week")!;
    expect(close).toMatchObject({ value: 5, target: 7, done: false });
    expect(r.challenges.find((c) => c.key === "balanced")!.done).toBe(true);
  });
});

describe("humeur des journées", () => {
  it("dépend de la charge réelle et des problèmes, pas du seul nombre de visites", () => {
    expect(dayMoodKey({ load: "légère", weekday: 1, holiday: null, visits: 6, overlaps: false })).toBe("light");
    expect(dayMoodKey({ load: "chargée", weekday: 1, holiday: null, visits: 2, overlaps: false })).toBe("busy");
    expect(dayMoodKey({ load: "équilibrée", weekday: 2, holiday: null, visits: 3, overlaps: true })).toBe("overloaded");
    expect(dayMood({ load: "trop chargée", weekday: 3, holiday: null, visits: 4, overlaps: false }).mood).toBe("stressed");
    expect(dayMood({ load: "équilibrée", weekday: 3, holiday: null, visits: 4, overlaps: false }).mood).toBe("joy");
  });
  it("distingue repos, férié et journée libre", () => {
    expect(dayMoodKey({ load: "vide", weekday: 6, holiday: null, visits: 0, overlaps: false })).toBe("weekend");
    expect(dayMoodKey({ load: "vide", weekday: 3, holiday: "Toussaint", visits: 0, overlaps: false })).toBe("holiday");
    expect(dayMoodKey({ load: "vide", weekday: 3, holiday: null, visits: 0, overlaps: false })).toBe("free");
  });
  it("donne à chaque pharmacie un avatar stable", () => {
    expect(avatarFor("abc")).toEqual(avatarFor("abc"));
    const variety = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(avatarFor(`pharmacie-${i}`))));
    expect(variety.size).toBeGreaterThan(10);
  });
});

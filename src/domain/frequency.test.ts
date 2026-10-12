import { describe, expect, it } from "vitest";
import { computeVisitStatus, DEFAULT_FREQUENCIES, intervalDays, targetVisitsPerYear } from "./frequency";

describe("fréquence cible", () => {
  it("applique la fréquence de la catégorie (A/B/C = 4, D = 3)", () => {
    expect(targetVisitsPerYear("A", null, DEFAULT_FREQUENCIES)).toEqual({ perYear: 4, origin: "category" });
    expect(targetVisitsPerYear("D", null, DEFAULT_FREQUENCIES)).toEqual({ perYear: 3, origin: "category" });
  });
  it("donne la priorité à la fréquence individuelle", () => {
    expect(targetVisitsPerYear("D", 6, DEFAULT_FREQUENCIES)).toEqual({ perYear: 6, origin: "individual" });
  });
  it("n'invente pas de fréquence sans catégorie", () => {
    expect(targetVisitsPerYear(null, null, DEFAULT_FREQUENCIES)).toEqual({ perYear: null, origin: "unknown" });
  });
  it("respecte les fréquences modifiées globalement", () => {
    expect(targetVisitsPerYear("B", null, { ...DEFAULT_FREQUENCIES, B: 6 }).perYear).toBe(6);
  });
  it("calcule l'intervalle entre visites", () => {
    expect(intervalDays(4)).toBe(91);
    expect(intervalDays(3)).toBe(122);
  });
});

describe("échéances", () => {
  const today = "2026-10-12";

  it("calcule la prochaine échéance à partir de la dernière visite", () => {
    const s = computeVisitStatus({ perYear: 4, today, visits: [{ day: "2026-09-01", state: "done" }] });
    expect(s.nextDue).toBe("2026-12-01");
    expect(s.daysUntilDue).toBe(50);
    expect(s.dueState).toBe("ok");
  });
  it("signale un retard", () => {
    const s = computeVisitStatus({ perYear: 4, today, visits: [{ day: "2026-05-01", state: "identified" }] });
    expect(s.dueState).toBe("overdue");
    expect(s.daysUntilDue).toBeLessThan(0);
  });
  it("signale une échéance proche", () => {
    const s = computeVisitStatus({ perYear: 4, today, visits: [{ day: "2026-07-20", state: "done" }] });
    expect(s.dueState).toBe("due_soon");
  });
  it("considère comme couverte une pharmacie déjà planifiée", () => {
    const s = computeVisitStatus({
      perYear: 4,
      today,
      visits: [
        { day: "2026-05-01", state: "done" },
        { day: "2026-10-20", state: "planned" },
      ],
    });
    expect(s.dueState).toBe("planned");
    expect(s.nextPlanned).toBe("2026-10-20");
    expect(s.plannedLate).toBe(true);
  });
  it("distingue visites réalisées, identifiées et planifiées dans l'objectif annuel", () => {
    const s = computeVisitStatus({
      perYear: 4,
      today,
      visits: [
        { day: "2025-12-10", state: "done" },
        { day: "2026-02-10", state: "done" },
        { day: "2026-05-10", state: "identified" },
        { day: "2026-11-10", state: "planned" },
      ],
    });
    expect(s.year).toEqual({ done: 1, identified: 1, planned: 1, target: 4, remaining: 1 });
    expect(s.lastVisit).toEqual({ day: "2026-05-10", state: "identified" });
  });
  it("indique une pharmacie jamais visitée", () => {
    const s = computeVisitStatus({ perYear: 3, today, visits: [] });
    expect(s.dueState).toBe("never_visited");
    expect(s.nextDue).toBe(today);
  });
  it("reste « inconnu » sans fréquence", () => {
    const s = computeVisitStatus({ perYear: null, today, visits: [{ day: "2026-01-01", state: "done" }] });
    expect(s.dueState).toBe("unknown");
    expect(s.nextDue).toBeNull();
    expect(s.year.remaining).toBeNull();
  });
});

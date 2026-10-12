import { describe, expect, it } from "vitest";
import { PLACES } from "../../../tests/fixtures/places";
import { DEFAULT_ESTIMATE } from "../routing/estimate";
import { bestSlotInDay, suggestSlots, type DayPlan, type SuggestSettings, type SuggestTarget } from "./suggest";

const settings: SuggestSettings = {
  workStart: 8 * 60 + 30,
  workEnd: 18 * 60 + 30,
  lunchStart: 12 * 60 + 30,
  lunchMinutes: 60,
  bufferMinutes: 10,
  defaultVisitMinutes: 45,
  home: PLACES.rennes,
  hotelThresholdKm: 150,
  mustReturnHomeWeekdays: [5],
  estimate: DEFAULT_ESTIMATE,
};

const bayeux: SuggestTarget = {
  id: "bayeux",
  label: "Pharmacie de Bayeux",
  location: PLACES.bayeux,
  departmentCode: "14",
  category: "A",
  preferredWeekdays: [],
  excludedWeekdays: [],
  preferredStart: null,
  preferredEnd: null,
  visitMinutes: null,
};

// Semaine du 9 novembre 2026 : lundi/mardi Calvados, mercredi/jeudi Manche, vendredi Ille-et-Vilaine
const prefs: Record<number, string[]> = { 1: ["14"], 2: ["14"], 3: ["50"], 4: ["50"], 5: ["35"] };
function week(appointments: Record<string, DayPlan["appointments"]> = {}): Map<string, DayPlan> {
  const m = new Map<string, DayPlan>();
  for (let d = 2; d <= 30; d++) {
    const day = `2026-11-${String(d).padStart(2, "0")}`;
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
    m.set(day, { appointments: appointments[day] ?? [], preferredDepartments: prefs[dow] ?? [] });
  }
  return m;
}

describe("propositions de créneaux", () => {
  it("privilégie un jour du secteur où des rendez-vous sont déjà prévus à proximité", () => {
    const days = week({
      "2026-11-10": [
        { id: "a", label: "Caen", start: 9 * 60, end: 9 * 60 + 45, location: PLACES.caen, departmentCode: "14", kind: "visit" },
        { id: "b", label: "Vire", start: 15 * 60, end: 15 * 60 + 45, location: PLACES.vire, departmentCode: "14", kind: "visit" },
      ],
    });
    const res = suggestSlots({ target: bayeux, targetDay: "2026-11-11", today: "2026-11-02", days, settings });
    expect(res[0]!.day).toBe("2026-11-10");
    expect(res[0]!.pros.join(" ")).toMatch(/même secteur/);
    expect(res[0]!.pros.join(" ")).toMatch(/consacré au secteur/);
    // Le créneau s'insère entre les deux rendez-vous existants
    expect(res[0]!.start).toBeGreaterThan(9 * 60 + 45);
    expect(res[0]!.end).toBeLessThan(15 * 60);
  });

  it("explique les inconvénients (secteur non prévu, déplacement dédié)", () => {
    const res = suggestSlots({ target: bayeux, targetDay: "2026-11-12", today: "2026-11-02", days: week(), settings, maxResults: 20 });
    const thursday = res.find((s) => s.day === "2026-11-12");
    expect(thursday?.cons.join(" ")).toMatch(/prévu pour 50/);
    expect(thursday?.cons.join(" ")).toMatch(/déplacement dédié/);
  });

  it("n'exclut ni les jours fériés ni les jours refusés par le pharmacien sans raison", () => {
    const res = suggestSlots({
      target: { ...bayeux, excludedWeekdays: [1] },
      targetDay: "2026-11-11",
      today: "2026-11-02",
      days: week(),
      settings,
      maxResults: 50,
    });
    expect(res.some((s) => s.day === "2026-11-11")).toBe(false); // 11 novembre férié
    expect(res.some((s) => s.day === "2026-11-09")).toBe(false); // lundi refusé
  });

  it("ne propose jamais de date passée", () => {
    const res = suggestSlots({ target: bayeux, targetDay: "2026-10-01", today: "2026-11-02", days: week(), settings, maxResults: 50 });
    expect(res.every((s) => s.day > "2026-11-02")).toBe(true);
  });

  it("respecte la pause déjeuner et les horaires du pharmacien", () => {
    const plan: DayPlan = { appointments: [], preferredDepartments: ["14"] };
    const slot = bestSlotInDay(plan, { ...bayeux, preferredStart: 12 * 60 + 15 }, 45, settings);
    expect(slot!.start).toBeGreaterThanOrEqual(13 * 60 + 30);
  });

  it("refuse une journée sans créneau compatible", () => {
    const plan: DayPlan = {
      appointments: [{ id: "x", label: "Absent", start: 8 * 60, end: 19 * 60, location: null, departmentCode: null, kind: "unavailable" }],
      preferredDepartments: [],
    };
    expect(bestSlotInDay(plan, bayeux, 45, settings)).toBeNull();
  });
});

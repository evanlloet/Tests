import { describe, expect, it } from "vitest";
import { PLACES } from "../../../tests/fixtures/places";
import { estimateMatrix } from "./estimate";
import { compareScenarios, optimizeDay } from "./optimizer";
import { simulateDay, type DayContext, type PlanStop } from "./schedule";

const ctx: DayContext = {
  workStart: 7 * 60 + 30,
  workEnd: 19 * 60,
  lunchStart: 12 * 60 + 30,
  lunchMinutes: 60,
  lunchFlexMinutes: 60,
  bufferMinutes: 10,
  maxDriveMinutes: 360,
};

// 0 = domicile (Rennes), puis les pharmacies
const points = [PLACES.rennes, PLACES.caen, PLACES.bayeux, PLACES.lisieux, PLACES.falaise, PLACES.vire, PLACES.honfleur];
const matrix = estimateMatrix(points);
const stop = (id: string, pointIndex: number, extra: Partial<PlanStop> = {}): PlanStop => ({
  id,
  label: id,
  pointIndex,
  durationMin: 45,
  fixedStart: null,
  earliest: null,
  latest: null,
  ...extra,
});

describe("simulation d'une journée", () => {
  it("calcule horaires, trajets et retour", () => {
    const s = simulateDay({ ctx, stops: [stop("caen", 1), stop("bayeux", 2)], startIndex: 0, endIndex: 0, matrix });
    expect(s.stops).toHaveLength(2);
    expect(s.departure).toBe(ctx.workStart);
    expect(s.stops[0]!.arrival).toBeCloseTo(ctx.workStart + matrix.durationsMin[0]![1]!, 5);
    expect(s.stops[1]!.arrival).toBeCloseTo(s.stops[0]!.end + ctx.bufferMinutes + matrix.durationsMin[1]![2]!, 5);
    expect(s.totalKm).toBeCloseTo(matrix.distancesKm[0]![1]! + matrix.distancesKm[1]![2]! + matrix.distancesKm[2]![0]!, 5);
    expect(s.violations).toEqual([]);
  });

  it("respecte l'heure d'un rendez-vous confirmé (attente si en avance)", () => {
    const s = simulateDay({ ctx, stops: [stop("caen", 1, { fixedStart: 15 * 60 })], startIndex: 0, endIndex: 0, matrix });
    expect(s.stops[0]!.start).toBe(15 * 60);
    expect(s.departure).toBeCloseTo(15 * 60 - matrix.durationsMin[0]![1]!, 5);
  });

  it("signale un retard sur rendez-vous confirmé comme contrainte bloquante", () => {
    const s = simulateDay({
      ctx,
      stops: [stop("caen", 1, { fixedStart: 9 * 60 }), stop("honfleur", 6, { fixedStart: 9 * 60 + 50 })],
      startIndex: 0,
      endIndex: 0,
      matrix,
    });
    expect(s.violations.find((v) => v.code === "late_confirmed")).toMatchObject({ severity: "hard", stopId: "honfleur" });
  });

  it("protège la pause déjeuner", () => {
    const s = simulateDay({
      ctx,
      stops: [stop("a", 1, { durationMin: 120 }), stop("b", 2, { durationMin: 120 }), stop("c", 3, { durationMin: 60 })],
      startIndex: 0,
      endIndex: 0,
      matrix,
    });
    expect(s.lunch).not.toBeNull();
    expect(s.lunch!.end - s.lunch!.start).toBe(60);
    for (const st of s.stops) {
      const overlaps = st.start < s.lunch!.end && st.end > s.lunch!.start;
      expect(overlaps).toBe(false);
    }
  });

  it("signale une journée trop longue", () => {
    const many = [1, 2, 3, 4, 5, 6].map((i) => stop(`p${i}`, i, { durationMin: 75 }));
    const s = simulateDay({ ctx, stops: many, startIndex: 0, endIndex: 0, matrix });
    expect(s.violations.some((v) => v.code === "day_too_long")).toBe(true);
  });

  it("respecte la fenêtre horaire préférée du pharmacien", () => {
    const s = simulateDay({ ctx, stops: [stop("caen", 1, { earliest: 14 * 60 })], startIndex: 0, endIndex: 0, matrix });
    expect(s.stops[0]!.start).toBeGreaterThanOrEqual(14 * 60);
  });
});

describe("optimisation de l'ordre", () => {
  const initialOrder = [stop("lisieux", 3), stop("bayeux", 2), stop("falaise", 4), stop("caen", 1)];

  it("réduit les kilomètres par rapport à l'ordre initial", () => {
    const initial = simulateDay({ ctx, stops: initialOrder, startIndex: 0, endIndex: 0, matrix });
    const best = optimizeDay({ ctx, stops: initialOrder, startIndex: 0, endIndex: 0, matrix });
    expect(best.method).toBe("exhaustive");
    expect(best.schedule.totalKm).toBeLessThan(initial.totalKm - 20);
    const cmp = compareScenarios(initial, best.schedule);
    expect(cmp.worthApplying).toBe(true);
    expect(cmp.kmSaved).toBeGreaterThan(20);
    expect(cmp.explanation[0]).toMatch(/^Distance/);
  });

  it("ne déplace jamais un rendez-vous confirmé", () => {
    const stops = [stop("lisieux", 3), stop("bayeux", 2, { fixedStart: 9 * 60 + 30 }), stop("falaise", 4), stop("caen", 1, { fixedStart: 16 * 60 })];
    const best = optimizeDay({ ctx, stops, startIndex: 0, endIndex: 0, matrix });
    const byId = Object.fromEntries(best.schedule.stops.map((s) => [s.id, s]));
    expect(byId.bayeux!.start).toBe(9 * 60 + 30);
    expect(byId.caen!.start).toBe(16 * 60);
    expect(best.schedule.violations.filter((v) => v.severity === "hard")).toEqual([]);
  });

  it("garde l'ordre actuel s'il est déjà optimal", () => {
    const sorted = optimizeDay({ ctx, stops: initialOrder, startIndex: 0, endIndex: 0, matrix }).order;
    const again = optimizeDay({ ctx, stops: sorted, startIndex: 0, endIndex: 0, matrix });
    const initial = simulateDay({ ctx, stops: sorted, startIndex: 0, endIndex: 0, matrix });
    const cmp = compareScenarios(initial, again.schedule);
    expect(cmp.orderChanged).toBe(false);
    expect(cmp.worthApplying).toBe(false);
  });

  it("utilise une recherche locale au-delà de 8 visites, sans dégrader le résultat", () => {
    const pts = [
      PLACES.rennes,
      PLACES.caen,
      PLACES.bayeux,
      PLACES.lisieux,
      PLACES.falaise,
      PLACES.vire,
      PLACES.honfleur,
      PLACES.saintLo,
      PLACES.coutances,
      PLACES.granville,
      PLACES.avranches,
    ];
    const m = estimateMatrix(pts);
    const stops = [10, 3, 7, 1, 9, 4, 2, 8, 6, 5].map((i) => stop(`p${i}`, i, { durationMin: 20 }));
    const initial = simulateDay({ ctx, stops, startIndex: 0, endIndex: 0, matrix: m });
    const best = optimizeDay({ ctx, stops, startIndex: 0, endIndex: 0, matrix: m });
    expect(best.method).toBe("local_search");
    expect(best.schedule.cost).toBeLessThanOrEqual(initial.cost);
    expect(best.schedule.totalKm).toBeLessThan(initial.totalKm);
    expect(best.order).toHaveLength(10);
  });

  it("est déterministe", () => {
    const a = optimizeDay({ ctx, stops: initialOrder, startIndex: 0, endIndex: 0, matrix });
    const b = optimizeDay({ ctx, stops: initialOrder, startIndex: 0, endIndex: 0, matrix });
    expect(a.order.map((s) => s.id)).toEqual(b.order.map((s) => s.id));
  });
});

describe("cohérence après application", () => {
  it("un scénario appliqué puis re-simulé avec ses horaires figés ne crée aucun retard", () => {
    const flexible = [stop("lisieux", 3), stop("bayeux", 2), stop("falaise", 4), stop("caen", 1), stop("vire", 5)];
    const best = optimizeDay({ ctx, stops: flexible, startIndex: 0, endIndex: 0, matrix });
    for (const s of best.schedule.stops) expect(s.start % 5).toBe(0);
    // Les horaires proposés deviennent des rendez-vous confirmés (minutes entières)
    const fixed = best.schedule.stops.map((s) => stop(s.id, s.pointIndex, { fixedStart: s.start }));
    const again = simulateDay({ ctx, stops: fixed, startIndex: 0, endIndex: 0, matrix });
    expect(again.violations.filter((v) => v.severity === "hard")).toEqual([]);
    expect(again.stops.map((s) => s.start)).toEqual(best.schedule.stops.map((s) => s.start));
  });

  it("ne repousse pas la pause déjeuner au point de mettre en retard un rendez-vous confirmé", () => {
    const stops = [
      // Caen se termine à 13 h 40 ; Bayeux (≈ 35 min de route) est confirmé à 14 h 30
      stop("caen", 1, { fixedStart: 11 * 60, durationMin: 160 }),
      stop("bayeux", 2, { fixedStart: 14 * 60 + 30 }),
    ];
    const s = simulateDay({ ctx, stops, startIndex: 0, endIndex: 0, matrix });
    expect(s.violations.some((v) => v.code === "late_confirmed")).toBe(false);
    expect(s.violations.some((v) => v.code === "lunch_not_protected")).toBe(true);
  });
});

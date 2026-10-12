import { describe, expect, it } from "vitest";
import { PLACES } from "../../../tests/fixtures/places";
import { DEFAULT_ESTIMATE } from "../routing/estimate";
import { zonedDateTime } from "../time";
import { analyzeHistory, type HistoricalVisit } from "./history";

let n = 0;
const v = (day: string, time: string, id: string, dept: string, loc: { lat: number; lng: number }, minutes = 45, outcome: HistoricalVisit["outcome"] = "unknown"): HistoricalVisit => {
  const start = zonedDateTime(day, time);
  return { id: `v${n++}`, pharmacyId: id, pharmacyName: id.toUpperCase(), departmentCode: dept, location: loc, start, end: new Date(start.getTime() + minutes * 60_000), outcome };
};

const visits: HistoricalVisit[] = [
  // Lundis Calvados : Caen + Bayeux ensemble 3 fois
  v("2026-01-05", "09:00", "caen", "14", PLACES.caen, 45, "done"),
  v("2026-01-05", "11:00", "bayeux", "14", PLACES.bayeux),
  v("2026-03-02", "09:00", "caen", "14", PLACES.caen, 60),
  v("2026-03-02", "11:00", "bayeux", "14", PLACES.bayeux),
  v("2026-05-04", "09:00", "caen", "14", PLACES.caen, 30),
  v("2026-05-04", "11:00", "bayeux", "14", PLACES.bayeux),
  // Mercredi + jeudi Manche (Cherbourg, lointain) consécutifs
  v("2026-03-04", "10:00", "cherbourg", "50", PLACES.cherbourg),
  v("2026-03-05", "10:00", "cherbourg2", "50", PLACES.cherbourg),
  // Vendredi Ille-et-Vilaine
  v("2026-03-06", "10:00", "rennes", "35", PLACES.rennes),
  v("2026-03-06", "14:00", "rennes", "35", PLACES.rennes, 45, "missed"),
];

describe("analyse de l'historique", () => {
  const a = analyzeHistory({ visits, tz: "Europe/Paris", home: PLACES.rennes, hotelThresholdKm: 150, estimate: DEFAULT_ESTIMATE });

  it("compte visites, pharmacies et journées (visites manquées exclues)", () => {
    expect(a.totals).toMatchObject({ visits: 9, done: 1, identified: 8, pharmacies: 5, days: 6, firstDay: "2026-01-05", lastDay: "2026-05-04" });
  });

  it("calcule la fréquence historique par pharmacie", () => {
    const caen = a.perPharmacy.find((p) => p.pharmacyId === "caen")!;
    expect(caen.count).toBe(3);
    expect(caen.lastDay).toBe("2026-05-04");
    expect(caen.avgIntervalDays).toBe(60);
  });

  it("répartit les visites par jour de semaine et par secteur", () => {
    expect(a.weekdays.find((w) => w.weekday === 1)).toEqual({ weekday: 1, visits: 6, days: 3 });
    const monday = a.sectorsByWeekday.find((s) => s.weekday === 1)!;
    expect(monday.departments[0]).toMatchObject({ code: "14", share: 1 });
  });

  it("calcule la durée moyenne et médiane", () => {
    expect(a.durations.measured).toBe(9);
    expect(a.durations.medianMin).toBe(45);
  });

  it("repère les journées lointaines et les nuits probables", () => {
    // Depuis Rennes, le Calvados (~190 km estimés) et Cherbourg dépassent le seuil de 150 km
    expect(a.farDays!.count).toBe(5);
    expect(a.farDays!.byWeekday.find((w) => w.weekday === 1)!.count).toBe(3);
    expect(a.farDays!.consecutiveSequences).toBe(1);
    expect(a.mileage!.daysMeasured).toBe(6);
  });

  it("détecte les regroupements géographiques récurrents", () => {
    expect(a.clusters).toHaveLength(1);
    expect(a.clusters[0]!.pharmacies.map((p) => p.id)).toEqual(["bayeux", "caen"]);
    expect(a.clusters[0]!.sharedDays).toBe(3);
  });
});

describe("regroupements", () => {
  it("n'enchaîne pas A–B et B–C en un groupe A–B–C sans lien entre A et C", () => {
    const visits: HistoricalVisit[] = [];
    for (const day of ["2026-01-05", "2026-02-02", "2026-03-02", "2026-04-06"]) {
      visits.push(v(day, "09:00", "a", "14", PLACES.caen), v(day, "11:00", "b", "14", PLACES.bayeux));
    }
    for (const day of ["2026-05-04", "2026-06-01", "2026-07-06"]) {
      visits.push(v(day, "09:00", "b", "14", PLACES.bayeux), v(day, "11:00", "c", "14", PLACES.lisieux));
    }
    const a = analyzeHistory({ visits, tz: "Europe/Paris", home: null, hotelThresholdKm: 150, estimate: DEFAULT_ESTIMATE });
    // Le lien le plus fort (A–B) forme le groupe ; C n'y entre pas faute de lien avec A
    expect(a.clusters.map((c) => c.pharmacies.map((p) => p.id))).toEqual([["a", "b"]]);
  });
});

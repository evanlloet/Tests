import { describe, expect, it } from "vitest";
import { detectPhoneVisits, type PhoneVisitInput } from "./phone";

const RENNES = { lat: 48.1113, lng: -1.68 };
const at = (hhmm: string) => new Date(`2026-10-02T${hhmm}:00+02:00`);
const visit = (id: string, from: string, to: string, place: string, lat: number, lng: number): PhoneVisitInput => ({
  id,
  start: at(from),
  end: at(to),
  pharmacyKey: id,
  place,
  location: { lat, lng },
});

describe("détection des rendez-vous téléphoniques", () => {
  it("repère un rendez-vous impossible à faire sur place (Manche au milieu d'une journée en Ille-et-Vilaine)", () => {
    const result = detectPhoneVisits({
      visits: [
        visit("liffre", "09:30", "11:00", "Liffré", 48.2135, -1.5065),
        visit("brix", "11:00", "11:30", "Brix", 49.5458, -1.5814),
        visit("st-aubin", "11:30", "12:30", "Saint-Aubin-du-Cormier", 48.2611, -1.4006),
        visit("fougeres", "13:00", "14:00", "Fougères", 48.3524, -1.1986),
      ],
      teleworkBlocks: [],
      dayStart: RENNES,
      dayEnd: RENNES,
    });
    expect([...result.keys()]).toEqual(["brix"]);
    expect(result.get("brix")!.level).toBe("certain");
  });

  it("garde une visite isolée placée sur la route du retour", () => {
    const result = detectPhoneVisits({
      visits: [
        visit("cherbourg-1", "09:30", "10:30", "Cherbourg", 49.6337, -1.6222),
        visit("cherbourg-2", "10:30", "11:30", "Cherbourg", 49.64, -1.6),
        visit("tourlaville", "14:00", "15:00", "Tourlaville", 49.6386, -1.5672),
        visit("periers", "17:00", "18:00", "Périers", 49.1869, -1.4078),
      ],
      teleworkBlocks: [],
      dayStart: { lat: 49.62, lng: -1.58 },
      dayEnd: RENNES,
    });
    expect(result.has("periers")).toBe(false);
  });

  it("classe en téléphone tout rendez-vous pris pendant le télétravail", () => {
    const result = detectPhoneVisits({
      visits: [visit("mayenne", "09:30", "10:00", "Mayenne", 48.3, -0.61), visit("granville", "11:00", "11:30", "Granville", 48.84, -1.6)],
      teleworkBlocks: [{ start: at("09:00"), end: at("17:00") }],
      dayStart: RENNES,
      dayEnd: RENNES,
    });
    expect(result.get("mayenne")).toEqual({ level: "certain", reason: "Pris pendant le télétravail" });
    expect(result.size).toBe(2);
  });

  it("ne signale rien sur une journée regroupée", () => {
    const result = detectPhoneVisits({
      visits: [visit("a", "09:30", "10:30", "Caen", 49.18, -0.37), visit("b", "11:00", "12:00", "Hérouville", 49.2, -0.33), visit("c", "14:00", "15:00", "Bayeux", 49.28, -0.7)],
      teleworkBlocks: [],
      dayStart: RENNES,
      dayEnd: RENNES,
    });
    expect(result.size).toBe(0);
  });
});

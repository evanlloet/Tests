import { describe, expect, it } from "vitest";
import { buildMatchIndex, decideMatch, scoreCandidates, type MatchablePharmacy } from "./matching";

const ph = (id: string, name: string, city: string, postalCode: string, addressLine: string | null = null): MatchablePharmacy => ({
  id,
  name,
  city,
  postalCode,
  addressLine,
});

const pharmacies = [
  ph("lemoine", "Pharmacie Lemoine", "Caen", "14000", "12 rue Saint-Jean"),
  ph("centre-caen", "Pharmacie du Centre", "Caen", "14000"),
  ph("centre-bayeux", "Pharmacie du Centre", "Bayeux", "14400"),
  ph("gare-lisieux", "Pharmacie de la Gare", "Lisieux", "14100"),
  ph("bayeux", "Grande Pharmacie de Bayeux", "Bayeux", "14400"),
  ph("saint-lo", "Pharmacie de Saint-Lô", "Saint-Lô", "50000"),
  ph("port", "Pharmacie du Port", "Honfleur", "14600"),
];
const index = buildMatchIndex(pharmacies);
const top = (title: string, location: string | null = null) => scoreCandidates({ title, location }, index);

describe("rapprochement agenda ↔ pharmacies", () => {
  it("valide automatiquement un nom distinctif avec sa commune", () => {
    const c = top("RDV Pharmacie Lemoine", "Caen");
    expect(c[0]!.pharmacyId).toBe("lemoine");
    expect(c[0]!.score).toBeGreaterThanOrEqual(0.9);
    expect(decideMatch(c, 0.9).status).toBe("auto_validated");
    expect(c[0]!.reasons.join(" ")).toMatch(/lemoine/);
  });

  it("demande une validation quand la commune manque", () => {
    const c = top("Pharmacie Lemoine");
    expect(c[0]!.pharmacyId).toBe("lemoine");
    expect(decideMatch(c, 0.9).status).toBe("pending");
  });

  it("départage deux pharmacies homonymes grâce à la commune", () => {
    const c = top("Ph. du Centre", "Bayeux");
    expect(c[0]!.pharmacyId).toBe("centre-bayeux");
    expect(c.find((x) => x.pharmacyId === "centre-caen")!.score).toBeLessThan(c[0]!.score);
  });

  it("reste prudent sur un nom ambigu sans commune", () => {
    const c = top("Pharmacie du Centre");
    const d = decideMatch(c, 0.9);
    expect(d.status).not.toBe("auto_validated");
    expect(c.slice(0, 2).map((x) => x.pharmacyId).sort()).toEqual(["centre-bayeux", "centre-caen"]);
  });

  it("tolère une faute de frappe", () => {
    const c = top("visite pharmacie Lemoinne Caen");
    expect(c[0]!.pharmacyId).toBe("lemoine");
    expect(c[0]!.reasons.join(" ")).toMatch(/faute de frappe/);
  });

  it("reconnaît une pharmacie désignée par sa commune", () => {
    expect(top("Pharmacie St-Lô")[0]!.pharmacyId).toBe("saint-lo");
  });

  it("ne propose rien pour un événement sans rapport", () => {
    expect(decideMatch(top("Réunion budget"), 0.9).status).toBe("no_candidate");
  });

  it("utilise l'adresse du lieu comme indice", () => {
    const c = top("Pharmacie Lemoine", "12 rue Saint-Jean, Caen");
    expect(c[0]!.reasons.join(" ")).toMatch(/Adresse cohérente/);
  });

  it("n'utilise la description que si elle est autorisée", () => {
    const event = { title: "RDV", location: null, description: "Pharmacie du Port Honfleur" };
    expect(scoreCandidates(event, index)).toHaveLength(0);
    expect(scoreCandidates(event, index, { useDescription: true })[0]!.pharmacyId).toBe("port");
  });
});

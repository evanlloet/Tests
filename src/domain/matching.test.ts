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

describe("contexte de la journée et commune seule", () => {
  it("propose les pharmacies d'une commune quand seul son nom est indiqué", () => {
    const c = top("Ph. Honfleur");
    expect(c[0]!.pharmacyId).toBe("port");
    expect(c[0]!.reasons.join(" ")).toMatch(/Seule la commune/);
    expect(decideMatch(c, 0.9).status).toBe("pending");
  });

  it("départage deux homonymes grâce au secteur des autres rendez-vous du jour", async () => {
    const { applyDayContext, isAmbiguous } = await import("./matching");
    const homonyms = buildMatchIndex([ph("morel-caen", "Pharmacie Morel", "Caen", "14000"), ph("morel-aigle", "Pharmacie Morel", "L'Aigle", "61300")]);
    const c = scoreCandidates({ title: "RDV Pharmacie Morel", location: null }, homonyms);
    expect(isAmbiguous(c)).toBe(true);
    const geo = new Map([
      ["morel-caen", { departmentCode: "14", location: { lat: 49.18, lng: -0.37 } }],
      ["morel-aigle", { departmentCode: "61", location: { lat: 48.76, lng: 0.63 } }],
    ]);
    const ctx = { departments: new Map([["14", 3]]), points: [{ lat: 49.28, lng: -0.7 }] };
    const adjusted = applyDayContext(c, ctx, geo, (code) => (code === "14" ? "Calvados" : code));
    expect(adjusted[0]!.pharmacyId).toBe("morel-caen");
    expect(adjusted[0]!.reasons.join(" ")).toMatch(/Même secteur \(Calvados\)/);
    expect(isAmbiguous(adjusted)).toBe(false);
    expect(decideMatch(adjusted, 0.9).status).toBe("auto_validated");
  });

  it("ne modifie rien sans contexte", async () => {
    const { applyDayContext } = await import("./matching");
    const c = top("Pharmacie Lemoine");
    expect(applyDayContext(c, undefined, new Map())).toEqual(c);
  });
});

describe("consensus d'une journée sans ancrage", () => {
  it("favorise le département compatible avec tous les autres rendez-vous ambigus du jour", async () => {
    const { applyDayConsensus, isAmbiguous } = await import("./matching");
    const idx = buildMatchIndex([
      ph("centre-caen", "Pharmacie du Centre", "Caen", "14000"),
      ph("centre-coutances", "Pharmacie du Centre", "Coutances", "50200"),
      ph("gauthier-granville", "Pharmacie Gauthier", "Granville", "50400"),
      ph("gauthier-evron", "Pharmacie Gauthier", "Évron", "53600"),
      ph("perrin-granville", "Pharmacie Perrin", "Granville", "50400"),
      ph("perrin-laval", "Pharmacie Perrin", "Laval", "53000"),
    ]);
    const dept: Record<string, string> = {
      "centre-caen": "14",
      "centre-coutances": "50",
      "gauthier-granville": "50",
      "gauthier-evron": "53",
      "perrin-granville": "50",
      "perrin-laval": "53",
    };
    const geo = new Map(Object.entries(dept).map(([id, d]) => [id, { departmentCode: d, location: null }]));
    const day = ["Ph. Centre", "RDV Pharmacie Gauthier", "RDV Pharmacie Perrin"].map((t) => scoreCandidates({ title: t, location: null }, idx));
    expect(day.every((c) => isAmbiguous(c))).toBe(true);
    const adjusted = applyDayConsensus(day, geo);
    expect(adjusted.map((c) => c[0]!.pharmacyId)).toEqual(["centre-coutances", "gauthier-granville", "perrin-granville"]);
    // Réordonne sans valider seul
    expect(adjusted.every((c) => decideMatch(c, 0.9).status === "pending")).toBe(true);
  });
});

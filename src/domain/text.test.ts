import { describe, expect, it } from "vitest";
import { agendaTokens, normalizeCity, normalizePharmacyName, normalizeText, pharmacyDedupeKey, readablePharmacyName, trigramSimilarity } from "./text";

describe("normalisation", () => {
  it("retire accents, casse et ponctuation", () => {
    expect(normalizeText("  Pharmacie de l'Église – Saint-Lô ")).toBe("pharmacie de l eglise saint lo");
  });
  it("normalise les abréviations de commune", () => {
    expect(normalizeCity("St-Lô")).toBe("saint lo");
    expect(normalizeCity("Ste Mère Église")).toBe("sainte mere eglise");
    expect(normalizeCity("CAEN CEDEX 4")).toBe("caen");
  });
  it("ne garde que les mots distinctifs du nom", () => {
    expect(normalizePharmacyName("SELARL Pharmacie du Centre")).toBe("centre");
    expect(normalizePharmacyName("Grande Pharmacie de Bayeux")).toBe("grande bayeux");
  });
  it("produit une clé de dédoublonnage stable", () => {
    expect(pharmacyDedupeKey("Pharmacie du Centre", "14000", "Caen")).toBe(
      pharmacyDedupeKey("PHARMACIE DU CENTRE", "14 000", "CAEN"),
    );
    expect(pharmacyDedupeKey("Pharmacie du Centre", "14000", "Caen")).not.toBe(
      pharmacyDedupeKey("Pharmacie du Centre", "14400", "Bayeux"),
    );
  });
  it("tolère les fautes de frappe", () => {
    expect(trigramSimilarity("lemoine", "lemoinne")).toBeGreaterThan(0.6);
    expect(trigramSimilarity("lemoine", "martin")).toBeLessThan(0.2);
  });

  it("développe les abréviations des fichiers clients et des agendas", () => {
    expect(normalizePharmacyName("SELAS GDE PHIE DU MOULIN")).toBe("grande moulin");
    expect(normalizePharmacyName("Grande Pharmacie du Moulin")).toBe("grande moulin");
    expect(agendaTokens("RDV Phie St Michel")).toEqual(["saint", "michel"]);
  });
});

describe("nom lisible à partir d'une raison sociale", () => {
  it.each([
    ["SELARL GRANDE PHIE DES GOELANDS", "Grande Pharmacie des Goelands"],
    ["SELAS GDE PHIE DU MOULIN", "Grande Pharmacie du Moulin"],
    ["SELARL PHIE DE L ABBAYE", "Pharmacie de l'Abbaye"],
    ["SELARL PHIE D ARVILLE C CIAL LES PINS", "Pharmacie d'Arville Centre Commercial les Pins"],
    ["SELARL PHIE ST GERMAIN", "Pharmacie Saint Germain"],
    ["SELARL PHIE LE BIHAN", "Pharmacie Le Bihan"],
    ["MME LE GALL DURAND ANNE", "Mme Le Gall Durand Anne"],
    ["M TRAN", "M. Tran"],
    ["SARL DUPRE-LEROY", "Dupre-Leroy"],
    ["SELARL BCD", "BCD"],
    ["HYPER EXEMPLE FRA000", "Hyper Exemple FRA000"],
    ["SAS STE DE DISTRI DU BOCAGE", "Ste de Distri du Bocage"],
  ])("%s → %s", (raw, expected) => {
    expect(readablePharmacyName(raw)).toBe(expected);
  });

  it("ne réécrit pas un nom déjà en minuscules, mais retire la forme juridique", () => {
    expect(readablePharmacyName("Pharmacie du Port")).toBe("Pharmacie du Port");
    expect(readablePharmacyName("SELARL Pharmacie du Port")).toBe("Pharmacie du Port");
  });
});

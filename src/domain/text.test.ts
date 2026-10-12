import { describe, expect, it } from "vitest";
import { normalizeCity, normalizePharmacyName, normalizeText, pharmacyDedupeKey, trigramSimilarity } from "./text";

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
});

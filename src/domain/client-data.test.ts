import { describe, expect, it } from "vitest";
import { geoLabel, isApproximate, revenueEvolution } from "./client-data";

describe("données du fichier clients", () => {
  it("calcule l'évolution A / A-1 comme le fichier", () => {
    expect(revenueEvolution("100000", "140000")).toBeCloseTo(0.4, 4);
    expect(revenueEvolution(20000, 18000)).toBeCloseTo(-0.1, 4);
    expect(revenueEvolution(null, 100)).toBeNull();
    expect(revenueEvolution(0, 100)).toBeNull();
  });

  it("décrit honnêtement la géolocalisation", () => {
    const approx = { lat: 49.6, geoPrecision: "city", geoSource: "centre_commune:commune-nouvelle:Cherbourg-en-Cotentin" };
    expect(geoLabel(approx)).toBe("Approximative : centre de la commune nouvelle (Cherbourg-en-Cotentin)");
    expect(isApproximate(approx)).toBe(true);
    expect(isApproximate({ lat: 49.1, geoPrecision: "exact" })).toBe(false);
    expect(geoLabel({ lat: null, geoPrecision: null, geoSource: null })).toBe("Non géolocalisée");
  });
});

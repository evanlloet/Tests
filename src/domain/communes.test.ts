import { describe, expect, it } from "vitest";
import { locateCommune } from "./communes";

describe("centre approximatif des communes", () => {
  it("retrouve une commune par nom et code postal", () => {
    const caen = locateCommune("14000", "CAEN");
    expect(caen).toMatchObject({ name: "Caen", basis: "commune" });
    expect(caen!.lat).toBeCloseTo(49.18, 1);
    expect(caen!.lng).toBeCloseTo(-0.37, 1);
    expect(locateCommune("50000", "ST LO")).toMatchObject({ name: "Saint-Lô" });
  });

  it("gère les communes déléguées, renommées ou fusionnées", () => {
    // Commune déléguée sans tracé propre : centre de la commune nouvelle
    expect(locateCommune("50110", "TOURLAVILLE")).toMatchObject({ name: "Cherbourg-en-Cotentin", basis: "commune-nouvelle" });
    // Ancien nom (« Le Hom », « Saline ») encore utilisé dans les fichiers
    expect(locateCommune("14220", "LE HOM")).toMatchObject({ code: "14689" });
    expect(locateCommune("14670", "SALINE")).toMatchObject({ code: "14712" });
    // Nom abrégé : « Cherbourg » → Cherbourg-en-Cotentin (même code postal)
    expect(locateCommune("50100", "CHERBOURG")).toMatchObject({ code: "50129" });
  });

  it("ne devine rien quand la commune est inconnue", () => {
    expect(locateCommune("95300", "HEROUVILLE")).toBeNull(); // hors des départements couverts
    expect(locateCommune("14220", "Ville imaginaire")).toBeNull(); // code postal partagé par plusieurs communes
    expect(locateCommune(null, null)).toBeNull();
  });

  it("se rabat sur la seule commune du code postal, en le signalant", () => {
    expect(locateCommune("14000", "Ville imaginaire")).toMatchObject({ name: "Caen", basis: "code-postal" });
    expect(locateCommune("14000", "Caen Centre")).toMatchObject({ name: "Caen", basis: "commune" }); // début du nom
  });
});

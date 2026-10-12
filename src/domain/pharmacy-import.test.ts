import { describe, expect, it } from "vitest";
import { parseDecimal, parsePharmacyCsv } from "./pharmacy-import";

describe("import CSV de pharmacies", () => {
  it("reconnaît les colonnes, le département et l'identifiant FINESS", () => {
    const res = parsePharmacyCsv(
      [
        "Nom;Adresse;Code postal;Ville;FINESS;Latitude;Longitude;Catégorie;CA",
        "Pharmacie Lemoine;12 rue Saint-Jean;14000;Caen;140012345;49,1829;-0,3707;A;1 250 000,50",
        "Pharmacie du Port;1 quai;14600;Honfleur;140067890;;;;",
      ].join("\n"),
    );
    expect(res.issues).toEqual([]);
    expect(res.externalSource).toBe("finess");
    expect(res.rows[0]).toMatchObject({
      name: "Pharmacie Lemoine",
      postalCode: "14000",
      departmentCode: "14",
      externalId: "140012345",
      externalSource: "finess",
      lat: 49.1829,
      lng: -0.3707,
      category: "A",
      annualRevenue: 1250000.5,
    });
    // Valeurs absentes : laissées vides, jamais devinées
    expect(res.rows[1]).toMatchObject({ lat: null, lng: null, category: null, annualRevenue: null });
  });

  it("signale les valeurs invalides sans les inventer", () => {
    const res = parsePharmacyCsv("nom,cp,ville,categorie,latitude,longitude\nPharmacie X,1400,Caen,Z,abc,2");
    expect(res.rows[0]).toMatchObject({ postalCode: "01400", category: null, lat: null, lng: null });
    expect(res.issues.map((i) => i.message).join(" ")).toMatch(/Catégorie « Z »/);
  });

  it("corrige des coordonnées inversées", () => {
    const res = parsePharmacyCsv("nom,cp,ville,lat,lon\nPharmacie X,14000,Caen,-0.37,49.18");
    expect(res.rows[0]).toMatchObject({ lat: 49.18, lng: -0.37 });
  });

  it("écarte les doublons internes au fichier", () => {
    const res = parsePharmacyCsv("nom,cp,ville\nPharmacie du Centre,14000,Caen\nPHARMACIE DU CENTRE,14000,CAEN");
    expect(res.rows).toHaveLength(1);
    expect(res.issues[0]!.message).toMatch(/doublon/);
  });

  it("exige une colonne de nom", () => {
    expect(() => parsePharmacyCsv("ville\nCaen")).toThrow(/nom/);
  });

  it("lit les nombres français et anglais", () => {
    expect(parseDecimal("1 234,5")).toBe(1234.5);
    expect(parseDecimal("1.234,5")).toBe(1234.5);
    expect(parseDecimal("1,234.5")).toBe(1234.5);
    expect(parseDecimal("-1,6778")).toBe(-1.6778);
    expect(parseDecimal("abc")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDay, parseDecimal, parsePharmacyCsv, parsePharmacyFile } from "./pharmacy-import";

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const clientsXlsx = () => new Uint8Array(readFileSync(path.join(__dirname, "../../tests/fixtures/clients-exemple.xlsx")));

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

describe("fichier clients Excel (format de l'export CLIENTS)", () => {
  const res = parsePharmacyFile(clientsXlsx(), decode);

  it("associe chaque colonne à un champ de Léa", () => {
    expect(res.format).toBe("xlsx");
    expect(res.externalSource).toBe("code_client");
    expect(Object.fromEntries(res.mapping.map((m) => [m.header, m.field]))).toEqual({
      Code: "externalId",
      "Lib Sous-Canal Client": "channel",
      "Nom Client": "name",
      "Code Postal": "postalCode",
      Ville: "city",
      "N° Tel": "phone",
      "Adresse Mail": "email",
      "Code UGA 746 Tiers Cde": "salesZone",
      "Lib Groupement Client": "buyingGroup",
      "Ciblage Client Oral Care": "category",
      "Ciblage Premium": "targeting",
      "Ciblage Perfect Store": "targeting",
      "Ciblage TLV": "targeting",
      "Ciblage GC": "targeting",
      "Nom Agent Oral Care": "extra",
      "KAM  régional": "extra",
      "Date de dernière Commande": "lastOrder",
      "Date de prochaine visite": "plannedVisit",
      "CAf CFaj A-1": "revenuePreviousYear",
      "CAf A": "revenueCurrentYear",
      "Evol A/A-1": "derived",
    });
  });

  it("lit une ligne complète sans rien inventer", () => {
    expect(res.rows[0]).toMatchObject({
      name: "Grande Pharmacie du Phare",
      legalName: "SELARL GRANDE PHIE DU PHARE",
      externalId: "9000001",
      channel: "Pharmacie",
      postalCode: "14000",
      departmentCode: "14",
      email: "contact@phare.example.test",
      salesZone: "14CAE",
      buyingGroup: "SAS GROUPEMENT EXEMPLE",
      category: "A",
      targeting: ["Perfect Store", "GC (R)"],
      revenuePreviousYear: 100000,
      revenueCurrentYear: 140000,
      lastOrderOn: "2026-08-31",
      plannedVisitOn: "2026-10-05",
      lat: null,
      extra: { "Nom Agent Oral Care": "Agent Exemple", "KAM  régional": "KAM Exemple" },
    });
    expect(res.rows[1]).toMatchObject({ name: "Exemple Distribution", channel: "GMS", targeting: ["Premium"], plannedVisitOn: null });
    // Valeurs absentes : vides, jamais déduites
    expect(res.rows[2]).toMatchObject({ targeting: ["GC"], buyingGroup: null, revenueCurrentYear: null });
    expect(res.rows[4]).toMatchObject({ name: "Mme Dupont Claire", revenuePreviousYear: null, revenueCurrentYear: 66 });
  });

  it("signale les incohérences du fichier", () => {
    const messages = res.issues.map((i) => `${i.row}: ${i.message}`);
    expect(messages).toContain("5: Code postal 95300 (département 95) éloigné de la zone 14HER : adresse à vérifier.");
    expect(messages.some((m) => m.startsWith("7: E-mail « pas-un-mail »"))).toBe(true);
    expect(res.rows[5]!.email).toBeNull();
    expect(res.issues).toHaveLength(2);
  });

  it("accepte les mêmes colonnes en CSV, avec « - » pour une valeur vide", () => {
    const csv = parsePharmacyCsv(
      ["Code;Nom Client;Code Postal;Ville;Ciblage Client Oral Care;Ciblage Premium;Date de prochaine visite;CA A-1;CA A", "42;SELARL PHIE DU PORT;14600;HONFLEUR;-;P;13/10/2026;1 200;-"].join("\n"),
    );
    expect(csv.rows[0]).toMatchObject({
      name: "Pharmacie du Port",
      externalId: "42",
      category: null,
      targeting: ["Premium"],
      plannedVisitOn: "2026-10-13",
      revenuePreviousYear: 1200,
      revenueCurrentYear: null,
    });
    expect(csv.issues).toEqual([]);
  });

  it("lit les dates françaises et ISO, refuse les dates impossibles", () => {
    expect(parseDay("2026-08-31")).toBe("2026-08-31");
    expect(parseDay("31/08/2026")).toBe("2026-08-31");
    expect(parseDay("1/9/26")).toBe("2026-09-01");
    expect(parseDay("30/02/2026")).toBeNull();
    expect(parseDay("demain")).toBeNull();
  });
});


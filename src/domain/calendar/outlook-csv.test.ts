import { describe, expect, it } from "vitest";
import { decodeTextFile } from "./decode";
import { detectDateOrder, parseOutlookCsv } from "./outlook-csv";

const FR_HEADER =
  '"Objet","Date de début","Heure de début","Date de fin","Heure de fin","Journée entière","Rappel actif/inactif","Date du rappel","Heure du rappel","Organisateur d\'une réunion","Participants obligatoires","Participants facultatifs","Ressources de la réunion","Facturation","Catégories","Description","Emplacement","Kilométrage","Critère de diffusion","Privé","Afficher la disponibilité"';

const row = (objet: string, d1: string, h1: string, d2: string, h2: string, allDay = "Faux", lieu = "", desc = "") =>
  `"${objet}","${d1}","${h1}","${d2}","${h2}","${allDay}","Faux","","","","","","","","","${desc}","${lieu}","","Normal","Faux","2"`;

describe("CSV Outlook (français)", () => {
  const csv = [
    FR_HEADER,
    row("Pharmacie Lemoine", "15/06/2026", "09:00:00", "15/06/2026", "09:45:00", "Faux", "Caen"),
    row("Congés", "20/07/2026", "00:00:00", "25/07/2026", "00:00:00", "Vrai"),
    row("Annulé : Pharmacie du Port", "16/06/2026", "14:00:00", "16/06/2026", "15:00:00", "Faux", "Honfleur"),
  ].join("\r\n");

  it("lit les événements et normalise les horaires en Europe/Paris", () => {
    const res = parseOutlookCsv(csv);
    expect(res.format).toBe("outlook_csv");
    expect(res.events).toHaveLength(3);
    const [visit] = res.events;
    expect(visit!.title).toBe("Pharmacie Lemoine");
    expect(visit!.location).toBe("Caen");
    expect(visit!.start.toISOString()).toBe("2026-06-15T07:00:00.000Z");
    expect(visit!.end.toISOString()).toBe("2026-06-15T07:45:00.000Z");
    expect(visit!.raw).toMatchObject({ format: "outlook_csv", line: 2 });
  });

  it("gère les journées entières et les annulations", () => {
    const res = parseOutlookCsv(csv);
    const conges = res.events[1]!;
    expect(conges.allDay).toBe(true);
    expect(conges.start.toISOString()).toBe("2026-07-19T22:00:00.000Z");
    expect(res.events[2]!.isCancelled).toBe(true);
  });

  it("produit des clés identiques à chaque import (idempotence)", () => {
    const a = parseOutlookCsv(csv).events.map((e) => e.sourceKey);
    const b = parseOutlookCsv(csv).events.map((e) => e.sourceKey);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
  });

  it("accepte un fichier ré-enregistré avec des points-virgules", () => {
    const semi = csv.replace(/","/g, '";"');
    expect(parseOutlookCsv(semi).events).toHaveLength(3);
  });

  it("signale les lignes illisibles sans bloquer l'import", () => {
    const bad = [FR_HEADER, row("RDV sans date", "", "", "", ""), row("Pharmacie X", "32/13/2026", "09:00", "32/13/2026", "10:00")].join("\n");
    const res = parseOutlookCsv(bad);
    expect(res.events).toHaveLength(0);
    expect(res.warnings.join(" ")).toMatch(/date de début illisible/);
  });

  it("refuse un fichier qui n'est pas un export de calendrier", () => {
    expect(() => parseOutlookCsv("nom;ville\nA;B")).toThrow(/Objet/);
  });
});

describe("CSV Outlook (anglais, AM/PM)", () => {
  it("détecte l'ordre mois/jour et les heures AM/PM", () => {
    const csv = [
      '"Subject","Start Date","Start Time","End Date","End Time","All day event","Location","Description"',
      '"Pharmacy visit Lemoine","6/15/2026","9:00:00 AM","6/15/2026","9:45:00 AM","False","Caen",""',
      '"Pharmacie du Port","6/16/2026","2:00:00 PM","6/16/2026","3:00:00 PM","False","Honfleur",""',
    ].join("\n");
    const res = parseOutlookCsv(csv);
    expect(res.events[0]!.start.toISOString()).toBe("2026-06-15T07:00:00.000Z");
    expect(res.events[1]!.start.toISOString()).toBe("2026-06-16T12:00:00.000Z");
  });
});

describe("détection du format de date", () => {
  it("tranche selon les valeurs", () => {
    expect(detectDateOrder(["15/06/2026", "01/02/2026"])).toBe("dmy");
    expect(detectDateOrder(["06/15/2026"])).toBe("mdy");
    expect(detectDateOrder(["01/02/2026"])).toBeNull();
  });
});

describe("décodage", () => {
  it("lit un export Windows-1252 (accents)", () => {
    const bytes = new Uint8Array([0x43, 0x6f, 0x6e, 0x67, 0xe9, 0x73]); // « Congés » en cp1252
    expect(decodeTextFile(bytes)).toEqual({ text: "Congés", encoding: "windows-1252" });
  });
  it("lit un fichier UTF-8 avec BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Été")]);
    expect(decodeTextFile(bytes).text).toBe("Été");
  });
});

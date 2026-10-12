import { readFileSync } from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { cellText, excelDate, firstDataSheet, isDateFormat, readXlsx, XlsxError } from "./xlsx";

const fixture = () => new Uint8Array(readFileSync(path.join(__dirname, "../../tests/fixtures/clients-exemple.xlsx")));

describe("lecture Excel (.xlsx)", () => {
  it("lit en-têtes, textes, nombres et dates d'un vrai classeur", () => {
    const sheet = firstDataSheet(readXlsx(fixture()));
    expect(sheet.name).toBe("Feuil1");
    expect(sheet.rows).toHaveLength(7);
    expect(sheet.rows[0]![0]).toBe(" Code");
    const first = sheet.rows[1]!;
    expect(first[0]).toBe(9000001);
    expect(first[2]).toBe("SELARL GRANDE PHIE DU PHARE");
    expect(first[16]).toBeInstanceOf(Date);
    expect(cellText(first[16]!)).toBe("2026-08-31");
    expect(cellText(first[20]!)).toBe("0.4");
    // Cellules vides : null (KAM absent, date absente)
    expect(sheet.rows[2]![15]).toBeNull();
    expect(sheet.rows[2]![17]).toBeNull();
  });

  it("reconnaît les formats de date sans confondre pourcentages et nombres", () => {
    expect(isDateFormat("mm-dd-yy")).toBe(true);
    expect(isDateFormat("[$-40C]d mmmm yyyy")).toBe(true);
    expect(isDateFormat("0.00%")).toBe(false);
    expect(isDateFormat("#,##0")).toBe(false);
    expect(isDateFormat('0" jours"')).toBe(false);
  });

  it("convertit les numéros de série Excel", () => {
    expect(excelDate(46265).toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(excelDate(44804, true).toISOString().slice(0, 10)).toBe("2026-09-01"); // calendrier 1904 (anciens Excel Mac)
  });

  it("lit les chaînes en ligne et les cellules creuses", () => {
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="A &amp; B" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nom</t></is></c><c r="C1" t="inlineStr"><is><t>Ville</t></is></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>Pharmacie &lt;Test&gt;</t></is></c><c r="C3" t="str"><v>Caen</v></c></row></sheetData></worksheet>',
      ),
    });
    const [sheet] = readXlsx(xlsx);
    expect(sheet!.name).toBe("A & B");
    expect(sheet!.rows).toEqual([["Nom", null, "Ville"], [], ["Pharmacie <Test>", null, "Caen"]]);
  });

  it("refuse un fichier qui n'est pas un .xlsx", () => {
    expect(() => readXlsx(new TextEncoder().encode("nom;ville"))).toThrow(XlsxError);
  });
});

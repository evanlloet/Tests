/**
 * Lecture minimale d'un classeur Excel (.xlsx) : première feuille non vide,
 * valeurs des cellules (texte, nombre, booléen, date). Les formules ne sont pas
 * recalculées : on lit la dernière valeur enregistrée par Excel.
 *
 * Le format .xlsx est une archive ZIP de fichiers XML (Office Open XML) ; seuls
 * les fichiers utiles sont décompressés, avec une limite de taille pour éviter
 * les archives piégées.
 */
import { unzipSync } from "fflate";

export type XlsxCell = string | number | boolean | Date | null;
export type XlsxSheet = { name: string; rows: XlsxCell[][] };

export class XlsxError extends Error {}

/** Taille décompressée maximale acceptée (tous fichiers XML confondus). */
const MAX_UNCOMPRESSED = 80 * 1024 * 1024;

export function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Feuilles du classeur, dans l'ordre des onglets. */
export function readXlsx(bytes: Uint8Array): XlsxSheet[] {
  if (!isXlsx(bytes)) throw new XlsxError("Ce fichier n'est pas un classeur Excel .xlsx (les anciens .xls ne sont pas lus : enregistrez-le en .xlsx ou en CSV).");
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNCOMPRESSED) throw new XlsxError("Classeur trop volumineux une fois décompressé.");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw new XlsxError("Classeur Excel illisible (archive endommagée ?).");
  }
  const text = (name: string) => (files[name] ? new TextDecoder("utf-8").decode(files[name]) : null);

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new XlsxError("Classeur Excel incomplet (workbook.xml absent).");
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const rels = parseRelationships(text("xl/_rels/workbook.xml.rels") ?? "");
  const shared = parseSharedStrings(text("xl/sharedStrings.xml") ?? "");
  const dateStyles = parseDateStyles(text("xl/styles.xml") ?? "");

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = parseAttributes(m[1]!);
    const target = rels.get(attrs["r:id"] ?? attrs.id ?? "");
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = text(path);
    if (xml === null) continue;
    sheets.push({ name: decodeXml(attrs.name ?? ""), rows: parseSheet(xml, shared, dateStyles, date1904) });
  }
  if (sheets.length === 0) throw new XlsxError("Aucune feuille lisible dans ce classeur.");
  return sheets;
}

/** Première feuille contenant au moins deux lignes non vides (en-têtes + données). */
export function firstDataSheet(sheets: XlsxSheet[]): XlsxSheet {
  return sheets.find((s) => s.rows.filter((r) => r.some((c) => c !== null && c !== "")).length >= 2) ?? sheets[0]!;
}

/** Valeur d'une cellule sous forme de texte : dates en AAAA-MM-JJ, nombres sans séparateur de milliers. */
export function cellText(cell: XlsxCell): string {
  if (cell === null) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, cell.getUTCHours() || cell.getUTCMinutes() ? 16 : 10).replace("T", " ");
  if (typeof cell === "number") return Number.isInteger(cell) ? String(cell) : String(Math.round(cell * 1e9) / 1e9);
  if (typeof cell === "boolean") return cell ? "VRAI" : "FAUX";
  return cell;
}

/* -------------------------------------------------------------------------- */

function parseSheet(xml: string, shared: string[], dateStyles: Set<number>, date1904: boolean): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = parseAttributes(rm[1]!);
    const rowIndex = rowAttrs.r ? Number(rowAttrs.r) - 1 : nextRow;
    nextRow = rowIndex + 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > 1_048_575) continue;
    const row: XlsxCell[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = parseAttributes(cm[1]!);
      const col = a.r ? columnIndex(a.r) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col > 16_383) continue;
      row[col] = cellValue(a, cm[2] ?? "", shared, dateStyles, date1904);
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[rowIndex] = row;
  }
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
  while (rows.length && rows[rows.length - 1]!.every((c) => c === null || c === "")) rows.pop();
  return rows;
}

function cellValue(a: Record<string, string>, inner: string, shared: string[], dateStyles: Set<number>, date1904: boolean): XlsxCell {
  const type = a.t ?? "n";
  if (type === "inlineStr") return richText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
  const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return null;
  switch (type) {
    case "s":
      return shared[Number(raw)] ?? null;
    case "str":
      return decodeXml(raw);
    case "b":
      return raw === "1";
    case "e":
      return null;
    case "d": {
      const d = new Date(decodeXml(raw));
      return Number.isNaN(d.getTime()) ? decodeXml(raw) : d;
    }
    default: {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      if (a.s !== undefined && dateStyles.has(Number(a.s))) return excelDate(n, date1904);
      return n;
    }
  }
}

/** Numéro de série Excel → date (UTC). */
export function excelDate(serial: number, date1904 = false): Date {
  // 1970-01-01 = 25569 dans le calendrier 1900 d'Excel (qui compte à tort un 29 février 1900), 24107 dans le calendrier 1904.
  const days = date1904 ? serial - 24107 : serial - 25569;
  return new Date(Math.round(days * 86_400_000));
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => richText(m[1] ?? ""));
}

function richText(xml: string): string {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...cleaned.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join("");
}

function parseRelationships(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const a = parseAttributes(m[1]!);
    if (a.Id && a.Target) out.set(a.Id, decodeXml(a.Target));
  }
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** Index des styles de cellule (cellXfs) dont le format est une date ou une heure. */
function parseDateStyles(xml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const a = parseAttributes(m[1]!);
    if (a.numFmtId) custom.set(Number(a.numFmtId), decodeXml(a.formatCode ?? ""));
  }
  const out = new Set<number>();
  const xfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(parseAttributes(m[1]!).numFmtId ?? 0);
    const code = custom.get(id);
    if (code !== undefined ? isDateFormat(code) : BUILTIN_DATE_FORMATS.has(id)) out.add(i);
    i++;
  }
  return out;
}

/** « dd/mm/yyyy », « mm-dd-yy », « [$-40C]d mmmm yyyy »… mais pas « 0.00% » ni « #,##0 ». */
export function isDateFormat(code: string): boolean {
  const stripped = code
    .split(";")[0]!
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, "");
  return /[dmyhs]/i.test(stripped) && !/^general$/i.test(stripped.trim());
}

function parseAttributes(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/_x000D_/g, "");
}

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

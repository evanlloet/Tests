import "server-only";
import { CalendarFormatError } from "@/domain/calendar/outlook-csv";
import { PharmacyImportError } from "@/domain/pharmacy-import";
import { AppointmentError } from "../services/appointments";
import { ReviewError } from "../services/match-review";
import { RoutePlanError } from "../services/route-plan";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const EXPECTED = [AppointmentError, ReviewError, RoutePlanError, PharmacyImportError, CalendarFormatError];

/** Transforme une erreur métier en message lisible ; journalise les erreurs inattendues. */
export function toActionError(err: unknown): { ok: false; error: string } {
  if (EXPECTED.some((E) => err instanceof E)) return { ok: false, error: (err as Error).message };
  // Les redirections de Next.js sont des exceptions à laisser passer
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
  console.error("[action]", err);
  return { ok: false, error: "Une erreur inattendue est survenue. Réessayez ; si elle persiste, consultez les journaux du serveur." };
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function readUpload(file: FormDataEntryValue | null, extensions: string[]): Promise<{ name: string; bytes: Uint8Array } | string> {
  if (!(file instanceof File) || file.size === 0) return "Choisissez un fichier.";
  if (file.size > MAX_UPLOAD_BYTES) return "Fichier trop volumineux (15 Mo maximum).";
  const lower = file.name.toLowerCase();
  if (!extensions.some((ext) => lower.endsWith(ext))) return `Format attendu : ${extensions.join(", ")}.`;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

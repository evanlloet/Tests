import { createHash } from "node:crypto";
import { normalizeText } from "../text";

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Empreinte « titre + horaires » commune aux formats ICS et CSV. */
export function eventContentHash(title: string, start: Date, end: Date): string {
  return sha256(`${normalizeText(title)}|${start.toISOString()}|${end.toISOString()}`).slice(0, 32);
}

/** Clé d'un événement ICS : UID + occurrence. */
export function icsSourceKey(uid: string, recurrenceId: string | null): string {
  return `ics:${sha256(`${uid}|${recurrenceId ?? "single"}`).slice(0, 40)}`;
}

/** Clé d'une ligne CSV Outlook (le CSV ne contient pas d'UID). */
export function csvSourceKey(title: string, start: Date, end: Date, location: string | null): string {
  return `csv:${sha256(`${normalizeText(title)}|${start.toISOString()}|${end.toISOString()}|${normalizeText(location)}`).slice(0, 40)}`;
}

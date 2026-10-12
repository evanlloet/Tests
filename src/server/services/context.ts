import "server-only";
import type { FrequencySettings } from "@/domain/frequency";
import { dayKeyOf, zonedDateTime, type DayKey } from "@/domain/time";
import type { SessionUser } from "../auth/session";

/** Paramètres de l'utilisatrice nécessaires aux règles métier. */
export function frequencySettings(user: Pick<SessionUser, "frequencyA" | "frequencyB" | "frequencyC" | "frequencyD">): FrequencySettings {
  return { A: user.frequencyA, B: user.frequencyB, C: user.frequencyC, D: user.frequencyD };
}

export function todayFor(user: Pick<SessionUser, "timezone">, now = new Date()): DayKey {
  return dayKeyOf(now, user.timezone);
}

export function yearBounds(today: DayKey, tz: string) {
  const year = Number(today.slice(0, 4));
  return {
    yearStart: zonedDateTime(`${year}-01-01`, "00:00", tz),
    nextYearStart: zonedDateTime(`${year + 1}-01-01`, "00:00", tz),
  };
}

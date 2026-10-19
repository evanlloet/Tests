import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { buildAgendaStats, type AgendaStats } from "@/domain/analytics/agenda-stats";
import { isCategory } from "@/domain/frequency";
import { dayKeyOf } from "@/domain/time";
import type { SessionUser } from "../auth/session";
import type { Db } from "../db/client";
import { pharmacies, pharmacyMetrics } from "../db/schema";
import { listWeekTemplates } from "../repositories/territories";
import { loadAgendaData } from "./agenda-data";

/** Statistiques du secteur (page « Statistiques ») : voir domain/analytics/agenda-stats. */
export async function getAgendaStats(db: Db, user: SessionUser, now = new Date()): Promise<AgendaStats & { templateName: string | null; hasHome: boolean }> {
  const data = await loadAgendaData(db, user);
  const clients = await db
    .select({ id: pharmacies.id, name: pharmacies.name, city: pharmacies.city, departmentCode: pharmacies.departmentCode, category: pharmacyMetrics.category })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(and(eq(pharmacies.userId, user.id), sql`${pharmacies.status} <> 'closed'`));
  const templates = await listWeekTemplates(db, user.id);
  const template = templates.find((t) => t.isDefault) ?? templates[0] ?? null;

  const stats = buildAgendaStats({
    visits: data.visits.map((v) => ({
      id: v.id,
      day: v.day,
      start: v.start,
      end: v.end,
      pharmacyId: v.pharmacyId,
      pharmacyName: v.pharmacyName,
      city: v.city,
      departmentCode: v.departmentCode,
      location: v.location,
      mode: v.mode,
      pendingReview: v.modeReview === "pending",
      reason: v.modeReason,
    })),
    nights: data.nights,
    teleworkDays: data.telework.map((t) => t.day),
    clients: clients.map((c) => ({ ...c, category: isCategory(c.category) ? c.category : null })),
    home: data.home,
    template: template?.days ?? {},
    targets: { A: user.frequencyA, B: user.frequencyB, C: user.frequencyC, D: user.frequencyD },
    today: dayKeyOf(now, user.timezone),
    tz: user.timezone,
    estimate: data.estimate,
  });
  return { ...stats, templateName: template?.name ?? null, hasHome: data.home !== null };
}

import "server-only";
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db as defaultDb, type DbOrTx } from "../db/client";
import { appointmentMatches, calendarEvents, calendarImports, pharmacies } from "../db/schema";

export type MatchStatusFilter = "to_review" | "pending" | "no_candidate" | "auto_validated" | "validated" | "ignored" | "other";

/** Rapprochements nécessitant une décision : propositions incertaines + visites probables sans candidat. */
function toReviewCondition(): SQL {
  return or(
    eq(appointmentMatches.status, "pending"),
    and(eq(appointmentMatches.status, "no_candidate"), eq(calendarEvents.classification, "visit")),
  )!;
}

export async function countPendingMatches(userId: string, db: DbOrTx = defaultDb): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointmentMatches)
    .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
    .where(and(eq(appointmentMatches.userId, userId), toReviewCondition()));
  return row?.n ?? 0;
}

export async function listMatches(
  db: DbOrTx,
  userId: string,
  filter: MatchStatusFilter,
  options: { importId?: string; limit?: number; offset?: number } = {},
) {
  const conditions: SQL[] = [eq(appointmentMatches.userId, userId)];
  if (filter === "to_review") conditions.push(toReviewCondition());
  else if (filter === "no_candidate") conditions.push(eq(appointmentMatches.status, "no_candidate"), eq(calendarEvents.classification, "visit"));
  else if (filter === "other") conditions.push(eq(appointmentMatches.status, "no_candidate"), sql`${calendarEvents.classification} <> 'visit'`);
  else conditions.push(eq(appointmentMatches.status, filter));
  if (options.importId) conditions.push(eq(calendarEvents.importId, options.importId));

  const rows = await db
    .select({ match: appointmentMatches, event: calendarEvents, pharmacy: pharmacies })
    .from(appointmentMatches)
    .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
    .leftJoin(pharmacies, eq(pharmacies.id, appointmentMatches.pharmacyId))
    .where(and(...conditions))
    .orderBy(asc(calendarEvents.startsAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(appointmentMatches)
    .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
    .where(and(...conditions));
  return { rows, total: count?.n ?? 0 };
}

export async function matchCounts(db: DbOrTx, userId: string) {
  const rows = await db
    .select({ status: appointmentMatches.status, classification: calendarEvents.classification, n: sql<number>`count(*)::int` })
    .from(appointmentMatches)
    .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
    .where(eq(appointmentMatches.userId, userId))
    .groupBy(appointmentMatches.status, calendarEvents.classification);
  const out: Record<MatchStatusFilter, number> = {
    to_review: 0,
    pending: 0,
    no_candidate: 0,
    auto_validated: 0,
    validated: 0,
    ignored: 0,
    other: 0,
  };
  for (const r of rows) {
    if (r.status === "no_candidate") {
      if (r.classification === "visit") {
        out.no_candidate += r.n;
        out.to_review += r.n;
      } else out.other += r.n;
    } else {
      out[r.status] += r.n;
      if (r.status === "pending") out.to_review += r.n;
    }
  }
  return out;
}

export async function getMatch(db: DbOrTx, userId: string, id: string) {
  const [row] = await db
    .select({ match: appointmentMatches, event: calendarEvents })
    .from(appointmentMatches)
    .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId))
    .where(and(eq(appointmentMatches.id, id), eq(appointmentMatches.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function pharmaciesByIds(db: DbOrTx, userId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, typeof pharmacies.$inferSelect>();
  const rows = await db
    .select()
    .from(pharmacies)
    .where(and(eq(pharmacies.userId, userId), inArray(pharmacies.id, ids)));
  return new Map(rows.map((p) => [p.id, p]));
}

export async function listCalendarImports(db: DbOrTx, userId: string) {
  return db
    .select()
    .from(calendarImports)
    .where(eq(calendarImports.userId, userId))
    .orderBy(sql`${calendarImports.createdAt} desc`)
    .limit(50);
}

export async function eventsWithoutMatch(db: DbOrTx, userId: string) {
  return db
    .select({ event: calendarEvents })
    .from(calendarEvents)
    .leftJoin(appointmentMatches, eq(appointmentMatches.calendarEventId, calendarEvents.id))
    .where(and(eq(calendarEvents.userId, userId), isNull(appointmentMatches.id)));
}

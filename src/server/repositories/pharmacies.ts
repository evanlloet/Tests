import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { appointments, pharmacies, pharmacyMetrics, pharmacyPreferences, visitReports } from "../db/schema";

export type PharmacyFilters = {
  q?: string;
  department?: string;
  category?: "A" | "B" | "C" | "D" | "none";
  channel?: string;
  zone?: string;
  tag?: string;
  ids?: string[];
};

export async function listPharmaciesWithMetrics(db: DbOrTx, userId: string, filters: PharmacyFilters = {}) {
  const conditions: SQL[] = [eq(pharmacies.userId, userId)];
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(
      or(
        ilike(pharmacies.name, like),
        ilike(pharmacies.city, like),
        ilike(pharmacies.postalCode, like),
        ilike(pharmacies.externalId, like),
        ilike(pharmacies.addressLine, like),
        ilike(pharmacies.legalName, like),
        ilike(pharmacies.buyingGroup, like),
        ilike(pharmacies.email, like),
        ilike(pharmacies.salesZone, like),
      )!,
    );
  }
  if (filters.department) conditions.push(eq(pharmacies.departmentCode, filters.department));
  if (filters.channel) conditions.push(eq(pharmacies.channel, filters.channel));
  if (filters.zone) conditions.push(eq(pharmacies.salesZone, filters.zone));
  if (filters.tag) conditions.push(sql`${filters.tag} = any(${pharmacies.targeting})`);
  if (filters.category === "none") conditions.push(isNull(pharmacyMetrics.category));
  else if (filters.category) conditions.push(eq(pharmacyMetrics.category, filters.category));
  if (filters.ids) {
    if (filters.ids.length === 0) return [];
    conditions.push(inArray(pharmacies.id, filters.ids));
  }
  return db
    .select({ pharmacy: pharmacies, metrics: pharmacyMetrics })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .where(and(...conditions))
    .orderBy(asc(pharmacies.name));
}

export type VisitAggregate = {
  pharmacyId: string;
  lastDone: Date | null;
  lastIdentified: Date | null;
  nextPlanned: Date | null;
  doneYear: number;
  identifiedYear: number;
  plannedYear: number;
  total: number;
};

/**
 * Agrégats de visites par pharmacie (une requête) :
 * réalisées (outcome = done), identifiées (passées, confirmées ou en attente, réalisation non
 * confirmée), planifiées (futures). Une proposition passée jamais confirmée ne compte pas.
 */
export async function visitAggregates(
  db: DbOrTx,
  userId: string,
  now: Date,
  yearStart: Date,
  nextYearStart: Date,
  pharmacyIds?: string[],
): Promise<Map<string, VisitAggregate>> {
  const conditions: SQL[] = [
    eq(appointments.userId, userId),
    eq(appointments.kind, "visit"),
    sql`${appointments.status} <> 'cancelled'`,
    sql`${appointments.outcome} <> 'missed'`,
    sql`${appointments.pharmacyId} is not null`,
  ];
  if (pharmacyIds) {
    if (pharmacyIds.length === 0) return new Map();
    conditions.push(inArray(appointments.pharmacyId, pharmacyIds));
  }
  // Paramètres typés explicitement : le pilote ne sait pas sérialiser une Date dans un fragment SQL brut
  const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  const [nowP, yearP, nextYearP] = [ts(now), ts(yearStart), ts(nextYearStart)];
  const rows = await db
    .select({
      pharmacyId: appointments.pharmacyId,
      lastDone: sql<Date | null>`max(${appointments.startsAt}) filter (where ${appointments.startsAt} < ${nowP} and ${appointments.outcome} = 'done')`,
      lastIdentified: sql<Date | null>`max(${appointments.startsAt}) filter (where ${appointments.startsAt} < ${nowP} and ${appointments.outcome} = 'unknown' and ${appointments.status} in ('confirmed', 'pending'))`,
      nextPlanned: sql<Date | null>`min(${appointments.startsAt}) filter (where ${appointments.startsAt} >= ${nowP} and ${appointments.outcome} = 'unknown')`,
      doneYear: sql<number>`count(*) filter (where ${appointments.startsAt} >= ${yearP} and ${appointments.startsAt} < ${nowP} and ${appointments.outcome} = 'done')::int`,
      identifiedYear: sql<number>`count(*) filter (where ${appointments.startsAt} >= ${yearP} and ${appointments.startsAt} < ${nowP} and ${appointments.outcome} = 'unknown' and ${appointments.status} in ('confirmed', 'pending'))::int`,
      plannedYear: sql<number>`count(*) filter (where ${appointments.startsAt} >= ${nowP} and ${appointments.startsAt} < ${nextYearP} and ${appointments.outcome} = 'unknown')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(appointments)
    .where(and(...conditions))
    .groupBy(appointments.pharmacyId);
  const toDate = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v : new Date(v));
  return new Map(
    rows.map((r) => [
      r.pharmacyId!,
      {
        pharmacyId: r.pharmacyId!,
        lastDone: toDate(r.lastDone),
        lastIdentified: toDate(r.lastIdentified),
        nextPlanned: toDate(r.nextPlanned),
        doneYear: r.doneYear,
        identifiedYear: r.identifiedYear,
        plannedYear: r.plannedYear,
        total: r.total,
      },
    ]),
  );
}

export async function getPharmacy(db: DbOrTx, userId: string, id: string) {
  const [row] = await db
    .select({ pharmacy: pharmacies, metrics: pharmacyMetrics, preferences: pharmacyPreferences })
    .from(pharmacies)
    .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
    .leftJoin(pharmacyPreferences, eq(pharmacyPreferences.pharmacyId, pharmacies.id))
    .where(and(eq(pharmacies.id, id), eq(pharmacies.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function listPharmacyAppointments(db: DbOrTx, userId: string, pharmacyId: string) {
  return db
    .select()
    .from(appointments)
    .where(and(eq(appointments.userId, userId), eq(appointments.pharmacyId, pharmacyId)))
    .orderBy(desc(appointments.startsAt));
}

export async function listVisitReports(db: DbOrTx, userId: string, pharmacyId: string) {
  return db
    .select()
    .from(visitReports)
    .where(and(eq(visitReports.userId, userId), eq(visitReports.pharmacyId, pharmacyId)))
    .orderBy(desc(visitReports.createdAt));
}

/** Données minimales pour le rapprochement (référentiel complet de l'utilisatrice). */
export async function listForMatching(db: DbOrTx, userId: string) {
  return db
    .select({
      id: pharmacies.id,
      name: pharmacies.name,
      city: pharmacies.city,
      postalCode: pharmacies.postalCode,
      addressLine: pharmacies.addressLine,
    })
    .from(pharmacies)
    .where(and(eq(pharmacies.userId, userId), sql`${pharmacies.status} <> 'closed'`));
}

export async function countPharmacies(db: DbOrTx, userId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(pharmacies).where(eq(pharmacies.userId, userId));
  return row?.n ?? 0;
}

/** Valeurs présentes dans le référentiel pour les filtres (canal, zone, ciblage). */
export async function pharmacyFacets(db: DbOrTx, userId: string) {
  const count = sql<number>`count(*)::int`;
  const [channels, zones, tags] = await Promise.all([
    db
      .select({ value: pharmacies.channel, n: count })
      .from(pharmacies)
      .where(and(eq(pharmacies.userId, userId), isNotNull(pharmacies.channel)))
      .groupBy(pharmacies.channel)
      .orderBy(asc(pharmacies.channel)),
    db
      .select({ value: pharmacies.salesZone, n: count })
      .from(pharmacies)
      .where(and(eq(pharmacies.userId, userId), isNotNull(pharmacies.salesZone)))
      .groupBy(pharmacies.salesZone)
      .orderBy(asc(pharmacies.salesZone)),
    db.execute<{ value: string; n: number }>(
      sql`select tag as value, count(*)::int as n from ${pharmacies}, unnest(${pharmacies.targeting}) as tag where ${pharmacies.userId} = ${userId} group by tag order by tag`,
    ),
  ]);
  const clean = (rows: { value: string | null; n: number }[]) => rows.filter((r): r is { value: string; n: number } => r.value !== null);
  return { channels: clean(channels), zones: clean(zones), tags: clean([...tags]) };
}

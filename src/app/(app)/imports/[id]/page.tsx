import { and, asc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { appointmentMatches, calendarEvents, calendarImports, pharmacies } from "@/server/db/schema";

export const metadata: Metadata = { title: "Détail de l'import" };

const CLASS_LABEL = { visit: "Visite probable", not_visit: "Autre", unknown: "Indéterminé" } as const;
const MATCH_LABEL: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" | "info" }> = {
  auto_validated: { label: "Validé auto.", tone: "success" },
  validated: { label: "Validé", tone: "success" },
  pending: { label: "À vérifier", tone: "warning" },
  no_candidate: { label: "Sans pharmacie", tone: "danger" },
  ignored: { label: "Ignoré", tone: "neutral" },
};

export default async function ImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [imp] = await db.select().from(calendarImports).where(and(eq(calendarImports.id, id), eq(calendarImports.userId, user.id)));
  if (!imp) notFound();
  const filter = sp.classe === "visit" || sp.classe === "not_visit" || sp.classe === "unknown" ? sp.classe : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = and(eq(calendarEvents.userId, user.id), eq(calendarEvents.importId, id), filter ? eq(calendarEvents.classification, filter) : undefined);
  const rows = await db
    .select({ event: calendarEvents, match: appointmentMatches, pharmacy: { id: pharmacies.id, name: pharmacies.name, city: pharmacies.city } })
    .from(calendarEvents)
    .leftJoin(appointmentMatches, eq(appointmentMatches.calendarEventId, calendarEvents.id))
    .leftJoin(pharmacies, eq(pharmacies.id, appointmentMatches.pharmacyId))
    .where(where)
    .orderBy(asc(calendarEvents.startsAt))
    .limit(100)
    .offset((page - 1) * 100);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(calendarEvents).where(where);
  const total = count?.n ?? 0;
  const tab = (value: string | null, label: string) => (
    <Link
      key={label}
      href={`/imports/${id}${value ? `?classe=${value}` : ""}`}
      className={`rounded-lg px-3 py-1.5 text-sm ${filter === value ? "bg-primary text-primary-fg" : "text-muted hover:text-text"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={imp.filename}
        subtitle={`Importé le ${formatDateTime(imp.createdAt, user.timezone)} · ${imp.newEvents} nouvel(s) événement(s) sur ${imp.totalEvents}`}
      />
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        {tab(null, "Tous")}
        {tab("visit", "Visites probables")}
        {tab("unknown", "Indéterminés")}
        {tab("not_visit", "Autres")}
      </div>
      <p className="mb-2 text-sm text-muted">
        {total} événement(s) créé(s) par cet import{filter ? ` (${CLASS_LABEL[filter].toLowerCase()})` : ""}. Les événements déjà connus lors d&apos;imports
        précédents ne sont pas répétés.
      </p>
      <Card className="divide-y divide-border">
        {rows.map(({ event: e, match: m, pharmacy: p }) => (
          <div key={e.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[180px_1fr_auto] sm:items-center sm:gap-4">
            <span className="text-muted tabular-nums">{formatDateTime(e.startsAt, user.timezone)}</span>
            <span className="min-w-0">
              <span className={`block truncate font-medium ${e.isCancelled ? "line-through" : ""}`}>{e.title}</span>
              <span className="block truncate text-xs text-muted">
                {[e.location, e.classificationReason, e.duplicateOfId ? "doublon probable d'un événement déjà importé" : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={e.classification === "visit" ? "accent" : "neutral"}>{CLASS_LABEL[e.classification]}</Badge>
              {m ? <Badge tone={MATCH_LABEL[m.status]!.tone}>{MATCH_LABEL[m.status]!.label}</Badge> : null}
              {p ? (
                <Link href={`/pharmacies/${p.id}`} className="text-xs text-primary underline">
                  {p.name}
                </Link>
              ) : null}
            </span>
          </div>
        ))}
        {rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">Aucun événement.</p> : null}
      </Card>
      {total > page * 100 ? (
        <div className="mt-4 text-center">
          <Link href={`/imports/${id}?${new URLSearchParams({ ...(filter ? { classe: filter } : {}), page: String(page + 1) })}`} className="text-sm font-medium text-primary underline">
            Page suivante
          </Link>
        </div>
      ) : null}
    </>
  );
}

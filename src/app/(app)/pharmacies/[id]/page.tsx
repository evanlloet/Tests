import { CalendarPlus, MapPin, Navigation, Phone, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OutcomeButtons } from "@/components/appointment-actions";
import { APPOINTMENT_STATUS, formatEuros, OUTCOME, SOURCE_LABEL } from "@/components/labels";
import { IdentityForm, MetricsForm, PreferencesForm } from "@/components/pharmacy-forms";
import { Badge, CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/notice";
import { DueBadge, LastVisit, YearProgress } from "@/components/visit-status";
import { departmentName } from "@/domain/departments";
import { targetVisitsPerYear } from "@/domain/frequency";
import { formatDate, formatDateTime, formatDayLong, WEEKDAY_SHORT } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getPharmacy, listPharmacyAppointments, listVisitReports, visitAggregates } from "@/server/repositories/pharmacies";
import { territoryLookup } from "@/server/repositories/territories";
import { frequencySettings, todayFor, yearBounds } from "@/server/services/context";
import { statusFromAggregate } from "@/server/services/pharmacy-overview";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await params;
  const row = /^[0-9a-f-]{36}$/.test(id) ? await getPharmacy(db, user.id, id) : null;
  return { title: row?.pharmacy.name ?? "Pharmacie" };
}

export default async function PharmacyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const row = await getPharmacy(db, user.id, id);
  if (!row) notFound();
  const { pharmacy: p, metrics, preferences } = row;

  const now = new Date();
  const today = todayFor(user, now);
  const { yearStart, nextYearStart } = yearBounds(today, user.timezone);
  const agg = (await visitAggregates(db, user.id, now, yearStart, nextYearStart, [p.id])).get(p.id);
  const freq = frequencySettings(user);
  const target = targetVisitsPerYear(metrics?.category ?? null, metrics?.targetVisitsPerYear ?? null, freq);
  const status = statusFromAggregate(agg, target.perYear, today, user.timezone);
  const appts = await listPharmacyAppointments(db, user.id, p.id);
  const reports = await listVisitReports(db, user.id, p.id);
  const territory = p.departmentCode ? (await territoryLookup(db, user.id)).get(p.departmentCode) : null;
  const destination = p.lat !== null && p.lng !== null ? `${p.lat},${p.lng}` : [p.addressLine, p.postalCode, p.city].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <Link href="/pharmacies" className="text-sm text-muted hover:text-text">
          ← Pharmacies
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{p.name}</h1>
          <CategoryBadge category={metrics?.category} />
          {p.status === "closed" ? <Badge tone="danger">Fermée</Badge> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <SectorDot color={territory?.color} /> {departmentName(p.departmentCode)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-4" aria-hidden />
            {[p.addressLine, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Adresse inconnue"}
          </span>
          {p.phone ? (
            <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-primary">
              <Phone className="size-4" aria-hidden /> {p.phone}
            </a>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <LinkButton href={`/pharmacies/${p.id}/prochaine-visite`} size="lg">
            <Sparkles className="size-5" aria-hidden /> Proposer la prochaine visite
          </LinkButton>
          <LinkButton href={`/planning/nouveau?pharmacie=${p.id}`} variant="secondary" size="lg">
            <CalendarPlus className="size-5" aria-hidden /> Planifier
          </LinkButton>
          {destination ? (
            <LinkButton
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`}
              variant="secondary"
              size="lg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation className="size-5" aria-hidden /> Itinéraire
            </LinkButton>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Suivi des visites"
              description={
                target.perYear
                  ? `Objectif : ${target.perYear} visites par an (${target.origin === "individual" ? "fréquence individuelle" : `catégorie ${metrics?.category}`}), soit une visite tous les ${status.intervalDays} jours.`
                  : "Catégorie inconnue : aucune fréquence cible n'est appliquée."
              }
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 text-sm">
                <DueBadge status={status} />
                <p>
                  <span className="text-muted">Dernière visite : </span>
                  <LastVisit status={status} today={today} />
                </p>
                <p>
                  <span className="text-muted">Prochaine échéance : </span>
                  {status.nextDue ? formatDayLong(status.nextDue) : "—"}
                </p>
                <p>
                  <span className="text-muted">Prochain rendez-vous : </span>
                  {status.nextPlanned ? formatDayLong(status.nextPlanned) : "aucun"}
                </p>
                {status.plannedLate ? <p className="text-warning">Le prochain rendez-vous dépasse l'échéance de plus de 2 semaines.</p> : null}
              </div>
              <YearProgress status={status} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Historique des rendez-vous" description="Un rendez-vous issu de l'agenda n'est compté comme réalisé qu'après confirmation." />
            <CardBody>
              {appts.length === 0 ? (
                <EmptyState title="Aucun rendez-vous connu">Importez votre agenda Outlook ou planifiez une visite.</EmptyState>
              ) : (
                <ul className="divide-y divide-border">
                  {appts.map((a) => {
                    const past = a.startsAt < now;
                    return (
                      <li key={a.id} className="space-y-1.5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/planning/rdv/${a.id}`} className="font-medium hover:underline">
                            {formatDateTime(a.startsAt, user.timezone)}
                          </Link>
                          <Badge tone={APPOINTMENT_STATUS[a.status].tone}>{APPOINTMENT_STATUS[a.status].label}</Badge>
                          {past && a.status !== "cancelled" ? <Badge tone={OUTCOME[a.outcome].tone}>{OUTCOME[a.outcome].label}</Badge> : null}
                          <span className="text-xs text-muted">{SOURCE_LABEL[a.source]}</span>
                        </div>
                        <p className="text-sm text-muted">{a.title}</p>
                        {past && a.status !== "cancelled" && a.kind === "visit" ? <OutcomeButtons appointment={a} /> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Comptes rendus" />
            <CardBody>
              {reports.length === 0 ? (
                <p className="text-sm text-muted">Aucun compte rendu. Ils se saisissent avec le bouton « Rendez-vous terminé ».</p>
              ) : (
                <ul className="space-y-3">
                  {reports.map((r) => (
                    <li key={r.id} className="rounded-xl bg-surface-2 p-3 text-sm">
                      <p className="text-xs text-muted">{formatDate(r.createdAt, user.timezone)}</p>
                      <p className="mt-1 whitespace-pre-line">{r.summary}</p>
                      {r.nextActions ? <p className="mt-2 font-medium">À faire : {r.nextActions}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Données commerciales"
              description={
                [
                  metrics?.annualRevenue ? `CA : ${formatEuros(metrics.annualRevenue)}` : "CA inconnu",
                  metrics?.potential ? `potentiel ${metrics.potential}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
            />
            <CardBody>
              <MetricsForm pharmacyId={p.id} metrics={metrics} categoryFrequency={freq} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Disponibilités du pharmacien"
              description={
                preferences?.preferredWeekdays.length
                  ? `Préfère : ${preferences.preferredWeekdays.map((d) => WEEKDAY_SHORT[d]).join(", ")}`
                  : "Aucune préférence connue."
              }
            />
            <CardBody>
              <PreferencesForm pharmacyId={p.id} prefs={preferences} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Identité et adresse" />
            <CardBody>
              <IdentityForm pharmacy={p} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Provenance et qualité" />
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Source</dt>
                <dd>{p.source}</dd>
                <dt className="text-muted">Identifiant</dt>
                <dd>{p.externalId ? `${p.externalSource ?? "externe"} ${p.externalId}` : "aucun"}</dd>
                <dt className="text-muted">Géolocalisation</dt>
                <dd>{p.lat !== null ? `${p.geoPrecision ?? "?"} — ${p.geoSource ?? "source inconnue"}` : "absente"}</dd>
                <dt className="text-muted">Mise à jour</dt>
                <dd>{formatDate(p.updatedAt, user.timezone)}</dd>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

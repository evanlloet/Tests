import { CalendarPlus, ChevronDown, Mail, MapPin, Navigation, Phone, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { OutcomeButtons } from "@/components/appointment-actions";
import { Buddy } from "@/components/buddy";
import { ChannelBadge, RevenueTrend, TargetingChips } from "@/components/client-data";
import { APPOINTMENT_STATUS, formatEuros, OUTCOME, SOURCE_LABEL } from "@/components/labels";
import { BUDDY_PASTEL, Hearts, PharmacyAvatar, pharmacyMoodSentence } from "@/components/mood-ui";
import { IdentityForm, MetricsForm, PreferencesForm } from "@/components/pharmacy-forms";
import { Badge, CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Tile } from "@/components/ui/card";
import { geoLabel, isApproximate } from "@/domain/client-data";
import { departmentName } from "@/domain/departments";
import { targetVisitsPerYear } from "@/domain/frequency";
import { avatarFor, PHARMACY_MOODS } from "@/domain/mood";
import { dayKeyOf, diffDays, formatDate, formatDateTime, formatDayLong, formatDayShort, WEEKDAY_SHORT } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import type { Appointment } from "@/server/db/schema";
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

/** Pastille de la frise : un mini-bonhomme selon la réalisation de la visite. */
function stickerFor(a: Appointment, past: boolean) {
  if (a.status === "cancelled") return { mood: "sleepy" as const, color: "gray" as const, label: "Annulé" };
  if (!past) return { mood: "love" as const, color: "blue" as const, label: "Prévu" };
  if (a.outcome === "done") return { mood: "joy" as const, color: "green" as const, label: "Réalisée" };
  if (a.outcome === "missed") return { mood: "worried" as const, color: "red" as const, label: "Non réalisée" };
  return { mood: "calm" as const, color: "purple" as const, label: "À confirmer" };
}

const TIMELINE = "relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[19px] before:w-0.5 before:bg-border";
const TIMELINE_VISIBLE = 6;

function TimelineItem({ a, past, timezone }: { a: Appointment; past: boolean; timezone: string }) {
  const sticker = stickerFor(a, past);
  return (
    <li className="relative flex gap-3">
      <Buddy mood={sticker.mood} shape="squircle" color={sticker.color} size={40} label={sticker.label} className="relative z-10" />
      <div className="min-w-0 flex-1 rounded-[18px] bg-surface-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/planning/rdv/${a.id}`} className="font-semibold hover:underline">
            {formatDateTime(a.startsAt, timezone)}
          </Link>
          <Badge tone={APPOINTMENT_STATUS[a.status].tone}>{APPOINTMENT_STATUS[a.status].label}</Badge>
          {past && a.status !== "cancelled" ? <Badge tone={OUTCOME[a.outcome].tone}>{OUTCOME[a.outcome].label}</Badge> : null}
        </div>
        <p className="text-xs text-muted">
          {a.title} · {SOURCE_LABEL[a.source]}
        </p>
        {past && a.status !== "cancelled" && a.kind === "visit" && a.outcome === "unknown" ? (
          <div className="mt-2">
            <OutcomeButtons appointment={a} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-[24px] border border-border/70 bg-surface shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-display text-lg font-bold">
        {title}
        <ChevronDown className="size-5 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
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
  const avatar = avatarFor(p.id);
  const doneTotal = appts.filter((a) => a.outcome === "done").length;

  return (
    <div className="space-y-5">
      <Link href="/pharmacies" className="text-sm font-semibold text-muted hover:text-text">
        ← Pharmacies
      </Link>

      {/* Héros : l'avatar de la pharmacie et son humeur */}
      <Tile color={BUDDY_PASTEL[avatar.color]} className="relative overflow-hidden p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <PharmacyAvatar id={p.id} dueState={status.dueState} size={120} animate className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={metrics?.category} />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-semibold">
                <SectorDot color={territory?.color} className="size-2" /> {departmentName(p.departmentCode)}
              </span>
              {p.salesZone ? <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-semibold">Zone {p.salesZone}</span> : null}
              <ChannelBadge channel={p.channel} />
              <TargetingChips tags={p.targeting} />
              {p.status === "closed" ? <Badge tone="danger">Fermée</Badge> : null}
            </div>
            <h1 className="mt-2 text-3xl leading-tight font-extrabold sm:text-4xl">{p.name}</h1>
            {p.legalName || p.externalId || p.buyingGroup ? (
              <p className="mt-0.5 text-sm opacity-75">
                {[p.legalName, p.externalId ? `${p.externalSource === "code_client" ? "code client" : (p.externalSource ?? "id")} ${p.externalId}` : null, p.buyingGroup ? `groupement ${p.buyingGroup}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            <p className="mt-1 text-base font-medium">« {pharmacyMoodSentence(status, (d) => formatDayLong(d))} »</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm opacity-80">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" aria-hidden />
                {[p.addressLine, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Adresse inconnue"}
                {isApproximate(p) ? <span className="text-xs">(position approximative)</span> : null}
              </span>
              {p.phone ? (
                <a href={`tel:${p.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 font-semibold underline">
                  <Phone className="size-4" aria-hidden /> {p.phone}
                </a>
              ) : null}
              {p.email
                ? p.email
                    .split(/[;,\s]+/)
                    .filter(Boolean)
                    .map((e) => (
                      <a key={e} href={`mailto:${e}`} className="inline-flex min-w-0 items-center gap-1 font-semibold break-all underline">
                        <Mail className="size-4 shrink-0" aria-hidden /> {e}
                      </a>
                    ))
                : null}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
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
      </Tile>

      {/* Les chiffres clés en tuiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile color="peach">
          <p className="text-sm font-semibold">Dernière visite</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{status.lastVisit ? formatDayShort(status.lastVisit.day) : "—"}</p>
          <p className="mt-1 text-xs opacity-75">
            {status.lastVisit
              ? `il y a ${diffDays(status.lastVisit.day, today)} j${status.lastVisit.state === "identified" ? " · à confirmer" : ""}`
              : "aucune visite connue"}
          </p>
        </Tile>
        <Tile color="lilac">
          <p className="text-sm font-semibold">Prochaine échéance</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{status.nextDue ? formatDayShort(status.nextDue) : "—"}</p>
          <p className="mt-1 text-xs opacity-75">
            {status.nextPlanned ? `rendez-vous le ${formatDayShort(status.nextPlanned)}` : target.perYear ? `tous les ${status.intervalDays} jours` : "catégorie à définir"}
          </p>
        </Tile>
        <Tile color="pink">
          <p className="text-sm font-semibold">Cette année</p>
          <div className="mt-2">
            <Hearts value={status.year.done + status.year.identified} planned={status.year.planned} target={status.year.target} size={20} />
          </div>
          <p className="mt-1 text-xs opacity-75">
            {status.year.done} réalisée(s) · {status.year.identified} à confirmer · {status.year.planned} prévue(s)
          </p>
        </Tile>
        {metrics?.revenueCurrentYear || metrics?.revenuePreviousYear ? (
          <Tile color="mint">
            <p className="text-sm font-semibold">Chiffre d'affaires A</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{metrics.revenueCurrentYear ? formatEuros(metrics.revenueCurrentYear) : "—"}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs opacity-75">
              A-1 : {metrics.revenuePreviousYear ? formatEuros(metrics.revenuePreviousYear) : "—"}
              <RevenueTrend previous={metrics.revenuePreviousYear} current={metrics.revenueCurrentYear} className="opacity-100" />
            </p>
          </Tile>
        ) : (
          <Tile color="mint">
            <p className="text-sm font-semibold">Potentiel</p>
            <p className="mt-1 font-display text-2xl font-extrabold capitalize">{metrics?.potential ?? "—"}</p>
            <p className="mt-1 text-xs opacity-75">{metrics?.annualRevenue ? `CA ${formatEuros(metrics.annualRevenue)}` : "CA inconnu"}</p>
          </Tile>
        )}
      </div>

      {/* Informations du fichier clients : commandes et visite planifiée par le laboratoire */}
      {metrics?.lastOrderOn || metrics?.plannedVisitOn ? (
        <div className="grid grid-cols-2 gap-3">
          <Tile color="butter">
            <p className="text-sm font-semibold">Dernière commande</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{metrics.lastOrderOn ? formatDayShort(metrics.lastOrderOn) : "—"}</p>
            <p className="mt-1 text-xs opacity-75">
              {metrics.lastOrderOn ? `il y a ${diffDays(metrics.lastOrderOn, today)} j · fichier clients (ce n'est pas une visite)` : "inconnue"}
            </p>
          </Tile>
          <Tile color="sky">
            <p className="text-sm font-semibold">Visite prévue au fichier</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{metrics.plannedVisitOn ? formatDayShort(metrics.plannedVisitOn) : "—"}</p>
            <p className="mt-1 text-xs opacity-75">
              {!metrics.plannedVisitOn
                ? "aucune date"
                : status.nextPlanned
                  ? `rendez-vous dans Léa le ${formatDayShort(status.nextPlanned)}`
                  : metrics.plannedVisitOn < today
                    ? "date dépassée, aucun rendez-vous dans Léa"
                    : "aucun rendez-vous dans Léa pour l'instant"}
            </p>
          </Tile>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Votre histoire ensemble"
              description={`${doneTotal} visite(s) réalisée(s) · ${appts.length} rendez-vous connus. Un rendez-vous issu de l'agenda reste « à confirmer » tant qu'il n'est pas clôturé.`}
            />
            <CardBody>
              {appts.length === 0 ? (
                <div className="flex items-center gap-3 rounded-[20px] bg-surface-2 p-4 text-sm text-muted">
                  <Buddy mood="sleepy" shape={avatar.shape} color={avatar.color} size={40} />
                  Aucun rendez-vous pour l'instant. Importez votre agenda ou planifiez une première visite.
                </div>
              ) : (
                <>
                  <ol className={TIMELINE}>
                    {appts.slice(0, TIMELINE_VISIBLE).map((a) => (
                      <TimelineItem key={a.id} a={a} past={a.startsAt < now} timezone={user.timezone} />
                    ))}
                  </ol>
                  {appts.length > TIMELINE_VISIBLE ? (
                    <details className="group mt-3">
                      <summary className="cursor-pointer list-none rounded-full bg-surface-2 px-4 py-2 text-center text-sm font-semibold hover:bg-border/60 group-open:mb-3">
                        <span className="group-open:hidden">Voir les {appts.length - TIMELINE_VISIBLE} rendez-vous plus anciens</span>
                        <span className="hidden group-open:inline">Masquer les rendez-vous plus anciens</span>
                      </summary>
                      <ol className={TIMELINE}>
                        {appts.slice(TIMELINE_VISIBLE).map((a) => (
                          <TimelineItem key={a.id} a={a} past={a.startsAt < now} timezone={user.timezone} />
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Comptes rendus" description="Saisis avec le bouton « Rendez-vous terminé »." />
            <CardBody>
              {reports.length === 0 ? (
                <p className="text-sm text-muted">Pas encore de compte rendu.</p>
              ) : (
                <ul className="space-y-3">
                  {reports.map((r) => (
                    <li key={r.id} className="max-w-[90%]">
                      <div className="rounded-[20px] rounded-bl-md bg-primary-soft px-4 py-3 text-sm">
                        <p className="whitespace-pre-line">{r.summary}</p>
                        {r.nextActions ? <p className="mt-2 font-semibold">À faire : {r.nextActions}</p> : null}
                      </div>
                      <p className="mt-1 pl-2 text-xs text-muted">✓ {formatDate(r.createdAt, user.timezone)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-3">
          <Tile color="sky" className="flex items-center gap-3">
            <PharmacyAvatar id={p.id} dueState={status.dueState} size={44} />
            <div className="text-sm">
              <p className="font-display text-base font-bold">{PHARMACY_MOODS[status.dueState].label}</p>
              <p className="opacity-80">
                {preferences?.preferredWeekdays.length
                  ? `Préfère vous voir le ${preferences.preferredWeekdays.map((d) => WEEKDAY_SHORT[d]?.toLowerCase()).join(", ")}`
                  : "Pas de préférence de jour connue"}
                {preferences?.preferredStart ? `, à partir de ${preferences.preferredStart.slice(0, 5)}` : ""}.
              </p>
            </div>
          </Tile>
          <Section title="Données commerciales" open={!metrics?.category}>
            <MetricsForm pharmacyId={p.id} metrics={metrics} categoryFrequency={freq} />
          </Section>
          <Section title="Disponibilités du pharmacien">
            <PreferencesForm pharmacyId={p.id} prefs={preferences} />
          </Section>
          <Section title="Identité et adresse">
            <IdentityForm pharmacy={p} />
          </Section>
          <Section title="Provenance et qualité">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Source</dt>
              <dd>{p.source}</dd>
              <dt className="text-muted">Identifiant</dt>
              <dd>{p.externalId ? `${p.externalSource ?? "externe"} ${p.externalId}` : "aucun"}</dd>
              <dt className="text-muted">Géolocalisation</dt>
              <dd>{geoLabel(p)}</dd>
              {p.channel ? (
                <>
                  <dt className="text-muted">Canal</dt>
                  <dd>{p.channel}</dd>
                </>
              ) : null}
              {p.buyingGroup ? (
                <>
                  <dt className="text-muted">Groupement</dt>
                  <dd>{p.buyingGroup}</dd>
                </>
              ) : null}
              {Object.entries(p.extra ?? {}).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <dt className="text-muted">Mise à jour</dt>
              <dd>{formatDate(p.updatedAt, user.timezone)}</dd>
              <dt className="text-muted">Créée</dt>
              <dd>{dayKeyOf(p.createdAt, user.timezone)}</dd>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

import { AlertCircle, ArrowRight, CalendarCheck, Car, MapPin, Navigation, Route, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CompleteVisit } from "@/components/complete-visit";
import { DayList } from "@/components/planning/day-list";
import { LOAD_STYLE } from "@/components/planning/week-grid";
import { CategoryBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/notice";
import { hasLocation } from "@/domain/geo";
import { estimateLeg } from "@/domain/routing/estimate";
import { addDays, formatDayLong, formatDayShort, formatDuration, formatHHmm, minutesOfDay, WEEKDAY_LABELS, isoWeekday } from "@/domain/time";
import { cn } from "@/lib/cn";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { travelPreferences } from "@/server/db/schema";
import { countPendingMatches } from "@/server/repositories/matches";
import { countPharmacies } from "@/server/repositories/pharmacies";
import { countUnconfirmedPastVisits } from "@/server/services/appointments";
import { todayFor } from "@/server/services/context";
import { getPharmacyOverview } from "@/server/services/pharmacy-overview";
import { getPlanning } from "@/server/services/planning";

export const metadata: Metadata = { title: "Aujourd'hui" };

export default async function TodayPage() {
  const user = await requireUser();
  const now = new Date();
  const today = todayFor(user, now);
  const nowMin = minutesOfDay(now, user.timezone);
  const pharmacyCount = await countPharmacies(db, user.id);

  if (pharmacyCount === 0) {
    return (
      <div className="space-y-6">
        <Greeting name={user.displayName} today={today} />
        <EmptyState icon={<Sparkles className="size-10" />} title="Bienvenue ! Commençons par vos données" action={<LinkButton href="/profil?bienvenue=1">Démarrer la configuration</LinkButton>}>
          Léa a besoin de votre référentiel de pharmacies et de votre historique Outlook pour reconstruire les fiches clients et vous
          proposer des tournées. Comptez une dizaine de minutes.
        </EmptyState>
      </div>
    );
  }

  const week = await getPlanning(db, user, today, addDays(today, 7));
  const day = week[0]!;
  const visits = day.appointments.filter((a) => a.kind === "visit" && a.status !== "cancelled");
  const open = visits.filter((a) => a.outcome === "unknown");
  // Visite à clôturer (déjà commencée) en priorité, sinon la prochaine
  const current = open.find((a) => a.start <= nowMin + 15);
  const next = open.find((a) => a.start > nowMin && a !== current);
  const focus = current ?? next ?? null;
  const focusLabel = !current ? "Prochain rendez-vous" : current.end + 30 >= nowMin ? "Rendez-vous en cours" : "Visite à clôturer";

  const [travel] = await db.select().from(travelPreferences).where(eq(travelPreferences.userId, user.id));
  const home = travel && hasLocation({ lat: travel.homeLat, lng: travel.homeLng }) ? { lat: travel.homeLat!, lng: travel.homeLng! } : null;
  let legToFocus: { km: number; minutes: number } | null = null;
  if (focus?.pharmacy && hasLocation(focus.pharmacy)) {
    const idx = day.appointments.indexOf(focus);
    const prev = day.appointments.slice(0, idx).reverse().find((a) => a.pharmacy && hasLocation(a.pharmacy));
    const from = prev?.pharmacy ? { lat: prev.pharmacy.lat!, lng: prev.pharmacy.lng! } : home;
    if (from) {
      legToFocus = estimateLeg(from, { lat: focus.pharmacy.lat, lng: focus.pharmacy.lng }, {
        roadFactor: travel?.estimateRoadFactor ?? 1.25,
        speedKmh: travel?.estimateSpeedKmh ?? 90,
      });
    }
  }

  // Alertes limitées aux sujets réellement importants
  const alerts: { href: string; text: string }[] = [];
  const pendingMatches = await countPendingMatches(user.id);
  if (pendingMatches) alerts.push({ href: "/rapprochements", text: `${pendingMatches} rendez-vous Outlook à rapprocher d'une pharmacie` });
  const unconfirmed = await countUnconfirmedPastVisits(db, user.id, new Date(now.getTime() - 14 * 86_400_000), new Date(now.getTime() - 3600_000));
  if (unconfirmed) alerts.push({ href: "/planning", text: `${unconfirmed} visite(s) des 14 derniers jours à marquer comme réalisée(s) ou non` });
  const overview = await getPharmacyOverview(user);
  const overdueAB = overview.filter((i) => i.status.dueState === "overdue" && (i.metrics?.category === "A" || i.metrics?.category === "B")).length;
  if (overdueAB) alerts.push({ href: "/pharmacies?due=overdue&tri=urgence", text: `${overdueAB} pharmacie(s) A ou B en retard de visite` });
  const badDays = week.slice(1).filter((d) => d.warnings.length && d.weekday <= 5);
  if (badDays[0]) alerts.push({ href: `/planning?vue=jour&date=${badDays[0].day}`, text: `${formatDayShort(badDays[0].day)} : ${badDays[0].warnings[0]!.toLowerCase()}` });
  if (!home) alerts.push({ href: "/profil#deplacements", text: "Renseignez votre domicile pour estimer les trajets" });

  const doneToday = visits.filter((a) => a.outcome === "done").length;
  const dayOver = nowMin > Math.max(...visits.map((v) => v.end), 0) && visits.length > 0;

  return (
    <div className="space-y-5">
      <Greeting name={user.displayName} today={today} sectors={day.sectors} />

      {focus ? (
        <Card className="overflow-hidden">
          <div className="h-1.5" style={{ backgroundColor: focus.color ?? "var(--primary)" }} />
          <CardBody className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary">{focusLabel}</p>
                <h2 className="mt-0.5 text-xl font-semibold">
                  <Link href={focus.pharmacy ? `/pharmacies/${focus.pharmacy.id}` : `/planning/rdv/${focus.id}`} className="hover:underline">
                    {focus.title}
                  </Link>
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                  <MapPin className="size-4" aria-hidden /> {focus.pharmacy?.city ?? "Lieu inconnu"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums">{formatHHmm(focus.start)}</p>
                <p className="text-xs text-muted">jusqu&apos;à {formatHHmm(focus.end)}</p>
                <div className="mt-1">
                  <CategoryBadge category={focus.category} />
                </div>
              </div>
            </div>
            {legToFocus && !current ? (
              <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <Car className="size-4 text-muted" aria-hidden /> ~{formatDuration(legToFocus.minutes)} de trajet ({Math.round(legToFocus.km)} km, estimation à vol d&apos;oiseau)
              </p>
            ) : null}
            <CompleteVisit appointmentId={focus.id} />
            <div className="grid grid-cols-2 gap-2">
              {focus.pharmacy && hasLocation(focus.pharmacy) ? (
                <LinkButton
                  href={`https://www.google.com/maps/dir/?api=1&destination=${focus.pharmacy.lat},${focus.pharmacy.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="secondary"
                  size="lg"
                >
                  <Navigation className="size-5" aria-hidden /> Itinéraire
                </LinkButton>
              ) : (
                <span />
              )}
              <LinkButton href={`/planning/rdv/${focus.id}`} variant="secondary" size="lg">
                Détails
              </LinkButton>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex items-center gap-3">
            <CalendarCheck className="size-8 text-success" aria-hidden />
            <div>
              <p className="font-semibold">{visits.length ? "Toutes les visites du jour sont traitées" : "Aucune visite prévue aujourd'hui"}</p>
              <p className="text-sm text-muted">
                {visits.length ? `${doneToday} visite(s) réalisée(s) aujourd'hui.` : "Profitez-en pour préparer la semaine ou vérifier vos rapprochements."}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {alerts.length ? (
        <section aria-label="Alertes" className="space-y-2">
          {alerts.slice(0, 4).map((a) => (
            <Link key={a.text} href={a.href} className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm hover:opacity-90">
              <AlertCircle className="size-4 shrink-0 text-warning" aria-hidden />
              <span className="flex-1">{a.text}</span>
              <ArrowRight className="size-4 text-muted" aria-hidden />
            </Link>
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-5 *:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Tournée du jour"
            description={`${visits.length} visite(s) · charge ${day.load}`}
            action={
              visits.length > 1 ? (
                <LinkButton href={`/tournees?date=${today}`} size="sm" variant="secondary">
                  <Route className="size-4" aria-hidden /> Optimiser
                </LinkButton>
              ) : null
            }
          />
          <CardBody>
            <DayList day={day} showHeader={false} />
            {dayOver ? (
              <div className="mt-4 rounded-xl bg-success-soft p-3 text-sm text-success">
                <p className="font-semibold">Bilan de la journée</p>
                <p className="text-text/80">
                  {doneToday}/{visits.length} visite(s) confirmée(s) comme réalisée(s)
                  {day.driveKm !== null ? ` · ~${Math.round(day.driveKm)} km estimés` : ""}. Bonne soirée !
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Les prochains jours" description="Charge estimée : visites, trajets et pause." />
          <CardBody>
            <ul className="space-y-2">
              {week
                .slice(1)
                .filter((d) => d.weekday <= 5)
                .slice(0, 5)
                .map((d) => (
                  <li key={d.day}>
                    <Link href={`/planning?vue=jour&date=${d.day}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                      <span className="flex items-center gap-2">
                        <span className="w-20 text-sm font-medium capitalize">{formatDayShort(d.day)}</span>
                        {d.sectors.map((s) => (
                          <span key={s.code} className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: s.color }}>
                            {s.name}
                          </span>
                        ))}
                      </span>
                      <span className={cn("text-xs", LOAD_STYLE[d.load])}>
                        {d.visits} visite(s) · {d.load}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Greeting({ name, today, sectors = [] }: { name: string; today: string; sectors?: { code: string; name: string; color: string }[] }) {
  const weekday = isoWeekday(today);
  return (
    <header>
      <p className="text-sm text-muted capitalize">{formatDayLong(today)}</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Bonjour {name}</h1>
      {sectors.length ? (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {WEEKDAY_LABELS[weekday]} : secteur
          {sectors.map((s) => (
            <span key={s.code} className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: s.color }}>
              {s.name}
            </span>
          ))}
        </p>
      ) : null}
    </header>
  );
}

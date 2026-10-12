import { AlertCircle, ArrowRight, Car, Flame, MapPin, Navigation, Route, Sparkles, Store, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { BuddyCrowd } from "@/components/buddy";
import { CompleteVisit } from "@/components/complete-visit";
import { BUDDY_PASTEL, DayBuddy, MoodChip, ProgressBar, ProgressRing } from "@/components/mood-ui";
import { DayList } from "@/components/planning/day-list";
import { CategoryBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Tile } from "@/components/ui/card";
import { encouragement } from "@/domain/gamification";
import { hasLocation } from "@/domain/geo";
import { estimateLeg } from "@/domain/routing/estimate";
import { addDays, formatDayLong, formatDuration, formatHHmm, minutesOfDay, WEEKDAY_SHORT } from "@/domain/time";
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
import { getRewards } from "@/server/services/rewards";

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
        <header>
          <p className="text-sm text-muted capitalize">{formatDayLong(today)}</p>
          <h1 className="text-4xl font-extrabold">Bonjour {user.displayName}&nbsp;!</h1>
        </header>
        <Card className="overflow-hidden">
          <div className="grid items-center gap-4 p-6 sm:grid-cols-[1fr_280px]">
            <div>
              <h2 className="text-3xl leading-tight font-extrabold">Vos pharmacies attendent de faire votre connaissance</h2>
              <p className="mt-2 text-muted">
                Importez votre référentiel puis votre agenda Outlook : Léa reconstruit les fiches et l'historique des visites, et vos journées
                prennent vie.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <LinkButton href="/pharmacies/import" size="lg">
                  <Store className="size-5" aria-hidden /> Importer mes pharmacies
                </LinkButton>
                <LinkButton href="/imports" size="lg" variant="secondary">
                  Importer mon agenda
                </LinkButton>
              </div>
            </div>
            <BuddyCrowd className="h-64" />
          </div>
        </Card>
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
  if (overdueAB) alerts.push({ href: "/pharmacies?due=overdue&tri=urgence", text: `${overdueAB} pharmacie(s) A ou B vous attendent depuis longtemps` });
  const badDays = week.slice(1).filter((d) => d.warnings.length && d.weekday <= 5);
  if (badDays[0]) alerts.push({ href: `/planning?vue=jour&date=${badDays[0].day}`, text: `${formatDayLong(badDays[0].day)} : ${badDays[0].warnings[0]!.toLowerCase()}` });
  if (!home) alerts.push({ href: "/profil#deplacements", text: "Renseignez votre domicile pour estimer les trajets" });

  const rewards = user.gamificationEnabled ? await getRewards(db, user) : null;
  const doneToday = visits.filter((a) => a.outcome === "done").length;
  const dayOver = visits.length > 0 && nowMin > Math.max(...visits.map((v) => v.end));
  const challenge = rewards?.challenges.find((c) => !c.done) ?? null;
  const visitMinutes = visits.reduce((n, v) => n + (v.end - v.start), 0);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted capitalize">{formatDayLong(today)}</p>
          <h1 className="text-4xl leading-tight font-extrabold">Bonjour {user.displayName}&nbsp;!</h1>
          <p className="mt-1 text-lg text-muted">Comment s'annonce votre journée&nbsp;?</p>
        </div>
        {rewards ? (
          <Link href="/recompenses" className="flex shrink-0 flex-col items-center gap-1" aria-label={`Niveau ${rewards.level.name}, ${rewards.points} points`}>
            <ProgressRing value={rewards.level.progress} size={58} color="var(--primary)">
              <span className="text-sm">{rewards.level.index + 1}</span>
            </ProgressRing>
            <span className="text-xs font-bold">{rewards.level.name}</span>
          </Link>
        ) : null}
      </header>

      {/* Humeur de la semaine */}
      <nav aria-label="Humeur des prochains jours" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {week
          .filter((d) => d.weekday <= 5 || d.visits > 0)
          .slice(0, 6)
          .map((d, i) => (
            <Link key={d.day} href={`/planning?vue=jour&date=${d.day}`} className="shrink-0">
              <MoodChip mood={d.mood} label={i === 0 ? `Aujourd'hui · ${d.mood.label}` : `${WEEKDAY_SHORT[d.weekday]} · ${d.mood.label}`} active={i === 0} />
            </Link>
          ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          {/* Bonhomme du jour */}
          <Tile color={BUDDY_PASTEL[day.mood.color]} className="flex items-center gap-4 p-5">
            <DayBuddy mood={day.mood} size={88} animate />
            <div className="min-w-0">
              <p className="text-sm font-semibold opacity-75">Journée {day.mood.label.toLowerCase()}</p>
              <p className="font-display text-2xl leading-tight font-extrabold">{day.mood.hint}</p>
              {day.sectors.length ? (
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {day.sectors.map((s) => (
                    <span key={s.code} className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: s.color }}>
                      {s.name}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </Tile>

          {focus ? (
            <Tile color="pink" className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold opacity-75">{focusLabel}</p>
                  <h2 className="text-2xl leading-tight font-extrabold">
                    <Link href={focus.pharmacy ? `/pharmacies/${focus.pharmacy.id}` : `/planning/rdv/${focus.id}`} className="hover:underline">
                      {focus.title}
                    </Link>
                  </h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm opacity-80">
                    <MapPin className="size-4" aria-hidden /> {focus.pharmacy?.city ?? "Lieu inconnu"}
                  </p>
                </div>
                <div className="rounded-[20px] bg-white/70 px-3 py-2 text-center">
                  <p className="font-display text-2xl font-extrabold">{formatHHmm(focus.start)}</p>
                  <p className="text-xs opacity-75">→ {formatHHmm(focus.end)}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <CategoryBadge category={focus.category} />
                {legToFocus && !current ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1">
                    <Car className="size-4" aria-hidden /> ~{formatDuration(legToFocus.minutes)} · {Math.round(legToFocus.km)} km (estimation)
                  </span>
                ) : null}
              </div>
              <div className="text-text">
                <CompleteVisit appointmentId={focus.id} />
              </div>
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
            </Tile>
          ) : (
            <Card>
              <CardBody className="flex items-center gap-4">
                <DayBuddy mood={day.mood} size={56} />
                <div>
                  <p className="font-display text-xl font-bold">{visits.length ? "Toutes les visites du jour sont traitées" : "Pas de visite aujourd'hui"}</p>
                  <p className="text-sm text-muted">
                    {visits.length ? `${doneToday} visite(s) réalisée(s) aujourd'hui.` : "Un bon moment pour préparer la semaine ou vérifier vos rapprochements."}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Tile color="peach">
              <p className="text-sm font-semibold">Visites du jour</p>
              <p className="mt-1 font-display text-4xl font-extrabold">{visits.length}</p>
              <div className="mt-2 flex h-10 items-end gap-1" aria-hidden>
                {visits.map((v) => (
                  <span key={v.id} className={cn("w-full max-w-4 rounded-t-[4px]", v.outcome === "done" ? "bg-on-pastel" : "bg-on-pastel/35")} style={{ height: `${Math.min(100, ((v.end - v.start) / 90) * 100)}%` }} />
                ))}
              </div>
              <p className="mt-1 text-xs opacity-75">{visitMinutes ? `${formatDuration(visitMinutes)} en pharmacie` : "Journée libre"}</p>
            </Tile>
            <Tile color="lilac">
              <p className="text-sm font-semibold">Route estimée</p>
              <p className="mt-1 font-display text-4xl font-extrabold">{day.driveKm !== null ? Math.round(day.driveKm) : "—"}<span className="ml-1 text-base">km</span></p>
              <p className="mt-2 flex items-center gap-1.5 text-sm">
                <Route className="size-4" aria-hidden /> {day.driveMinutes !== null ? formatDuration(day.driveMinutes) : "trajets non estimés"}
              </p>
              <p className="mt-1 text-xs opacity-75">À vol d'oiseau × 1,25</p>
            </Tile>
            {rewards ? (
              <>
                <Tile color="mint">
                  <p className="text-sm font-semibold">Points</p>
                  <p className="mt-1 font-display text-4xl font-extrabold">{rewards.points.toLocaleString("fr-FR")}</p>
                  <p className="mt-1 text-xs font-semibold">{rewards.todayPoints ? `+${rewards.todayPoints} aujourd'hui` : `Niveau ${rewards.level.name}`}</p>
                  {rewards.level.nextMin ? <ProgressBar value={rewards.points - rewards.level.min} target={rewards.level.nextMin - rewards.level.min} className="mt-2 bg-white/60" /> : null}
                </Tile>
                <Tile color="butter">
                  <p className="text-sm font-semibold">Série douce</p>
                  <p className="mt-1 flex items-center gap-1 font-display text-4xl font-extrabold">
                    <Flame className="size-8" aria-hidden /> {rewards.streak.current}
                  </p>
                  <p className="mt-1 text-xs opacity-75">journée(s) clôturée(s) d'affilée · record {rewards.streak.best}</p>
                </Tile>
              </>
            ) : null}
          </div>

          {challenge ? (
            <Tile color="mint" className="p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <Trophy className="size-4" aria-hidden /> Défi de la semaine
                </p>
                <Link href="/recompenses" className="text-sm font-semibold underline">
                  Tous les défis
                </Link>
              </div>
              <p className="mt-2 font-display text-xl font-bold">{challenge.label}</p>
              <div className="mt-3 flex items-center gap-3">
                <ProgressBar value={challenge.value} target={challenge.target} className="flex-1 bg-white/60" />
                <span className="text-sm font-bold tabular-nums">
                  {challenge.value}/{challenge.target}
                </span>
              </div>
              <p className="mt-2 text-xs opacity-75">{encouragement(rewards!)}</p>
            </Tile>
          ) : null}

          {alerts.length ? (
            <section aria-label="Alertes" className="space-y-2">
              {alerts.slice(0, 4).map((a) => (
                <Link key={a.text} href={a.href} className="flex items-center gap-3 rounded-[20px] bg-surface px-4 py-3 text-sm shadow-card hover:bg-surface-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
                    <AlertCircle className="size-4" aria-hidden />
                  </span>
                  <span className="flex-1">{a.text}</span>
                  <ArrowRight className="size-4 text-muted" aria-hidden />
                </Link>
              ))}
            </section>
          ) : null}
        </div>

        <div className="space-y-5">
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
                <div className="mt-4 flex items-center gap-3 pastel-scope rounded-[20px] bg-mint p-4 text-on-pastel">
                  <DayBuddy mood={{ ...day.mood, mood: doneToday === visits.length ? "joy" : day.mood.mood }} size={48} />
                  <div className="text-sm">
                    <p className="font-display text-lg font-bold">Bilan de la journée</p>
                    <p>
                      {doneToday}/{visits.length} visite(s) clôturée(s)
                      {day.driveKm !== null ? ` · ~${Math.round(day.driveKm)} km estimés` : ""}
                      {rewards?.todayPoints ? ` · +${rewards.todayPoints} points` : ""}. Bonne soirée !
                    </p>
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>
          {rewards && !challenge ? (
            <Tile color="sky" className="flex items-center gap-3 p-5">
              <Sparkles className="size-6" aria-hidden />
              <p className="text-sm font-semibold">Tous les défis de la semaine sont relevés. Bravo !</p>
            </Tile>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import { and, eq, isNotNull } from "drizzle-orm";
import { AlertTriangle, Check, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApplyPlanForm } from "@/components/apply-plan";
import { formatKm } from "@/components/labels";
import { LeaMap } from "@/components/map/lea-map";
import { ProposeSlotButton } from "@/components/propose-slot";
import { Badge, CategoryBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState, Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { formatDayLong, formatDuration, formatHHmm, isDayKey } from "@/domain/time";
import type { ScheduleResult } from "@/domain/routing/schedule";
import { scheduleSignature } from "@/server/actions/routes";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { favoritePlaces } from "@/server/db/schema";
import { todayFor } from "@/server/services/context";
import { RoutePlanError, simulateDayPlan, type DaySimulation, type Endpoint } from "@/server/services/route-plan";

export const metadata: Metadata = { title: "Tournées" };

function endpoint(v: string | undefined): Endpoint {
  return !v || v === "home" ? { kind: "home" } : { kind: "place", id: v };
}

export default async function RoutesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const day = sp.date && isDayKey(sp.date) ? sp.date : todayFor(user);
  const hotels = await db
    .select()
    .from(favoritePlaces)
    .where(and(eq(favoritePlaces.userId, user.id), eq(favoritePlaces.kind, "hotel"), isNotNull(favoritePlaces.lat)));
  const validPlace = (v: string | undefined) => (v && hotels.some((h) => h.id === v) ? v : "home");
  const start = validPlace(sp.depart);
  const end = validPlace(sp.arrivee);
  const allowConfirmed = sp.confirmes === "deplacables";

  let sim: DaySimulation | null = null;
  let error: string | null = null;
  try {
    sim = await simulateDayPlan(db, user, day, { start: endpoint(start), end: endpoint(end), persist: false, allowConfirmed });
  } catch (err) {
    if (err instanceof RoutePlanError) error = err.message;
    else throw err;
  }

  return (
    <>
      <PageHeader title="Tournée" subtitle={<span className="capitalize">{formatDayLong(day)}</span>} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Date</span>
          <Input type="date" name="date" defaultValue={day} className="h-10 w-auto" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Départ</span>
          <Select name="depart" defaultValue={start} className="h-10 w-auto">
            <option value="home">Domicile</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                Hôtel : {h.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Arrivée</span>
          <Select name="arrivee" defaultValue={end} className="h-10 w-auto">
            <option value="home">Domicile</option>
            {hotels.map((h) => (
              <option key={h.id} value={h.id}>
                Hôtel : {h.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm">
          <input type="checkbox" name="confirmes" value="deplacables" defaultChecked={allowConfirmed} className="accent-[var(--primary)]" />
          Autoriser le déplacement des rendez-vous confirmés
        </label>
        <button type="submit" className="h-10 rounded-xl bg-text px-4 text-sm font-medium text-bg">
          Simuler
        </button>
      </form>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!sim && !error ? (
        <EmptyState title="Aucune visite ce jour-là" action={<Link href={`/planning?vue=jour&date=${day}`} className="text-primary underline">Ouvrir le planning</Link>}>
          La simulation compare l&apos;ordre actuel des visites d&apos;une journée avec un ordre optimisé.
        </EmptyState>
      ) : null}
      {sim ? <Simulation sim={sim} day={day} start={start} end={end} visitMinutes={user.defaultVisitMinutes} /> : null}
    </>
  );
}

async function Simulation({ sim, day, start, end, visitMinutes }: { sim: DaySimulation; day: string; start: string; end: string; visitMinutes: number }) {
  const cmp = sim.comparison;
  const signature = await scheduleSignature(sim.optimized.stops);
  const mapStops = sim.optimized.stops.map((s, i) => {
    const p = sim.stops[s.id]!.pharmacy!;
    return { id: s.id, label: s.label, lat: p.lat!, lng: p.lng!, order: i + 1, time: formatHHmm(s.start), pharmacyId: p.id };
  });
  return (
    <div className="space-y-4">
      <Notice tone={sim.provider.isRealRouting ? "success" : "info"} title={sim.provider.label}>
        {sim.fallbackReason ? `${sim.fallbackReason} ` : ""}
        {sim.provider.disclaimer ?? "Distances et durées issues d'un calcul d'itinéraire routier."}
      </Notice>
      {sim.allowConfirmed ? (
        <Notice tone="warning" title="Simulation avec rendez-vous confirmés déplaçables">
          {sim.movedConfirmed.length
            ? `Ce scénario déplace ${sim.movedConfirmed.length} rendez-vous confirmé(s) : ${sim.movedConfirmed.map((m) => `${m.label} (${formatHHmm(m.from)} → ${formatHHmm(m.to)})`).join(", ")}. Chaque déplacement est à renégocier avec le pharmacien.`
            : "Même en autorisant leur déplacement, aucun rendez-vous confirmé n'aurait besoin de bouger."}
        </Notice>
      ) : null}
      {sim.warnings.map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}

      <Card>
        <CardHeader
          title={cmp.worthApplying ? "Un meilleur ordre de passage est possible" : "Recommandation : conserver le planning actuel"}
          description={`Moteur : ${sim.method === "exhaustive" ? "recherche exhaustive" : sim.method === "local_search" ? "recherche locale (2-opt)" : "trivial"} · ${sim.evaluated.toLocaleString("fr-FR")} ordres évalués`}
        />
        <CardBody>
          <ul className="space-y-1.5 text-sm">
            {cmp.explanation.map((e) => (
              <li key={e} className="flex gap-2">
                {e.startsWith("Non résolu") || e.startsWith("Nouvelle contrainte") ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                ) : e.startsWith("Aucun moteur") ? (
                  <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                ) : (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                )}
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-2">
        <ScenarioCard title="Planning actuel" schedule={sim.initial} sim={sim} />
        <ScenarioCard title="Scénario optimisé" schedule={sim.optimized} sim={sim} highlight={cmp.worthApplying} />
      </div>

      {cmp.orderChanged ? (
        <Card>
          <CardHeader title="Appliquer le scénario ?" description="Les horaires des visites non confirmées seront modifiés ; tout est journalisé." />
          <CardBody>
            <ApplyPlanForm
              day={day}
              signature={signature}
              start={start}
              end={end}
              recommended={cmp.worthApplying}
              allowConfirmed={sim.allowConfirmed}
              movedConfirmed={sim.movedConfirmed.map((m) => `${m.label} ${formatHHmm(m.from)} → ${formatHHmm(m.to)}`)}
            />
          </CardBody>
        </Card>
      ) : null}

      <LeaMap
        pharmacies={[]}
        stops={mapStops}
        home={sim.start.location}
        lineIsEstimate={!sim.provider.isRealRouting}
        className="h-[45vh]"
      />

      {sim.nearby.length ? (
        <Card>
          <CardHeader
            title="Pharmacies à visiter près de cette tournée"
            description="En retard ou bientôt dues, à moins de 15 km d'une visite du jour. Le créneau proposé respecte horaires, trajets et pause."
          />
          <CardBody>
            <ul className="divide-y divide-border">
              {sim.nearby.map((n) => (
                <li key={n.pharmacyId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <Link href={`/pharmacies/${n.pharmacyId}`} className="hover:underline">
                        {n.name}
                      </Link>
                      <CategoryBadge category={n.category} />
                    </p>
                    <p className="text-xs text-muted">
                      {n.city} · {n.dueLabel} · détour estimé {formatKm(n.detourKm)}
                    </p>
                  </div>
                  {n.start !== null ? (
                    <ProposeSlotButton
                      pharmacyId={n.pharmacyId}
                      title={n.name}
                      day={day}
                      start={formatHHmm(n.start)}
                      end={formatHHmm(n.start + visitMinutes)}
                      label={`Ajouter à ${formatHHmm(n.start)}`}
                    />
                  ) : (
                    <Badge tone="neutral">Pas de créneau libre</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function ScenarioCard({ title, schedule, sim, highlight }: { title: string; schedule: ScheduleResult; sim: DaySimulation; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-primary ring-1 ring-primary/30" : undefined}>
      <CardHeader title={title} />
      <CardBody className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-[11px] text-muted">Distance</dt>
            <dd className="font-semibold tabular-nums">{formatKm(schedule.totalKm)}</dd>
          </div>
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-[11px] text-muted">Conduite</dt>
            <dd className="font-semibold tabular-nums">{formatDuration(schedule.totalDriveMin)}</dd>
          </div>
          <div className="rounded-xl bg-surface-2 p-2">
            <dt className="text-[11px] text-muted">Retour</dt>
            <dd className="font-semibold tabular-nums">{formatHHmm(schedule.returnLeg.arrival)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          Départ {formatHHmm(schedule.departure)} de {sim.start.label} · {schedule.stops.length} visite(s) · attente {formatDuration(schedule.totalWaitMin)}
          {schedule.lunch ? ` · pause ${formatHHmm(schedule.lunch.start)}–${formatHHmm(schedule.lunch.end)}` : ""}
        </p>
        <ol className="space-y-1.5 text-sm">
          {schedule.stops.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">{i + 1}</span>
              <span className="w-24 shrink-0 text-xs text-muted tabular-nums">
                {formatHHmm(s.start)}–{formatHHmm(s.end)}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {s.fixed ? <Badge tone="success">confirmé</Badge> : null}
              <span className="text-xs text-muted tabular-nums">{Math.round(s.legKm)} km</span>
            </li>
          ))}
        </ol>
        {schedule.violations.length ? (
          <ul className="space-y-1 text-xs">
            {schedule.violations.map((v, i) => (
              <li key={i} className={v.severity === "hard" ? "text-danger" : "text-warning"}>
                {v.severity === "hard" ? "Bloquant : " : "À surveiller : "}
                {v.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-success">Toutes les contraintes sont respectées.</p>
        )}
      </CardBody>
    </Card>
  );
}

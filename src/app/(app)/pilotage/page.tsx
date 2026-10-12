import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart, Meter, StackedBars, TableView } from "@/components/charts";
import { CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/notice";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { departmentName } from "@/domain/departments";
import { formatDayShort, formatDuration, WEEKDAY_LABELS, WEEKDAY_SHORT } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { territoryLookup } from "@/server/repositories/territories";
import { getHistoryAnalysis } from "@/server/services/analytics";
import { getPharmacyOverview } from "@/server/services/pharmacy-overview";

export const metadata: Metadata = { title: "Pilotage" };

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export default async function PilotagePage() {
  const user = await requireUser();
  const { analysis: a, quality: q } = await getHistoryAnalysis(db, user);
  const territories = await territoryLookup(db, user.id);
  const overview = await getPharmacyOverview(user);
  const color = (code: string | null) => (code ? (territories.get(code)?.color ?? "#9b9188") : "#9b9188");

  const coverage = (["A", "B", "C", "D"] as const).map((cat) => {
    const items = overview.filter((i) => i.metrics?.category === cat);
    const count = (s: string) => items.filter((i) => i.status.dueState === s).length;
    return {
      cat,
      total: items.length,
      upToDate: count("ok") + count("planned"),
      soon: count("due_soon"),
      overdue: count("overdue") + count("never_visited"),
      visitsYear: items.reduce((n, i) => n + i.status.year.done + i.status.year.identified, 0),
      targetYear: items.reduce((n, i) => n + (i.status.year.target ?? 0), 0),
    };
  });

  return (
    <>
      <PageHeader title="Pilotage" subtitle="Analyse de l'historique reconstruit et qualité des données." />

      <section aria-labelledby="qualite" className="mb-6">
        <h2 id="qualite" className="mb-3 text-lg font-semibold">
          Qualité des données
        </h2>
        <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardBody className="space-y-3">
              <Meter label="Pharmacies géolocalisées" value={q.geolocated} total={q.pharmacies} />
              <Meter label="Pharmacies catégorisées (A–D)" value={q.categorized} total={q.pharmacies} />
              <p className="text-xs text-muted">Sans coordonnées, pas de calcul de trajet ; sans catégorie, pas d&apos;échéance.</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2 text-sm">
              <p>
                <strong className="tabular-nums">{q.importedEvents.toLocaleString("fr-FR")}</strong> événements Outlook importés
              </p>
              <p className="text-muted">
                Rapprochements : {q.matches.auto_validated} automatiques · {q.matches.validated} validés · {q.matches.to_review} à vérifier ·{" "}
                {q.matches.ignored} ignorés
              </p>
              {q.matches.to_review ? (
                <Link href="/rapprochements" className="font-medium text-primary underline">
                  Vérifier les {q.matches.to_review} rapprochements en attente
                </Link>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </section>

      {a.totals.visits === 0 ? (
        <EmptyState icon={<BarChart3 className="size-10" />} title="Pas encore d'historique" action={<LinkButton href="/imports">Importer l&apos;agenda Outlook</LinkButton>}>
          Les analyses apparaîtront dès que des rendez-vous passés seront rattachés à des pharmacies.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Notice tone="info">
            Période analysée : du {formatDayShort(a.totals.firstDay!)} au {formatDayShort(a.totals.lastDay!)}. {a.totals.identified} visite(s) sont
            « identifiées » d&apos;après l&apos;agenda mais non confirmées comme réalisées ; {a.totals.done} sont confirmées.
          </Notice>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Visites" value={a.totals.visits.toLocaleString("fr-FR")} hint={`${a.totals.done} confirmées`} />
            <Stat label="Pharmacies visitées" value={a.totals.pharmacies} hint={`sur ${q.pharmacies}`} />
            <Stat label="Visites par jour" value={a.totals.avgVisitsPerDay?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} hint={`${a.totals.days} journées`} />
            <Stat label="Durée médiane" value={a.durations.medianMin !== null ? formatDuration(a.durations.medianMin) : "—"} hint={a.durations.averageMin !== null ? `moyenne ${formatDuration(a.durations.averageMin)}` : undefined} />
            <Stat
              label="Km par jour (estim.)"
              value={a.mileage ? Math.round(a.mileage.avgKmPerDay).toLocaleString("fr-FR") : "—"}
              hint={a.mileage ? `${a.mileage.daysMeasured} jours mesurés, vol d'oiseau × coef.` : "domicile non renseigné"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-2">
            <Card>
              <CardHeader title="Visites par jour de la semaine" />
              <CardBody>
                <ColumnChart
                  ariaLabel="Nombre de visites par jour de la semaine"
                  data={a.weekdays.filter((w) => w.weekday <= 5 || w.visits > 0).map((w) => ({ key: String(w.weekday), label: WEEKDAY_SHORT[w.weekday]!, value: w.visits, tooltip: `${WEEKDAY_LABELS[w.weekday]} · ${w.days} journée(s)` }))}
                />
                <TableView caption="Visites par jour" headers={["Jour", "Visites", "Journées"]} rows={a.weekdays.map((w) => [WEEKDAY_LABELS[w.weekday], w.visits, w.days])} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Secteurs visités chaque jour" description="Part des visites par département, selon le jour de la semaine." />
              <CardBody>
                <StackedBars
                  ariaLabel="Répartition des visites par secteur et par jour"
                  legend={[...new Set(a.sectorsByWeekday.flatMap((s) => s.departments.map((d) => d.code)))].map((code) => ({
                    key: code ?? "?",
                    label: departmentName(code),
                    color: color(code),
                  }))}
                  rows={a.sectorsByWeekday.map((s) => ({
                    key: String(s.weekday),
                    label: WEEKDAY_LABELS[s.weekday]!,
                    total: s.departments.reduce((n, d) => n + d.visits, 0),
                    segments: s.departments.map((d) => ({ key: d.code ?? "?", label: departmentName(d.code), value: d.visits, color: color(d.code) })),
                  }))}
                />
                <TableView
                  caption="Secteurs par jour"
                  headers={["Jour", "Secteur principal", "Part"]}
                  rows={a.sectorsByWeekday.map((s) => [WEEKDAY_LABELS[s.weekday], departmentName(s.departments[0]?.code ?? null), `${Math.round((s.departments[0]?.share ?? 0) * 100)} %`])}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Visites par mois" />
            <CardBody>
              <ColumnChart
                ariaLabel="Visites par mois"
                labelAll={a.monthly.length <= 12}
                data={a.monthly.map((m) => ({ key: m.month, label: `${MONTHS[Number(m.month.slice(5)) - 1]}${m.month.endsWith("-01") ? ` ${m.month.slice(2, 4)}` : ""}`, value: m.visits, tooltip: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}` }))}
              />
              <TableView caption="Visites par mois" headers={["Mois", "Visites"]} rows={a.monthly.map((m) => [m.month, m.visits])} />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Déplacements lointains"
                description={a.farDays ? `Journées avec au moins une visite à plus de ${a.farDays.thresholdKm} km (estimés) du domicile.` : "Renseignez votre domicile pour cette analyse."}
              />
              <CardBody>
                {a.farDays ? (
                  <>
                    <p className="mb-3 text-sm">
                      <strong>{a.farDays.count}</strong> journée(s) lointaine(s), dont <strong>{a.farDays.consecutiveSequences}</strong> enchaînement(s) de jours
                      consécutifs (nuits d&apos;hôtel probables).
                    </p>
                    <ColumnChart
                      ariaLabel="Journées lointaines par jour de la semaine"
                      color="var(--accent)"
                      height={110}
                      data={a.farDays.byWeekday.map((w) => ({ key: String(w.weekday), label: WEEKDAY_SHORT[w.weekday]!, value: w.count }))}
                    />
                  </>
                ) : null}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Regroupements récurrents" description="Pharmacies visitées ensemble au moins 3 fois, sur au moins la moitié de leurs journées de visite." />
              <CardBody>
                {a.clusters.length === 0 ? (
                  <p className="text-sm text-muted">Aucun regroupement récurrent détecté.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {a.clusters.map((c, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <SectorDot color={color(c.departmentCode)} className="mt-1.5" />
                        <span>
                          {c.pharmacies.map((p, j) => (
                            <span key={p.id}>
                              {j ? ", " : ""}
                              <Link href={`/pharmacies/${p.id}`} className="hover:underline">
                                {p.name}
                              </Link>
                            </span>
                          ))}
                          <span className="text-muted"> — {c.sharedDays} journées communes</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Couverture des objectifs par catégorie" description="Situation actuelle des échéances (visites réalisées ou identifiées, et rendez-vous planifiés)." />
            <CardBody className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Catégorie</th>
                    <th className="py-2 pr-3 font-medium">Pharmacies</th>
                    <th className="py-2 pr-3 font-medium">À jour ou planifiées</th>
                    <th className="py-2 pr-3 font-medium">À prévoir</th>
                    <th className="py-2 pr-3 font-medium">En retard / jamais vues</th>
                    <th className="py-2 pr-3 font-medium">Visites cette année / objectif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {coverage.map((c) => (
                    <tr key={c.cat}>
                      <td className="py-2 pr-3">
                        <CategoryBadge category={c.cat} />
                      </td>
                      <td className="py-2 pr-3">{c.total}</td>
                      <td className="py-2 pr-3">{c.upToDate}</td>
                      <td className="py-2 pr-3">{c.soon}</td>
                      <td className="py-2 pr-3">
                        {c.overdue ? (
                          <Link href={`/pharmacies?cat=${c.cat}&due=overdue`} className="text-danger underline">
                            {c.overdue}
                          </Link>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {c.visitsYear} / {c.targetYear}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Fréquence historique par pharmacie" description="Les 25 pharmacies les plus visitées sur la période." />
            <CardBody className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Pharmacie</th>
                    <th className="py-2 pr-3 font-medium">Visites</th>
                    <th className="py-2 pr-3 font-medium">Intervalle moyen</th>
                    <th className="py-2 pr-3 font-medium">Dernière</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {a.perPharmacy.slice(0, 25).map((p) => (
                    <tr key={p.pharmacyId}>
                      <td className="py-2 pr-3">
                        <Link href={`/pharmacies/${p.pharmacyId}`} className="inline-flex items-center gap-2 hover:underline">
                          <SectorDot color={color(p.departmentCode)} /> {p.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{p.count}</td>
                      <td className="py-2 pr-3">{p.avgIntervalDays !== null ? `${p.avgIntervalDays} j` : "—"}</td>
                      <td className="py-2 pr-3">{formatDayShort(p.lastDay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

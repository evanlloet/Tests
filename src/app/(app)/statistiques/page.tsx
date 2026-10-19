import { BarChart3, BedDouble, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart, StackedBars, TableView } from "@/components/charts";
import { Badge, CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/notice";
import { PageHeader, Stat } from "@/components/ui/page-header";
import type { StatsDay } from "@/domain/analytics/agenda-stats";
import { departmentName } from "@/domain/departments";
import { formatDayShort, formatHHmm, formatTime, WEEKDAY_LABELS, WEEKDAY_SHORT } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { territoryLookup } from "@/server/repositories/territories";
import { getAgendaStats } from "@/server/services/agenda-stats";

export const metadata: Metadata = { title: "Statistiques" };

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const nf = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: digits }));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);

export default async function StatistiquesPage() {
  const user = await requireUser();
  const s = await getAgendaStats(db, user);
  const territories = await territoryLookup(db, user.id);
  const color = (code: string | null | undefined) => (code ? (territories.get(code)?.color ?? "#9b9188") : "#9b9188");
  const sectorLabel = (codes: string[]) => (codes.length ? codes.map((c) => departmentName(c)).join(" + ") : "—");
  const Sectors = ({ codes }: { codes: string[] }) =>
    codes.length ? (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {codes.map((c) => (
          <span key={c} className="inline-flex items-center gap-1">
            <SectorDot color={color(c)} />
            {departmentName(c)}
          </span>
        ))}
      </span>
    ) : (
      <span className="text-muted">—</span>
    );

  if (s.kpis.onsite + s.kpis.phone === 0) {
    return (
      <>
        <PageHeader title="Statistiques" subtitle="Votre secteur tel que l'agenda le raconte." />
        <EmptyState icon={<BarChart3 className="size-10" />} title="Pas encore de visites" action={<LinkButton href="/imports">Importer l&apos;agenda Outlook</LinkButton>}>
          Importez le fichier clients puis l&apos;agenda Outlook : Léa reconstitue les secteurs de chaque jour, les nuits d&apos;hôtel et les rendez-vous téléphoniques.
        </EmptyState>
      </>
    );
  }

  const k = s.kpis;
  return (
    <>
      <PageHeader
        title="Statistiques"
        subtitle={`Votre secteur tel que l'agenda le raconte · 12 derniers mois (du ${formatDayShort(s.period.from)} au ${formatDayShort(s.period.to)})`}
      />

      {k.phonePending ? (
        <Notice tone="warning" className="mb-4" title={`${k.phonePending} rendez-vous téléphonique(s) à valider`}>
          Ils sont déjà comptés comme téléphoniques ci-dessous.{" "}
          <Link href="/telephone" className="font-semibold underline">
            Les valider →
          </Link>
        </Notice>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Visites sur place" value={nf(k.onsite)} hint={`${k.fieldDays} journées terrain`} />
        <Stat label="Rendez-vous par téléphone" value={nf(k.phone)} hint={`${pct(k.phone / Math.max(1, k.onsite + k.phone))} des rendez-vous`} />
        <Stat label="Nuits d'hôtel" value={nf(k.nights)} hint={`${k.teleworkDays} jour(s) de télétravail`} />
        <Stat label="Km estimés" value={nf(k.km)} hint={k.kmPerDay ? `≈ ${nf(k.kmPerDay)} km par journée` : "domicile non renseigné"} />
        <Stat label="Heures de route (estim.)" value={nf(k.driveHours)} hint="vol d'oiseau × coef. de détour" />
        <Stat label="Clientes vues" value={`${k.clientsSeen}/${k.clients}`} hint={`${k.upcoming} rendez-vous à venir`} />
      </div>

      <div className="space-y-6">
        {/* Semaine réelle */}
        <Card>
          <CardHeader
            title="Votre vraie semaine"
            description={`Secteur principal de chaque journée terrain, comparé à la semaine type${s.templateName ? ` « ${s.templateName} »` : ""}.`}
          />
          <CardBody className="space-y-4">
            <StackedBars
              ariaLabel="Secteur principal des journées, par jour de la semaine"
              legend={[...new Set(s.weekdays.flatMap((w) => w.sectors.map((x) => x.code)))].map((code) => ({ key: code, label: departmentName(code), color: color(code) }))}
              rows={s.weekdays.map((w) => ({
                key: String(w.weekday),
                label: WEEKDAY_LABELS[w.weekday]!,
                total: w.days,
                segments: w.sectors.map((x) => ({ key: x.code, label: departmentName(x.code), value: x.days, color: color(x.code) })),
              }))}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Jour</th>
                    <th className="py-2 pr-3 font-medium">Semaine type</th>
                    <th className="py-2 pr-3 font-medium">Conforme</th>
                    <th className="py-2 pr-3 font-medium">2 secteurs</th>
                    <th className="py-2 pr-3 font-medium">Visites / jour</th>
                    <th className="py-2 pr-3 font-medium">Tél. / jour</th>
                    <th className="py-2 pr-3 font-medium">Nuits</th>
                    <th className="py-2 pr-3 font-medium">Km / jour</th>
                    <th className="py-2 pr-3 font-medium">Horaires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {s.weekdays.map((w) => (
                    <tr key={w.weekday}>
                      <td className="py-2 pr-3 font-semibold">{WEEKDAY_LABELS[w.weekday]}</td>
                      <td className="py-2 pr-3">
                        <Sectors codes={w.template} />
                      </td>
                      <td className="py-2 pr-3">
                        {w.templateMatch === null ? "—" : <Badge tone={w.templateMatch >= 0.7 ? "success" : w.templateMatch >= 0.45 ? "warning" : "danger"}>{pct(w.templateMatch)}</Badge>}
                      </td>
                      <td className="py-2 pr-3">{pct(w.twoSectors)}</td>
                      <td className="py-2 pr-3">{nf(w.onsitePerDay, 1)}</td>
                      <td className="py-2 pr-3">{nf(w.phonePerDay, 1)}</td>
                      <td className="py-2 pr-3">{w.nights}</td>
                      <td className="py-2 pr-3">{nf(w.kmPerDay)}</td>
                      <td className="py-2 pr-3">{w.start !== null && w.end !== null ? `${formatHHmm(Math.round(w.start))}–${formatHHmm(Math.round(w.end))}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              « Conforme » : part des journées où l&apos;un des secteurs travaillés est celui de la semaine type. Une journée compte 2 secteurs quand le principal
              représente moins de 75 % des visites sur place.
            </p>
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-2">
          <Card>
            <CardHeader title="Visites sur place par mois" description="Survolez une colonne : rendez-vous téléphoniques, nuits et kilomètres du mois." />
            <CardBody>
              <ColumnChart
                ariaLabel="Visites sur place par mois"
                labelAll={false}
                data={s.months.map((m) => ({
                  key: m.month,
                  label: MONTHS[Number(m.month.slice(5)) - 1]!,
                  value: m.onsite,
                  tooltip: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)} · ${m.phone} tél. · ${m.nights} nuit(s) · ${nf(m.km)} km`,
                }))}
              />
              <TableView
                caption="Activité par mois"
                headers={["Mois", "Sur place", "Téléphone", "Journées", "Nuits", "Km estimés"]}
                rows={s.months.map((m) => [`${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`, m.onsite, m.phone, m.days, m.nights, nf(m.km)])}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Nuits d'hôtel" icon={<BedDouble className="size-6 text-muted" />} description="Lues dans les réservations de l'agenda (jour d'arrivée → jour de départ)." />
            <CardBody className="space-y-4">
              <ColumnChart
                ariaLabel="Nuits d'hôtel par soir de la semaine"
                height={110}
                color="var(--accent)"
                data={s.hotels.byWeekday.filter((w) => w.weekday <= 5 || w.nights > 0).map((w) => ({ key: String(w.weekday), label: `${WEEKDAY_SHORT[w.weekday]} soir`, value: w.nights }))}
              />
              <p className="text-sm">
                {s.hotels.weeks.two} semaine(s) à 2 nuits, {s.hotels.weeks.one} à 1 nuit, {s.hotels.weeks.more} à 3 nuits ou plus.
                {s.hotels.savedKmPerNight !== null ? (
                  <>
                    {" "}
                    Une nuit sur place évite en moyenne <strong>{nf(s.hotels.savedKmPerNight)} km</strong> et{" "}
                    <strong>{nf((s.hotels.savedMinutesPerNight ?? 0) / 60, 1)} h</strong> de route par rapport à un retour au domicile.
                  </>
                ) : null}
                {s.hotels.sameSectorShare !== null ? ` L'hôtel est dans le secteur du lendemain ${pct(s.hotels.sameSectorShare)} du temps.` : null}
              </p>
              <ul className="divide-y divide-border text-sm">
                {s.hotels.top.map((h) => (
                  <li key={`${h.hotel}|${h.city}`} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">
                      {h.hotel}
                      {h.city ? <span className="text-muted"> · {h.city}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums">{h.nights} nuit(s)</span>
                  </li>
                ))}
              </ul>
              {s.hotels.dayTrips.length ? (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    {s.hotels.dayTrips.length} journée(s) lointaine(s) faite(s) en aller-retour depuis le domicile
                  </summary>
                  <ul className="mt-2 space-y-1 text-muted">
                    {s.hotels.dayTrips.map((d) => (
                      <li key={d.day}>
                        {formatDayShort(d.day)} · {sectorLabel(d.sectors)} · jusqu&apos;à {nf(d.farthestKm)} km du domicile · {nf(d.km)} km dans la journée
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-2">
          <Card>
            <CardHeader title="Couverture des clientes" description="Visites sur place sur 12 mois, comparées à la fréquence cible de chaque catégorie." />
            <CardBody className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Catégorie</th>
                    <th className="py-2 pr-3 font-medium">Clientes</th>
                    <th className="py-2 pr-3 font-medium">Vues</th>
                    <th className="py-2 pr-3 font-medium">Visites / cliente</th>
                    <th className="py-2 pr-3 font-medium">Objectif atteint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {s.coverage.map((c) => (
                    <tr key={c.category}>
                      <td className="py-2 pr-3">
                        <CategoryBadge category={c.category} />
                      </td>
                      <td className="py-2 pr-3">{c.clients}</td>
                      <td className="py-2 pr-3">{c.seen}</td>
                      <td className="py-2 pr-3">
                        {nf(c.onsitePerClient, 1)} <span className="text-xs text-muted">/ {c.target}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {c.reached}/{c.clients}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="mt-4 w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Département</th>
                    <th className="py-2 pr-3 font-medium">Clientes</th>
                    <th className="py-2 pr-3 font-medium">Vues</th>
                    <th className="py-2 pr-3 font-medium">Visites sur place</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {s.byDepartment.map((d) => (
                    <tr key={d.code}>
                      <td className="py-2 pr-3">
                        <Sectors codes={d.code === "?" ? [] : [d.code]} />
                      </td>
                      <td className="py-2 pr-3">{d.clients}</td>
                      <td className="py-2 pr-3">{d.seen}</td>
                      <td className="py-2 pr-3">{d.onsiteVisits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Pas vues sur place depuis 6 mois" description={`${s.notSeen.length} cliente(s), les catégories A et B en premier.`} />
            <CardBody>
              <ul className="max-h-96 divide-y divide-border overflow-auto text-sm">
                {s.notSeen.slice(0, 60).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <CategoryBadge category={c.category} />
                      <Link href={`/pharmacies/${c.id}`} className="truncate hover:underline">
                        {c.name}
                      </Link>
                      <span className="truncate text-xs text-muted">{c.city}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{c.lastOnsite ? formatDayShort(c.lastOnsite) : "jamais"}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        {/* Dernier mois */}
        <Card>
          <CardHeader title="Le dernier mois, jour par jour" description="Secteurs travaillés d'après l'agenda, nuits d'hôtel et kilomètres estimés (départ de l'hôtel de la veille le cas échéant)." />
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Jour</th>
                  <th className="py-2 pr-3 font-medium">Secteur(s)</th>
                  <th className="py-2 pr-3 font-medium">Semaine type</th>
                  <th className="py-2 pr-3 font-medium">Sur place</th>
                  <th className="py-2 pr-3 font-medium">Tél.</th>
                  <th className="py-2 pr-3 font-medium">Départ</th>
                  <th className="py-2 pr-3 font-medium">Nuit</th>
                  <th className="py-2 pr-3 font-medium">Km</th>
                  <th className="py-2 pr-3 font-medium">Horaires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {s.lastMonth.map((d) => (
                  <tr key={d.day}>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap capitalize">{formatDayShort(d.day)}</td>
                    <td className="py-2 pr-3">{d.onsite ? <Sectors codes={d.sectors} /> : d.telework ? <Badge tone="info">Télétravail</Badge> : "—"}</td>
                    <td className="py-2 pr-3">
                      {d.matchesTemplate === null ? "—" : d.matchesTemplate ? <Badge tone="success">oui</Badge> : <Badge tone="warning">écart</Badge>}
                    </td>
                    <td className="py-2 pr-3">{d.onsite}</td>
                    <td className="py-2 pr-3">{d.phone || ""}</td>
                    <td className="py-2 pr-3">{d.startFrom}</td>
                    <td className="py-2 pr-3">{d.night ? `🏨 ${d.night.city ?? d.night.hotel}` : ""}</td>
                    <td className="py-2 pr-3">{nf(d.km)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{d.firstStart !== null && d.lastEnd !== null ? `${formatHHmm(d.firstStart)}–${formatHHmm(d.lastEnd)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        {/* 3 dernières semaines */}
        <section aria-labelledby="semaines">
          <h2 id="semaines" className="mb-3 text-lg font-semibold">
            Les 3 dernières semaines en détail
          </h2>
          <div className="grid grid-cols-1 gap-3 *:min-w-0 md:grid-cols-2 xl:grid-cols-3">
            {s.lastWeeks.map((d) => (
              <DayCard key={d.day} d={d} tz={user.timezone} sectors={<Sectors codes={d.sectors} />} />
            ))}
          </div>
        </section>
        <p className="text-xs text-muted">
          Kilomètres et heures de route : estimation à vol d&apos;oiseau × coefficient de détour (réglable dans le profil), pas un calcul d&apos;itinéraire.
          Les tournées à venir utilisent, elles, le moteur d&apos;itinéraires routiers quand il répond.
        </p>
      </div>
    </>
  );
}

function DayCard({ d, tz, sectors }: { d: StatsDay; tz: string; sectors: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold capitalize">{formatDayShort(d.day)}</p>
            <div className="text-xs">{d.onsite ? sectors : d.telework ? "Télétravail" : "—"}</div>
          </div>
          <div className="text-right text-xs text-muted">
            {d.km !== null ? <p>{nf(d.km)} km estimés</p> : null}
            <p>départ : {d.startFrom}</p>
          </div>
        </div>
        <ul className="space-y-1 text-sm">
          {d.visits.map((v) => (
            <li key={v.id} className="flex items-baseline gap-2">
              <span className="w-11 shrink-0 text-xs text-muted tabular-nums">{formatTime(v.start, tz)}</span>
              <span className="min-w-0 flex-1">
                <Link href={`/pharmacies/${v.pharmacyId}`} className={`hover:underline ${v.mode === "phone" ? "text-muted" : ""}`}>
                  {v.pharmacyName}
                </Link>
                <span className="text-xs text-muted"> · {v.city}</span>
                {v.mode === "phone" ? (
                  <span className="block text-xs text-warning" title={v.reason ?? undefined}>
                    <Phone className="inline size-3" aria-hidden /> Téléphone{v.pendingReview ? " (à valider)" : ""}
                    {v.reason ? ` — ${v.reason}` : ""}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {d.night ? (
          <p className="rounded-xl bg-accent-soft px-2.5 py-1.5 text-xs">
            🏨 Nuit : {d.night.hotel}
            {d.night.city ? ` (${d.night.city})` : ""}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

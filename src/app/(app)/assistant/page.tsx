import { BedDouble, CalendarCheck2, Lightbulb, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Buddy } from "@/components/buddy";
import { Badge, CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { EmptyState, Notice } from "@/components/ui/notice";
import { PageHeader, Stat } from "@/components/ui/page-header";
import { FEEDBACK_REASON_LABELS } from "@/domain/assistant/learning";
import { weekOf, type PlannedDay } from "@/domain/assistant/planner";
import { departmentName } from "@/domain/departments";
import { formatDayLong, formatDayShort, formatHHmm, WEEKDAY_LABELS } from "@/domain/time";
import { acceptDayAction, feedbackAction, resetLearningAction } from "@/server/actions/assistant";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { territoryLookup } from "@/server/repositories/territories";
import { getAssistantPlan } from "@/server/services/assistant";

export const metadata: Metadata = { title: "Assistant de planification" };

const TONE = { danger: "danger", warning: "warning", info: "info", success: "success" } as const;

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const months = sp.mois === "1" ? 1 : sp.mois === "3" ? 3 : 2;
  const a = await getAssistantPlan(db, user, months);
  const territories = await territoryLookup(db, user.id);
  const color = (code: string | null | undefined) => (code ? (territories.get(code)?.color ?? "#9b9188") : "#9b9188");

  if (a.clientsCount === 0) {
    return (
      <>
        <PageHeader title="Assistant" />
        <EmptyState icon={<Sparkles className="size-10" />} title="Il me faut vos pharmacies" action={<LinkButton href="/pharmacies/import">Importer mes pharmacies</LinkButton>}>
          Importez le fichier clients puis l&apos;agenda Outlook : j&apos;apprendrai vos habitudes pour vous proposer vos prochaines semaines.
        </EmptyState>
      </>
    );
  }

  const days = a.plan.days;
  const proposals = days.reduce((n, d) => n + d.proposals.length, 0);
  const nights = days.filter((d) => d.hotel && !d.hotel.booked).length;
  const km = days.reduce((n, d) => n + (d.kmEstimate ?? 0), 0);
  const weeks = new Map<string, PlannedDay[]>();
  for (const d of days) weeks.set(weekOf(d.day), [...(weeks.get(weekOf(d.day)) ?? []), d]);
  const h = a.habits;

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Votre planning des prochaines semaines, construit à partir de vos habitudes d'agenda et de vos réponses à mes propositions."
        actions={
          <div className="flex gap-1 rounded-full border border-border bg-surface p-1 shadow-card">
            {[1, 2, 3].map((m) => (
              <Link
                key={m}
                href={`/assistant?mois=${m}`}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${months === m ? "bg-ink text-ink-fg" : "text-muted hover:text-text"}`}
              >
                {m} mois
              </Link>
            ))}
          </div>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Buddy mood="joy" shape="flower" color="yellow" size={72} className="shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-xl font-extrabold">
              {proposals ? `J'ai préparé ${proposals} visites sur ${days.filter((d) => d.proposals.length).length} journées.` : "Votre planning est déjà bien rempli."}
            </p>
            <p className="mt-1 text-sm text-muted">
              J&apos;ai analysé {h.daysAnalysed} journées de terrain des 12 derniers mois
              {a.learning.accepted + a.learning.rejected ? ` et ${a.learning.accepted + a.learning.rejected} réponse(s) de votre part` : ""}. Acceptez une journée pour
              l&apos;ajouter au planning (statut « proposé », à confirmer avec les pharmacies) ou dites-moi ce qui ne va pas : j&apos;apprends de vos choix.
            </p>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visites proposées" value={proposals} hint={`sur ${months} mois`} />
        <Stat label="Journées déjà pleines" value={days.filter((d) => d.status === "full").length} hint={`${days.filter((d) => d.status === "blocked").length} jour(s) sans terrain`} />
        <Stat label="Nuits d'hôtel conseillées" value={nights} />
        <Stat label="Km estimés sur la période" value={a.hasHome ? Math.round(km).toLocaleString("fr-FR") : "—"} hint={a.hasHome ? "vol d'oiseau × coef." : "domicile non renseigné"} />
      </div>

      {a.pendingPhone ? (
        <Notice tone="warning" className="mb-4">
          {a.pendingPhone} rendez-vous téléphonique(s) restent à valider : tant qu&apos;ils ne le sont pas, je les compte comme téléphoniques.{" "}
          <Link href="/telephone" className="font-semibold underline">
            Les valider
          </Link>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 *:min-w-0 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Lightbulb className="size-5" aria-hidden /> Mes recommandations
          </h2>
          {a.plan.recommendations.length === 0 ? <p className="text-sm text-muted">Rien de particulier à signaler.</p> : null}
          {a.plan.recommendations.map((r) => (
            <Notice key={r.id} tone={TONE[r.tone]} title={r.title}>
              <p>{r.detail}</p>
              {r.items?.length ? (
                <ul className="mt-2 space-y-0.5 text-sm">
                  {r.items.map((it) => (
                    <li key={it.label}>
                      {it.href ? (
                        <Link href={it.href} className="underline">
                          {it.label}
                        </Link>
                      ) : (
                        it.label
                      )}
                      {it.hint ? <span className="opacity-70"> · {it.hint}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          ))}
        </div>

        <Card>
          <CardHeader title="Ce que j'ai appris" icon={<Sparkles className="size-6 text-muted" />} />
          <CardBody className="space-y-3 text-sm">
            <ul className="space-y-1.5">
              {[1, 2, 3, 4, 5].map((wd) => {
                const top = Object.entries(h.sectorShare[wd] ?? {})
                  .sort((x, y) => y[1] - x[1])
                  .slice(0, 2)
                  .filter(([, s]) => s >= 0.15);
                return (
                  <li key={wd} className="flex flex-wrap items-center gap-x-2">
                    <span className="w-20 font-semibold">{WEEKDAY_LABELS[wd]}</span>
                    {top.map(([code, s]) => (
                      <span key={code} className="inline-flex items-center gap-1">
                        <SectorDot color={color(code)} /> {departmentName(code)} <span className="text-xs text-muted">{Math.round(s * 100)} %</span>
                      </span>
                    ))}
                    <span className="text-xs text-muted">
                      · {h.visitsPerDay[wd]} visites · {formatHHmm(h.startMinutes[wd]!)}–{formatHHmm(h.endMinutes[wd]!)}
                      {(h.hotelShare[wd] ?? 0) >= 0.2 ? " · souvent à l'hôtel le soir" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-muted">
              Visites de {h.visitMinutes} min · {h.fieldDaysPerWeek.toLocaleString("fr-FR")} jours de terrain par semaine en moyenne.
            </p>
            {Object.keys(h.hotels).length ? (
              <p className="text-muted">
                Hôtels habituels :{" "}
                {Object.entries(h.hotels)
                  .map(([dep, x]) => `${x.name} (${departmentName(dep)})`)
                  .join(", ")}
                .
              </p>
            ) : null}
            <div className="border-t border-border pt-3">
              <p className="font-semibold">Vos retours</p>
              <p className="text-muted">
                {a.learning.accepted} journée(s) acceptée(s), {a.learning.rejected} proposition(s) refusée(s).
              </p>
              {a.learning.insights.length ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {a.learning.insights.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Dites-moi quand une proposition ne vous convient pas : j&apos;ajuste les suivantes.</p>
              )}
              {a.learning.accepted + a.learning.rejected ? (
                <ActionForm action={resetLearningAction} className="mt-2">
                  <SubmitButton size="sm" variant="ghost" pendingLabel="…">
                    Oublier mes retours
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-lg font-semibold">
        <CalendarCheck2 className="size-5" aria-hidden /> Le plan, semaine par semaine
      </h2>
      <div className="space-y-6">
        {[...weeks.entries()].map(([monday, list]) => (
          <section key={monday} aria-label={`Semaine du ${formatDayShort(monday)}`}>
            <h3 className="mb-2 text-sm font-semibold text-muted">Semaine du {formatDayLong(monday)}</h3>
            <div className="grid grid-cols-1 gap-3 *:min-w-0 md:grid-cols-2 xl:grid-cols-3">
              {list.map((d) => (
                <DayCard key={d.day} d={d} color={color} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function DayCard({ d, color }: { d: PlannedDay; color: (code: string | null | undefined) => string }) {
  if (d.status === "blocked") {
    return (
      <Card className="opacity-70">
        <CardBody className="flex items-center justify-between gap-2 py-3">
          <span className="font-semibold capitalize">{formatDayShort(d.day)}</span>
          <Badge>{d.blockedReason}</Badge>
        </CardBody>
      </Card>
    );
  }
  const visits = d.existing.filter((x) => x.kind === "visit");
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold capitalize">{formatDayShort(d.day)}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-sm">
              {d.sectors.map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <SectorDot color={color(s)} /> {departmentName(s)}
                </span>
              ))}
              {d.startsFromHotel ? <span className="text-xs text-muted">· départ de l&apos;hôtel</span> : null}
            </p>
          </div>
          {d.status === "full" ? <Badge tone="success">Journée pleine</Badge> : d.kmEstimate !== null && d.proposals.length ? <span className="text-xs text-muted">≈ {Math.round(d.kmEstimate)} km</span> : null}
        </div>
        {d.why.length ? <p className="text-xs text-muted">{d.why.join(" ")}</p> : null}

        {visits.length ? (
          <ul className="space-y-1 text-sm">
            {visits.map((x) => (
              <li key={x.id} className="flex gap-2 text-muted">
                <span className="w-11 shrink-0 tabular-nums">{formatHHmm(x.start)}</span>
                <span className="truncate">
                  {x.mode === "phone" ? "📞 " : ""}
                  {x.title} <span className="text-xs">(déjà prévu)</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {d.proposals.length ? (
          <ul className="space-y-2">
            {d.proposals.map((p) => (
              <li key={p.pharmacyId} className="rounded-2xl bg-surface-2 p-2.5 text-sm">
                <div className="flex items-start gap-2">
                  <span className="w-11 shrink-0 font-semibold tabular-nums">{formatHHmm(p.start)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Link href={`/pharmacies/${p.pharmacyId}`} className="truncate font-medium hover:underline">
                        {p.name}
                      </Link>
                      <CategoryBadge category={p.category} />
                    </span>
                    <span className="block text-xs text-muted">
                      {p.city} · {p.why}
                    </span>
                  </span>
                </div>
                <details className="mt-1 pl-13">
                  <summary className="cursor-pointer text-xs text-muted hover:text-text">Retirer de cette journée</summary>
                  <ActionForm action={feedbackAction} className="mt-1.5 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="kind" value="client_day" />
                    <input type="hidden" name="day" value={d.day} />
                    <input type="hidden" name="pharmacyId" value={p.pharmacyId} />
                    <input type="hidden" name="departmentCode" value={p.departmentCode ?? ""} />
                    <Select name="reason" aria-label="Raison" className="h-8 text-xs">
                      {(["client_unavailable_weekday", "too_soon", "day_too_full", "other"] as const).map((r) => (
                        <option key={r} value={r}>
                          {FEEDBACK_REASON_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                      Retirer
                    </SubmitButton>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        ) : null}

        {d.hotel ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-accent-soft px-2.5 py-1.5 text-xs">
            <BedDouble className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>
                {d.hotel.booked ? "Nuit réservée" : "Nuit conseillée"} : {d.hotel.name}
              </strong>
              {d.hotel.city ? ` (${d.hotel.city})` : ""}. {d.hotel.why}
            </span>
          </p>
        ) : null}

        {d.proposals.length ? (
          <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
            <ActionForm action={acceptDayAction}>
              <input type="hidden" name="day" value={d.day} />
              <input type="hidden" name="departmentCode" value={d.sectors[0] ?? ""} />
              {d.proposals.map((p) => (
                <input key={p.pharmacyId} type="hidden" name="visit" value={`${p.pharmacyId}|${p.start}|${p.end}`} />
              ))}
              <SubmitButton size="sm" pendingLabel="Ajout…">
                Ajouter au planning
              </SubmitButton>
            </ActionForm>
            <details>
              <summary className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-text">Pas comme ça…</summary>
              <ActionForm action={feedbackAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="kind" value="day" />
                <input type="hidden" name="day" value={d.day} />
                <input type="hidden" name="departmentCode" value={d.sectors[0] ?? ""} />
                <Select name="reason" aria-label="Raison" className="h-8 text-xs">
                  {(["other_sector", "not_field_day", "day_too_full", "other"] as const).map((r) => (
                    <option key={r} value={r}>
                      {FEEDBACK_REASON_LABELS[r]}
                    </option>
                  ))}
                </Select>
                <SubmitButton size="sm" variant="secondary" pendingLabel="…">
                  Envoyer
                </SubmitButton>
              </ActionForm>
            </details>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

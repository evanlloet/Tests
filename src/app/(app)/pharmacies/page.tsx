import { CalendarClock, FileUp, Plus, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChannelBadge, RevenueTrend, TargetingChips } from "@/components/client-data";
import { CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Hearts, PharmacyAvatar, pharmacyMoodSentence } from "@/components/mood-ui";
import { DueBadge } from "@/components/visit-status";
import { DUE_STATE_LABELS, type DueState } from "@/domain/frequency";
import { formatDayShort } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { countPharmacies, pharmacyFacets } from "@/server/repositories/pharmacies";
import { listTerritories } from "@/server/repositories/territories";
import { todayFor } from "@/server/services/context";
import { getPharmacyOverview } from "@/server/services/pharmacy-overview";

export const metadata: Metadata = { title: "Pharmacies" };

const PAGE = 60;

export default async function PharmaciesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const total = await countPharmacies(db, user.id);
  const territories = await listTerritories(db, user.id);
  const category = ["A", "B", "C", "D", "none"].includes(sp.cat ?? "") ? (sp.cat as "A" | "B" | "C" | "D" | "none") : undefined;
  const due = (Object.keys(DUE_STATE_LABELS) as DueState[]).includes(sp.due as DueState) ? (sp.due as DueState) : undefined;
  const sort = sp.tri === "nom" ? "name" : "urgency";
  const facets = total ? await pharmacyFacets(db, user.id) : { channels: [], zones: [], tags: [] };
  const pick = (value: string | undefined, list: { value: string }[]) => (value && list.some((f) => f.value === value) ? value : undefined);
  const items = total
    ? await getPharmacyOverview(user, {
        q: sp.q,
        department: sp.dept || undefined,
        category,
        due,
        sort,
        channel: pick(sp.canal, facets.channels),
        zone: pick(sp.zone, facets.zones),
        tag: pick(sp.ciblage, facets.tags),
      })
    : [];
  const today = todayFor(user, new Date());
  const limit = Math.min(Number(sp.limite) || PAGE, 2000);

  return (
    <>
      <PageHeader
        title="Pharmacies"
        subtitle={total ? `${total.toLocaleString("fr-FR")} fiche(s) dans votre référentiel` : "Référentiel clients"}
        actions={
          <>
            <LinkButton href="/pharmacies/import" variant="secondary">
              <FileUp className="size-4" aria-hidden /> Importer un fichier
            </LinkButton>
            <LinkButton href="/pharmacies/nouvelle">
              <Plus className="size-4" aria-hidden /> Ajouter
            </LinkButton>
          </>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={<Store className="size-10" />}
          title="Aucune pharmacie pour l'instant"
          action={<LinkButton href="/pharmacies/import">Importer mon fichier de pharmacies</LinkButton>}
        >
          Importez votre fichier clients (Excel .xlsx ou CSV, export FINESS ou OpenStreetMap). Les colonnes sont reconnues automatiquement et un
          second import met à jour les fiches sans créer de doublons.
        </EmptyState>
      ) : (
        <>
          <form className="mb-4 space-y-2" role="search">
            <div className="flex gap-2">
              <Input name="q" defaultValue={sp.q} placeholder="Nom, commune, code client, groupement…" aria-label="Rechercher" className="min-w-0 flex-1" />
              <button type="submit" className="h-11 shrink-0 rounded-full bg-ink px-5 text-sm font-semibold text-ink-fg">
                Filtrer
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Select name="dept" defaultValue={sp.dept ?? ""} aria-label="Département">
                <option value="">Tous secteurs</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </Select>
              <Select name="cat" defaultValue={sp.cat ?? ""} aria-label="Catégorie">
                <option value="">Toutes catégories</option>
                {["A", "B", "C", "D"].map((c) => (
                  <option key={c} value={c}>
                    Catégorie {c}
                  </option>
                ))}
                <option value="none">Sans catégorie</option>
              </Select>
              <Select name="due" defaultValue={sp.due ?? ""} aria-label="Échéance">
                <option value="">Toutes échéances</option>
                {(Object.entries(DUE_STATE_LABELS) as [DueState, string][]).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Select name="tri" defaultValue={sp.tri ?? "urgence"} aria-label="Tri">
                <option value="urgence">Plus urgentes d'abord</option>
                <option value="nom">Ordre alphabétique</option>
              </Select>
              {facets.channels.length > 1 ? (
                <Select name="canal" defaultValue={sp.canal ?? ""} aria-label="Canal">
                  <option value="">Tous canaux</option>
                  {facets.channels.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} ({f.n})
                    </option>
                  ))}
                </Select>
              ) : null}
              {facets.zones.length ? (
                <Select name="zone" defaultValue={sp.zone ?? ""} aria-label="Zone commerciale">
                  <option value="">Toutes zones (UGA)</option>
                  {facets.zones.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} ({f.n})
                    </option>
                  ))}
                </Select>
              ) : null}
              {facets.tags.length ? (
                <Select name="ciblage" defaultValue={sp.ciblage ?? ""} aria-label="Ciblage">
                  <option value="">Tous ciblages</option>
                  {facets.tags.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} ({f.n})
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </form>

          <p className="mb-2 text-sm text-muted" aria-live="polite">
            {items.length.toLocaleString("fr-FR")} résultat(s)
          </p>

          {items.length === 0 ? (
            <EmptyState title="Aucune pharmacie ne correspond à ces filtres" />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.slice(0, limit).map(({ pharmacy: p, metrics, status, territory }) => {
                const filePlanned = !status.nextPlanned ? metrics?.plannedVisitOn : null;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/pharmacies/${p.id}`}
                      className="flex h-full gap-3 rounded-[24px] border border-border/70 bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      <PharmacyAvatar id={p.id} dueState={status.dueState} size={52} className="buddy-hover" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-display text-base leading-tight font-bold">{p.name}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            <ChannelBadge channel={p.channel} />
                            <CategoryBadge category={metrics?.category} />
                          </span>
                        </div>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                          <SectorDot color={territory?.color} className="size-2" />
                          {[p.postalCode, p.city].filter(Boolean).join(" ") || "Adresse inconnue"}
                          {p.salesZone ? ` · ${p.salesZone}` : ""}
                          {p.lat === null ? " · non géolocalisée" : ""}
                        </p>
                        <p className="mt-2 text-sm leading-snug">{pharmacyMoodSentence(status, formatDayShort)}</p>
                        {filePlanned ? (
                          <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${filePlanned < today ? "text-danger" : "text-primary"}`}>
                            <CalendarClock className="size-3.5" aria-hidden />
                            Visite prévue au fichier : {formatDayShort(filePlanned)}
                            {filePlanned < today ? " (dépassée)" : ""}
                          </p>
                        ) : null}
                        {p.targeting?.length || metrics?.revenuePreviousYear ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <TargetingChips tags={p.targeting} />
                            <RevenueTrend previous={metrics?.revenuePreviousYear} current={metrics?.revenueCurrentYear} />
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <Hearts value={status.year.done + status.year.identified} planned={status.year.planned} target={status.year.target} size={14} />
                          <DueBadge status={status} />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > limit ? (
            <div className="mt-4 text-center">
              <LinkButton
                variant="secondary"
                href={{ pathname: "/pharmacies", query: { ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), limite: String(limit + PAGE) } }}
              >
                Afficher plus ({items.length - limit} restantes)
              </LinkButton>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

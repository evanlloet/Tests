import { FileUp, Plus, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CategoryBadge, SectorDot } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { DueBadge, LastVisit, YearProgress } from "@/components/visit-status";
import { DUE_STATE_LABELS, type DueState } from "@/domain/frequency";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { countPharmacies } from "@/server/repositories/pharmacies";
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
  const items = total
    ? await getPharmacyOverview(user, { q: sp.q, department: sp.dept || undefined, category, due, sort })
    : [];
  const limit = Math.min(Number(sp.limite) || PAGE, 2000);
  const today = todayFor(user);

  return (
    <>
      <PageHeader
        title="Pharmacies"
        subtitle={total ? `${total.toLocaleString("fr-FR")} fiche(s) dans votre référentiel` : "Référentiel clients"}
        actions={
          <>
            <LinkButton href="/pharmacies/import" variant="secondary">
              <FileUp className="size-4" aria-hidden /> Importer un CSV
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
          Importez votre liste (CSV, export FINESS ou OpenStreetMap). Les colonnes sont reconnues automatiquement et un
          second import met à jour les fiches sans créer de doublons.
        </EmptyState>
      ) : (
        <>
          <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]" role="search">
            <Input name="q" defaultValue={sp.q} placeholder="Nom, commune, code postal, FINESS…" aria-label="Rechercher" className="col-span-2 sm:col-span-1" />
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
            <button type="submit" className="h-11 rounded-xl bg-text px-4 text-sm font-medium text-bg">
              Filtrer
            </button>
          </form>

          <p className="mb-2 text-sm text-muted" aria-live="polite">
            {items.length.toLocaleString("fr-FR")} résultat(s)
          </p>

          {items.length === 0 ? (
            <EmptyState title="Aucune pharmacie ne correspond à ces filtres" />
          ) : (
            <Card className="divide-y divide-border overflow-hidden">
              {items.slice(0, limit).map(({ pharmacy: p, metrics, status, territory }) => (
                <Link
                  key={p.id}
                  href={`/pharmacies/${p.id}`}
                  className="grid gap-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SectorDot color={territory?.color} />
                      <span className="truncate font-medium">{p.name}</span>
                      <CategoryBadge category={metrics?.category} />
                    </div>
                    <p className="mt-0.5 truncate pl-4.5 text-sm text-muted">
                      {[p.postalCode, p.city].filter(Boolean).join(" ") || "Adresse inconnue"}
                      {p.lat === null ? " · non géolocalisée" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-4.5 text-sm sm:pl-0">
                    <DueBadge status={status} />
                    <span className="text-muted">
                      Dernière : <LastVisit status={status} today={today} />
                    </span>
                  </div>
                  <div className="pl-4.5 sm:pl-0">
                    <YearProgress status={status} />
                  </div>
                </Link>
              ))}
            </Card>
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

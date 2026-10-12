import { GitCompareArrows } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { MatchList, type MatchCardData } from "@/components/match-card";
import { EmptyState } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/domain/time";
import { rematchAction, validateManyAction } from "@/server/actions/calendar";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listMatches, matchCounts, pharmaciesByIds, type MatchStatusFilter } from "@/server/repositories/matches";
import { pickerOptions } from "@/server/repositories/picker";

export const metadata: Metadata = { title: "Rapprochements" };

const TABS: { key: MatchStatusFilter; label: string }[] = [
  { key: "to_review", label: "À vérifier" },
  { key: "auto_validated", label: "Validés automatiquement" },
  { key: "validated", label: "Validés" },
  { key: "ignored", label: "Ignorés" },
  { key: "other", label: "Autres événements" },
];

const PAGE = 20;

export default async function MatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = (TABS.find((t) => t.key === sp.statut)?.key ?? "to_review") as MatchStatusFilter;
  const page = Math.max(1, Number(sp.page) || 1);
  const counts = await matchCounts(db, user.id);
  const { rows, total } = await listMatches(db, user.id, filter, { limit: PAGE, offset: (page - 1) * PAGE });
  const ids = [...new Set(rows.flatMap((r) => [...r.match.candidates.map((c) => c.pharmacyId), r.match.pharmacyId].filter(Boolean) as string[]))];
  const byId = await pharmaciesByIds(db, user.id, ids);
  const options = await pickerOptions(db, user.id);

  const cards: MatchCardData[] = rows.map(({ match: m, event: e }) => {
    const candidates = m.candidates
      .filter((c) => byId.has(c.pharmacyId))
      .map((c) => {
        const p = byId.get(c.pharmacyId)!;
        return { ...c, name: p.name, address: [p.addressLine, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Adresse inconnue" };
      });
    if (m.pharmacyId && !candidates.some((c) => c.pharmacyId === m.pharmacyId) && byId.has(m.pharmacyId)) {
      const p = byId.get(m.pharmacyId)!;
      candidates.unshift({ pharmacyId: p.id, score: m.score, reasons: m.reasons, name: p.name, address: [p.postalCode, p.city].filter(Boolean).join(" ") });
    }
    return {
      id: m.id,
      status: m.status,
      score: m.score,
      currentPharmacyId: m.pharmacyId,
      event: {
        title: e.title,
        when: formatDateTime(e.startsAt, user.timezone),
        location: e.location,
        classificationReason: e.classificationReason,
        description: null,
      },
      candidates,
    };
  });
  const bulkIds = filter === "to_review" ? rows.filter((r) => r.match.status === "pending" && r.match.pharmacyId).map((r) => r.match.id) : [];

  return (
    <>
      <PageHeader
        title="Rapprochements"
        subtitle="Vérifiez les correspondances entre vos rendez-vous Outlook et les pharmacies. Rien n'est ajouté à l'historique sans validation, sauf les correspondances très sûres."
        actions={
          <ActionForm action={rematchAction}>
            <SubmitButton variant="secondary" pendingLabel="Analyse…">
              Relancer le rapprochement
            </SubmitButton>
          </ActionForm>
        }
      />
      <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1" aria-label="Filtres">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/rapprochements?statut=${t.key}`}
            aria-current={filter === t.key ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${filter === t.key ? "bg-primary text-primary-fg" : "text-muted hover:text-text"}`}
          >
            {t.label} <span className="tabular-nums opacity-80">({counts[t.key]})</span>
          </Link>
        ))}
      </nav>

      {bulkIds.length > 1 ? (
        <ActionForm action={validateManyAction} className="mb-4">
          {bulkIds.map((id) => (
            <input key={id} type="hidden" name="matchIds" value={id} />
          ))}
          <SubmitButton variant="accent" pendingLabel="Validation…">
            Valider les {bulkIds.length} propositions de cette page
          </SubmitButton>
          <p className="mt-1 text-xs text-muted">Valide la pharmacie proposée pour chaque carte affichée ci-dessous. Vérifiez-les avant.</p>
        </ActionForm>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState icon={<GitCompareArrows className="size-10" />} title={filter === "to_review" ? "Rien à vérifier" : "Aucun élément"}>
          {filter === "to_review" ? "Toutes les correspondances ont été traitées." : null}
        </EmptyState>
      ) : (
        <MatchList key={`${filter}-${page}`} cards={cards} options={options} />
      )}

      {total > PAGE ? (
        <nav className="mt-6 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={`/rapprochements?statut=${filter}&page=${page - 1}`} className="text-primary underline">
              ← Précédents
            </Link>
          ) : null}
          <span className="text-muted">
            Page {page} / {Math.ceil(total / PAGE)}
          </span>
          {page * PAGE < total ? (
            <Link href={`/rapprochements?statut=${filter}&page=${page + 1}`} className="text-primary underline">
              Suivants →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

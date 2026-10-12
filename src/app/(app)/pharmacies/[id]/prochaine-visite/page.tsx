import { CalendarPlus, Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProposeSlotButton } from "@/components/propose-slot";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { DueBadge } from "@/components/visit-status";
import { formatDayLong, formatHHmm } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { getPharmacy } from "@/server/repositories/pharmacies";
import { suggestNextVisit } from "@/server/services/suggestions";

export const metadata: Metadata = { title: "Prochaine visite" };

export default async function NextVisitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const row = await getPharmacy(db, user.id, id);
  if (!row) notFound();
  const result = await suggestNextVisit(db, user, id);
  if (!result) notFound();
  const p = row.pharmacy;

  return (
    <>
      {sp.terminee ? (
        <Notice tone="success" title="Visite enregistrée comme réalisée" className="mb-4">
          Voici les meilleurs créneaux pour la prochaine visite, calculés à partir de votre planning complet.
        </Notice>
      ) : null}
      <PageHeader
        title={`Prochaine visite : ${p.name}`}
        subtitle={
          result.targetDay
            ? `Échéance cible : ${formatDayLong(result.targetDay)}${result.status.perYear ? ` (${result.status.perYear} visites par an)` : ""}`
            : "Échéance non calculable"
        }
        actions={<DueBadge status={result.status} />}
      />
      {result.status.nextPlanned ? (
        <Notice tone="info" className="mb-4">
          Un rendez-vous est déjà prévu le {formatDayLong(result.status.nextPlanned)}. Les propositions ci-dessous restent indicatives.
        </Notice>
      ) : null}
      {result.blocker ? (
        <EmptyState title="Pas de proposition" action={<LinkButton href={`/pharmacies/${p.id}`}>Compléter la fiche</LinkButton>}>
          {result.blocker}
        </EmptyState>
      ) : (
        <ol className="space-y-3">
          {result.suggestions.map((s, i) => (
            <li key={`${s.day}-${s.start}`}>
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-primary">{i === 0 ? "Meilleure option" : `Option ${i + 1}`}</p>
                      <p className="text-lg font-semibold capitalize">{formatDayLong(s.day)}</p>
                      <p className="text-sm text-muted">
                        {formatHHmm(s.start)}–{formatHHmm(s.end)}
                        {s.detourKm !== null ? ` · détour estimé ${Math.round(s.detourKm)} km` : ""}
                        {s.offsetFromTarget !== 0 ? ` · ${s.offsetFromTarget > 0 ? "+" : ""}${s.offsetFromTarget} j / échéance` : " · le jour de l'échéance"}
                      </p>
                    </div>
                    <Badge tone="neutral" title="Score de pertinence (plus haut = mieux)">
                      Score {Math.round(s.score)}
                    </Badge>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <ul className="space-y-1">
                      {s.pros.map((x) => (
                        <li key={x} className="flex gap-1.5">
                          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {x}
                        </li>
                      ))}
                    </ul>
                    <ul className="space-y-1">
                      {s.cons.map((x) => (
                        <li key={x} className="flex gap-1.5 text-muted">
                          <Minus className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ProposeSlotButton pharmacyId={p.id} title={p.name} day={s.day} start={formatHHmm(s.start)} end={formatHHmm(s.end)} />
                    <Link href={`/planning?vue=jour&date=${s.day}`} className="text-sm text-primary underline">
                      Voir la journée
                    </Link>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <LinkButton href={`/planning/nouveau?pharmacie=${p.id}`} variant="secondary">
          <CalendarPlus className="size-4" aria-hidden /> Choisir un autre créneau
        </LinkButton>
        <LinkButton href={`/pharmacies/${p.id}`} variant="ghost">
          Retour à la fiche
        </LinkButton>
      </div>
      {result.disclaimer ? <p className="mt-4 text-xs text-muted">{result.disclaimer}</p> : null}
      <p className="mt-1 text-xs text-muted">Un créneau ajouté est « proposé » : il reste à confirmer avec le pharmacien.</p>
    </>
  );
}

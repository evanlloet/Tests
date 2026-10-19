import { Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { departmentName } from "@/domain/departments";
import { formatDayLong, formatTime } from "@/domain/time";
import { setPhoneModeAction } from "@/server/actions/phone";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listPhoneReview } from "@/server/services/phone-review";

export const metadata: Metadata = { title: "Rendez-vous téléphoniques" };

export default async function PhoneReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const which = sp.vue === "valides" ? "validated" : "pending";
  const days = await listPhoneReview(db, user, which);
  const pendingIds = days.flatMap((d) => d.visits.filter((v) => v.modeReview === "pending").map((v) => v.id));

  return (
    <>
      <PageHeader
        title="Rendez-vous téléphoniques"
        subtitle="L'agenda ne dit pas si un rendez-vous se fait sur place ou par téléphone : Léa le déduit de la journée, vous confirmez."
      />
      <div className="mb-4 flex flex-wrap gap-1 rounded-full border border-border bg-surface p-1 shadow-card">
        {[
          { v: null, label: "À valider" },
          { v: "valides", label: "Confirmés par téléphone" },
        ].map((t) => (
          <Link
            key={t.label}
            href={t.v ? `/telephone?vue=${t.v}` : "/telephone"}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${(sp.vue ?? null) === t.v ? "bg-ink text-ink-fg" : "text-muted hover:text-text"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {days.length === 0 ? (
        <EmptyState
          icon={<Phone className="size-10" />}
          title={which === "pending" ? "Aucun rendez-vous à valider" : "Aucun rendez-vous confirmé par téléphone"}
          action={<LinkButton href="/imports">Importer l&apos;agenda Outlook</LinkButton>}
        >
          Après chaque import, les rendez-vous impossibles à faire sur place (trajet trop long, rendez-vous isolé, pris pendant le télétravail) apparaissent ici.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {which === "pending" ? (
            <Card>
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">
                  <strong className="tabular-nums">{pendingIds.length}</strong> rendez-vous à valider sur {days.length} journée(s). Un rendez-vous confirmé par
                  téléphone sort des trajets, des kilomètres et des tournées, mais compte toujours comme un contact.
                </p>
                <ActionForm action={setPhoneModeAction} className="shrink-0">
                  {pendingIds.map((id) => (
                    <input key={id} type="hidden" name="id" value={id} />
                  ))}
                  <input type="hidden" name="mode" value="phone" />
                  <SubmitButton pendingLabel="Validation…">Tout confirmer par téléphone</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : (
            <Notice tone="info">Un rendez-vous confirmé par erreur peut être repassé « sur place » ici.</Notice>
          )}

          {days.map((d) => (
            <Card key={d.day}>
              <CardHeader title={<span className="capitalize">{formatDayLong(d.day)}</span>} description={d.night ? `Nuit d'hôtel : ${d.night}` : undefined} />
              <CardBody className="divide-y divide-border p-0">
                {d.visits.map((v) => {
                  const phone = v.mode === "phone";
                  return (
                    <div key={v.id} className={`grid gap-2 px-4 py-3 text-sm sm:grid-cols-[110px_1fr_auto] sm:items-center ${phone ? "bg-warning-soft/40" : ""}`}>
                      <span className="text-muted tabular-nums">
                        {formatTime(v.start, user.timezone)}–{formatTime(v.end, user.timezone)}
                      </span>
                      <span className="min-w-0">
                        <Link href={`/pharmacies/${v.pharmacyId}`} className="block truncate font-medium hover:underline">
                          {v.pharmacyName}
                        </Link>
                        <span className="block truncate text-xs text-muted">
                          {[v.city, v.departmentCode ? departmentName(v.departmentCode) : null].filter(Boolean).join(" · ")}
                          {phone && v.modeReason ? ` — ${v.modeReason}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {v.modeReview === "pending" ? (
                          <ActionForm action={setPhoneModeAction} className="flex flex-wrap gap-2" feedback={false}>
                            <input type="hidden" name="id" value={v.id} />
                            <SubmitButton name="mode" value="phone" size="sm" pendingLabel="…">
                              <Phone className="size-4" aria-hidden /> Téléphone
                            </SubmitButton>
                            <SubmitButton name="mode" value="onsite" size="sm" variant="secondary" pendingLabel="…">
                              Sur place
                            </SubmitButton>
                          </ActionForm>
                        ) : phone ? (
                          <>
                            <Badge tone="warning">
                              <Phone className="size-3" aria-hidden /> Téléphone
                            </Badge>
                            <ActionForm action={setPhoneModeAction} feedback={false}>
                              <input type="hidden" name="id" value={v.id} />
                              <SubmitButton name="mode" value="onsite" size="sm" variant="ghost" pendingLabel="…">
                                Repasser sur place
                              </SubmitButton>
                            </ActionForm>
                          </>
                        ) : (
                          <Badge>Sur place</Badge>
                        )}
                      </span>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

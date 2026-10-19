"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import { formatDayShort } from "@/domain/time";
import { importCalendarAction, previewCalendarAction } from "@/server/actions/calendar";
import type { ActionResult } from "@/server/actions/result";
import type { CalendarImportSummary, CalendarPreview } from "@/server/services/calendar-import";
import { Badge } from "./ui/badge";
import { submitWithoutReset } from "./action-form";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Checkbox, Field, Input } from "./ui/form";
import { Notice } from "./ui/notice";
import { Stat } from "./ui/page-header";

export function CalendarImportForm() {
  const [state, action, pending] = useActionState<ActionResult<CalendarImportSummary> | null, FormData>(importCalendarAction, null);
  const [previewState, preview, previewing] = useActionState<ActionResult<CalendarPreview> | null, FormData>(previewCalendarAction, null);
  const [stale, setStale] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  // Prévisualisation hors « action » de formulaire : React réinitialiserait le formulaire (et le fichier choisi)
  const runPreview = () => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setStale(false);
    const fd = new FormData(form);
    startTransition(() => preview(fd));
  };
  const r = state?.ok ? state.data : undefined;
  const p = !stale && previewState?.ok ? previewState.data : undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <form ref={formRef} action={action} onSubmit={submitWithoutReset(action)} className="space-y-4">
            <Field label="Fichier du calendrier" htmlFor="file" hint="Format .ics (recommandé : conserve les fuseaux et les récurrences) ou .csv exporté depuis Outlook.">
              <Input
                id="file"
                name="file"
                type="file"
                accept=".ics,.csv,.txt,text/calendar,text/csv"
                required
                className="h-auto py-2"
                onChange={() => setStale(true)}
              />
            </Field>
            <Checkbox
              name="useDescription"
              label="Utiliser aussi la description des rendez-vous pour reconnaître les pharmacies (à cocher seulement si les descriptions ne contiennent pas d'informations personnelles)."
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="lg" variant={p ? "secondary" : "primary"} disabled={previewing || pending} onClick={runPreview}>
                {previewing ? "Lecture…" : "1. Prévisualiser"}
              </Button>
              <Button type="submit" size="lg" variant={p ? "primary" : "secondary"} disabled={pending || previewing || !p}>
                {pending ? "Import en cours…" : "2. Confirmer l'import"}
              </Button>
            </div>
            {!p ? <p className="text-xs text-muted">La prévisualisation lit le fichier sans rien enregistrer.</p> : null}
          </form>
        </CardBody>
      </Card>
      {previewState && !previewState.ok && !stale ? <Notice tone="danger">{previewState.error}</Notice> : null}
      {p && !r ? <PreviewCard p={p} /> : null}
      {state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      {r ? (
        <Card>
          <CardHeader
            title="Import terminé"
            description={`${r.format === "ics" ? "Fichier ICS" : "CSV Outlook"} · encodage ${r.encoding}${r.firstDay ? ` · du ${formatDayShort(r.firstDay)} au ${formatDayShort(r.lastDay!)}` : ""}`}
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Événements lus" value={r.totalEvents} hint={r.sourceEntries !== r.totalEvents ? `${r.sourceEntries} entrées (récurrences développées)` : undefined} />
              <Stat label="Nouveaux" value={r.newEvents} />
              <Stat label="Mis à jour" value={r.updatedEvents} />
              <Stat label="Déjà connus" value={r.unchangedEvents} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-surface-2 p-3 text-sm">
                <p className="font-medium">Classement des nouveaux événements</p>
                <ul className="mt-1 text-muted">
                  <li>{r.classification.visit} visite(s) probable(s)</li>
                  <li>{r.classification.unknown} indéterminé(s)</li>
                  <li>{r.classification.not_visit} autre(s) (congés, réunions, annulés…)</li>
                  {r.probableDuplicates ? <li>{r.probableDuplicates} doublon(s) probable(s) d&apos;un événement déjà importé</li> : null}
                  {r.duplicatesInFile ? <li>{r.duplicatesInFile} doublon(s) dans le fichier</li> : null}
                </ul>
              </div>
              <div className="rounded-2xl bg-surface-2 p-3 text-sm">
                <p className="font-medium">Rapprochement avec les pharmacies</p>
                <ul className="mt-1 text-muted">
                  <li>{r.matches.auto_validated} validé(s) automatiquement (confiance élevée)</li>
                  <li>{r.matches.pending} à vérifier</li>
                  <li>{r.matches.no_candidate} sans pharmacie trouvée</li>
                  <li>{r.appointmentsCreated} visite(s) ajoutée(s) à l&apos;historique</li>
                  {r.appointmentsUpdated ? <li>{r.appointmentsUpdated} rendez-vous mis à jour (modifiés dans Outlook)</li> : null}
                </ul>
              </div>
            </div>
            {r.phoneToReview ? (
              <Notice tone="warning" title={`${r.phoneToReview} rendez-vous téléphonique(s) à valider`}>
                Ces rendez-vous ne peuvent pas être des visites sur place (trajet impossible, rendez-vous isolé, télétravail…). Confirmez-les pour
                qu&apos;ils sortent des trajets et des tournées.{" "}
                <Link href="/telephone" className="font-semibold underline">
                  Valider les rendez-vous téléphoniques →
                </Link>
              </Notice>
            ) : null}
            {r.warnings.length ? (
              <details className="rounded-2xl border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium">{r.warnings.length} remarque(s)</summary>
                <ul className="mt-2 max-h-60 space-y-1 overflow-auto text-muted">
                  {r.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="flex flex-wrap gap-3 text-sm font-medium">
              <Link href="/rapprochements" className="text-primary underline-offset-4 hover:underline">
                Vérifier les rapprochements →
              </Link>
              <Link href={`/imports/${r.importId}`} className="text-primary underline-offset-4 hover:underline">
                Détail des événements →
              </Link>
              <Link href="/statistiques" className="text-primary underline-offset-4 hover:underline">
                Statistiques du secteur →
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function PreviewCard({ p }: { p: CalendarPreview }) {
  return (
    <Card>
      <CardHeader
        title="Prévisualisation (rien n'est encore enregistré)"
        description={`${p.format === "ics" ? "Fichier ICS" : "CSV Outlook"} · encodage ${p.encoding}${p.firstDay ? ` · du ${formatDayShort(p.firstDay)} au ${formatDayShort(p.lastDay!)}` : ""}`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Événements" value={p.totalEvents} hint={p.sourceEntries !== p.totalEvents ? `${p.sourceEntries} entrées, récurrences développées` : undefined} />
          <Stat label="Nouveaux" value={p.totalEvents - p.alreadyImported - p.probableDuplicates} />
          <Stat label="Déjà importés" value={p.alreadyImported} />
          <Stat label="À venir" value={p.futureEvents} />
        </div>
        <ul className="text-sm text-muted">
          <li>
            Classement : {p.classification.visit} visite(s) probable(s), {p.classification.unknown} indéterminé(s), {p.classification.not_visit} autre(s)
          </li>
          <li>
            {p.cancelled} annulé(s) · {p.allDay} sur la journée entière · {p.probableDuplicates} doublon(s) probable(s) · {p.duplicatesInFile} doublon(s) dans le fichier
          </li>
        </ul>
        {p.sample.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="mb-2 text-left text-xs text-muted">Derniers nouveaux événements, horaires convertis en heure de Paris</caption>
              <tbody className="divide-y divide-border">
                {p.sample.map((s, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{s.when}</td>
                    <td className="py-1.5 pr-3">
                      {s.title}
                      {s.location ? <span className="text-muted"> · {s.location}</span> : null}
                    </td>
                    <td className="py-1.5" title={s.reason}>
                      <Badge tone={s.classification === "visit" ? "accent" : "neutral"}>
                        {s.classification === "visit" ? "Visite" : s.classification === "unknown" ? "Indéterminé" : "Autre"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {p.warnings.length ? (
          <details className="rounded-2xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{p.warnings.length} remarque(s)</summary>
            <ul className="mt-2 max-h-60 space-y-1 overflow-auto text-muted">
              {p.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

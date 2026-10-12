"use client";

import Link from "next/link";
import { useActionState } from "react";
import { formatDayShort } from "@/domain/time";
import { importCalendarAction } from "@/server/actions/calendar";
import type { ActionResult } from "@/server/actions/result";
import type { CalendarImportSummary } from "@/server/services/calendar-import";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Checkbox, Field, Input } from "./ui/form";
import { Notice } from "./ui/notice";
import { Stat } from "./ui/page-header";

export function CalendarImportForm() {
  const [state, action, pending] = useActionState<ActionResult<CalendarImportSummary> | null, FormData>(importCalendarAction, null);
  const r = state?.ok ? state.data : undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <form action={action} className="space-y-4">
            <Field label="Fichier du calendrier" htmlFor="file" hint="Format .ics (recommandé : conserve les fuseaux et les récurrences) ou .csv exporté depuis Outlook.">
              <Input id="file" name="file" type="file" accept=".ics,.csv,.txt,text/calendar,text/csv" required className="h-auto py-2" />
            </Field>
            <Checkbox
              name="useDescription"
              label="Utiliser aussi la description des rendez-vous pour reconnaître les pharmacies (à cocher seulement si les descriptions ne contiennent pas d'informations personnelles)."
            />
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Analyse en cours…" : "Importer et analyser"}
            </Button>
          </form>
        </CardBody>
      </Card>
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
              <div className="rounded-xl bg-surface-2 p-3 text-sm">
                <p className="font-medium">Classement des nouveaux événements</p>
                <ul className="mt-1 text-muted">
                  <li>{r.classification.visit} visite(s) probable(s)</li>
                  <li>{r.classification.unknown} indéterminé(s)</li>
                  <li>{r.classification.not_visit} autre(s) (congés, réunions, annulés…)</li>
                  {r.probableDuplicates ? <li>{r.probableDuplicates} doublon(s) probable(s) d&apos;un événement déjà importé</li> : null}
                  {r.duplicatesInFile ? <li>{r.duplicatesInFile} doublon(s) dans le fichier</li> : null}
                </ul>
              </div>
              <div className="rounded-xl bg-surface-2 p-3 text-sm">
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
            {r.warnings.length ? (
              <details className="rounded-xl border border-border p-3 text-sm">
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
              <Link href="/pilotage" className="text-primary underline-offset-4 hover:underline">
                Analyse de l&apos;historique →
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

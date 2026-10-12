"use client";

import Link from "next/link";
import { useActionState } from "react";
import { importPharmaciesAction } from "@/server/actions/pharmacies";
import type { ActionResult } from "@/server/actions/result";
import type { PharmacyImportResult } from "@/server/services/pharmacy-import";
import { submitWithoutReset } from "./action-form";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input } from "./ui/form";
import { Notice } from "./ui/notice";
import { Stat } from "./ui/page-header";

export function PharmacyImportForm() {
  const [state, action, pending] = useActionState<ActionResult<PharmacyImportResult> | null, FormData>(importPharmaciesAction, null);
  const result = state?.ok ? state.data : undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <form action={action} onSubmit={submitWithoutReset(action)} className="space-y-4">
            <Field
              label="Fichier Excel (.xlsx) ou CSV"
              htmlFor="file"
              hint="Excel : la première feuille remplie est lue. CSV : séparateur virgule, point-virgule ou tabulation, encodage UTF-8 ou Windows."
            >
              <Input
                id="file"
                name="file"
                type="file"
                accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
                className="h-auto py-2"
              />
            </Field>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Import en cours…" : "Importer"}
            </Button>
          </form>
        </CardBody>
      </Card>

      {state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}

      {result ? (
        <Card>
          <CardHeader title="Résultat de l'import" description={`${result.totalRows} ligne(s) lue(s) dans le fichier ${result.format === "xlsx" ? "Excel" : "CSV"}.`} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Créées" value={result.created} />
              <Stat label="Mises à jour" value={result.updated} />
              <Stat label="Inchangées" value={result.unchanged} />
              <Stat label="Ignorées" value={result.skipped} />
            </div>
            {result.locatedByCommune ? (
              <Notice tone="info">
                {result.locatedByCommune} fiche(s) sans adresse placée(s) au centre de leur commune : position approximative, suffisante pour
                estimer les trajets. Vous pouvez saisir l'adresse ou les coordonnées exactes sur chaque fiche.
              </Notice>
            ) : null}
            <details className="rounded-2xl border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Correspondance des {result.mapping.length} colonnes</summary>
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Colonne du fichier</th>
                    <th className="py-1 font-medium">Dans Léa</th>
                  </tr>
                </thead>
                <tbody>
                  {result.mapping.map((m) => (
                    <tr key={m.header} className="border-t border-border/60">
                      <td className="py-1 pr-2 font-medium">{m.header}</td>
                      <td className="py-1 text-muted">{m.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {result.issues.length ? (
              <details className="rounded-2xl border border-border p-3 text-sm" open={result.issues.length <= 10}>
                <summary className="cursor-pointer font-medium">{result.issues.length} remarque(s) sur le fichier</summary>
                <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-muted">
                  {result.issues.map((i, idx) => (
                    <li key={idx}>
                      Ligne {i.row} : {i.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <Notice tone="success">Aucune anomalie détectée dans le fichier.</Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href="/pharmacies" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Voir le référentiel →
              </Link>
              <Link href="/rapprochements" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Relancer les rapprochements en attente →
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

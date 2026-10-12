import type { Metadata } from "next";
import Link from "next/link";
import { CalendarImportForm } from "@/components/calendar-import-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listCalendarImports } from "@/server/repositories/matches";
import { countPharmacies } from "@/server/repositories/pharmacies";

export const metadata: Metadata = { title: "Imports Outlook" };

export default async function ImportsPage() {
  const user = await requireUser();
  const imports = await listCalendarImports(db, user.id);
  const pharmacyCount = await countPharmacies(db, user.id);
  return (
    <>
      <PageHeader title="Import du calendrier Outlook" subtitle="Reconstruisez l'historique des visites à partir de votre agenda. Les imports sont rejouables sans doublons." />
      {pharmacyCount === 0 ? (
        <Notice tone="warning" title="Importez d'abord vos pharmacies" className="mb-4">
          Le rapprochement des rendez-vous se fait avec votre référentiel. <Link href="/pharmacies/import" className="underline">Importer les pharmacies</Link>, puis
          revenez ici (vous pourrez aussi relancer le rapprochement plus tard).
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1fr_340px]">
        <CalendarImportForm />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Exporter depuis Outlook" />
            <CardBody className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Fichier ICS (recommandé)</p>
                <p className="text-muted">Outlook : Fichier › Enregistrer le calendrier › Plus d&apos;options › Plage de dates « Spécifier » (2 ans) › Détail « Détails complets ».</p>
              </div>
              <div>
                <p className="font-medium">Fichier CSV</p>
                <p className="text-muted">Fichier › Ouvrir et exporter › Importer/Exporter › Exporter dans un fichier › Valeurs séparées par une virgule › Calendrier.</p>
              </div>
              <p className="text-xs text-muted">
                Les événements sont conservés tels quels (données d&apos;origine et provenance). Un événement d&apos;agenda n&apos;est pas la preuve
                qu&apos;une visite a eu lieu : les visites importées sont « identifiées » jusqu&apos;à confirmation.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Synchronisation Microsoft Graph" />
            <CardBody className="text-sm text-muted">
              Non disponible dans cette version : la connexion directe à Outlook (Microsoft Graph) nécessite l&apos;enregistrement d&apos;une
              application Azure et un stockage chiffré des jetons. L&apos;architecture d&apos;import est prête à la recevoir.
            </CardBody>
          </Card>
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader title="Imports précédents" />
        <CardBody>
          {imports.length === 0 ? (
            <p className="text-sm text-muted">Aucun import pour l&apos;instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Fichier</th>
                    <th className="py-2 pr-3 font-medium">Événements</th>
                    <th className="py-2 pr-3 font-medium">Nouveaux</th>
                    <th className="py-2 pr-3 font-medium">Mis à jour</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {imports.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(i.createdAt, user.timezone)}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/imports/${i.id}`} className="text-primary underline-offset-4 hover:underline">
                          {i.filename}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{i.totalEvents}</td>
                      <td className="py-2 pr-3 tabular-nums">{i.newEvents}</td>
                      <td className="py-2 pr-3 tabular-nums">{i.updatedEvents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

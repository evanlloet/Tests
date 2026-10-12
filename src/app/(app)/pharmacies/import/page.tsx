import type { Metadata } from "next";
import { PharmacyImportForm } from "@/components/pharmacy-import-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PHARMACY_FIELDS, type PharmacyField } from "@/domain/pharmacy-import";

export const metadata: Metadata = { title: "Importer des pharmacies" };

export default function ImportPharmaciesPage() {
  return (
    <>
      <PageHeader title="Importer des pharmacies" subtitle="Fichier clients Excel ou CSV. Import rejouable : une pharmacie déjà présente est mise à jour, jamais dupliquée." />
      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1fr_360px]">
        <PharmacyImportForm />
        <Card>
          <CardHeader title="Colonnes reconnues" description="Les en-têtes sont comparés sans tenir compte des accents ni des majuscules." />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {(Object.entries(PHARMACY_FIELDS) as [PharmacyField, (typeof PHARMACY_FIELDS)[PharmacyField]][]).map(([k, f]) => (
                <div key={k}>
                  <dt className="font-medium">{f.label}</dt>
                  <dd className="text-muted">{f.aliases.length ? f.aliases.slice(0, 5).join(", ") : "colonnes « Ciblage … »"}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted">
              Règles : une valeur vide (ou « - ») n'efface jamais une donnée existante ; une valeur illisible est ignorée et
              signalée ; aucune catégorie ni chiffre d'affaires n'est déduit. Identification : code client ou identifiant
              externe, sinon nom + code postal + commune. Les colonnes non reconnues sont conservées dans « Autres
              informations ». Une raison sociale en capitales (« SELARL PHIE DU PORT ») est affichée sous une forme
              lisible (« Pharmacie du Port ») ; l'originale reste visible sur la fiche.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

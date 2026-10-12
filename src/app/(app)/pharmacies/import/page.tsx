import type { Metadata } from "next";
import { PharmacyImportForm } from "@/components/pharmacy-import-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PHARMACY_COLUMN_ALIASES } from "@/domain/pharmacy-import";

export const metadata: Metadata = { title: "Importer des pharmacies" };

const LABELS: Record<keyof typeof PHARMACY_COLUMN_ALIASES, string> = {
  name: "Nom (obligatoire)",
  legalName: "Raison sociale",
  externalId: "Identifiant externe (FINESS, OSM…)",
  address: "Adresse",
  postalCode: "Code postal",
  city: "Commune",
  phone: "Téléphone",
  lat: "Latitude",
  lng: "Longitude",
  category: "Catégorie A/B/C/D",
  revenue: "Chiffre d'affaires",
  potential: "Potentiel (fort/moyen/faible)",
  targetVisits: "Visites par an",
  notes: "Notes",
};

export default function ImportPharmaciesPage() {
  return (
    <>
      <PageHeader title="Importer des pharmacies" subtitle="Import rejouable : une pharmacie déjà présente est mise à jour, jamais dupliquée." />
      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1fr_360px]">
        <PharmacyImportForm />
        <Card>
          <CardHeader title="Colonnes reconnues" description="Les en-têtes sont comparés sans tenir compte des accents ni des majuscules." />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
                <div key={k}>
                  <dt className="font-medium">{LABELS[k]}</dt>
                  <dd className="text-muted">{PHARMACY_COLUMN_ALIASES[k].slice(0, 5).join(", ")}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted">
              Règles : une valeur vide n'efface jamais une donnée existante ; une valeur illisible est ignorée et signalée ;
              aucune catégorie ni chiffre d'affaires n'est déduit. Identification : identifiant externe, sinon nom + code
              postal + commune.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

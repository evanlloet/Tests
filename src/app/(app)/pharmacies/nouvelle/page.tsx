import type { Metadata } from "next";
import { CreatePharmacyForm } from "@/components/pharmacy-forms";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { createPharmacyAction } from "@/server/actions/pharmacies";

export const metadata: Metadata = { title: "Nouvelle pharmacie" };

export default function NewPharmacyPage() {
  return (
    <>
      <PageHeader title="Nouvelle pharmacie" subtitle="Seul le nom est obligatoire. Les informations inconnues restent vides." />
      <Card className="max-w-2xl">
        <CardBody>
          <CreatePharmacyForm action={createPharmacyAction} />
        </CardBody>
      </Card>
    </>
  );
}

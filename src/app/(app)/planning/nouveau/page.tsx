import type { Metadata } from "next";
import { AppointmentForm } from "@/components/appointment-form";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { isDayKey } from "@/domain/time";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { pickerOptions } from "@/server/repositories/picker";
import { todayFor } from "@/server/services/context";

export const metadata: Metadata = { title: "Nouveau rendez-vous" };

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const options = await pickerOptions(db, user.id);
  const day = sp.date && isDayKey(sp.date) ? sp.date : todayFor(user);
  const start = sp.debut && /^\d{2}:\d{2}$/.test(sp.debut) ? sp.debut : "09:00";
  const [h = 9, m = 0] = start.split(":").map(Number);
  const endMin = h * 60 + m + user.defaultVisitMinutes;
  const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  return (
    <>
      <PageHeader title="Nouveau rendez-vous" />
      <Card className="max-w-2xl">
        <CardBody>
          <AppointmentForm
            options={options}
            defaultVisitMinutes={user.defaultVisitMinutes}
            values={{
              pharmacyId: sp.pharmacie ?? null,
              kind: "visit",
              title: "",
              day,
              start,
              end,
              status: "confirmed",
              notes: "",
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}

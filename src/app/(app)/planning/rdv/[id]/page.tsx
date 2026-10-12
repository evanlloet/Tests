import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CancelButton, OutcomeButtons } from "@/components/appointment-actions";
import { AppointmentForm } from "@/components/appointment-form";
import { CompleteVisit } from "@/components/complete-visit";
import { APPOINTMENT_STATUS, OUTCOME, SOURCE_LABEL } from "@/components/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { dayKeyOf, formatDateTime, timeOfDay } from "@/domain/time";
import { deleteAppointmentAction } from "@/server/actions/appointments";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { auditLogs, calendarEvents } from "@/server/db/schema";
import { pickerOptions } from "@/server/repositories/picker";
import { getAppointment } from "@/server/services/appointments";

export const metadata: Metadata = { title: "Rendez-vous" };

const ACTION_LABEL: Record<string, string> = {
  create: "Création",
  update: "Modification",
  move: "Déplacement",
  complete: "Visite terminée",
  outcome: "Réalisation modifiée",
  delete: "Suppression",
};

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const appt = await getAppointment(db, user.id, id);
  if (!appt) notFound();
  const options = await pickerOptions(db, user.id);
  const [event] = appt.calendarEventId
    ? await db.select().from(calendarEvents).where(and(eq(calendarEvents.id, appt.calendarEventId), eq(calendarEvents.userId, user.id)))
    : [];
  const history = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.userId, user.id), eq(auditLogs.entity, "appointment"), eq(auditLogs.entityId, appt.id)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);
  const past = appt.startsAt < new Date();
  const canComplete = appt.kind === "visit" && appt.pharmacyId && appt.status !== "cancelled" && appt.outcome !== "done";

  return (
    <>
      <PageHeader
        title={appt.title}
        subtitle={formatDateTime(appt.startsAt, user.timezone)}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={APPOINTMENT_STATUS[appt.status].tone}>{APPOINTMENT_STATUS[appt.status].label}</Badge>
            <Badge tone={OUTCOME[appt.outcome].tone}>{OUTCOME[appt.outcome].label}</Badge>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 *:min-w-0 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Modifier" />
          <CardBody>
            <AppointmentForm
              options={options}
              defaultVisitMinutes={user.defaultVisitMinutes}
              values={{
                id: appt.id,
                pharmacyId: appt.pharmacyId,
                kind: appt.kind,
                title: appt.title,
                day: dayKeyOf(appt.startsAt, user.timezone),
                start: timeOfDay(appt.startsAt, user.timezone),
                end: timeOfDay(appt.endsAt, user.timezone),
                status: appt.status,
                notes: appt.notes ?? "",
              }}
            />
          </CardBody>
        </Card>
        <div className="space-y-4">
          {canComplete ? (
            <Card>
              <CardBody>
                <CompleteVisit appointmentId={appt.id} />
              </CardBody>
            </Card>
          ) : null}
          {past && appt.kind === "visit" && appt.status !== "cancelled" ? (
            <Card>
              <CardHeader title="Réalisation" description="Un rendez-vous présent dans l'agenda ne prouve pas que la visite a eu lieu." />
              <CardBody>
                <OutcomeButtons appointment={appt} />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Provenance" />
            <CardBody className="space-y-2 text-sm">
              <p>{SOURCE_LABEL[appt.source]}</p>
              {event ? (
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="text-xs text-muted">Événement Outlook d&apos;origine (conservé sans modification)</p>
                  <p className="font-medium">{event.title}</p>
                  <p className="text-muted">
                    {formatDateTime(event.startsAt, user.timezone)}
                    {event.location ? ` · ${event.location}` : ""}
                  </p>
                  <Link href={`/imports/${event.importId}`} className="text-xs text-primary underline">
                    Voir l&apos;import
                  </Link>
                </div>
              ) : null}
              {appt.pharmacyId ? (
                <Link href={`/pharmacies/${appt.pharmacyId}`} className="text-primary underline">
                  Fiche de la pharmacie
                </Link>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Journal des modifications" />
            <CardBody>
              <ul className="space-y-1.5 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <span className="text-muted">{formatDateTime(h.createdAt, user.timezone)}</span> — {ACTION_LABEL[h.action] ?? h.action}
                    {h.reason ? <span className="text-muted"> ({h.reason})</span> : null}
                  </li>
                ))}
                {history.length === 0 ? <li className="text-muted">Aucune entrée.</li> : null}
              </ul>
            </CardBody>
          </Card>
          <div className="flex flex-wrap gap-2">
            {appt.status !== "cancelled" ? <CancelButton id={appt.id} /> : null}
            {appt.source !== "calendar_import" ? (
              <ActionForm action={deleteAppointmentAction}>
                <input type="hidden" name="id" value={appt.id} />
                <Button type="submit" variant="ghost" size="sm" className="text-danger">
                  Supprimer
                </Button>
              </ActionForm>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

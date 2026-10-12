"use client";

import { cancelAppointmentAction, setOutcomeAction } from "@/server/actions/appointments";
import type { Appointment } from "@/server/db/schema";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";

/** Boutons « réalisée / non réalisée » pour une visite passée. */
export function OutcomeButtons({ appointment }: { appointment: Pick<Appointment, "id" | "outcome"> }) {
  const options = [
    { value: "done", label: "Réalisée" },
    { value: "missed", label: "Non réalisée" },
    { value: "unknown", label: "Je ne sais pas" },
  ].filter((o) => o.value !== appointment.outcome);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <ActionForm key={o.value} action={setOutcomeAction} feedback={false}>
          <input type="hidden" name="id" value={appointment.id} />
          <input type="hidden" name="outcome" value={o.value} />
          <Button type="submit" size="sm" variant="ghost" className="border border-border">
            {o.label}
          </Button>
        </ActionForm>
      ))}
    </div>
  );
}

export function CancelButton({ id }: { id: string }) {
  return (
    <ActionForm action={cancelAppointmentAction}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="danger"
        size="sm"
        onClick={(e) => {
          if (!confirm("Annuler ce rendez-vous ? Il restera visible dans l'historique comme annulé.")) e.preventDefault();
        }}
      >
        Annuler le rendez-vous
      </Button>
    </ActionForm>
  );
}

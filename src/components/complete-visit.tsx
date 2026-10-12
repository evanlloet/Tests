"use client";

import { CheckCircle2 } from "lucide-react";
import { useActionState, useState } from "react";
import { completeVisitAction } from "@/server/actions/appointments";
import type { ActionResult } from "@/server/actions/result";
import { submitWithoutReset } from "./action-form";
import { Button } from "./ui/button";
import { Field, Textarea } from "./ui/form";
import { Notice } from "./ui/notice";

/**
 * Bouton « Rendez-vous terminé » : marque la visite comme réalisée, enregistre un
 * compte rendu facultatif puis propose les créneaux de la prochaine visite.
 */
export function CompleteVisit({ appointmentId, label = "Rendez-vous terminé" }: { appointmentId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(completeVisitAction, null);
  if (!open) {
    return (
      <Button size="xl" className="w-full" onClick={() => setOpen(true)}>
        <CheckCircle2 className="size-6" aria-hidden /> {label}
      </Button>
    );
  }
  return (
    <form action={action} onSubmit={submitWithoutReset(action)} className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-4">
      <input type="hidden" name="id" value={appointmentId} />
      <Field label="Compte rendu (facultatif)" htmlFor={`summary-${appointmentId}`}>
        <Textarea id={`summary-${appointmentId}`} name="summary" rows={3} placeholder="Points abordés, commande, besoins du pharmacien…" autoFocus />
      </Field>
      <Field label="Actions à prévoir (facultatif)" htmlFor={`next-${appointmentId}`}>
        <Textarea id={`next-${appointmentId}`} name="nextActions" rows={2} />
      </Field>
      {state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending} className="flex-1">
          {pending ? "Enregistrement…" : "Valider la visite et proposer la suivante"}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

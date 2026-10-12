"use client";

import { applyOptimizedAction } from "@/server/actions/routes";
import { ActionForm, SubmitButton } from "./action-form";
import { Checkbox } from "./ui/form";

export function ApplyPlanForm({
  day,
  signature,
  start,
  end,
  recommended,
  allowConfirmed,
  movedConfirmed,
}: {
  day: string;
  signature: string;
  start: string;
  end: string;
  recommended: boolean;
  allowConfirmed: boolean;
  movedConfirmed: string[];
}) {
  return (
    <ActionForm action={applyOptimizedAction} className="space-y-3">
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="signature" value={signature} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <input type="hidden" name="allowConfirmed" value={allowConfirmed ? "1" : "0"} />
      <Checkbox
        name="confirm"
        required
        label={
          allowConfirmed
            ? "J'ai vérifié le scénario : appliquer les nouveaux horaires."
            : "J'ai vérifié le scénario : modifier les horaires des visites non confirmées (les rendez-vous confirmés ne bougent pas)."
        }
      />
      {movedConfirmed.length ? (
        <Checkbox
          name="confirmConfirmed"
          required
          label={`Je confirme le déplacement de ${movedConfirmed.length} rendez-vous confirmé(s) (${movedConfirmed.join(", ")}) : je préviens les pharmaciens et je mets Outlook à jour.`}
        />
      ) : null}
      <SubmitButton variant={recommended ? "primary" : "secondary"} size="lg" pendingLabel="Application…">
        Appliquer ce scénario
      </SubmitButton>
    </ActionForm>
  );
}

"use client";

import { useActionState } from "react";
import { deleteAccountAction, type AuthState } from "@/server/actions/auth";
import { submitWithoutReset } from "./action-form";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/form";
import { Notice } from "./ui/notice";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(deleteAccountAction, null);
  return (
    <details className="rounded-2xl border border-danger/30 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-danger">Supprimer mon compte et toutes mes données</summary>
      <form action={action} onSubmit={submitWithoutReset(action)} className="mt-3 space-y-3">
        <p className="text-muted">
          Suppression définitive : pharmacies, rendez-vous, imports, comptes rendus et journal. Exportez vos données avant si nécessaire.
        </p>
        <Field label="Saisissez votre adresse e-mail pour confirmer" htmlFor="confirmEmail">
          <Input id="confirmEmail" name="confirmEmail" type="email" autoComplete="off" required />
        </Field>
        {state?.error ? <Notice tone="danger">{state.error}</Notice> : null}
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Suppression…" : "Supprimer définitivement"}
        </Button>
      </form>
    </details>
  );
}

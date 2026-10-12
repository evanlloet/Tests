"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, signupAction, type AuthState } from "@/server/actions/auth";
import { submitWithoutReset } from "./action-form";
import { Button } from "./ui/button";
import { Card, CardBody } from "./ui/card";
import { Field, Input } from "./ui/form";
import { Notice } from "./ui/notice";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(loginAction, null);
  return (
    <Card>
      <CardBody>
        <form action={action} onSubmit={submitWithoutReset(action)} className="space-y-4">
          <h2 className="text-2xl font-extrabold">Connexion</h2>
          {state?.error ? <Notice tone="danger">{state.error}</Notice> : null}
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required inputMode="email" />
          </Field>
          <Field label="Mot de passe" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Connexion…" : "Se connecter"}
          </Button>
          <p className="text-center text-sm text-muted">
            Pas encore de compte ?{" "}
            <Link href="/inscription" className="font-medium text-primary underline-offset-4 hover:underline">
              Créer un compte
            </Link>
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

export function SignupForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signupAction, null);
  if (!enabled) {
    return (
      <Notice tone="info" title="Inscription fermée">
        La création de compte est désactivée sur cette installation. <Link href="/connexion" className="underline">Se connecter</Link>
      </Notice>
    );
  }
  return (
    <Card>
      <CardBody>
        <form action={action} onSubmit={submitWithoutReset(action)} className="space-y-4">
          <h2 className="text-2xl font-extrabold">Créer votre compte</h2>
          {state?.error ? <Notice tone="danger">{state.error}</Notice> : null}
          <Field label="Prénom" htmlFor="displayName">
            <Input id="displayName" name="displayName" autoComplete="given-name" required maxLength={80} />
          </Field>
          <Field label="E-mail" htmlFor="email" error={state?.fieldErrors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Mot de passe" htmlFor="password" hint="10 caractères minimum, dont une lettre et un chiffre." error={state?.fieldErrors?.password}>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Création…" : "Créer le compte"}
          </Button>
          <p className="text-center text-sm text-muted">
            Déjà inscrite ?{" "}
            <Link href="/connexion" className="font-medium text-primary underline-offset-4 hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </CardBody>
    </Card>
  );
}

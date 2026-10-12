"use client";

import { createContext, startTransition, useActionState, useContext, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/server/actions/result";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

type SimpleAction = (formData: FormData) => Promise<ActionResult<unknown>>;
type StatefulAction<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

const PendingContext = createContext(false);

/**
 * Soumission sans réinitialisation automatique du formulaire (comportement par
 * défaut de React 19 avec `action`) : en cas d'erreur, la saisie est conservée.
 * L'attribut `action` reste présent pour fonctionner sans JavaScript.
 */
export function submitWithoutReset(dispatch: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(fd));
  };
}

export function ActionFeedback({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (state.ok) return state.message ? <Notice tone="success" className="mt-3">{state.message}</Notice> : null;
  return (
    <Notice tone="danger" className="mt-3">
      {state.error}
    </Notice>
  );
}

/** Formulaire branché sur une Server Action « simple » (FormData → résultat). */
export function ActionForm({
  action,
  children,
  className,
  feedback = true,
}: {
  action: SimpleAction;
  children: ReactNode;
  className?: string;
  feedback?: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (_prev: ActionResult<unknown> | null, fd: FormData) => action(fd), null);
  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className={className}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {feedback ? <ActionFeedback state={state} /> : null}
    </form>
  );
}

/** Formulaire branché sur une Server Action avec état (useActionState). */
export function StatefulForm<T>({
  action,
  children,
  className,
  render,
}: {
  action: StatefulAction<T>;
  children: ReactNode;
  className?: string;
  render?: (state: ActionResult<T> | null) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className={className}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {render ? render(state) : <ActionFeedback state={state} />}
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type"> & { pendingLabel?: ReactNode }) {
  const fromContext = useContext(PendingContext);
  const { pending: fromStatus } = useFormStatus();
  const pending = fromContext || fromStatus;
  return (
    <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </Button>
  );
}

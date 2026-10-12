"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/server/actions/result";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

type SimpleAction = (formData: FormData) => Promise<ActionResult<unknown>>;
type StatefulAction<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

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
  const [state, formAction] = useActionState(async (_prev: ActionResult<unknown> | null, fd: FormData) => action(fd), null);
  return (
    <form action={formAction} className={className}>
      {children}
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
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {render ? render(state) : <ActionFeedback state={state} />}
    </form>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type"> & { pendingLabel?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </Button>
  );
}

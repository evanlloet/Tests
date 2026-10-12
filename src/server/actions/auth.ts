"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "../db/client";
import { hashPassword, passwordPolicyError, verifyPassword } from "../auth/password";
import { clearFailures, isRateLimited, recordFailure } from "../auth/rate-limit";
import { createSession, destroySession, requireUser } from "../auth/session";
import { users } from "../db/schema";
import { createUserWithDefaults, findUserByEmail } from "../repositories/users";

export type AuthState = { error?: string; fieldErrors?: Record<string, string> } | null;

const loginSchema = z.object({
  email: z.email("Adresse e-mail invalide.").max(200),
  password: z.string().min(1, "Mot de passe requis.").max(200),
});

// Hachage factice : rend la durée de vérification identique que le compte existe ou non.
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${parsed.data.email.toLowerCase()}|${ip}`;
  if (isRateLimited(key)) return { error: "Trop de tentatives. Réessayez dans quelques minutes." };

  const user = await findUserByEmail(db, parsed.data.email);
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(key);
    return { error: "E-mail ou mot de passe incorrect." };
  }
  clearFailures(key);
  await createSession(user.id);
  redirect("/");
}

const signupSchema = z.object({
  displayName: z.string().trim().min(1, "Indiquez votre prénom.").max(80),
  email: z.email("Adresse e-mail invalide.").max(200),
  password: z.string().max(200),
});

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (process.env.ALLOW_SIGNUP !== "true") {
    return { error: "La création de compte est désactivée sur cette installation." };
  }
  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };
  const policy = passwordPolicyError(parsed.data.password);
  if (policy) return { fieldErrors: { password: policy } };
  if (await findUserByEmail(db, parsed.data.email)) {
    return { fieldErrors: { email: "Un compte existe déjà avec cette adresse." } };
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const userId = await db.transaction((tx) =>
    createUserWithDefaults(tx, { email: parsed.data.email, passwordHash, displayName: parsed.data.displayName }),
  );
  await createSession(userId);
  redirect("/profil?bienvenue=1");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/connexion");
}

/** Suppression définitive du compte et de toutes les données associées (suppression en cascade). */
export async function deleteAccountAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const user = await requireUser();
  const confirmation = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (confirmation !== user.email.toLowerCase()) return { error: "Saisissez exactement votre adresse e-mail pour confirmer." };
  await db.delete(users).where(eq(users.id, user.id));
  await destroySession();
  redirect("/connexion");
}

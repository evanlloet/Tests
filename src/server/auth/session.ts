import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db/client";
import { sessions, users, type User } from "../db/schema";

export const SESSION_COOKIE = "lea_session";
const SESSION_DAYS = 30;
const RENEW_WHEN_DAYS_LEFT = 15;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, userAgent });
  // Nettoyage opportuniste des sessions expirées de cet utilisateur
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  await setSessionCookie(token, expiresAt);
}

async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export type SessionUser = Pick<
  User,
  | "id"
  | "email"
  | "displayName"
  | "timezone"
  | "workDayStart"
  | "workDayEnd"
  | "defaultVisitMinutes"
  | "bufferMinutes"
  | "lunchStart"
  | "lunchMinutes"
  | "frequencyA"
  | "frequencyB"
  | "frequencyC"
  | "frequencyD"
  | "autoMatchThreshold"
  | "onboardingStep"
  | "onboardingCompletedAt"
  | "gamificationEnabled"
>;

/** Utilisateur courant (une seule requête SQL par rendu grâce à `cache`). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  // Renouvellement glissant (les cookies ne sont modifiables que hors rendu : on ignore l'échec)
  if (row.session.expiresAt.getTime() - Date.now() < RENEW_WHEN_DAYS_LEFT * 86_400_000) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    try {
      await setSessionCookie(token, expiresAt);
    } catch {
      /* rendu de Server Component : le cookie sera renouvelé à la prochaine action */
    }
  }
  const { passwordHash: _ignored, createdAt: _c, updatedAt: _u, ...user } = row.user;
  return user;
});

/** À appeler en tête de chaque page, action ou route protégée. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

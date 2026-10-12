import type { Metadata } from "next";
import { Onboarding } from "@/components/onboarding/onboarding";
import { DEPARTMENTS } from "@/domain/departments";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { listTerritories, listWeekTemplates } from "@/server/repositories/territories";
import { getUserSettings } from "@/server/repositories/users";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function WelcomePage() {
  const user = await requireUser();
  const { travel } = await getUserSettings(db, user.id);
  const territories = (await listTerritories(db, user.id)).filter((t) => t.kind === "department");
  const templates = await listWeekTemplates(db, user.id);
  const week = (templates.find((t) => t.isDefault) ?? templates[0])?.days ?? {};
  return (
    <Onboarding
      data={{
        firstName: user.displayName,
        step: user.onboardingCompletedAt ? 0 : user.onboardingStep,
        home: { lat: travel?.homeLat ?? null, lng: travel?.homeLng ?? null, address: travel?.homeAddress ?? null },
        territories: territories.map((t) => ({ code: t.code, name: t.name, color: t.color, isActive: t.isActive })),
        departments: Object.entries(DEPARTMENTS),
        week,
        rhythm: {
          workDayStart: user.workDayStart,
          workDayEnd: user.workDayEnd,
          lunchStart: user.lunchStart,
          lunchMinutes: user.lunchMinutes,
          defaultVisitMinutes: user.defaultVisitMinutes,
          bufferMinutes: user.bufferMinutes,
        },
        frequencies: { A: user.frequencyA, B: user.frequencyB, C: user.frequencyC, D: user.frequencyD },
        gamificationEnabled: user.gamificationEnabled,
      }}
    />
  );
}

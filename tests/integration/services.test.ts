import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { zonedDateTime, addDays, isoWeekday, dayKeyOf } from "@/domain/time";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { appointments, auditLogs, pharmacies, travelPreferences, users } from "@/server/db/schema";
import { AppointmentError, completeVisit, createAppointment, updateAppointment } from "@/server/services/appointments";
import { importPharmacyCsv } from "@/server/services/pharmacy-import";
import { getPharmacyOverview } from "@/server/services/pharmacy-overview";
import { getRewards } from "@/server/services/rewards";
import { applyRoutePlan, RoutePlanError, simulateDayPlan } from "@/server/services/route-plan";
import { suggestNextVisit } from "@/server/services/suggestions";
import { bytes, createTestUser, resetDatabase } from "../support/db";

const CSV = [
  "Nom;Code postal;Ville;Latitude;Longitude;Catégorie",
  "Pharmacie Lemoine;14000;Caen;49,1829;-0,3707;A",
  "Pharmacie du Port;14600;Honfleur;49,4189;0,2331;B",
  "Pharmacie de la Gare;14100;Lisieux;49,1466;0,2266;C",
  "Grande Pharmacie de Bayeux;14400;Bayeux;49,2764;-0,7024;D",
].join("\n");

async function sessionUser(id: string): Promise<SessionUser> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  const { passwordHash: _p, createdAt: _c, updatedAt: _u, ...rest } = u!;
  return rest;
}

/** Prochain jour ouvré (lundi à vendredi) à partir de demain. */
function nextWorkday(): string {
  let d = addDays(dayKeyOf(new Date()), 1);
  while (isoWeekday(d) > 5) d = addDays(d, 1);
  return d;
}

describe("services métier (base réelle)", () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$client.end();
  });

  async function setup() {
    const t = await createTestUser();
    await importPharmacyCsv(db, t.id, { name: "p.csv", bytes: bytes(CSV) });
    await db.update(travelPreferences).set({ homeLat: 48.1173, homeLng: -1.6778 }).where(eq(travelPreferences.userId, t.id));
    const user = await sessionUser(t.id);
    const ph = Object.fromEntries((await db.select().from(pharmacies)).map((p) => [p.city!, p.id]));
    return { user, ph };
  }

  it("calcule les échéances et distingue visite identifiée / réalisée", async () => {
    const { user, ph } = await setup();
    const past = new Date(Date.now() - 100 * 86_400_000);
    const appt = await createAppointment(db, user.id, {
      pharmacyId: ph.Caen!, kind: "visit", title: "Visite", startsAt: past, endsAt: new Date(past.getTime() + 45 * 60_000), status: "confirmed", notes: null,
    });
    let overview = await getPharmacyOverview(user);
    const caen = () => overview.find((o) => o.pharmacy.id === ph.Caen)!;
    expect(caen().status.lastVisit?.state).toBe("identified");
    expect(caen().status.dueState).toBe("overdue"); // A : 4/an → tous les 91 jours
    await completeVisit(db, user.id, appt.id, { summary: "RAS", nextActions: null });
    overview = await getPharmacyOverview(user);
    expect(caen().status.lastVisit?.state).toBe("done");
    const bayeux = overview.find((o) => o.pharmacy.id === ph.Bayeux)!;
    expect(bayeux.status.dueState).toBe("never_visited");
  });

  it("calcule points et badges à partir des faits enregistrés (sans compteur stocké)", async () => {
    const { user, ph } = await setup();
    const empty = await getRewards(db, user);
    expect(empty.points).toBe(0);
    expect(empty.level.name).toBe("Graine");
    const past = new Date(Date.now() - 2 * 86_400_000);
    const appt = await createAppointment(db, user.id, {
      pharmacyId: ph.Honfleur!, kind: "visit", title: "Visite", startsAt: past, endsAt: new Date(past.getTime() + 45 * 60_000), status: "confirmed", notes: null,
    });
    // Un rendez-vous identifié mais non clôturé ne rapporte rien
    expect((await getRewards(db, user)).points).toBe(0);
    await completeVisit(db, user.id, appt.id, { summary: "Commande passée", nextActions: null });
    const r = await getRewards(db, user);
    const line = (label: string) => r.breakdown.find((b) => b.label === label)?.points;
    expect(line("Visites réalisées")).toBe(10);
    expect(line("Comptes rendus")).toBe(5);
    expect(r.points).toBeGreaterThanOrEqual(15);
    expect(r.badges.find((b) => b.key === "first-visit")?.unlocked).toBe(true);
  });

  it("propose des créneaux pour la prochaine visite", async () => {
    const { user, ph } = await setup();
    const res = await suggestNextVisit(db, user, ph.Caen!);
    expect(res?.blocker).toBeNull();
    expect(res!.suggestions.length).toBeGreaterThan(0);
    expect(res!.suggestions.every((s) => isoWeekday(s.day) <= 5)).toBe(true);
  });

  it("protège un rendez-vous confirmé contre un changement d'horaire implicite", async () => {
    const { user, ph } = await setup();
    const day = nextWorkday();
    const a = await createAppointment(db, user.id, {
      pharmacyId: ph.Caen!, kind: "visit", title: "Visite", startsAt: zonedDateTime(day, "09:00"), endsAt: zonedDateTime(day, "09:45"), status: "confirmed", notes: null,
    });
    await expect(updateAppointment(db, user.id, a.id, { startsAt: zonedDateTime(day, "10:00"), endsAt: zonedDateTime(day, "10:45") })).rejects.toBeInstanceOf(AppointmentError);
    await updateAppointment(db, user.id, a.id, { startsAt: zonedDateTime(day, "10:00"), endsAt: zonedDateTime(day, "10:45") }, { allowConfirmedTimeChange: true });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, a.id));
    expect(logs.map((l) => l.action).sort()).toEqual(["create", "move"]);
  });

  it("simule, compare et applique une tournée sans toucher aux rendez-vous confirmés", async () => {
    const { user, ph } = await setup();
    const day = nextWorkday();
    const mk = (city: string, start: string, status: "confirmed" | "pending") =>
      createAppointment(db, user.id, {
        pharmacyId: ph[city]!, kind: "visit", title: city, startsAt: zonedDateTime(day, start), endsAt: zonedDateTime(day, addMinutes(start, 45)), status, notes: null,
      });
    // Ordre initial volontairement mauvais : Lisieux, Bayeux, Honfleur, puis Caen (confirmé à 16 h)
    const lisieux = await mk("Lisieux", "09:00", "pending");
    await mk("Bayeux", "10:30", "pending");
    await mk("Honfleur", "13:30", "pending");
    const caen = await mk("Caen", "16:00", "confirmed");

    const sim = await simulateDayPlan(db, user, day, { persist: false });
    expect(sim).not.toBeNull();
    expect(sim!.provider.isRealRouting).toBe(false);
    expect(sim!.optimized.totalKm).toBeLessThan(sim!.initial.totalKm);
    expect(sim!.comparison.worthApplying).toBe(true);
    expect(sim!.optimized.stops.find((s) => s.id === caen.id)!.start).toBe(16 * 60);

    const persisted = await simulateDayPlan(db, user, day, { persist: true });
    const { changed } = await applyRoutePlan(db, user, persisted!.optimizedPlanId!);
    expect(changed).toBeGreaterThan(0);
    const [caenAfter] = await db.select().from(appointments).where(eq(appointments.id, caen.id));
    expect(caenAfter!.startsAt.toISOString()).toBe(zonedDateTime(day, "16:00").toISOString());
    await expect(applyRoutePlan(db, user, persisted!.optimizedPlanId!)).rejects.toBeInstanceOf(RoutePlanError);

    // Un scénario devient caduc si le planning change entre-temps
    const again = await simulateDayPlan(db, user, day, { persist: true });
    await new Promise((r) => setTimeout(r, 5));
    await updateAppointment(db, user.id, lisieux.id, { notes: "modifié" });
    await expect(applyRoutePlan(db, user, again!.optimizedPlanId!)).rejects.toThrow(/a changé/);
  });
});

function addMinutes(hhmm: string, m: number) {
  const [h = 0, mi = 0] = hhmm.split(":").map(Number);
  const t = h * 60 + mi + m;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

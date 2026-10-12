import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { appointmentMatches, appointments, auditLogs, calendarEvents, pharmacies, pharmacyMetrics } from "@/server/db/schema";
import { importCalendarFile } from "@/server/services/calendar-import";
import { ignoreMatch, rematchOpenEvents, validateMatch } from "@/server/services/match-review";
import { importPharmacyCsv } from "@/server/services/pharmacy-import";
import { bytes, createTestUser, resetDatabase, testDb } from "../support/db";

const PHARMACIES_CSV = [
  "Nom;Adresse;Code postal;Ville;FINESS;Latitude;Longitude;Catégorie",
  "Pharmacie Lemoine;12 rue Saint-Jean;14000;Caen;140000001;49,1829;-0,3707;A",
  "Pharmacie du Centre;3 place du Marché;14400;Bayeux;140000002;49,2764;-0,7024;B",
  "Pharmacie du Centre;8 rue Écuyère;14000;Caen;140000003;49,1840;-0,3690;",
  "Pharmacie du Port;1 quai Sainte-Catherine;14600;Honfleur;140000004;;;D",
].join("\n");

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-lemoine
SUMMARY:RDV Pharmacie Lemoine
LOCATION:Caen
DTSTART:20260602T070000Z
DTEND:20260602T074500Z
END:VEVENT
BEGIN:VEVENT
UID:evt-centre
SUMMARY:Pharmacie du Centre
DTSTART:20260603T080000Z
DTEND:20260603T090000Z
END:VEVENT
BEGIN:VEVENT
UID:evt-conges
SUMMARY:Congés
DTSTART;VALUE=DATE:20260720
DTEND;VALUE=DATE:20260725
END:VEVENT
BEGIN:VEVENT
UID:evt-inconnue
SUMMARY:Pharmacie des Remparts
LOCATION:Vire
DTSTART:20260604T080000Z
DTEND:20260604T090000Z
END:VEVENT
END:VCALENDAR`;

const now = new Date("2026-10-12T10:00:00Z");

afterAll(async () => {
  await testDb.$client.end();
});

describe("import du référentiel pharmacies", () => {
  beforeEach(resetDatabase);

  it("crée les fiches puis ne crée aucun doublon lors d'un second import", async () => {
    const user = await createTestUser();
    const first = await importPharmacyCsv(testDb, user.id, { name: "pharmacies.csv", bytes: bytes(PHARMACIES_CSV) });
    expect(first).toMatchObject({ created: 4, updated: 0, unchanged: 0 });
    const second = await importPharmacyCsv(testDb, user.id, { name: "pharmacies.csv", bytes: bytes(PHARMACIES_CSV) });
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    const [count] = await testDb.select({ n: sql<number>`count(*)::int` }).from(pharmacies);
    expect(count!.n).toBe(4);
  });

  it("met à jour sans effacer les données existantes", async () => {
    const user = await createTestUser();
    await importPharmacyCsv(testDb, user.id, { name: "a.csv", bytes: bytes(PHARMACIES_CSV) });
    const update = ["FINESS;Nom;Code postal;Ville;Téléphone;Catégorie", "140000004;Pharmacie du Port;14600;Honfleur;02 31 00 00 00;"].join("\n");
    const res = await importPharmacyCsv(testDb, user.id, { name: "b.csv", bytes: bytes(update) });
    expect(res).toMatchObject({ created: 0, updated: 1 });
    const [port] = await testDb
      .select({ p: pharmacies, m: pharmacyMetrics })
      .from(pharmacies)
      .leftJoin(pharmacyMetrics, eq(pharmacyMetrics.pharmacyId, pharmacies.id))
      .where(eq(pharmacies.externalId, "140000004"));
    expect(port!.p.phone).toBe("02 31 00 00 00");
    expect(port!.p.addressLine).toBe("1 quai Sainte-Catherine");
    expect(port!.m!.category).toBe("D");
  });

  it("isole les données de chaque utilisateur", async () => {
    const a = await createTestUser("a@example.test");
    const b = await createTestUser("b@example.test");
    await importPharmacyCsv(testDb, a.id, { name: "a.csv", bytes: bytes(PHARMACIES_CSV) });
    const res = await importPharmacyCsv(testDb, b.id, { name: "b.csv", bytes: bytes(PHARMACIES_CSV) });
    expect(res.created).toBe(4);
    const [count] = await testDb.select({ n: sql<number>`count(*)::int` }).from(pharmacies).where(eq(pharmacies.userId, b.id));
    expect(count!.n).toBe(4);
  });
});

describe("import Outlook et rapprochement", () => {
  beforeEach(resetDatabase);

  async function setup() {
    const user = await createTestUser();
    await importPharmacyCsv(testDb, user.id, { name: "p.csv", bytes: bytes(PHARMACIES_CSV) });
    return user;
  }

  it("classe, rapproche et crée les rendez-vous sûrs", async () => {
    const user = await setup();
    const res = await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    expect(res).toMatchObject({ format: "ics", totalEvents: 4, newEvents: 4 });
    expect(res.classification).toEqual({ visit: 3, not_visit: 1, unknown: 0 });
    // Lemoine + Caen → validé automatiquement ; « Centre » sans commune → à valider ; Remparts → aucun candidat
    expect(res.matches).toEqual({ auto_validated: 1, pending: 1, no_candidate: 1 });
    expect(res.appointmentsCreated).toBe(1);

    const appts = await testDb.select().from(appointments).where(eq(appointments.userId, user.id));
    expect(appts).toHaveLength(1);
    expect(appts[0]).toMatchObject({ status: "confirmed", outcome: "unknown", source: "calendar_import" });
  });

  it("ne crée aucun doublon quand le même fichier est réimporté", async () => {
    const user = await setup();
    await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    const again = await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    expect(again).toMatchObject({ newEvents: 0, updatedEvents: 0, unchangedEvents: 4, appointmentsCreated: 0 });
    const [events] = await testDb.select({ n: sql<number>`count(*)::int` }).from(calendarEvents);
    const [appts] = await testDb.select({ n: sql<number>`count(*)::int` }).from(appointments);
    const [matches] = await testDb.select({ n: sql<number>`count(*)::int` }).from(appointmentMatches);
    expect([events!.n, appts!.n, matches!.n]).toEqual([4, 1, 3]);
  });

  it("repère un même événement importé sous un autre format", async () => {
    const user = await setup();
    await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    const csv = [
      '"Objet","Date de début","Heure de début","Date de fin","Heure de fin","Journée entière","Emplacement"',
      '"RDV Pharmacie Lemoine","02/06/2026","09:00:00","02/06/2026","09:45:00","Faux","Caen"',
    ].join("\n");
    const res = await importCalendarFile(testDb, user, { name: "agenda.csv", bytes: bytes(csv) }, { now });
    expect(res).toMatchObject({ newEvents: 1, probableDuplicates: 1, appointmentsCreated: 0 });
  });

  it("met à jour un rendez-vous déplacé dans Outlook s'il n'a pas été modifié dans Léa", async () => {
    const user = await setup();
    await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    const moved = ICS.replace("DTSTART:20260602T070000Z\nDTEND:20260602T074500Z", "DTSTART:20260602T120000Z\nDTEND:20260602T124500Z");
    const res = await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(moved) }, { now });
    expect(res).toMatchObject({ updatedEvents: 1, appointmentsUpdated: 1 });
    const [appt] = await testDb.select().from(appointments);
    expect(appt!.startsAt.toISOString()).toBe("2026-06-02T12:00:00.000Z");
    const logs = await testDb.select().from(auditLogs).where(and(eq(auditLogs.entity, "appointment"), eq(auditLogs.action, "update")));
    expect(logs).toHaveLength(1);
  });

  it("permet de valider, corriger ou ignorer un rapprochement", async () => {
    const user = await setup();
    await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    const matches = await testDb
      .select({ m: appointmentMatches, e: calendarEvents })
      .from(appointmentMatches)
      .innerJoin(calendarEvents, eq(calendarEvents.id, appointmentMatches.calendarEventId));
    const centre = matches.find((r) => r.e.title === "Pharmacie du Centre")!;
    expect(centre.m.status).toBe("pending");
    expect(centre.m.candidates.length).toBeGreaterThanOrEqual(2);

    // « Choisir une autre pharmacie » : on prend le 2e candidat
    const other = centre.m.candidates.find((c) => c.pharmacyId !== centre.m.pharmacyId)!;
    await validateMatch(testDb, user, centre.m.id, other.pharmacyId);
    const [appt] = await testDb.select().from(appointments).where(eq(appointments.calendarEventId, centre.e.id));
    expect(appt!.pharmacyId).toBe(other.pharmacyId);

    // Ignorer un rendez-vous validé automatiquement retire le rendez-vous créé
    const lemoine = matches.find((r) => r.e.title === "RDV Pharmacie Lemoine")!;
    await ignoreMatch(testDb, user, lemoine.m.id);
    const remaining = await testDb.select().from(appointments).where(eq(appointments.calendarEventId, lemoine.e.id));
    expect(remaining).toHaveLength(0);

    // Un réimport ne revient pas sur les décisions
    const again = await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    expect(again.appointmentsCreated).toBe(0);
    const [ignored] = await testDb.select().from(appointmentMatches).where(eq(appointmentMatches.id, lemoine.m.id));
    expect(ignored!.status).toBe("ignored");
  });

  it("relance le rapprochement après ajout d'une pharmacie au référentiel", async () => {
    const user = await setup();
    await importCalendarFile(testDb, user, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    await importPharmacyCsv(testDb, user.id, {
      name: "ajout.csv",
      bytes: bytes("Nom;Code postal;Ville\nPharmacie des Remparts;14500;Vire"),
    });
    const res = await rematchOpenEvents(testDb, user);
    expect(res.auto_validated).toBe(1);
    expect(res.appointmentsCreated).toBe(1);
  });
});

describe("suppression du compte", () => {
  beforeEach(resetDatabase);

  it("supprime en cascade toutes les données de l'utilisatrice, et seulement les siennes", async () => {
    const a = await createTestUser("a@example.test");
    const b = await createTestUser("b@example.test");
    for (const u of [a, b]) {
      await importPharmacyCsv(testDb, u.id, { name: "p.csv", bytes: bytes(PHARMACIES_CSV) });
      await importCalendarFile(testDb, u, { name: "agenda.ics", bytes: bytes(ICS) }, { now });
    }
    const { users } = await import("@/server/db/schema");
    await testDb.delete(users).where(eq(users.id, a.id));
    const remaining = async (table: typeof pharmacies | typeof appointments | typeof calendarEvents | typeof appointmentMatches | typeof auditLogs) =>
      (await testDb.select({ u: table.userId }).from(table)).map((r) => r.u);
    for (const table of [pharmacies, appointments, calendarEvents, appointmentMatches, auditLogs]) {
      const owners = await remaining(table);
      expect(owners.length).toBeGreaterThan(0);
      expect(owners.every((o) => o === b.id)).toBe(true);
    }
  });
});

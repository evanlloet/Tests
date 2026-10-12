import { describe, expect, it } from "vitest";
import { addDays, dayKeyOf, diffDays, isoWeekday, startOfIsoWeek, timeOfDay, zonedDateTime } from "./time";
import { easterSunday, publicHolidayName } from "./holidays";

describe("fuseau Europe/Paris", () => {
  it("convertit une heure locale en instant UTC (été et hiver)", () => {
    expect(zonedDateTime("2026-07-01", "09:00").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedDateTime("2026-12-01", "09:00").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });
  it("retrouve le jour et l'heure locaux", () => {
    const d = new Date("2026-10-12T22:30:00Z");
    expect(dayKeyOf(d)).toBe("2026-10-13");
    expect(timeOfDay(d)).toBe("00:30");
  });
  it("gère les changements d'heure", () => {
    // 25 octobre 2026 : passage à l'heure d'hiver
    expect(zonedDateTime("2026-10-24", "10:00").toISOString()).toBe("2026-10-24T08:00:00.000Z");
    expect(zonedDateTime("2026-10-26", "10:00").toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });
  it("calcule les jours de semaine ISO", () => {
    expect(isoWeekday("2026-10-12")).toBe(1);
    expect(isoWeekday("2026-10-18")).toBe(7);
    expect(startOfIsoWeek("2026-10-15")).toBe("2026-10-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-10-12", "2026-12-01")).toBe(50);
  });
});

describe("jours fériés", () => {
  it("calcule Pâques et les fériés mobiles", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(publicHolidayName("2026-04-06")).toBe("Lundi de Pâques");
    expect(publicHolidayName("2026-05-14")).toBe("Ascension");
    expect(publicHolidayName("2026-11-11")).toBe("Armistice 1918");
    expect(publicHolidayName("2026-10-12")).toBeNull();
  });
});

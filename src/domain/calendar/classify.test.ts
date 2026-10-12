import { describe, expect, it } from "vitest";
import { classifyEvent } from "./classify";

const ev = (title: string, extra: Partial<Parameters<typeof classifyEvent>[0]> = {}) => ({
  title,
  location: null,
  allDay: false,
  isCancelled: false,
  start: new Date("2026-06-15T07:00:00Z"),
  end: new Date("2026-06-15T07:45:00Z"),
  ...extra,
});

describe("classement des événements", () => {
  it("reconnaît une visite en pharmacie", () => {
    expect(classifyEvent(ev("RDV Pharmacie Lemoine")).classification).toBe("visit");
  });
  it("écarte congés, réunions et rendez-vous personnels", () => {
    expect(classifyEvent(ev("Congés")).classification).toBe("not_visit");
    expect(classifyEvent(ev("Réunion d'équipe Teams")).classification).toBe("not_visit");
    expect(classifyEvent(ev("Dentiste")).classification).toBe("not_visit");
  });
  it("écarte les événements annulés et les journées entières", () => {
    expect(classifyEvent(ev("Pharmacie Lemoine", { isCancelled: true })).reason).toBe("Événement annulé");
    expect(classifyEvent(ev("Salon", { allDay: true })).classification).toBe("not_visit");
  });
  it("laisse indéterminé un titre sans indice", () => {
    expect(classifyEvent(ev("Lemoine Caen")).classification).toBe("unknown");
  });
  it("ne rejette pas une visite qui mentionne aussi une réunion", () => {
    expect(classifyEvent(ev("Réunion pharmacie du Centre")).classification).toBe("visit");
  });
});

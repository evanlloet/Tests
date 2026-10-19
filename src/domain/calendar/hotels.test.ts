import { describe, expect, it } from "vitest";
import { extractHotelNights, hotelName, isHotelBooking, parseHotelAddress } from "./hotels";

const allDay = (title: string, from: string, to: string, location: string | null = null) => ({
  title,
  location,
  allDay: true,
  start: new Date(`${from}T00:00:00+02:00`),
  end: new Date(`${to}T00:00:00+02:00`),
});

describe("nuits d'hôtel lues dans l'agenda", () => {
  it("reconnaît une réservation et ignore les trajets", () => {
    expect(isHotelBooking(allDay("JEANNE TEST - ibis Caen Centre, 1234ABC0500", "2026-09-28", "2026-09-30"))).toBe(true);
    expect(isHotelBooking(allDay("JEANNE TEST - TGV INOUI Paris", "2026-09-28", "2026-09-29"))).toBe(false);
    expect(isHotelBooking({ ...allDay("Hôtel à réserver", "2026-09-28", "2026-09-29"), allDay: false })).toBe(false);
  });

  it("compte une nuit par soir entre l'arrivée et le départ (lundi + mardi)", () => {
    const nights = extractHotelNights(
      [
        allDay("JEANNE TEST - ibis Caen Centre, 1234ABC0500", "2026-09-28", "2026-09-30", "1 rue de l'Exemple, Caen, Normandy, 14000, FRA"),
        allDay("JEANNE TEST - ibis Cherbourg, 9876XYZ0502", "2026-09-29", "2026-10-01", "2 rue de l'Exemple, Cherbourg-en-Cotentin, Normandy, 50100, FRA"),
        // Réservation en double pour le même soir : comptée une fois
        allDay("JEANNE TEST - ibis Caen Centre, 1234ABC0501", "2026-09-28", "2026-09-30"),
        allDay("JEANNE TEST - Le Gîte du Test", "2026-10-05", "2026-10-08", "3 place de l'Exemple, 61000 Alençon"),
      ],
      "Europe/Paris",
    );
    expect(nights.map((n) => n.night)).toEqual(["2026-09-28", "2026-09-29", "2026-10-05", "2026-10-06"]);
    expect(nights[0]).toMatchObject({ hotel: "ibis Caen Centre", city: "Caen", departmentCode: "14" });
    expect(nights[1]!.departmentCode).toBe("50");
    expect(nights[0]!.location).not.toBeNull();
  });

  it("lit l'adresse et le nom de l'établissement", () => {
    expect(parseHotelAddress("1 Rue Du Fresne, Bretteville-sur-Odon, Normandy, 14760, FRA")).toEqual({ postalCode: "14760", city: "Bretteville-sur-Odon" });
    expect(parseHotelAddress("12 rue de la Paix, 50200 Coutances")).toEqual({ postalCode: "50200", city: "Coutances" });
    expect(hotelName("JEANNE TEST - Hôtel ibis Alençon, 0982ZED508")).toBe("ibis Alençon");
  });
});

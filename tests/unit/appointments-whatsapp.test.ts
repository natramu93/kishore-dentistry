import { describe, expect, it } from "vitest";
import { buildAppointmentWhatsAppUrl, normalizeWhatsAppNumber } from "@/lib/appointments/whatsapp";

describe("appointment WhatsApp message", () => {
  it("normalizes Indian mobile numbers and includes appointment and center details", () => {
    const url = new URL(buildAppointmentWhatsAppUrl({
      patientName: "A Patient",
      patientMobile: "+91 93611 35459",
      scheduledAt: "2026-09-24T10:00:00.000Z",
      centerName: "Dr. Kishor's Dentistry Pvt Ltd — Tiruppur",
      centerAddress: "No. 541, Tiruppur",
      centerPhone: "9361135459",
    }));

    expect(url.origin + url.pathname).toBe("https://wa.me/919361135459");
    expect(url.searchParams.get("text")).toContain("Thursday, 24 September 2026 at 3:30 PM (IST)");
    expect(url.searchParams.get("text")).toContain("Center: Dr. Kishor's Dentistry Pvt Ltd — Tiruppur");
    expect(url.searchParams.get("text")).toContain("Address: No. 541, Tiruppur");
    expect(url.searchParams.get("text")).toContain("Contact: 9361135459");
  });

  it("supports leading-zero local numbers and leaves an incomplete number for manual recipient selection", () => {
    expect(normalizeWhatsAppNumber("09361135459")).toBe("919361135459");
    expect(normalizeWhatsAppNumber("9361135")).toBeNull();

    const url = new URL(buildAppointmentWhatsAppUrl({
      patientName: "Patient",
      patientMobile: "9361135",
      scheduledAt: "2026-09-24T10:00:00.000Z",
      centerName: "Tiruppur Center",
      centerAddress: null,
      centerPhone: null,
    }));
    expect(url.origin + url.pathname).toBe("https://wa.me/");
    expect(url.searchParams.get("text")).toContain("Center: Tiruppur Center");
  });
});

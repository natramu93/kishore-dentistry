import { describe, expect, it } from "vitest";
import { buildAppointmentWhatsAppUrl, normalizeWhatsAppNumber } from "@/lib/appointments/whatsapp";

describe("appointment WhatsApp message", () => {
  it.each([["Mr","Mr."],["Ms","Ms."],["Mrs","Mrs."],["Baby","Baby"],["Master","Master"]])("includes the saved %s title in the prepared greeting", (patientTitle,label) => {
    const url=new URL(buildAppointmentWhatsAppUrl({ patientName:"tEST PATIENT",patientTitle,patientMobile:"9000000000",scheduledAt:"2026-10-14T10:00:00Z",centerName:"Test Center",centerAddress:null,centerPhone:null }));
    expect(url.searchParams.get("text")).toContain(`Hello ${label} Test Patient,`);
    expect(url.searchParams.get("text")).toContain("3:30 PM (IST)");
  });
  it("keeps a title embedded in an older name from appearing twice", () => {
    const url=new URL(buildAppointmentWhatsAppUrl({ patientName:"Mr. TEST PATIENT",patientTitle:"Mr",patientMobile:"9000000000",scheduledAt:"2026-10-14T10:00:00Z",centerName:"Test Center",centerAddress:null,centerPhone:null }));
    expect(url.searchParams.get("text")).toContain("Hello Mr. Test Patient,");
    expect(url.searchParams.get("text")).not.toContain("Mr. Mr.");
  });
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

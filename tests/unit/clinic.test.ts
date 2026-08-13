import { describe, expect, it } from "vitest";
import {
  TIRUPUR_CLINIC,
  addressLinesFromSnapshot,
  getTelephoneHref,
} from "@/lib/clinic";

describe("Tirupur clinic identity", () => {
  it("keeps the canonical public contact details in one exact configuration", () => {
    expect(TIRUPUR_CLINIC).toMatchObject({
      brandName: "Dr. Kishor's Dentistry",
      officialName: "DR. KISHOR'S DENTISTRY - TIRUPUR",
      branchName: "Tirupur",
      branchCode: "TUP",
      timezone: "Asia/Kolkata",
      phoneDisplay: "9361135459",
      phoneE164: "+919361135459",
      phoneHref: "tel:+919361135459",
    });
    expect(TIRUPUR_CLINIC.addressLines).toEqual([
      "No-541, 543/338-34, 1st floor, Aadhaar Hospital,",
      "Opp to KR Bakes, Puspha Theatre Bus stop,",
      "Tirupur – 641602.",
    ]);
    expect(TIRUPUR_CLINIC.address).toBe(
      TIRUPUR_CLINIC.addressLines.join("\n")
    );
  });

  it("builds HTTPS map links whose decoded destination contains the full clinic identity", () => {
    const mapsUrl = new URL(TIRUPUR_CLINIC.mapsHref);
    expect(mapsUrl.protocol).toBe("https:");
    expect(mapsUrl.hostname).toBe("www.google.com");
    expect(mapsUrl.pathname).toBe("/maps/search/");
    expect(mapsUrl.searchParams.get("api")).toBe("1");
    expect(mapsUrl.searchParams.get("query")).toBe(
      [TIRUPUR_CLINIC.officialName, ...TIRUPUR_CLINIC.addressLines].join(" ")
    );

    const directionsUrl = new URL(TIRUPUR_CLINIC.directionsHref);
    expect(directionsUrl.protocol).toBe("https:");
    expect(directionsUrl.hostname).toBe("www.google.com");
    expect(directionsUrl.pathname).toBe("/maps/dir/");
    expect(directionsUrl.searchParams.get("api")).toBe("1");
    expect(directionsUrl.searchParams.get("destination")).toBe(
      mapsUrl.searchParams.get("query")
    );
  });

  it("normalizes safe telephone snapshots and rejects unsafe or malformed values", () => {
    expect(getTelephoneHref("+91 93611 35459")).toBe("tel:+919361135459");
    expect(getTelephoneHref("93611-35459")).toBe("tel:9361135459");
    expect(getTelephoneHref("javascript:alert(1)")).toBeNull();
    expect(getTelephoneHref("123456")).toBeNull();
    expect(getTelephoneHref(null)).toBeNull();

    expect(
      addressLinesFromSnapshot(" First line \r\n\r\n Second line\n ")
    ).toEqual(["First line", "Second line"]);
  });
});

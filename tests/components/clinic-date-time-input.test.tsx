import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClinicDateTimeInput } from "@/components/appointments/clinic-date-time-input";
afterEach(cleanup);

describe("explicit AM/PM date and time input", () => {
  it("shows an existing evening appointment in 12 hours and preserves its submitted value", () => {
    const { container }=render(<form><ClinicDateTimeInput id="appointment-time" name="scheduled_at" label="Date & time (IST)" defaultValue="2017-01-01T19:30" required /></form>);
    expect(screen.getByRole("group",{ name:"Date & time (IST)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hour")).toHaveValue("7");
    expect(screen.getByLabelText("Minute")).toHaveValue("30");
    expect(screen.getByLabelText("AM / PM")).toHaveValue("PM");
    expect(new FormData(container.querySelector("form")!).get("scheduled_at")).toBe("2017-01-01T19:30");
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });
  it("requires AM/PM explicitly and converts new selections correctly", () => {
    const { container }=render(<form><ClinicDateTimeInput id="appointment-time" name="scheduled_at" label="Date & time (IST)" required /></form>);
    const form=container.querySelector("form")!;
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(screen.getByLabelText("Date"),{ target:{ value:"2026-10-13" } });
    fireEvent.change(screen.getByLabelText("Hour"),{ target:{ value:"12" } });
    expect(new FormData(form).get("scheduled_at")).toBe("");
    fireEvent.change(screen.getByLabelText("AM / PM"),{ target:{ value:"AM" } });
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get("scheduled_at")).toBe("2026-10-13T00:00");
    fireEvent.change(screen.getByLabelText("AM / PM"),{ target:{ value:"PM" } });
    expect(new FormData(form).get("scheduled_at")).toBe("2026-10-13T12:00");
  });
  it("blocks editing and submission of a disabled clock", () => {
    const { container }=render(<form><ClinicDateTimeInput id="time" name="due_at" label="Due (IST)" defaultValue="2026-10-13T09:00" disabled /></form>);
    expect(screen.getByLabelText("Hour")).toBeDisabled();
    expect(screen.getByLabelText("Date")).toBeDisabled();
    expect(new FormData(container.querySelector("form")!).has("due_at")).toBe(false);
  });
});

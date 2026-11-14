import { expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth/context";
import { getDashboardData, getDoctorDashboardData } from "@/data/dashboard";
import { listMyTreatments } from "@/data/doctor-portal";
import { listInvoices } from "@/data/invoices";

vi.mock("server-only", () => ({}));
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/data/db", () => ({ db }));
const doctor = { role: "doctor", userId: "doctor-user", doctorId: "doctor-record", branchIds: [] } as unknown as AuthContext;

it("returns clinical dashboard counts without returning the legacy revenue field", async () => {
  db.rpc.mockResolvedValueOnce({ data: [{ todays_appointments: 1, week_appointments: 4, patients_treated: 6, revenue_generated: 9000 }], error: null });
  expect(await getDoctorDashboardData(doctor)).toEqual({ todaysAppointments: 1, weekAppointments: 4, patientsTreated: 6 });
});

it("requests only clinical fields for the doctor's treatment list", async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }) };
  db.from.mockReturnValueOnce(query);
  await listMyTreatments(doctor);
  expect(query.select.mock.calls[0][0]).not.toMatch(/\*|\bcost\b|invoice/);
  expect(query.eq).toHaveBeenCalledWith("doctor_id", doctor.doctorId);
});

it("denies doctors access to billing lists and the business dashboard", async () => {
  await expect(listInvoices(doctor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(getDashboardData(doctor)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

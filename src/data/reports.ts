import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { clinicToday } from "@/lib/tz";
import { formatInTimeZone } from "date-fns-tz";
import { CLINIC_TZ } from "@/lib/tz";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export type ReportRow = {
  key: string;
  label: string;
  leads: number;
  appointments: number;
  followUps: number;
  revenue: number;
};

export type ReportsData = {
  byDoctor: ReportRow[];
  byCenter: ReportRow[];
  byDay: ReportRow[];
  byTreatment: ReportRow[];
  totals: { leads: number; appointments: number; followUps: number; revenue: number };
};

function branchScope(ctx: AuthContext): string[] | null {
  if (ctx.role === "admin") return null;
  return ctx.branchIds.length ? ctx.branchIds : [EMPTY_UUID];
}

/**
 * Revenue is measured as the sum of `treatments.cost` (the cost recorded at
 * the point of care) rather than invoice totals, since not every treatment
 * has an invoice raised for it yet — cost is the earliest reliable signal.
 */
export async function getReportsData(
  ctx: AuthContext,
  opts: { days?: number } = {}
): Promise<ReportsData> {
  const scope = branchScope(ctx);
  const days = opts.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let leadsQ = db.from("leads").select("id, branch_id, created_at");
  let apptQ = db.from("appointments").select("id, branch_id, doctor_id, lead_id, scheduled_at, status");
  let treatQ = db
    .from("treatments")
    .select("id, branch_id, doctor_id, lead_id, treatment_type_id, appointment_id, cost, treated_at");
  let fuQ = db.from("follow_ups").select("id, branch_id, lead_id, due_at, status");

  if (scope) {
    leadsQ = leadsQ.in("branch_id", scope);
    apptQ = apptQ.in("branch_id", scope);
    treatQ = treatQ.in("branch_id", scope);
    fuQ = fuQ.in("branch_id", scope);
  }

  const [
    { data: leads },
    { data: appointments },
    { data: treatments },
    { data: followUps },
    { data: doctors },
    { data: branches },
    { data: treatmentTypes },
  ] = await Promise.all([
    leadsQ,
    apptQ,
    treatQ,
    fuQ,
    db.from("doctors").select("id, full_name, branch_id"),
    db.from("branches").select("id, name"),
    db.from("treatment_types").select("id, name, category"),
  ]);

  const doctorName = new Map((doctors ?? []).map((d) => [d.id, d.full_name]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const treatmentName = new Map((treatmentTypes ?? []).map((t) => [t.id, t.name]));

  const allLeads = leads ?? [];
  const allAppts = appointments ?? [];
  const allTreatments = treatments ?? [];
  const allFollowUps = followUps ?? [];

  // Map lead -> doctor(s) it was seen by, so leads/follow-ups can roll up per doctor.
  const leadToDoctors = new Map<string, Set<string>>();
  for (const a of allAppts) {
    if (!a.doctor_id) continue;
    if (!leadToDoctors.has(a.lead_id)) leadToDoctors.set(a.lead_id, new Set());
    leadToDoctors.get(a.lead_id)!.add(a.doctor_id);
  }
  for (const t of allTreatments) {
    if (!t.doctor_id) continue;
    if (!leadToDoctors.has(t.lead_id)) leadToDoctors.set(t.lead_id, new Set());
    leadToDoctors.get(t.lead_id)!.add(t.doctor_id);
  }

  type Accumulator = Map<string, ReportRow>;
  const bump = (acc: Accumulator, key: string, label: string, field: keyof Omit<ReportRow, "key" | "label">, amount = 1) => {
    if (!acc.has(key)) acc.set(key, { key, label, leads: 0, appointments: 0, followUps: 0, revenue: 0 });
    acc.get(key)![field] += amount;
  };

  // ---------- By doctor ----------
  const byDoctorAcc: Accumulator = new Map();
  for (const a of allAppts) {
    if (!a.doctor_id) continue;
    bump(byDoctorAcc, a.doctor_id, doctorName.get(a.doctor_id) ?? "Unknown", "appointments");
  }
  for (const t of allTreatments) {
    if (!t.doctor_id) continue;
    bump(byDoctorAcc, t.doctor_id, doctorName.get(t.doctor_id) ?? "Unknown", "revenue", t.cost ?? 0);
  }
  // Unique patients + follow-ups per doctor (derived from leadToDoctors)
  const doctorPatientSets = new Map<string, Set<string>>();
  for (const [leadId, docIds] of leadToDoctors) {
    for (const docId of docIds) {
      if (!doctorPatientSets.has(docId)) doctorPatientSets.set(docId, new Set());
      doctorPatientSets.get(docId)!.add(leadId);
    }
  }
  for (const [docId, leadSet] of doctorPatientSets) {
    bump(byDoctorAcc, docId, doctorName.get(docId) ?? "Unknown", "leads", leadSet.size);
    const fuCount = allFollowUps.filter((f) => leadSet.has(f.lead_id)).length;
    bump(byDoctorAcc, docId, doctorName.get(docId) ?? "Unknown", "followUps", fuCount);
  }

  // ---------- By center (branch) ----------
  const byCenterAcc: Accumulator = new Map();
  for (const l of allLeads) bump(byCenterAcc, l.branch_id, branchName.get(l.branch_id) ?? "Unknown", "leads");
  for (const a of allAppts) bump(byCenterAcc, a.branch_id, branchName.get(a.branch_id) ?? "Unknown", "appointments");
  for (const f of allFollowUps) bump(byCenterAcc, f.branch_id, branchName.get(f.branch_id) ?? "Unknown", "followUps");
  for (const t of allTreatments) {
    bump(byCenterAcc, t.branch_id, branchName.get(t.branch_id) ?? "Unknown", "revenue", t.cost ?? 0);
  }

  // ---------- By day (trailing window) ----------
  const dayKey = (iso: string) => formatInTimeZone(iso, CLINIC_TZ, "yyyy-MM-dd");
  const dayLabel = (key: string) => formatInTimeZone(`${key}T00:00:00Z`, CLINIC_TZ, "d MMM");
  const byDayAcc: Accumulator = new Map();
  for (const l of allLeads) {
    if (l.created_at < since) continue;
    const k = dayKey(l.created_at);
    bump(byDayAcc, k, dayLabel(k), "leads");
  }
  for (const a of allAppts) {
    if (a.scheduled_at < since) continue;
    const k = dayKey(a.scheduled_at);
    bump(byDayAcc, k, dayLabel(k), "appointments");
  }
  for (const f of allFollowUps) {
    if (f.due_at < since) continue;
    const k = dayKey(f.due_at);
    bump(byDayAcc, k, dayLabel(k), "followUps");
  }
  for (const t of allTreatments) {
    if (t.treated_at < since) continue;
    const k = dayKey(t.treated_at);
    bump(byDayAcc, k, dayLabel(k), "revenue", t.cost ?? 0);
  }

  // ---------- By treatment type ----------
  const byTreatmentAcc: Accumulator = new Map();
  const treatmentPatients = new Map<string, Set<string>>();
  for (const t of allTreatments) {
    if (!t.treatment_type_id) continue;
    const name = treatmentName.get(t.treatment_type_id) ?? "Unknown";
    bump(byTreatmentAcc, t.treatment_type_id, name, "revenue", t.cost ?? 0);
    if (!treatmentPatients.has(t.treatment_type_id)) treatmentPatients.set(t.treatment_type_id, new Set());
    treatmentPatients.get(t.treatment_type_id)!.add(t.lead_id);
    const linkedAppt = allAppts.find((a) => a.id === t.appointment_id);
    if (linkedAppt) bump(byTreatmentAcc, t.treatment_type_id, name, "appointments");
  }
  for (const [typeId, leadSet] of treatmentPatients) {
    bump(byTreatmentAcc, typeId, treatmentName.get(typeId) ?? "Unknown", "leads", leadSet.size);
  }

  const sortDesc = (rows: Accumulator) =>
    [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.appointments - a.appointments);

  const byDay = [...byDayAcc.values()].sort((a, b) => (a.key < b.key ? -1 : 1));

  return {
    byDoctor: sortDesc(byDoctorAcc),
    byCenter: sortDesc(byCenterAcc),
    byDay,
    byTreatment: sortDesc(byTreatmentAcc),
    totals: {
      leads: allLeads.length,
      appointments: allAppts.length,
      followUps: allFollowUps.length,
      revenue: allTreatments.reduce((s, t) => s + (t.cost ?? 0), 0),
    },
  };
}

export function reportRangeLabel(days: number): string {
  const today = clinicToday();
  return `Last ${days} days (as of ${today})`;
}

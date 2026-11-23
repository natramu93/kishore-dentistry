import "server-only";

import type { AuthContext } from "@/lib/auth/context";
import { assertBranchAccess, canReadInvoice } from "@/lib/auth/guards";
import { assertUuid, normalizePagination } from "@/lib/validation";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { db } from "./db";

const PAGE_SIZE = 15;
const serviceFields = "bill_number,billed_at,service_names";
const billingFields = "bill_number,billed_at,service_names,gross_paise,discount_paise,tax_paise,net_paise,service_lines";

async function authorize(ctx: AuthContext, id: string) {
  const leadId = assertUuid(id, "Patient");
  const lead = await db.from("leads").select("id,branch_id,assignee_id").eq("id", leadId).is("deleted_at", null).maybeSingle();
  if (lead.error) throw lead.error;
  if (!lead.data) throw new NotFoundError("Patient");
  const branchId = lead.data.branch_id;
  if (ctx.role === "doctor") {
    const doctorId = ctx.doctorId;
    if (!doctorId) throw new AuthorizationError("Linked doctor access required");
    assertBranchAccess(ctx, branchId);
    const [appointment, treatment] = await Promise.all([
      db.from("appointments").select("id").eq("lead_id", leadId).eq("branch_id", branchId).eq("doctor_id", doctorId)
        .in("status", ["scheduled", "completed"]).limit(1).maybeSingle(),
      db.from("treatments").select("id").eq("lead_id", leadId).eq("branch_id", branchId).eq("doctor_id", doctorId).limit(1).maybeSingle(),
    ]);
    if (appointment.error) throw appointment.error;
    if (treatment.error) throw treatment.error;
    if (!appointment.data && !treatment.data) throw new NotFoundError("Patient history");
  } else if (!canReadInvoice(ctx, lead.data)) {
    throw new AuthorizationError("No access to patient billing history");
  }
  return { leadId, branchId };
}

export async function listLegacyPatientBills(ctx: AuthContext, id: string, pageValue?: number) {
  const { leadId, branchId } = await authorize(ctx, id);
  let { page } = normalizePagination(pageValue, PAGE_SIZE);
  const read = () => {
    const table = db.from("legacy_patient_bills");
    const query = ctx.role === "doctor" ? table.select(serviceFields, { count: "exact" }) : table.select(billingFields, { count: "exact" });
    return query.eq("lead_id", leadId).eq("branch_id", branchId).order("billed_at", { ascending: false }).order("bill_number")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  };
  let result = await read();
  if (result.error) throw result.error;
  const last = Math.max(1, Math.ceil((result.count ?? 0) / PAGE_SIZE));
  if (page > last) {
    page = last;
    result = await read();
    if (result.error) throw result.error;
  }
  return { records: result.data ?? [], page, pageSize: PAGE_SIZE, total: result.count ?? 0 };
}

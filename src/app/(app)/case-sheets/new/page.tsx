import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import {
  getCaseSheetFormContext,
  listTreatmentCodes,
} from "@/data/case-sheets";
import { listDoctors } from "@/data/catalogs";
import { CaseSheetEditor } from "@/components/clinical/case-sheet-editor";
import { toClinicInputValue } from "@/lib/tz";

export const metadata: Metadata = {
  title: "New Digital Case Sheet — Dr. Kishor's Dentistry CRM",
};

export default async function NewCaseSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; appointment?: string }>;
}) {
  const params = await searchParams;
  if (!params.appointment) notFound();

  const ctx = await getAuthContext();
  const scope = await getCaseSheetFormContext(ctx, {
    leadId: params.lead,
    appointmentId: params.appointment,
  });
  const [treatmentCodes, branchDoctors] = await Promise.all([
    listTreatmentCodes(ctx),
    ctx.role === "doctor"
      ? Promise.resolve([])
      : listDoctors(ctx, { branchId: scope.lead.branch_id }),
  ]);
  const doctors =
    ctx.role === "doctor" && ctx.doctorId
      ? [{ id: ctx.doctorId, label: "Treating doctor (you)" }]
      : branchDoctors
          .filter((doctor) => (
            !scope.appointment?.doctor_id || doctor.id === scope.appointment.doctor_id
          ))
          .map((doctor) => ({ id: doctor.id, label: doctor.full_name }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Digital case sheet</h1>
        <p className="text-sm text-muted-foreground">
          {scope.lead.name} · {scope.lead.mobile} · {scope.lead.branch?.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every treatment line must use an approved TMT code. Finalized clinical entries are
          retained as patient history and cannot be silently overwritten.
        </p>
      </div>
      <CaseSheetEditor
        leadId={scope.lead.id}
        appointmentId={scope.appointment?.id ?? null}
        doctors={doctors}
        doctorLocked={Boolean(scope.appointment?.doctor_id)}
        treatmentCodes={treatmentCodes}
        initialVisitAt={toClinicInputValue(
          scope.appointment?.scheduled_at ?? new Date().toISOString()
        )}
        successHref={ctx.role === "doctor" ? "/my-patients" : `/leads/${scope.lead.id}`}
      />
    </div>
  );
}

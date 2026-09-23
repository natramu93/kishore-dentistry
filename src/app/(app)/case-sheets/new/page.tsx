import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import {
  getCaseSheetFormContext,
  listTreatmentCodes,
} from "@/data/case-sheets";
import { listDoctors } from "@/data/catalogs";
import { CaseSheetEditor } from "@/components/clinical/case-sheet-editor";

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
          Use the Indian Standard tooth chart for general findings and future planning. Any
          treatment added must use an approved ICD-10 dental code. Multiple teeth can be selected
          for one treatment, and pricing is entered only when the invoice is generated.
        </p>
      </div>
      <CaseSheetEditor
        key={scope.appointment?.id ?? scope.lead.id}
        leadId={scope.lead.id}
        appointmentId={scope.appointment?.id ?? null}
        doctors={doctors}
        doctorLocked={Boolean(scope.appointment?.doctor_id)}
        treatmentCodes={treatmentCodes}
        canPrescribe={ctx.role === "doctor"}
        initialMedicalHistory={scope.medicalHistory}
        successHref={ctx.role === "doctor" ? `/my-patients/${scope.lead.id}` : `/leads/${scope.lead.id}`}
      />
    </div>
  );
}

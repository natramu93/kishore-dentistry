import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth/context";
import { getCaseSheetForEdit, listTreatmentCodes } from "@/data/case-sheets";
import { CaseSheetEditor } from "@/components/clinical/case-sheet-editor";

export const metadata: Metadata = {
  title: "Amend Digital Case Sheet — Dr. Kishor's Dentistry CRM",
};

export default async function EditCaseSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, ctx] = await Promise.all([params, getAuthContext()]);
  const record = await getCaseSheetForEdit(ctx, id);
  const treatmentCodes = await listTreatmentCodes(ctx);
  const doctors = [{
    id: record.caseSheet.doctor_id,
    label: ctx.role === "doctor" ? "Treating doctor (you)" : record.doctorName ?? "Treating doctor",
  }];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Amend digital case sheet</h1>
        <p className="text-sm text-muted-foreground">
          {record.lead.name} · {record.lead.branch?.name} · {record.doctorName ?? "Treating doctor"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Visit time remains unchanged. Every amendment requires a reason and is retained with its prior version.
        </p>
      </div>
      <CaseSheetEditor
        key={`${record.caseSheet.id}-${record.caseSheet.version}`}
        leadId={record.lead.id}
        appointmentId={record.caseSheet.appointment_id}
        doctors={doctors}
        doctorLocked
        treatmentCodes={treatmentCodes}
        canPrescribe={ctx.role === "doctor"}
        caseSheetId={record.caseSheet.id}
        expectedVersion={record.caseSheet.version}
        initialValues={{
          doctorId: record.caseSheet.doctor_id,
          visitAt: record.caseSheet.visit_at,
          chiefComplaint: record.caseSheet.chief_complaint ?? "",
          findings: record.caseSheet.findings ?? "",
          diagnosis: record.caseSheet.diagnosis ?? "",
          plan: record.caseSheet.plan ?? "",
          medicalHistory: record.medicalHistory,
          prescriptions: record.prescriptions,
          toothAssessments: record.toothAssessments,
          treatments: record.treatments,
        }}
        successHref={ctx.role === "doctor" ? `/my-patients/${record.lead.id}` : `/leads/${record.lead.id}`}
      />
    </div>
  );
}

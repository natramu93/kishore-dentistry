// Hand-written types for the crm schema (supabase gen can't see non-exposed
// schemas until `crm` is added to the dashboard's Exposed schemas list).
// Keep in sync with supabase/migrations/*.sql.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// "manager"/"agent" remain valid enum values in the DB for backward
// compatibility (Postgres enum values can't be dropped) but are no longer
// assigned — all profiles have been migrated to the roles below.
export type UserRole = "admin" | "operations" | "front_office" | "clinical_head" | "doctor";
export type LeadStatus =
  | "open"
  | "assigned"
  | "appointment_booked"
  | "visited_treated"
  | "follow_up"
  | "closed"
  | "dropped"
  | "missed";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no_show";
export type InvoiceStatus = "draft" | "sent" | "paid";
export type FollowUpStatus = "pending" | "done" | "cancelled";
export type CommentEntity = "lead" | "appointment" | "treatment" | "follow_up" | "invoice";
export type ToothState = "sound" | "present" | "missing" | "unerupted" | "impacted" | "retained_root" | "implant";
export type ToothPrognosis = "good" | "fair" | "guarded" | "poor" | "hopeless";
export type ToothRecommendedAction =
  | "monitor"
  | "investigate"
  | "preventive"
  | "restorative"
  | "endodontic"
  | "periodontal"
  | "surgical"
  | "prosthetic"
  | "orthodontic"
  | "referral"
  | "other";
export type MedicalHistoryReviewStatus =
  | "not_reviewed"
  | "reviewed_none"
  | "reviewed_conditions";
export type MedicalHistoryCondition =
  | "diabetes"
  | "hypertension"
  | "thyroid_disorder"
  | "pregnancy"
  | "kidney_disease"
  | "liver_disease"
  | "heart_condition"
  | "asthma"
  | "bleeding_disorder"
  | "allergies"
  | "other";
export type PrescriptionFoodTiming =
  | "before_food"
  | "after_food"
  | "with_food"
  | "not_applicable";
export type ClinicalAttachmentCategory =
  | "photograph"
  | "xray"
  | "scan"
  | "report"
  | "other";
export type ClinicalAttachmentStatus = "pending" | "ready" | "failed";
export type ReportAggregateRpcPayload = {
  by_doctor: Json;
  by_center: Json;
  by_day: Json;
  by_treatment: Json;
  totals: Json;
};

export type BusinessDashboardMetric =
  | "status"
  | "branch"
  | "source"
  | "interest"
  | "summary";

export type BusinessDashboardRpcRow = {
  metric: BusinessDashboardMetric;
  row_key: string;
  row_label: string;
  value: number;
};

export type DoctorDashboardRpcRow = {
  todays_appointments: number;
  week_appointments: number;
  patients_treated: number;
  revenue_generated: number;
};

type Timestamps = { created_at: string };

export type Branch = Timestamps & {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  company_name: string | null;
  invoice_email: string | null;
  gst_number: string | null;
  timezone: string;
  is_active: boolean;
  updated_at: string;
};

export type Profile = Timestamps & {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  updated_at: string;
};

export type UserBranch = Timestamps & {
  user_id: string;
  branch_id: string;
};

export type LeadSource = Timestamps & {
  id: string;
  name: string;
  is_active: boolean;
};

export type Doctor = Timestamps & {
  id: string;
  branch_id: string;
  full_name: string;
  specialization: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  updated_at: string;
  /** Linked login for the 'doctor' role — lets that user self-scope to this record. */
  profile_id: string | null;
};

export type TreatmentType = Timestamps & {
  id: string;
  name: string;
  category: string | null;
  default_cost: number | null;
  is_active: boolean;
};

export type TreatmentCode = Timestamps & {
  code: string;
  name: string;
  category: string | null;
  status: string;
  raw_metadata: string | null;
  source: string | null;
  code_system: "KISHORE_TREATMENT" | "ICD10_IN";
  code_level: "procedure" | "category" | "detail";
  billable: boolean;
  source_version: string;
};

export type Lead = Timestamps & {
  id: string;
  branch_id: string;
  source_id: string | null;
  name: string;
  email: string | null;
  mobile: string;
  age: number | null;
  dob: string | null;
  status: LeadStatus;
  assignee_id: string | null;
  interest_id: string | null;
  notes: string | null;
  created_by: string | null;
  status_changed_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

export type Appointment = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  doctor_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  notes: string | null;
  created_by: string | null;
  updated_at: string;
  external_source: string | null;
  external_appointment_id: string | null;
};

export type Treatment = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  appointment_id: string | null;
  treatment_type_id: string | null;
  doctor_id: string | null;
  cost: number | null;
  notes: string | null;
  treated_at: string;
  created_by: string | null;
  case_sheet_id: string | null;
  treatment_code: string | null;
  treatment_name: string | null;
  treatment_category: string | null;
  clinical_status: "planned" | "completed" | null;
  site_scope: "not_applicable" | "full_mouth" | "arch" | "quadrant" | "tooth" | "multi_tooth" | null;
  site_detail: string | null;
  tooth_number: string | null;
  tooth_numbers: string[];
  surfaces: string[] | null;
  diagnosis: string | null;
  quantity: number | null;
  performed_at: string | null;
  signed_at: string | null;
  signed_by: string | null;
};

export type CaseSheet = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  appointment_id: string;
  doctor_id: string;
  visit_at: string;
  chief_complaint: string | null;
  findings: string | null;
  diagnosis: string | null;
  plan: string | null;
  medical_alerts: string | null;
  finalized_at: string;
  signed_by: string;
  created_by: string;
  version: number;
  updated_at: string;
};

export type CaseSheetAmendment = {
  id: string;
  case_sheet_id: string;
  revision: number;
  reason: string;
  changed_by: string;
  changed_by_name: string;
  changed_at: string;
  old_data: Json;
  new_data: Json;
};

export type ToothAssessment = Timestamps & {
  id: string;
  case_sheet_id: string;
  lead_id: string;
  branch_id: string;
  appointment_id: string;
  doctor_id: string;
  tooth_number: string;
  tooth_state: ToothState;
  conditions: string[];
  surfaces: string[];
  clinical_findings: string | null;
  diagnosis: string | null;
  prognosis: ToothPrognosis | null;
  recommended_action: ToothRecommendedAction | null;
  future_plan: string | null;
  notes: string | null;
  assessed_at: string;
  signed_at: string;
  signed_by: string;
  created_by: string;
};

export type PatientMedicalHistoryVersion = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  review_status: MedicalHistoryReviewStatus;
  reviewed_with_patient: boolean;
  conditions: MedicalHistoryCondition[];
  description: string | null;
  recorded_at: string;
  recorded_by: string;
};

export type CaseSheetMedicalHistory = Timestamps & {
  case_sheet_id: string;
  medical_history_version_id: string;
  lead_id: string;
  branch_id: string;
  signed_at: string;
  signed_by: string;
};

export type PrescriptionItem = Timestamps & {
  id: string;
  case_sheet_id: string;
  lead_id: string;
  branch_id: string;
  appointment_id: string;
  doctor_id: string;
  line_number: number;
  medicine_name: string;
  strength: string | null;
  dosage: string | null;
  morning: boolean;
  noon: boolean;
  night: boolean;
  food_timing: PrescriptionFoodTiming;
  duration_days: number | null;
  instructions: string | null;
  prescribed_at: string;
  signed_at: string;
  signed_by: string;
  created_by: string;
};

export type CaseSheetAttachment = Timestamps & {
  id: string;
  case_sheet_id: string;
  treatment_id: string | null;
  lead_id: string;
  branch_id: string;
  category: ClinicalAttachmentCategory;
  bucket_id: "clinical-attachments";
  object_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256_hex: string | null;
  status: ClinicalAttachmentStatus;
  uploaded_at: string | null;
  created_by: string;
};

export type FollowUp = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  due_at: string;
  reason: string | null;
  status: FollowUpStatus;
  outcome_notes: string | null;
  completed_at: string | null;
  created_by: string | null;
};

export type Invoice = Timestamps & {
  id: string;
  invoice_number: string;
  lead_id: string;
  branch_id: string;
  treatment_id: string | null;
  status: InvoiceStatus;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  issued_at: string | null;
  paid_at: string | null;
  issuer_name: string;
  issuer_address: string | null;
  issuer_phone: string | null;
  issuer_email: string | null;
  issuer_gst_number: string | null;
  notes: string | null;
  created_by: string | null;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  version: number;
  code_enforced: boolean;
  invoice_kind: "clinical" | "consultation";
};

export type InvoiceItem = Timestamps & {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  treatment_id: string | null;
  treatment_type_id: string | null;
  treatment_code: string | null;
  treatment_name: string | null;
  treatment_category: string | null;
  case_sheet_id: string | null;
  tooth_number: string | null;
  tooth_numbers: string[] | null;
  site_scope: string | null;
  site_detail: string | null;
  surfaces: string[] | null;
  active_billing: boolean;
};

export type LeadActivity = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  actor_id: string | null;
  type: string;
  from_status: LeadStatus | null;
  to_status: LeadStatus | null;
  detail: Json;
};

export type Comment = Timestamps & {
  id: string;
  lead_id: string;
  branch_id: string;
  entity_type: CommentEntity;
  entity_id: string | null;
  body: string;
  author_id: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  version: number;
};

export type AuditLog = {
  id: number;
  entity_type:
    | "lead"
    | "appointment"
    | "treatment"
    | "follow_up"
    | "invoice"
    | "comment"
    | "profile"
    | "case_sheet"
    | "tooth_assessment";
  entity_id: string;
  action: string;
  actor_id: string | null;
  old_data: Json | null;
  new_data: Json | null;
  occurred_at: string;
};

export type ActionRateLimit = {
  actor_id: string;
  scope: string;
  window_started_at: string;
  expires_at: string;
  request_count: number;
  last_seen_at: string;
};

export type InvoicePaymentMethod = "upi" | "cash" | "card" | "neft";

export type InvoicePayment = Timestamps & {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: InvoicePaymentMethod;
  reference: string | null;
  notes: string | null;
  received_at: string;
  created_by: string | null;
};

export type WebhookEndpoint = Timestamps & {
  id: string;
  name: string;
  endpoint_key_hash: string;
  endpoint_key_prefix: string;
  secret_hash: string;
  secret_prefix: string;
  source_system: string;
  branch_id: string | null;
  is_active: boolean;
  last_received_at: string | null;
  last_event_at: string | null;
  created_by: string | null;
  updated_at: string;
};

export type WebhookEvent = Timestamps & {
  id: string;
  webhook_id: string;
  external_event_id: string | null;
  idempotency_key: string | null;
  http_method: string;
  content_type: string | null;
  headers: Json;
  body: Json | null;
  body_text: string | null;
  body_sha256: string;
  event_type: string | null;
  external_call_id: string | null;
  external_appointment_id: string | null;
  branch_id: string | null;
  lead_id: string | null;
  received_at: string;
  occurred_at: string | null;
  processed_at: string | null;
  processing_status: "received" | "processed" | "partial" | "failed";
  processing_error: string | null;
};

export type CallLog = Timestamps & {
  id: string;
  source_system: string;
  external_call_id: string;
  external_tenant_id: string | null;
  webhook_id: string | null;
  last_event_id: string | null;
  branch_id: string | null;
  lead_id: string | null;
  phone: string | null;
  normalized_mobile: string | null;
  caller_name: string | null;
  direction: "inbound" | "outbound" | "unknown";
  status: "ringing" | "in_progress" | "completed" | "failed" | "missed" | "no_answer" | "unknown";
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: Json | null;
  summary: string | null;
  disposition: string | null;
  hangup_cause: string | null;
  metadata: Json;
  updated_at: string;
};

export type CallLogStatusEvent = Timestamps & {
  id: string;
  call_log_id: string;
  webhook_event_id: string;
  status: CallLog["status"];
  occurred_at: string | null;
  payload: Json;
};

export type ExternalAppointment = Timestamps & {
  id: string;
  source_system: string;
  external_appointment_id: string;
  webhook_id: string | null;
  last_event_id: string | null;
  branch_id: string | null;
  lead_id: string | null;
  native_appointment_id: string | null;
  call_log_id: string | null;
  patient_name: string | null;
  mobile: string | null;
  normalized_mobile: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  doctor_name: string | null;
  status: "confirmed" | "scheduled" | "cancelled" | "completed" | "no_show" | "unknown";
  concern: string | null;
  metadata: Json;
  updated_at: string;
};

// Supabase client Database shape for `{ db: { schema: 'crm' } }` clients.
type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type TableDef<Row, Required extends keyof Row, Generated extends keyof Row, Rels extends Rel[] = []> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required | Generated>>;
  Update: Partial<Omit<Row, Generated>>;
  Relationships: Rels;
};

type FK<Name extends string, Col extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

type OneFK<Name extends string, Col extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: true;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

export type Database = {
  crm: {
    Tables: {
      branches: TableDef<Branch, "name" | "code", "id" | "created_at" | "updated_at">;
      profiles: TableDef<Profile, "id", "created_at" | "updated_at">;
      user_branches: TableDef<
        UserBranch,
        "user_id" | "branch_id",
        "created_at",
        [
          FK<"user_branches_user_id_fkey", "user_id", "profiles">,
          FK<"user_branches_branch_id_fkey", "branch_id", "branches">
        ]
      >;
      lead_sources: TableDef<LeadSource, "name", "id" | "created_at">;
      doctors: TableDef<
        Doctor,
        "branch_id" | "full_name",
        "id" | "created_at" | "updated_at",
        [
          FK<"doctors_branch_id_fkey", "branch_id", "branches">,
          FK<"doctors_profile_id_fkey", "profile_id", "profiles">
        ]
      >;
      treatment_types: TableDef<TreatmentType, "name", "id" | "created_at">;
      treatment_codes: TableDef<
        TreatmentCode,
        "code" | "name" | "status",
        "created_at"
      >;
      leads: TableDef<
        Lead,
        "branch_id" | "name" | "mobile",
        | "id"
        | "created_at"
        | "updated_at"
        | "status_changed_at"
        | "deleted_at"
        | "deleted_by"
        | "delete_reason",
        [
          FK<"leads_branch_id_fkey", "branch_id", "branches">,
          FK<"leads_source_id_fkey", "source_id", "lead_sources">,
          FK<"leads_assignee_id_fkey", "assignee_id", "profiles">,
          FK<"leads_interest_id_fkey", "interest_id", "treatment_types">,
          FK<"leads_created_by_fkey", "created_by", "profiles">
        ]
      >;
      appointments: TableDef<
        Appointment,
        "lead_id" | "scheduled_at",
        "id" | "created_at" | "updated_at" | "branch_id",
        [
          FK<"appointments_lead_id_fkey", "lead_id", "leads">,
          FK<"appointments_branch_id_fkey", "branch_id", "branches">,
          FK<"appointments_doctor_id_fkey", "doctor_id", "doctors">
        ]
      >;
      case_sheets: TableDef<
        CaseSheet,
        | "lead_id"
        | "branch_id"
        | "appointment_id"
        | "doctor_id"
        | "visit_at"
        | "finalized_at"
        | "signed_by"
        | "created_by",
        "id" | "created_at" | "version" | "updated_at",
        [
          FK<"case_sheets_lead_id_fkey", "lead_id", "leads">,
          FK<"case_sheets_branch_id_fkey", "branch_id", "branches">,
          FK<"case_sheets_appointment_id_fkey", "appointment_id", "appointments">,
          FK<"case_sheets_doctor_id_fkey", "doctor_id", "doctors">,
          FK<"case_sheets_signed_by_fkey", "signed_by", "profiles">,
          FK<"case_sheets_created_by_fkey", "created_by", "profiles">
        ]
      >;
      webhook_endpoints: TableDef<
        WebhookEndpoint,
        "name" | "endpoint_key_hash" | "endpoint_key_prefix" | "secret_hash" | "secret_prefix" | "source_system",
        "id" | "created_at" | "updated_at",
        [
          FK<"webhook_endpoints_branch_id_fkey", "branch_id", "branches">,
          FK<"webhook_endpoints_created_by_fkey", "created_by", "profiles">
        ]
      >;
      webhook_events: TableDef<
        WebhookEvent,
        "webhook_id" | "body_sha256",
        "id" | "created_at" | "received_at",
        [
          FK<"webhook_events_webhook_id_fkey", "webhook_id", "webhook_endpoints">,
          FK<"webhook_events_branch_id_fkey", "branch_id", "branches">,
          FK<"webhook_events_lead_id_fkey", "lead_id", "leads">
        ]
      >;
      call_logs: TableDef<
        CallLog,
        "source_system" | "external_call_id",
        "id" | "created_at" | "updated_at",
        [
          FK<"call_logs_webhook_id_fkey", "webhook_id", "webhook_endpoints">,
          FK<"call_logs_last_event_id_fkey", "last_event_id", "webhook_events">,
          FK<"call_logs_branch_id_fkey", "branch_id", "branches">,
          FK<"call_logs_lead_id_fkey", "lead_id", "leads">
        ]
      >;
      call_log_status_events: TableDef<
        CallLogStatusEvent,
        "call_log_id" | "webhook_event_id" | "status",
        "id" | "created_at",
        [
          FK<"call_log_status_events_call_log_id_fkey", "call_log_id", "call_logs">,
          FK<"call_log_status_events_webhook_event_id_fkey", "webhook_event_id", "webhook_events">
        ]
      >;
      case_sheet_amendments: TableDef<
        CaseSheetAmendment,
        | "case_sheet_id"
        | "revision"
        | "reason"
        | "changed_by"
        | "changed_by_name"
        | "old_data"
        | "new_data",
        "id" | "changed_at",
        [FK<"case_sheet_amendments_case_sheet_id_fkey", "case_sheet_id", "case_sheets">]
      >;
      external_appointments: TableDef<
        ExternalAppointment,
        "source_system" | "external_appointment_id",
        "id" | "created_at" | "updated_at",
        [
          FK<"external_appointments_webhook_id_fkey", "webhook_id", "webhook_endpoints">,
          FK<"external_appointments_branch_id_fkey", "branch_id", "branches">,
          FK<"external_appointments_lead_id_fkey", "lead_id", "leads">,
          FK<"external_appointments_native_appointment_id_fkey", "native_appointment_id", "appointments">,
          FK<"external_appointments_call_log_id_fkey", "call_log_id", "call_logs">
        ]
      >;
      tooth_assessments: TableDef<
        ToothAssessment,
        | "case_sheet_id"
        | "lead_id"
        | "branch_id"
        | "appointment_id"
        | "doctor_id"
        | "tooth_number"
        | "tooth_state"
        | "conditions"
        | "surfaces"
        | "assessed_at"
        | "signed_at"
        | "signed_by"
        | "created_by",
        "id" | "created_at",
        [
          FK<"tooth_assessments_case_sheet_id_fkey", "case_sheet_id", "case_sheets">,
          FK<"tooth_assessments_lead_id_fkey", "lead_id", "leads">,
          FK<"tooth_assessments_branch_id_fkey", "branch_id", "branches">,
          FK<"tooth_assessments_appointment_id_fkey", "appointment_id", "appointments">,
          FK<"tooth_assessments_doctor_id_fkey", "doctor_id", "doctors">,
          FK<"tooth_assessments_signed_by_fkey", "signed_by", "profiles">,
          FK<"tooth_assessments_created_by_fkey", "created_by", "profiles">
        ]
      >;
      patient_medical_history_versions: TableDef<
        PatientMedicalHistoryVersion,
        | "lead_id"
        | "branch_id"
        | "review_status"
        | "reviewed_with_patient"
        | "conditions"
        | "recorded_at"
        | "recorded_by",
        "id" | "created_at",
        [
          FK<"patient_medical_history_versions_lead_id_fkey", "lead_id", "leads">,
          FK<"patient_medical_history_versions_branch_id_fkey", "branch_id", "branches">,
          FK<"patient_medical_history_versions_recorded_by_fkey", "recorded_by", "profiles">
        ]
      >;
      case_sheet_medical_history: TableDef<
        CaseSheetMedicalHistory,
        | "case_sheet_id"
        | "medical_history_version_id"
        | "lead_id"
        | "branch_id"
        | "signed_at"
        | "signed_by",
        "created_at",
        [
          OneFK<"case_sheet_medical_history_case_sheet_id_fkey", "case_sheet_id", "case_sheets">,
          OneFK<"case_sheet_medical_history_medical_history_version_id_fkey", "medical_history_version_id", "patient_medical_history_versions">,
          FK<"case_sheet_medical_history_lead_id_fkey", "lead_id", "leads">,
          FK<"case_sheet_medical_history_branch_id_fkey", "branch_id", "branches">,
          FK<"case_sheet_medical_history_signed_by_fkey", "signed_by", "profiles">
        ]
      >;
      prescription_items: TableDef<
        PrescriptionItem,
        | "case_sheet_id"
        | "lead_id"
        | "branch_id"
        | "appointment_id"
        | "doctor_id"
        | "line_number"
        | "medicine_name"
        | "prescribed_at"
        | "signed_at"
        | "signed_by"
        | "created_by",
        "id" | "created_at",
        [
          FK<"prescription_items_case_sheet_id_fkey", "case_sheet_id", "case_sheets">,
          FK<"prescription_items_lead_id_fkey", "lead_id", "leads">,
          FK<"prescription_items_branch_id_fkey", "branch_id", "branches">,
          FK<"prescription_items_appointment_id_fkey", "appointment_id", "appointments">,
          FK<"prescription_items_doctor_id_fkey", "doctor_id", "doctors">,
          FK<"prescription_items_signed_by_fkey", "signed_by", "profiles">,
          FK<"prescription_items_created_by_fkey", "created_by", "profiles">
        ]
      >;
      case_sheet_attachments: TableDef<
        CaseSheetAttachment,
        | "id"
        | "case_sheet_id"
        | "treatment_id"
        | "lead_id"
        | "branch_id"
        | "category"
        | "object_path"
        | "original_name"
        | "mime_type"
        | "size_bytes"
        | "created_by",
        "created_at",
        [
          FK<"case_sheet_attachments_case_sheet_id_fkey", "case_sheet_id", "case_sheets">,
          FK<"case_sheet_attachments_treatment_id_fkey", "treatment_id", "treatments">,
          FK<"case_sheet_attachments_lead_id_fkey", "lead_id", "leads">,
          FK<"case_sheet_attachments_branch_id_fkey", "branch_id", "branches">,
          FK<"case_sheet_attachments_created_by_fkey", "created_by", "profiles">
        ]
      >;
      treatments: TableDef<
        Treatment,
        "lead_id",
        "id" | "created_at" | "branch_id",
        [
          FK<"treatments_lead_id_fkey", "lead_id", "leads">,
          FK<"treatments_branch_id_fkey", "branch_id", "branches">,
          FK<"treatments_appointment_id_fkey", "appointment_id", "appointments">,
          FK<"treatments_treatment_type_id_fkey", "treatment_type_id", "treatment_types">,
          FK<"treatments_doctor_id_fkey", "doctor_id", "doctors">,
          FK<"treatments_case_sheet_id_fkey", "case_sheet_id", "case_sheets">,
          {
            foreignKeyName: "treatments_treatment_code_fkey";
            columns: ["treatment_code"];
            isOneToOne: false;
            referencedRelation: "treatment_codes";
            referencedColumns: ["code"];
          }
        ]
      >;
      follow_ups: TableDef<
        FollowUp,
        "lead_id" | "due_at",
        "id" | "created_at" | "branch_id",
        [
          FK<"follow_ups_lead_id_fkey", "lead_id", "leads">,
          FK<"follow_ups_branch_id_fkey", "branch_id", "branches">
        ]
      >;
      invoices: TableDef<
        Invoice,
        "invoice_number" | "lead_id",
        | "id"
        | "created_at"
        | "updated_at"
        | "branch_id"
        | "paid_at"
        | "issuer_name"
        | "issuer_address"
        | "issuer_phone"
        | "deleted_at"
        | "deleted_by"
        | "delete_reason"
        | "invoice_kind"
        | "version",
        [
          FK<"invoices_lead_id_fkey", "lead_id", "leads">,
          FK<"invoices_branch_id_fkey", "branch_id", "branches">,
          FK<"invoices_treatment_id_fkey", "treatment_id", "treatments">
        ]
      >;
      invoice_items: TableDef<
        InvoiceItem,
        "invoice_id" | "description",
        "id" | "created_at" | "active_billing",
        [
          FK<"invoice_items_invoice_id_fkey", "invoice_id", "invoices">,
          FK<"invoice_items_treatment_id_fkey", "treatment_id", "treatments">,
          FK<"invoice_items_treatment_type_id_fkey", "treatment_type_id", "treatment_types">
        ]
      >;
      invoice_payments: TableDef<
        InvoicePayment,
        "invoice_id" | "amount" | "payment_method",
        "id" | "created_at" | "received_at",
        [FK<"invoice_payments_invoice_id_fkey", "invoice_id", "invoices">]
      >;
      lead_activity: TableDef<
        LeadActivity,
        "lead_id" | "type",
        "id" | "created_at" | "branch_id",
        [
          FK<"lead_activity_lead_id_fkey", "lead_id", "leads">,
          FK<"lead_activity_branch_id_fkey", "branch_id", "branches">,
          FK<"lead_activity_actor_id_fkey", "actor_id", "profiles">
        ]
      >;
      comments: TableDef<
        Comment,
        "lead_id" | "body" | "author_id",
        | "id"
        | "created_at"
        | "updated_at"
        | "branch_id"
        | "deleted_at"
        | "deleted_by"
        | "delete_reason"
        | "version",
        [
          FK<"comments_lead_id_fkey", "lead_id", "leads">,
          FK<"comments_branch_id_fkey", "branch_id", "branches">,
          FK<"comments_author_id_fkey", "author_id", "profiles">
        ]
      >;
      audit_log: TableDef<
        AuditLog,
        "entity_type" | "entity_id" | "action",
        "id" | "occurred_at"
      >;
      action_rate_limits: TableDef<
        ActionRateLimit,
        | "actor_id"
        | "scope"
        | "window_started_at"
        | "expires_at"
        | "request_count"
        | "last_seen_at",
        never,
        [FK<"action_rate_limits_actor_id_fkey", "actor_id", "profiles">]
      >;
    };
    Views: Record<string, never>;
    Functions: {
      case_sheet_amendment_window_open: {
        Args: { p_case_sheet_id: string };
        Returns: boolean;
      };
      current_tooth_assessments: {
        Args: { p_lead_id: string };
        Returns: ToothAssessment[];
      };
      next_invoice_number: { Args: { p_branch_id: string }; Returns: string };
      transition_lead: {
        Args: { p_lead_id: string; p_to: LeadStatus; p_actor: string; p_payload?: Json };
        Returns: Lead;
      };
      finalize_clinical_visit: {
        Args: {
          p_lead_id: string;
          p_appointment_id: string;
          p_doctor_id: string;
          p_visit_at: string;
          p_chief_complaint: string | null;
          p_findings: string | null;
          p_diagnosis: string | null;
          p_plan: string | null;
          p_medical_history_review_status: MedicalHistoryReviewStatus;
          p_medical_history_confirmed: boolean;
          p_medical_history_conditions: MedicalHistoryCondition[];
          p_medical_history_description: string | null;
          p_tooth_assessments: Json;
          p_treatments: Json;
          p_prescriptions: Json;
          p_actor: string;
        };
        Returns: CaseSheet;
      };
      amend_clinical_visit: {
        Args: {
          p_case_sheet_id: string;
          p_expected_version: number;
          p_reason: string;
          p_chief_complaint: string | null;
          p_findings: string | null;
          p_diagnosis: string | null;
          p_plan: string | null;
          p_medical_history_review_status: Exclude<MedicalHistoryReviewStatus, "not_reviewed">;
          p_medical_history_confirmed: boolean;
          p_medical_history_conditions: MedicalHistoryCondition[];
          p_medical_history_description: string | null;
          p_tooth_assessments: Json;
          p_treatments: Json;
          p_prescriptions: Json;
          p_actor: string;
        };
        Returns: CaseSheet;
      };
      create_invoice: {
        Args: {
          p_lead_id: string;
          p_treatment_id: string | null;
          p_tax_rate: number;
          p_notes: string | null;
          p_items: Json;
          p_actor: string;
        };
        Returns: Invoice;
      };
      create_consultation_invoice: {
        Args: {
          p_lead_id: string;
          p_amount: number;
          p_notes: string | null;
          p_actor: string;
        };
        Returns: Invoice;
      };
      update_invoice: {
        Args: {
          p_invoice_id: string;
          p_tax_rate: number;
          p_notes: string | null;
          p_items: Json;
          p_actor: string;
          p_expected_version?: number | null;
        };
        Returns: Invoice;
      };
      transition_invoice_status: {
        Args: {
          p_invoice_id: string;
          p_to: InvoiceStatus;
          p_actor: string;
          p_expected_version?: number | null;
        };
        Returns: Invoice;
      };
      record_invoice_payment: {
        Args: {
          p_invoice_id: string;
          p_amount: number;
          p_method: InvoicePaymentMethod;
          p_reference: string | null;
          p_notes: string | null;
          p_actor: string;
        };
        Returns: InvoicePayment;
      };
      delete_invoice: {
        Args: {
          p_invoice_id: string;
          p_actor: string;
          p_reason?: string;
          p_expected_version?: number | null;
        };
        Returns: Invoice;
      };
      soft_delete_lead: {
        Args: { p_lead_id: string; p_actor: string; p_reason: string };
        Returns: Lead;
      };
      create_lead: {
        Args: {
          p_branch_id: string;
          p_name: string;
          p_mobile: string;
          p_email: string | null;
          p_source_id: string | null;
          p_interest_id: string | null;
          p_age: number | null;
          p_dob: string | null;
          p_notes: string | null;
          p_actor: string;
        };
        Returns: Lead;
      };
      create_comment: {
        Args: {
          p_lead_id: string;
          p_entity_type: CommentEntity;
          p_entity_id: string | null;
          p_body: string;
          p_actor: string;
        };
        Returns: Comment;
      };
      update_comment: {
        Args: {
          p_comment_id: string;
          p_body: string;
          p_actor: string;
          p_expected_version: number;
        };
        Returns: Comment;
      };
      soft_delete_comment: {
        Args: {
          p_comment_id: string;
          p_actor: string;
          p_reason: string;
          p_expected_version: number;
        };
        Returns: Comment;
      };
      consume_action_rate_limit: {
        Args: {
          p_actor: string;
          p_scope: string;
          p_limit: number;
          p_window_ms: number;
        };
        Returns: boolean;
      };
      prune_action_rate_limits: {
        Args: { p_batch_size?: number };
        Returns: number;
      };
      get_report_aggregates: {
        Args: {
          p_actor: string;
          p_from: string;
          p_to: string;
          p_branch_id?: string | null;
          p_doctor_id?: string | null;
        };
        Returns: ReportAggregateRpcPayload[];
      };
      get_business_dashboard: {
        Args: {
          p_actor: string;
          p_day_start: string;
          p_day_end: string;
        };
        Returns: BusinessDashboardRpcRow[];
      };
      get_doctor_dashboard: {
        Args: {
          p_actor: string;
          p_day_start: string;
          p_day_end: string;
        };
        Returns: DoctorDashboardRpcRow[];
      };
      record_profile_admin_audit: {
        Args: {
          p_profile_id: string;
          p_actor: string;
          p_action: "created" | "updated";
          p_old_data: Json | null;
          p_new_data: Json;
        };
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      lead_status: LeadStatus;
      appointment_status: AppointmentStatus;
      invoice_status: InvoiceStatus;
      invoice_payment_method: InvoicePaymentMethod;
      follow_up_status: FollowUpStatus;
      comment_entity: CommentEntity;
    };
    CompositeTypes: Record<string, never>;
  };
};

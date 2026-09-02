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
  site_scope: "not_applicable" | "full_mouth" | "arch" | "quadrant" | "tooth" | null;
  site_detail: string | null;
  tooth_number: string | null;
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
  notes: string | null;
  created_by: string | null;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  version: number;
  code_enforced: boolean;
};

export type InvoiceItem = Timestamps & {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  treatment_id: string | null;
  treatment_code: string | null;
  treatment_name: string | null;
  treatment_category: string | null;
  case_sheet_id: string | null;
  tooth_number: string | null;
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
        "id" | "created_at",
        [
          FK<"case_sheets_lead_id_fkey", "lead_id", "leads">,
          FK<"case_sheets_branch_id_fkey", "branch_id", "branches">,
          FK<"case_sheets_appointment_id_fkey", "appointment_id", "appointments">,
          FK<"case_sheets_doctor_id_fkey", "doctor_id", "doctors">,
          FK<"case_sheets_signed_by_fkey", "signed_by", "profiles">,
          FK<"case_sheets_created_by_fkey", "created_by", "profiles">
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
          FK<"invoice_items_treatment_id_fkey", "treatment_id", "treatments">
        ]
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
      current_tooth_assessments: {
        Args: { p_lead_id: string };
        Returns: ToothAssessment[];
      };
      next_invoice_number: { Args: { p_branch_id: string }; Returns: string };
      transition_lead: {
        Args: { p_lead_id: string; p_to: LeadStatus; p_actor: string; p_payload?: Json };
        Returns: Lead;
      };
      finalize_case_sheet: {
        Args: {
          p_lead_id: string;
          p_appointment_id: string;
          p_doctor_id: string;
          p_visit_at: string;
          p_chief_complaint: string | null;
          p_findings: string | null;
          p_diagnosis: string | null;
          p_plan: string | null;
          p_medical_alerts: string | null;
          p_treatments: Json;
          p_actor: string;
        };
        Returns: CaseSheet;
      };
      finalize_case_sheet_with_odontogram: {
        Args: {
          p_lead_id: string;
          p_appointment_id: string;
          p_doctor_id: string;
          p_visit_at: string;
          p_chief_complaint: string | null;
          p_findings: string | null;
          p_diagnosis: string | null;
          p_plan: string | null;
          p_medical_alerts: string | null;
          p_tooth_assessments: Json;
          p_treatments: Json;
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
      follow_up_status: FollowUpStatus;
      comment_entity: CommentEntity;
    };
    CompositeTypes: Record<string, never>;
  };
};

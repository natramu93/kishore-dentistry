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

export type UserRole = "admin" | "manager" | "agent";
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
};

export type TreatmentType = Timestamps & {
  id: string;
  name: string;
  category: string | null;
  default_cost: number | null;
  is_active: boolean;
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
  notes: string | null;
  created_by: string | null;
  updated_at: string;
};

export type InvoiceItem = Timestamps & {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
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
        [FK<"doctors_branch_id_fkey", "branch_id", "branches">]
      >;
      treatment_types: TableDef<TreatmentType, "name", "id" | "created_at">;
      leads: TableDef<
        Lead,
        "branch_id" | "name" | "mobile",
        "id" | "created_at" | "updated_at" | "status_changed_at",
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
      treatments: TableDef<
        Treatment,
        "lead_id",
        "id" | "created_at" | "branch_id",
        [
          FK<"treatments_lead_id_fkey", "lead_id", "leads">,
          FK<"treatments_branch_id_fkey", "branch_id", "branches">,
          FK<"treatments_appointment_id_fkey", "appointment_id", "appointments">,
          FK<"treatments_treatment_type_id_fkey", "treatment_type_id", "treatment_types">,
          FK<"treatments_doctor_id_fkey", "doctor_id", "doctors">
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
        "id" | "created_at" | "updated_at" | "branch_id",
        [
          FK<"invoices_lead_id_fkey", "lead_id", "leads">,
          FK<"invoices_branch_id_fkey", "branch_id", "branches">,
          FK<"invoices_treatment_id_fkey", "treatment_id", "treatments">
        ]
      >;
      invoice_items: TableDef<
        InvoiceItem,
        "invoice_id" | "description",
        "id" | "created_at",
        [FK<"invoice_items_invoice_id_fkey", "invoice_id", "invoices">]
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
        "id" | "created_at" | "updated_at" | "branch_id",
        [
          FK<"comments_lead_id_fkey", "lead_id", "leads">,
          FK<"comments_branch_id_fkey", "branch_id", "branches">,
          FK<"comments_author_id_fkey", "author_id", "profiles">
        ]
      >;
    };
    Views: Record<string, never>;
    Functions: {
      next_invoice_number: { Args: { p_branch_id: string }; Returns: string };
      transition_lead: {
        Args: { p_lead_id: string; p_to: LeadStatus; p_actor: string; p_payload?: Json };
        Returns: Lead;
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

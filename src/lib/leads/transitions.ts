import { z } from "zod";
import type { LeadStatus } from "@/lib/database.types";

// Single source of truth for the pipeline (mirrored by the DB trigger
// crm.validate_lead_transition — keep both in sync).
export const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  open: ["assigned", "dropped"],
  assigned: ["open", "appointment_booked", "dropped"],
  appointment_booked: ["visited_treated", "missed", "assigned", "dropped"],
  visited_treated: ["follow_up", "closed", "dropped"],
  follow_up: ["appointment_booked", "closed", "dropped"],
  missed: ["assigned", "dropped"],
  closed: [],
  dropped: [],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  appointment_booked: "Appointment Booked",
  visited_treated: "Visited / Treated",
  follow_up: "Follow Up",
  closed: "Closed",
  dropped: "Dropped",
  missed: "Missed",
};

// Pipeline order for the status stepper (terminal states shown separately)
export const PIPELINE_ORDER: LeadStatus[] = [
  "open",
  "assigned",
  "appointment_booked",
  "visited_treated",
  "follow_up",
  "closed",
];

// Per-transition payload schemas, validated in the server action
export const transitionPayloadSchemas = {
  assigned: z.object({
    assignee_id: z.string().uuid(),
  }),
  appointment_booked: z.object({
    scheduled_at: z.string().min(1),
    doctor_id: z.string().uuid().optional().or(z.literal("")),
    duration_minutes: z.coerce.number().int().min(5).max(480).default(30),
    notes: z.string().optional(),
  }),
  visited_treated: z.object({
    appointment_id: z.string().uuid().optional(),
    treatment_type_id: z.string().uuid().optional().or(z.literal("")),
    doctor_id: z.string().uuid().optional().or(z.literal("")),
    cost: z.coerce.number().min(0).optional(),
    notes: z.string().optional(),
  }),
  follow_up: z.object({
    due_at: z.string().min(1),
    reason: z.string().optional(),
  }),
  missed: z.object({
    appointment_id: z.string().uuid().optional(),
  }),
  closed: z.object({}),
  dropped: z.object({
    reason: z.string().optional(),
    appointment_id: z.string().uuid().optional(),
  }),
  open: z.object({}),
} satisfies Partial<Record<LeadStatus, z.ZodTypeAny>>;

import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import type {
  AppointmentStatus,
  CommentEntity,
  FollowUpStatus,
  InvoiceStatus,
  LeadStatus,
  UserRole,
} from "@/lib/database.types";

export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
export const MAX_PAGE_SIZE = 100;
export const MAX_LIST_ROWS = 500;
export const MAX_REPORT_DAYS = 366;
export const MAX_REPORT_ROWS = 5_000;

export const uuidSchema = z.string().uuid("Invalid identifier");
export const optionalUuidSchema = uuidSchema.optional().or(z.literal(""));
export const userRoleSchema = z.enum([
  "admin",
  "operations",
  "front_office",
  "clinical_head",
  "doctor",
]);
export const leadStatusSchema = z.enum([
  "open",
  "assigned",
  "appointment_booked",
  "visited_treated",
  "follow_up",
  "closed",
  "dropped",
  "missed",
]);
export const appointmentStatusSchema = z.enum(["scheduled", "completed", "cancelled", "no_show"]);
export const invoiceStatusSchema = z.enum(["draft", "sent", "paid"]);
export const followUpStatusSchema = z.enum(["pending", "done", "cancelled"]);
export const commentEntitySchema = z.enum([
  "lead",
  "appointment",
  "treatment",
  "follow_up",
  "invoice",
]);

export const booleanInputSchema = z.preprocess((value) => {
  if (value === true || value === "true" || value === "on" || value === "1") return true;
  if (value === false || value === "false" || value === "off" || value === "0") return false;
  return value;
}, z.boolean());

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(message);
  return parsed.data;
}

export function assertUuid(value: unknown, label = "Identifier"): string {
  return parseOrThrow(uuidSchema, value, `${label} is invalid`);
}

export function assertUserRole(value: unknown): UserRole {
  return parseOrThrow(userRoleSchema, value, "Role is invalid");
}

export function assertLeadStatus(value: unknown): LeadStatus {
  return parseOrThrow(leadStatusSchema, value, "Lead status is invalid");
}

export function assertAppointmentStatus(value: unknown): AppointmentStatus {
  return parseOrThrow(appointmentStatusSchema, value, "Appointment status is invalid");
}

export function assertInvoiceStatus(value: unknown): InvoiceStatus {
  return parseOrThrow(invoiceStatusSchema, value, "Invoice status is invalid");
}

export function assertFollowUpStatus(value: unknown): FollowUpStatus {
  return parseOrThrow(followUpStatusSchema, value, "Follow-up status is invalid");
}

export function assertCommentEntity(value: unknown): CommentEntity {
  return parseOrThrow(commentEntitySchema, value, "Comment target is invalid");
}

export function assertIsoDateTime(value: unknown, label = "Date and time"): string {
  if (typeof value !== "string" || value.length > 64) {
    throw new ValidationError(`${label} is invalid`);
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/
  );
  if (!match) throw new ValidationError(`${label} is invalid`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] =
    match;
  assertDateOnly(`${yearText}-${monthText}-${dayText}`, label);

  if (hourText !== undefined) {
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? "0");
    if (
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      !offset ||
      (offset !== "Z" &&
        (() => {
          const [offsetHours, offsetMinutes] = offset.slice(1).split(":").map(Number);
          return offsetHours > 23 || offsetMinutes > 59;
        })())
    ) {
      throw new ValidationError(`${label} is invalid`);
    }
  }

  if (!Number.isFinite(Date.parse(value))) {
    throw new ValidationError(`${label} is invalid`);
  }
  return new Date(value).toISOString();
}

export function assertDateOnly(value: unknown, label = "Date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${label} is invalid`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new ValidationError(`${label} is invalid`);
  }
  return value;
}

export function normalizePagination(
  page: unknown,
  pageSize: unknown,
  defaultPageSize = 25
): { page: number; pageSize: number } {
  const parsedPage = typeof page === "number" ? page : Number(page ?? 1);
  const parsedSize = typeof pageSize === "number" ? pageSize : Number(pageSize ?? defaultPageSize);
  return {
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize:
      Number.isSafeInteger(parsedSize) && parsedSize > 0
        ? Math.min(parsedSize, MAX_PAGE_SIZE)
        : defaultPageSize,
  };
}

export function normalizeLimit(value: unknown, fallback: number, max = MAX_LIST_ROWS): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function normalizeSearch(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  // PostgREST `.or()` filters use commas/parentheses as syntax.
  const normalized = value
    .slice(0, maxLength)
    .replace(/[,%_()*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export function validateIsoRange(
  fromValue: unknown,
  toValue: unknown,
  defaults: { from: string; to: string },
  maxDays = MAX_REPORT_DAYS
): { from: string; to: string } {
  const from =
    fromValue === undefined
      ? assertIsoDateTime(defaults.from, "Start date")
      : assertIsoDateTime(fromValue, "Start date");
  const to =
    toValue === undefined
      ? assertIsoDateTime(defaults.to, "End date")
      : assertIsoDateTime(toValue, "End date");
  const duration = Date.parse(to) - Date.parse(from);
  if (duration <= 0) throw new ValidationError("End date must be after start date");
  if (duration > maxDays * 24 * 60 * 60 * 1_000) {
    throw new ValidationError(`Date range cannot exceed ${maxDays} days`);
  }
  return { from, to };
}

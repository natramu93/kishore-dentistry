"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as appointments from "@/data/appointments";
import { clinicTimeToUtc } from "@/lib/tz";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { optionalUuidSchema, uuidSchema } from "@/lib/validation";
import { runAction, type ActionResult } from "./util";

const rescheduleSchema = z.object({
  scheduled_at: z.string().min(1, "Pick a date and time").max(64),
  doctor_id: optionalUuidSchema,
  duration_minutes: z.coerce.number().int().min(5).max(480).default(15),
  notes: z.string().trim().max(4_000).optional(),
});

export async function rescheduleAppointmentAction(
  appointmentId: string,
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const ids = z.object({ appointmentId: uuidSchema, leadId: uuidSchema }).safeParse({
    appointmentId,
    leadId,
  });
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!ids.success) return { ok: false, error: "Appointment reference is invalid" };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const value = parsed.data;
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "appointment:reschedule", {
      limit: 30,
      windowMs: 5 * 60_000,
    });
    const updated = await appointments.updateAppointment(
      ctx,
      ids.data.appointmentId,
      {
        scheduled_at: clinicTimeToUtc(value.scheduled_at),
        doctor_id: value.doctor_id || null,
        duration_minutes: value.duration_minutes,
        notes: value.notes || null,
      },
      ids.data.leadId
    );
    revalidatePath(`/leads/${updated.lead_id}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard");
  });
}

export async function doctorMarkNoShowAction(
  appointmentId: string
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const id = uuidSchema.safeParse(appointmentId);
  if (!id.success) return { ok: false, error: "Appointment is invalid" };
  return runAction(async () => {
    await assertActionRateLimit(ctx.userId, "appointment:doctor-outcome", {
      limit: 30,
      windowMs: 5 * 60_000,
    });
    await appointments.doctorMarkNoShow(ctx, id.data);
    revalidatePath("/appointments");
    revalidatePath("/dashboard");
  });
}

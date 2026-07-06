"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import * as appointments from "@/data/appointments";
import { clinicTimeToUtc } from "@/lib/tz";
import { runAction, type ActionResult } from "./util";

const rescheduleSchema = z.object({
  scheduled_at: z.string().min(1, "Pick a date and time"),
  doctor_id: z.string().uuid().optional().or(z.literal("")),
  duration_minutes: z.coerce.number().int().min(5).max(480).default(30),
  notes: z.string().optional(),
});

export async function rescheduleAppointmentAction(
  appointmentId: string,
  leadId: string,
  formData: FormData
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;
  return runAction(async () => {
    await appointments.updateAppointment(ctx, appointmentId, {
      scheduled_at: clinicTimeToUtc(v.scheduled_at),
      doctor_id: v.doctor_id || null,
      duration_minutes: v.duration_minutes,
      notes: v.notes || null,
    });
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/appointments");
    revalidatePath("/dashboard");
  });
}

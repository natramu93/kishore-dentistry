import { fmt } from "@/lib/tz";
import { patientDisplayName } from "@/lib/patient-demographics";

export type AppointmentWhatsAppDetails = {
  patientName: string;
  patientTitle?: string | null;
  patientMobile: string;
  scheduledAt: string;
  centerName: string;
  centerAddress: string | null;
  centerPhone: string | null;
};

export function normalizeWhatsAppNumber(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function buildAppointmentWhatsAppUrl(details: AppointmentWhatsAppDetails): string {
  const message = [
    `Hello ${patientDisplayName({ name: details.patientName, title: details.patientTitle })}, your appointment is booked for ${fmt(details.scheduledAt, "EEEE, d MMMM yyyy 'at' h:mm a")} (IST).`,
    "",
    `Center: ${details.centerName}`,
    ...(details.centerAddress ? [`Address: ${details.centerAddress}`] : []),
    ...(details.centerPhone ? [`Contact: ${details.centerPhone}`] : []),
    "",
    "We look forward to seeing you. Please reply to this message if you need to reschedule.",
  ].join("\n");

  const phone = normalizeWhatsAppNumber(details.patientMobile);
  const url = new URL(`https://wa.me/${phone ?? ""}`);
  url.searchParams.set("text", message);
  return url.toString();
}

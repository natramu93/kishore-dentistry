import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";

export const metadata = { title: "Print invoice" };

/** Use the same paginated A4 document for browser printing and file sharing. */
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await getAuthContext();
  const { id } = await params;
  redirect(`/api/invoices/${encodeURIComponent(id)}/pdf?inline=1`);
}

import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getInvoice } from "@/data/invoices";
import { fmtDate, formatINR } from "@/lib/tz";
import { PrintButton } from "./print-button";

export const metadata = { title: "Invoice" };

// Print-friendly invoice: no app shell, browser Print -> Save as PDF.
export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext();
  const invoice = await getInvoice(ctx, id);
  if (!invoice) notFound();

  return (
    <div className="mx-auto max-w-[210mm] p-8 print:p-0 text-sm text-black bg-white min-h-screen">
      <PrintButton />

      <header className="flex justify-between items-start border-b-2 border-black pb-4">
        <div>
          <h1 className="text-2xl font-bold">Kishore Dentistry</h1>
          <p className="mt-1">{invoice.branch?.name} Branch</p>
          {invoice.branch?.address && <p>{invoice.branch.address}</p>}
          {invoice.branch?.phone && <p>Phone: {invoice.branch.phone}</p>}
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold uppercase tracking-wide">Invoice</h2>
          <p className="mt-1 font-mono">{invoice.invoice_number}</p>
          <p>Date: {fmtDate(invoice.issued_at ?? invoice.created_at)}</p>
          <p className="capitalize">Status: {invoice.status}</p>
        </div>
      </header>

      <section className="mt-6">
        <h3 className="font-semibold text-xs uppercase tracking-wide text-neutral-500">Billed to</h3>
        <p className="font-medium mt-1">{invoice.lead?.name}</p>
        {invoice.lead?.mobile && <p>{invoice.lead.mobile}</p>}
        {invoice.lead?.email && <p>{invoice.lead.email}</p>}
      </section>

      <table className="w-full mt-6 border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2">#</th>
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit price</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={item.id} className="border-b border-neutral-300">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{item.description}</td>
              <td className="py-2 text-right">{item.quantity}</td>
              <td className="py-2 text-right">{formatINR(item.unit_price)}</td>
              <td className="py-2 text-right">{formatINR(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 ml-auto w-64 space-y-1">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatINR(invoice.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax ({invoice.tax_rate}%)</span>
          <span>{formatINR(invoice.tax_amount)}</span>
        </div>
        <div className="flex justify-between font-bold text-base border-t-2 border-black pt-1">
          <span>Total</span>
          <span>{formatINR(invoice.total)}</span>
        </div>
      </div>

      {invoice.notes && (
        <p className="mt-6 text-neutral-600 border-t border-neutral-300 pt-3">{invoice.notes}</p>
      )}

      <footer className="mt-12 text-xs text-neutral-500 text-center">
        Thank you for choosing Kishore Dentistry.
      </footer>
    </div>
  );
}

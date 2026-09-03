import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getInvoice } from "@/data/invoices";
import {
  TIRUPUR_CLINIC,
  addressLinesFromSnapshot,
  getTelephoneHref,
} from "@/lib/clinic";
import { fmtDate, formatINR } from "@/lib/tz";
import { PrintButton } from "./print-button";
import { BrandWordmark } from "@/components/brand";

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
  if (!invoice.code_enforced) notFound();

  const isTirupur = invoice.branch?.code === TIRUPUR_CLINIC.branchCode;
  const issuerName =
    invoice.issuer_name ??
    (isTirupur
      ? TIRUPUR_CLINIC.officialName
      : `${TIRUPUR_CLINIC.brandName}${invoice.branch?.name ? ` - ${invoice.branch.name}` : ""}`);
  const issuerAddress =
    invoice.issuer_address ??
    (isTirupur ? TIRUPUR_CLINIC.address : invoice.branch?.address);
  const issuerPhone =
    invoice.issuer_phone ??
    (isTirupur ? TIRUPUR_CLINIC.phoneE164 : invoice.branch?.phone);
  const issuerPhoneHref = getTelephoneHref(issuerPhone);
  const issuerPhoneDisplay =
    issuerPhoneHref === TIRUPUR_CLINIC.phoneHref
      ? TIRUPUR_CLINIC.phoneDisplay
      : issuerPhone;

  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-4 text-sm text-black sm:p-8 print:p-0">
      <PrintButton />

      <header className="flex flex-col items-start justify-between gap-5 border-b-2 border-primary pb-5 sm:flex-row">
        <div className="min-w-0">
          <BrandWordmark
            surface="light"
            decorative
            className="h-16 w-auto max-w-full print:h-14"
          />
          <h1 className="mt-3 text-xl font-bold text-brand-navy">{issuerName}</h1>
          {(issuerAddress || issuerPhoneDisplay) && (
            <address className="mt-1 not-italic">
              {issuerAddress &&
                addressLinesFromSnapshot(issuerAddress).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              {issuerPhoneDisplay && (
                issuerPhoneHref ? (
                  <a href={issuerPhoneHref} className="block underline underline-offset-2">
                    Call: {issuerPhoneDisplay}
                  </a>
                ) : (
                  <span className="block">Call: {issuerPhoneDisplay}</span>
                )
              )}
            </address>
          )}
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <h2 className="text-xl font-bold uppercase tracking-wide text-brand-blue">Invoice</h2>
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
        <caption className="sr-only">Invoice line items</caption>
        <thead>
          <tr className="border-b-2 border-primary text-left text-brand-navy">
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
              <td className="py-2">
                {item.description}
                {item.surfaces?.length ? (
                  <span className="block text-xs text-neutral-600">
                    Surfaces: {item.surfaces.join(", ")}
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-right">{item.quantity}</td>
              <td className="py-2 text-right">{formatINR(item.unit_price)}</td>
              <td className="py-2 text-right">{formatINR(item.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 ml-auto w-full space-y-1 sm:w-64">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatINR(invoice.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax ({invoice.tax_rate}%)</span>
          <span>{formatINR(invoice.tax_amount)}</span>
        </div>
        <div className="flex justify-between border-t-2 border-primary pt-1 text-base font-bold text-brand-navy">
          <span>Total</span>
          <span>{formatINR(invoice.total)}</span>
        </div>
      </div>

      {invoice.notes && (
        <p className="mt-6 text-neutral-600 border-t border-neutral-300 pt-3">{invoice.notes}</p>
      )}

      <footer className="mt-12 border-t border-gold/60 pt-3 text-center text-xs text-neutral-600">
        Thank you for choosing {TIRUPUR_CLINIC.brandName}.
      </footer>
    </main>
  );
}

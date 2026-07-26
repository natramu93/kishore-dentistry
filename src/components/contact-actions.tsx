"use client";

import { toast } from "sonner";
import { Copy, Mail, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ContactActions({
  mobile,
  email,
}: {
  mobile: string | null | undefined;
  email: string | null | undefined;
}) {
  const digits = mobile?.replace(/\D/g, "") ?? "";
  const whatsappNumber = digits.length === 10 ? `91${digits}` : digits;

  async function copyMobile() {
    if (!mobile) return;
    try {
      await navigator.clipboard.writeText(mobile);
      toast.success("Mobile number copied");
    } catch {
      toast.error("Could not copy the mobile number");
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Contact actions">
      {mobile && (
        <>
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${mobile}`} aria-label={`Call ${mobile}`}>
              <Phone aria-hidden="true" />
              Call
            </a>
          </Button>
          {whatsappNumber && (
            <Button asChild size="sm" variant="outline">
              <a
                href={`https://wa.me/${whatsappNumber}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Message ${mobile} on WhatsApp (opens in a new tab)`}
              >
                <MessageCircle aria-hidden="true" />
                WhatsApp
              </a>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={copyMobile}
            aria-label={`Copy mobile number ${mobile}`}
          >
            <Copy aria-hidden="true" />
            Copy
          </Button>
        </>
      )}
      {email && (
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${email}`} aria-label={`Email ${email}`}>
            <Mail aria-hidden="true" />
            Email
          </a>
        </Button>
      )}
    </div>
  );
}

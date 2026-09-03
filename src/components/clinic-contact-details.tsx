import { MapPin, Phone } from "lucide-react";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { cn } from "@/lib/utils";

export function ClinicContactDetails({
  className,
  showName = true,
}: {
  className?: string;
  showName?: boolean;
}) {
  return (
    <address className={cn("not-italic", className)}>
      {showName && (
        <p className="font-semibold tracking-wide">
          {TIRUPUR_CLINIC.officialName}
        </p>
      )}
      <div className="mt-2 text-sm leading-6">
        {TIRUPUR_CLINIC.addressLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={TIRUPUR_CLINIC.phoneHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 font-medium underline decoration-current/40 underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          aria-label={`Call ${TIRUPUR_CLINIC.brandName} Tirupur at ${TIRUPUR_CLINIC.phoneDisplay}`}
        >
          <Phone className="size-4 shrink-0" aria-hidden="true" />
          Call: {TIRUPUR_CLINIC.phoneDisplay}
        </a>
        <a
          href={TIRUPUR_CLINIC.directionsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 font-medium underline decoration-current/40 underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          aria-label={`Get directions to ${TIRUPUR_CLINIC.brandName} Tirupur (opens in a new tab)`}
        >
          <MapPin className="size-4 shrink-0" aria-hidden="true" />
          Get directions
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </address>
  );
}

import { cn } from "@/lib/utils";

/** Simple tooth glyph used as the app's brand mark. */
export function ToothMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 5.5c-1.6-1.8-3.7-2.6-5.4-1.7C4.4 4.9 4 7.6 4.6 10.4c.4 1.9.7 2.7.9 4.4.2 1.6.3 3.2 1 4.4.3.5 1 .7 1.5.3.6-.5.8-1.6 1-2.7.2-1.1.5-2.3 1.2-2.6.5-.2 1-.2 1.5 0 .8.3 1 1.5 1.2 2.6.2 1.1.4 2.2 1 2.7.5.4 1.2.2 1.5-.3.7-1.2.8-2.8 1-4.4.2-1.7.5-2.5.9-4.4.6-2.8.2-5.5-2-6.6-1.7-.9-3.8-.1-5.4 1.7Z" />
    </svg>
  );
}

export function BrandWordmark({
  className,
  subtitle = "Clinic CRM",
}: {
  className?: string;
  subtitle?: string | null;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ToothMark className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className="block font-bold tracking-tight">Dr. Kishor&apos;s Dentistry</span>
        {subtitle && (
          <span className="block text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
    </div>
  );
}

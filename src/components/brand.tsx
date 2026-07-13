import { cn } from "@/lib/utils";

/**
 * Official Dr. Kishor's Dentistry logo (gold + white on transparent).
 * The wordmark's "Dr. Kishor's" is white, so it must sit on a dark surface.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/KD-logo.png"
      alt="Dr. Kishor's Dentistry"
      className={cn("h-9 w-auto select-none", className)}
      draggable={false}
    />
  );
}

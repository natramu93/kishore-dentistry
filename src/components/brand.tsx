import Image from "next/image";
import brandLogo from "../../public/KD-logo.png";
import { cn } from "@/lib/utils";

/**
 * Official Dr. Kishor's Dentistry logo (gold + white on transparent).
 * The wordmark's "Dr. Kishor's" is white, so it must sit on a dark surface.
 */
export function BrandWordmark({
  className,
  preload = false,
}: {
  className?: string;
  preload?: boolean;
}) {
  return (
    <Image
      src={brandLogo}
      alt="Dr. Kishor's Dentistry"
      className={cn("h-9 w-auto select-none", className)}
      draggable={false}
      sizes="(max-width: 768px) 160px, 208px"
      preload={preload}
    />
  );
}

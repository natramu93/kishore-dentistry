import Image from "next/image";
import logoOnLight from "../../public/brand/kishors-dentistry-logo-on-light.webp";
import logoOnNavy from "../../public/brand/kishors-dentistry-logo-on-navy.webp";
import brandMark from "../../public/brand/kishors-dentistry-mark.png";
import { TIRUPUR_CLINIC } from "@/lib/clinic";
import { cn } from "@/lib/utils";

type BrandImageProps = {
  className?: string;
  decorative?: boolean;
  preload?: boolean;
  sizes?: string;
};

type BrandWordmarkProps = BrandImageProps & {
  surface?: "navy" | "light";
};

/** Full clinic wordmark, selected for the surface it will sit on. */
export function BrandWordmark({
  className,
  decorative = false,
  preload = false,
  sizes = "(max-width: 768px) 160px, 208px",
  surface = "navy",
}: BrandWordmarkProps) {
  const logo = surface === "light" ? logoOnLight : logoOnNavy;

  return (
    <Image
      src={logo}
      alt={decorative ? "" : TIRUPUR_CLINIC.brandName}
      aria-hidden={decorative || undefined}
      width={2000}
      height={surface === "light" ? 624 : 627}
      className={cn("h-9 w-auto select-none", className)}
      draggable={false}
      sizes={sizes}
      preload={preload}
    />
  );
}

/** Compact clinic mark for constrained navigation and icon-sized placements. */
export function BrandMark({
  className,
  decorative = false,
  preload = false,
  sizes = "36px",
}: BrandImageProps) {
  return (
    <Image
      src={brandMark}
      alt={decorative ? "" : TIRUPUR_CLINIC.brandName}
      aria-hidden={decorative || undefined}
      width={512}
      height={512}
      className={cn("size-9 select-none", className)}
      draggable={false}
      sizes={sizes}
      preload={preload}
    />
  );
}

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { TIRUPUR_CLINIC } from "@/lib/clinic";

afterEach(cleanup);

describe("brand images", () => {
  it("uses the navy wordmark by default so existing dark-surface calls remain compatible", () => {
    render(<BrandWordmark className="h-12" preload />);

    const logo = screen.getByRole("img", { name: TIRUPUR_CLINIC.brandName });
    expect(logo).toHaveAttribute("src", expect.stringContaining("logo-on-navy"));
    expect(logo).toHaveAttribute("width", "2000");
    expect(logo).toHaveAttribute("height", "627");
    expect(logo).toHaveClass("w-auto", "select-none", "h-12");
    expect(logo).not.toHaveClass("h-9");
    expect(logo).toHaveAttribute("draggable", "false");
    expect(logo).not.toHaveAttribute("preload");
    expect(document.head.querySelector('link[rel="preload"][as="image"]')).not.toBeNull();
  });

  it("selects the light-surface wordmark with stable intrinsic dimensions", () => {
    render(<BrandWordmark surface="light" />);

    const logo = screen.getByRole("img", { name: TIRUPUR_CLINIC.brandName });
    expect(logo).toHaveAttribute("src", expect.stringContaining("logo-on-light"));
    expect(logo).toHaveAttribute("width", "2000");
    expect(logo).toHaveAttribute("height", "624");
  });

  it("renders decorative wordmarks with an empty alt and hides them from the accessibility tree", () => {
    const { container } = render(<BrandWordmark decorative />);

    expect(screen.queryByRole("img")).toBeNull();
    const logo = container.querySelector("img");
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the compact mark as an informative, fixed-size brand image", () => {
    render(<BrandMark className="size-11" sizes="44px" />);

    const mark = screen.getByRole("img", { name: TIRUPUR_CLINIC.brandName });
    expect(mark).toHaveAttribute("src", expect.stringContaining("kishors-dentistry-mark"));
    expect(mark).toHaveAttribute("width", "512");
    expect(mark).toHaveAttribute("height", "512");
    expect(mark).toHaveAttribute("sizes", "44px");
    expect(mark).toHaveClass("select-none", "size-11");
    expect(mark).not.toHaveClass("size-9");
  });

  it("supports decorative compact marks", () => {
    const { container } = render(<BrandMark decorative preload />);

    expect(screen.queryByRole("img")).toBeNull();
    const mark = container.querySelector("img");
    expect(mark).toHaveAttribute("alt", "");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).not.toHaveAttribute("preload");
  });
});

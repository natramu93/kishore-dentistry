import type { ReactNode } from "react";
import { BrandWordmark } from "@/components/brand";

type AuthPageShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** Shared, mobile-first presentation for password recovery and account setup. */
export function AuthPageShell({
  title,
  description,
  children,
  footer,
}: AuthPageShellProps) {
  return (
    <main
      aria-labelledby="auth-page-title"
      aria-describedby="auth-page-description"
      className="flex min-h-svh flex-1 items-center justify-center overflow-x-hidden bg-sidebar pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center sm:mb-8">
          <BrandWordmark
            surface="navy"
            className="mx-auto mb-4 h-auto w-full max-w-52 select-none"
            preload
          />
          <h1
            id="auth-page-title"
            className="text-xl font-semibold leading-tight text-sidebar-foreground sm:text-2xl"
          >
            {title}
          </h1>
          <p
            id="auth-page-description"
            className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-sidebar-foreground/80"
          >
            {description}
          </p>
        </header>

        {children}

        {footer ? (
          <footer className="mt-4 flex justify-center text-center text-sm">
            {footer}
          </footer>
        ) : null}
      </div>
    </main>
  );
}

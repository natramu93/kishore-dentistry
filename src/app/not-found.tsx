import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandWordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div className="max-w-md space-y-4">
        <div className="mx-auto w-fit max-w-full rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-border">
          <BrandWordmark surface="light" className="mx-auto h-16 max-w-full" />
        </div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground">
          The page may have moved, or you may not have access to it.
        </p>
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}

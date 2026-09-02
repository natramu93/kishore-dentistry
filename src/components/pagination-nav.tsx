import Link from "next/link";
import { Button } from "@/components/ui/button";

type SearchParams = Record<string, string | undefined>;

function pageHref(
  pathname: string,
  searchParams: SearchParams,
  page: number,
  pageParam: string
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && key !== pageParam) params.set(key, value);
  }
  if (page > 1) params.set(pageParam, String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function PaginationNav({
  pathname,
  searchParams,
  page,
  pageSize,
  total,
  pageParam = "page",
}: {
  pathname: string;
  searchParams: SearchParams;
  page: number;
  pageSize: number;
  total: number;
  pageParam?: string;
}) {
  if (total === 0) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const first = (safePage - 1) * pageSize + 1;
  const last = Math.min(safePage * pageSize, total);

  return (
    <nav
      aria-label="Results pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button
          asChild={safePage > 1}
          disabled={safePage <= 1}
          size="sm"
          variant="outline"
        >
          {safePage > 1 ? (
            <Link
              href={pageHref(pathname, searchParams, safePage - 1, pageParam)}
              rel="prev"
            >
              Previous
            </Link>
          ) : (
            <span>Previous</span>
          )}
        </Button>
        <span className="min-w-24 text-center text-sm">
          Page {safePage} of {pageCount}
        </span>
        <Button
          asChild={safePage < pageCount}
          disabled={safePage >= pageCount}
          size="sm"
          variant="outline"
        >
          {safePage < pageCount ? (
            <Link
              href={pageHref(pathname, searchParams, safePage + 1, pageParam)}
              rel="next"
            >
              Next
            </Link>
          ) : (
            <span>Next</span>
          )}
        </Button>
      </div>
    </nav>
  );
}

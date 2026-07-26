import { formatInTimeZone } from "date-fns-tz";
import { getAuthContext } from "@/lib/auth/context";
import {
  defaultReportRange,
  getReportsData,
} from "@/data/reports";
import { PublicError } from "@/lib/errors";
import { assertActionRateLimit } from "@/lib/rate-limit";
import { buildReportCsv } from "@/lib/reports/csv";
import { CLINIC_TZ, clinicDayRange } from "@/lib/tz";

export const dynamic = "force-dynamic";

function publicErrorStatus(error: PublicError): number {
  switch (error.code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "CONFLICT":
      return 409;
    default:
      return 400;
  }
}

function clinicDate(iso: string, endExclusive = false): string {
  const value = endExclusive
    ? new Date(Date.parse(iso) - 1)
    : new Date(iso);
  return formatInTimeZone(value, CLINIC_TZ, "yyyy-MM-dd");
}

export async function GET(request: Request) {
  // Keep authentication outside the error-mapping block so Next.js can
  // preserve getAuthContext's framework redirect for an expired session.
  const ctx = await getAuthContext();

  try {
    await assertActionRateLimit(ctx.userId, "report-export", {
      limit: 10,
      windowMs: 60_000,
    });

    const search = new URL(request.url).searchParams;
    const fromParam = search.get("from") || undefined;
    const toParam = search.get("to") || undefined;
    const fallback = defaultReportRange();
    const from = fromParam
      ? clinicDayRange(fromParam).start
      : fallback.from;
    const to = toParam ? clinicDayRange(toParam).end : fallback.to;

    const data = await getReportsData(ctx, {
      from,
      to,
      branchId: search.get("branch") || undefined,
      doctorId: search.get("doctor") || undefined,
    });
    const filenameFrom = fromParam ?? clinicDate(data.range.from);
    const filenameTo =
      toParam ?? clinicDate(data.range.to, true);
    const filename = `dentistry-report-${filenameFrom}-to-${filenameTo}.csv`;

    return new Response(buildReportCsv(data), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message },
        {
          status: publicErrorStatus(error),
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        }
      );
    }

    const reference = crypto.randomUUID();
    console.error(`Report export failed [${reference}]`, error);
    return Response.json(
      {
        error: `Unable to export this report. Please try again. Reference: ${reference}`,
      },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  }
}

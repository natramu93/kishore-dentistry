import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CallLogsPage from "@/app/(app)/call-logs/page";
import CallLogDetailPage from "@/app/(app)/call-logs/[id]/page";

vi.mock("@/lib/auth/context", () => ({ getAuthContext:vi.fn().mockResolvedValue({ role:"admin",userId:"test-admin" }) }));
vi.mock("@/data/call-tracking", () => ({
  listCallLogs:vi.fn().mockResolvedValue({ total:1,callLogs:[{ id:"old-call",status:"completed",caller_name:"Test Caller",lead:null,source_system:"test",started_at:"2017-01-01T18:29:00Z" }] }),
  listExternalAppointments:vi.fn().mockResolvedValue([{ id:"old-appointment",patient_name:"Test Patient",lead:null,status:"scheduled",source_system:"test",scheduled_at:"2017-01-01T18:30:00Z" }]),
  getCallLog:vi.fn().mockResolvedValue({ id:"old-call",status:"completed",caller_name:"Test Caller",lead:null,source_system:"test",started_at:"2017-01-01T18:29:00Z",ended_at:"2017-01-01T18:30:00Z",duration_seconds:60,recording_url:null,
    statusEvents:[{ id:"event-1",status:"completed",occurred_at:"2017-01-02T06:30:00Z" }],lastWebhookEvent:null }),
}));
afterEach(cleanup);

describe("stored history uses AM/PM in clinic time", () => {
  it("formats preexisting call and external appointment records in their correct India-time day", async () => {
    render(await CallLogsPage({ searchParams:Promise.resolve({}) }));
    expect(screen.getByText("1 Jan 2017, 11:59 PM")).toBeInTheDocument();
    expect(screen.getByText("2 Jan 2017, 12:00 AM")).toBeInTheDocument();
  });
  it("formats stored call start/end and status-history timestamps, including noon", async () => {
    render(await CallLogDetailPage({ params:Promise.resolve({ id:"old-call" }) }));
    expect(screen.getByText("1 Jan 2017, 11:59 PM")).toBeInTheDocument();
    expect(screen.getByText("2 Jan 2017, 12:00 AM")).toBeInTheDocument();
    expect(screen.getByText("2 Jan 2017, 12:00 PM")).toBeInTheDocument();
  });
});

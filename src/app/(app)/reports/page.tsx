import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { canViewReports } from "@/lib/auth/guards";
import { getReportsData, reportRangeLabel, type ReportRow } from "@/data/reports";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/tz";
import { Stethoscope, Building2, CalendarRange, ClipboardList } from "lucide-react";

export const metadata = { title: "Reports — Dr. Kishor's Dentistry CRM" };

const DAYS = 30;

export default async function ReportsPage() {
  const ctx = await getAuthContext();
  if (!canViewReports(ctx.role)) redirect("/dashboard");

  const data = await getReportsData(ctx, { days: DAYS });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.role === "admin" ? "All branches" : "Your branches"} · revenue is measured by
          treatment cost recorded at time of care
        </p>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <TotalCard label="Total leads" value={data.totals.leads} accent="border-l-blue-400" />
        <TotalCard label="Appointments" value={data.totals.appointments} accent="border-l-violet-400" />
        <TotalCard label="Follow-ups" value={data.totals.followUps} accent="border-l-amber-400" />
        <TotalCard label="Revenue" value={formatINR(data.totals.revenue)} accent="border-l-emerald-400" />
      </div>

      <Card className="border-l-4 border-l-gold">
        <CardContent className="pt-5">
          <Tabs defaultValue="doctor">
            <TabsList className="mb-4 flex-wrap h-auto">
              <TabsTrigger value="doctor">
                <Stethoscope className="h-4 w-4 mr-1.5" />
                By Doctor
              </TabsTrigger>
              <TabsTrigger value="center">
                <Building2 className="h-4 w-4 mr-1.5" />
                By Center
              </TabsTrigger>
              <TabsTrigger value="day">
                <CalendarRange className="h-4 w-4 mr-1.5" />
                By Day ({reportRangeLabel(DAYS)})
              </TabsTrigger>
              <TabsTrigger value="treatment">
                <ClipboardList className="h-4 w-4 mr-1.5" />
                By Treatment
              </TabsTrigger>
            </TabsList>

            <TabsContent value="doctor">
              <ReportTable rows={data.byDoctor} firstColumn="Doctor" emptyText="No doctor activity yet" />
            </TabsContent>
            <TabsContent value="center">
              <ReportTable rows={data.byCenter} firstColumn="Center" emptyText="No branch activity yet" />
            </TabsContent>
            <TabsContent value="day">
              <ReportTable rows={data.byDay} firstColumn="Day" emptyText="No activity in this window" />
            </TabsContent>
            <TabsContent value="treatment">
              <ReportTable rows={data.byTreatment} firstColumn="Treatment" emptyText="No treatments recorded yet" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function TotalCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <Card className={`border-l-4 ${accent}`}>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ReportTable({
  rows,
  firstColumn,
  emptyText,
}: {
  rows: ReportRow[];
  firstColumn: string;
  emptyText: string;
}) {
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{firstColumn}</TableHead>
          <TableHead className="text-right">Leads</TableHead>
          <TableHead className="text-right">Appointments</TableHead>
          <TableHead className="text-right">Follow-ups</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
              {emptyText}
            </TableCell>
          </TableRow>
        )}
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="font-medium">{r.label}</TableCell>
            <TableCell className="text-right">{r.leads || "—"}</TableCell>
            <TableCell className="text-right">{r.appointments || "—"}</TableCell>
            <TableCell className="text-right">{r.followUps || "—"}</TableCell>
            <TableCell className="text-right font-semibold">
              {r.revenue ? formatINR(r.revenue) : "—"}
            </TableCell>
          </TableRow>
        ))}
        {rows.length > 0 && (
          <TableRow className="bg-muted/40">
            <TableCell className="font-semibold">Total</TableCell>
            <TableCell className="text-right font-semibold">
              {rows.reduce((s, r) => s + r.leads, 0)}
            </TableCell>
            <TableCell className="text-right font-semibold">
              {rows.reduce((s, r) => s + r.appointments, 0)}
            </TableCell>
            <TableCell className="text-right font-semibold">
              {rows.reduce((s, r) => s + r.followUps, 0)}
            </TableCell>
            <TableCell className="text-right font-semibold">{formatINR(totalRevenue)}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

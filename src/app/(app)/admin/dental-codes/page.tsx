import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listTreatmentCodeCatalog } from "@/data/catalogs";
import {
  createTreatmentCodeAction,
  toggleTreatmentCodeActive,
  updateTreatmentCodeAction,
} from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Dental Codes — Admin" };

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export default async function DentalCodesPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");

  const codes = (await listTreatmentCodeCatalog(ctx, { includeInactive: true })).sort(
    (a, b) => a.code_system.localeCompare(b.code_system) || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  const icdCount = codes.filter((code) => code.code_system === "ICD10_IN").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dental code catalogue</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {icdCount} WHO ICD-10 K00–K14 diagnosis codes. Active codes appear in every new case sheet.
          </p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            ICD-10 records diagnoses and are the only codes available for new clinical entries.
          </p>
        </div>
        <FormDialog triggerLabel="New dental code" title="Add dental code" action={createTreatmentCodeAction}>
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input id="code" name="code" required placeholder="e.g. K02.9" className="font-mono uppercase" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Description</Label>
            <Input id="name" name="name" required placeholder="Dental caries, unspecified" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input id="category" name="category" placeholder="e.g. K02" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="code_level">Level</Label>
              <select id="code_level" name="code_level" className={selectClass} defaultValue="detail">
                <option value="detail">Detail</option>
                <option value="category">Category</option>
              </select>
            </div>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Input type="checkbox" name="billable" value="true" defaultChecked className="size-4" />
            <span>Billable / selectable for treatment entries</span>
          </label>
        </FormDialog>
      </div>

      <Table aria-label="Managed dental code catalogue">
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="hidden md:table-cell">Level</TableHead>
            <TableHead>Billable</TableHead>
            <TableHead>Status</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {codes.map((code) => (
            <TableRow key={code.code}>
              <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{code.code}</TableCell>
              <TableCell>
                <div className="font-medium">{code.name}</div>
                <div className="text-xs text-muted-foreground lg:hidden">ICD-10 (India-aligned)</div>
              </TableCell>
              <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{code.code_level}</TableCell>
              <TableCell>{code.billable ? "Yes" : "No"}</TableCell>
              <TableCell>
                <Badge variant={code.status === "active" ? "default" : "secondary"}>
                  {code.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <RowEditDialog title={`Edit ${code.code}`} action={updateTreatmentCodeAction.bind(null, code.code)}>
                    <div className="space-y-2">
                      <Label htmlFor={`name-${code.code}`}>Description</Label>
                      <Input id={`name-${code.code}`} name="name" defaultValue={code.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`category-${code.code}`}>Category</Label>
                      <Input id={`category-${code.code}`} name="category" defaultValue={code.category ?? ""} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`level-${code.code}`}>Level</Label>
                      <select id={`level-${code.code}`} name="code_level" className={selectClass} defaultValue={code.code_level}>
                        <option value="detail">Detail</option>
                        <option value="category">Category</option>
                      </select>
                    </div>
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <Input type="checkbox" name="billable" value="true" defaultChecked={code.billable} className="size-4" />
                      <span>Billable / selectable for treatment entries</span>
                    </label>
                  </RowEditDialog>
                  <ToggleActiveButton
                    isActive={code.status === "active"}
                    action={toggleTreatmentCodeActive.bind(null, code.code, code.status !== "active")}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

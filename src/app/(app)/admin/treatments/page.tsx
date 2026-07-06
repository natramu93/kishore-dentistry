import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listTreatmentTypes } from "@/data/catalogs";
import { createTreatmentTypeAction, toggleTreatmentTypeActive } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/tz";

export const metadata = { title: "Treatment Types — Admin" };

export default async function TreatmentTypesPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const types = await listTreatmentTypes(ctx, { includeInactive: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treatment types</h1>
          <p className="text-sm text-muted-foreground">
            The treatment catalog used in treatment records and invoice line items.
          </p>
        </div>
        <FormDialog triggerLabel="New treatment" title="Add treatment type" action={createTreatmentTypeAction}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default_cost">Default cost (₹)</Label>
            <Input id="default_cost" name="default_cost" type="number" min="0" step="0.01" />
          </div>
        </FormDialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Default cost</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell>{t.default_cost != null ? formatINR(t.default_cost) : "—"}</TableCell>
              <TableCell>
                <Badge variant={t.is_active ? "default" : "secondary"}>
                  {t.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <ToggleActiveButton
                  isActive={t.is_active}
                  action={toggleTreatmentTypeActive.bind(null, t.id, !t.is_active)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

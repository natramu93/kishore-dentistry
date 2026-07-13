import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listTreatmentTypes } from "@/data/catalogs";
import { createTreatmentTypeAction, toggleTreatmentTypeActive, updateTreatmentTypeAction } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatINR } from "@/lib/tz";
import { CATEGORY_ORDER, categoryRank } from "@/lib/dental";

export const metadata = { title: "Treatment Types — Admin" };

// Reused datalist of known categories (admins can also type a new one)
function CategoryField({ id, defaultValue }: { id: string; defaultValue?: string | null }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Category</Label>
      <Input id={id} name="category" list="treatment-categories" defaultValue={defaultValue ?? ""} placeholder="e.g. Orthodontics" />
      <datalist id="treatment-categories">
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

export default async function TreatmentTypesPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin" && ctx.role !== "clinical_head") redirect("/dashboard");
  const types = (await listTreatmentTypes(ctx, { includeInactive: true })).sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treatment catalog</h1>
          <p className="text-sm text-muted-foreground">
            {types.length} treatments. Prices auto-fill invoices and treatment records.
          </p>
        </div>
        <FormDialog triggerLabel="New treatment" title="Add treatment type" action={createTreatmentTypeAction}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required />
          </div>
          <CategoryField id="new-cat" />
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
            <TableHead>Category</TableHead>
            <TableHead>Default cost</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-muted-foreground">{t.category ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap">
                {t.default_cost != null ? formatINR(t.default_cost) : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={t.is_active ? "default" : "secondary"}>
                  {t.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <RowEditDialog title="Edit treatment type" action={updateTreatmentTypeAction.bind(null, t.id)}>
                    <div className="space-y-2">
                      <Label htmlFor={`tname-${t.id}`}>Name</Label>
                      <Input id={`tname-${t.id}`} name="name" defaultValue={t.name} required />
                    </div>
                    <CategoryField id={`tcat-${t.id}`} defaultValue={t.category} />
                    <div className="space-y-2">
                      <Label htmlFor={`tcost-${t.id}`}>Default cost (₹)</Label>
                      <Input
                        id={`tcost-${t.id}`}
                        name="default_cost"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={t.default_cost ?? ""}
                      />
                    </div>
                  </RowEditDialog>
                  <ToggleActiveButton
                    isActive={t.is_active}
                    action={toggleTreatmentTypeActive.bind(null, t.id, !t.is_active)}
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

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listTreatmentTypes } from "@/data/catalogs";
import { listMyBranches } from "@/data/branches";
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
  const datalistId = `${id}-categories`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Category</Label>
      <Input id={id} name="category" list={datalistId} defaultValue={defaultValue ?? ""} placeholder="e.g. Orthodontics" />
      <datalist id={datalistId}>
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

export default async function TreatmentTypesPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  if (!["admin", "operations", "clinical_head"].includes(ctx.role)) redirect("/dashboard");
  const branches = await listMyBranches(ctx);
  const branch = branches.find((item) => item.id === params.branch) ?? branches[0];
  if (!branch) redirect("/dashboard");
  const types = (await listTreatmentTypes(ctx, { includeInactive: true, branchId: branch.id })).sort(
    (a, b) => Number(b.is_general_consultation) - Number(a.is_general_consultation) || categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treatment catalog</h1>
          <p className="text-sm text-muted-foreground">
            {types.length} treatments. Prices auto-fill invoices and treatment records.
          </p>
        </div>
        <form method="get" className="min-w-48 space-y-1">
          <label htmlFor="branch" className="text-sm font-medium">Center</label>
          <select id="branch" name="branch" defaultValue={branch.id} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
            {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </form>
        <FormDialog triggerLabel="New treatment" title="Add treatment type" action={createTreatmentTypeAction}>
          <input type="hidden" name="branch_id" value={branch.id} />
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

      <Table aria-label="Treatment catalog">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead>Default cost</TableHead>
            <TableHead>Status</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.is_general_consultation ? "General consultation" : t.name}</TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{t.category ?? "—"}</TableCell>
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
                  <RowEditDialog title="Edit treatment type" action={updateTreatmentTypeAction.bind(null, t.id, branch.id)}>
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
                    action={toggleTreatmentTypeActive.bind(null, t.id, branch.id, !t.is_active)}
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

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listLeadSources } from "@/data/catalogs";
import { createLeadSourceAction, toggleLeadSourceActive, updateLeadSourceAction } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Lead Sources — Admin" };

export default async function SourcesPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const sources = await listLeadSources(ctx, { includeInactive: true });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lead sources</h1>
          <p className="text-sm text-muted-foreground">
            Where leads come from — Twitter, Facebook, reference, and anything you add here.
          </p>
        </div>
        <FormDialog triggerLabel="New source" title="Add lead source" action={createLeadSourceAction}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="e.g. JustDial" />
          </div>
        </FormDialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>
                <Badge variant={s.is_active ? "default" : "secondary"}>
                  {s.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <RowEditDialog title="Edit lead source" action={updateLeadSourceAction.bind(null, s.id)}>
                    <div className="space-y-2">
                      <Label htmlFor={`name-${s.id}`}>Name</Label>
                      <Input id={`name-${s.id}`} name="name" defaultValue={s.name} required />
                    </div>
                  </RowEditDialog>
                  <ToggleActiveButton
                    isActive={s.is_active}
                    action={toggleLeadSourceActive.bind(null, s.id, !s.is_active)}
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

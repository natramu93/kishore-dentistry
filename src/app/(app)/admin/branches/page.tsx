import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listBranches } from "@/data/branches";
import { createBranchAction, toggleBranchActive, updateBranchAction } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Branches — Admin" };

export default async function BranchesPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const branches = await listBranches(ctx, { includeInactive: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Branches</h1>
          <p className="text-sm text-muted-foreground">
            Add a branch here to scale — users, doctors and leads can be attached to it immediately.
          </p>
        </div>
        <FormDialog triggerLabel="New branch" title="Create branch" action={createBranchAction}>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="e.g. OMR" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">Code (used in invoice numbers)</Label>
            <Input id="code" name="code" required maxLength={6} placeholder="e.g. OMR" className="uppercase" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
        </FormDialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-medium">{b.name}</TableCell>
              <TableCell>{b.code}</TableCell>
              <TableCell className="text-muted-foreground">{b.address}</TableCell>
              <TableCell className="text-muted-foreground">{b.phone}</TableCell>
              <TableCell>
                <Badge variant={b.is_active ? "default" : "secondary"}>
                  {b.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <RowEditDialog title="Edit branch" action={updateBranchAction.bind(null, b.id)}>
                    <div className="space-y-2">
                      <Label htmlFor={`bname-${b.id}`}>Name</Label>
                      <Input id={`bname-${b.id}`} name="name" defaultValue={b.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`bcode-${b.id}`}>Code</Label>
                      <Input id={`bcode-${b.id}`} name="code" defaultValue={b.code} maxLength={6} required className="uppercase" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`baddr-${b.id}`}>Address</Label>
                      <Input id={`baddr-${b.id}`} name="address" defaultValue={b.address ?? ""} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`bphone-${b.id}`}>Phone</Label>
                      <Input id={`bphone-${b.id}`} name="phone" defaultValue={b.phone ?? ""} />
                    </div>
                  </RowEditDialog>
                  <ToggleActiveButton
                    isActive={b.is_active}
                    action={toggleBranchActive.bind(null, b.id, !b.is_active)}
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

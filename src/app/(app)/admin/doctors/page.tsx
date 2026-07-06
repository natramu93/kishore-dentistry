import { getAuthContext } from "@/lib/auth/context";
import { listDoctors } from "@/data/catalogs";
import { listMyBranches } from "@/data/branches";
import { createDoctorAction, toggleDoctorActive } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Doctors — Admin" };

export default async function DoctorsPage() {
  const ctx = await getAuthContext();
  const [doctors, branches] = await Promise.all([
    listDoctors(ctx, { includeInactive: true }),
    listMyBranches(ctx),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Doctors</h1>
          <p className="text-sm text-muted-foreground">
            Doctors are attached to a branch and appear in appointment and treatment forms.
          </p>
        </div>
        <FormDialog triggerLabel="New doctor" title="Add doctor" action={createDoctorAction}>
          <div className="space-y-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" name="full_name" required placeholder="Dr. …" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branch_id">Branch</Label>
            <select
              id="branch_id"
              name="branch_id"
              required
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="specialization">Specialization</Label>
            <Input id="specialization" name="specialization" placeholder="e.g. Orthodontist" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
        </FormDialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Specialization</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {doctors.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.full_name}</TableCell>
              <TableCell>{d.branch?.name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{d.specialization}</TableCell>
              <TableCell className="text-muted-foreground">{d.phone}</TableCell>
              <TableCell>
                <Badge variant={d.is_active ? "default" : "secondary"}>
                  {d.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <ToggleActiveButton
                  isActive={d.is_active}
                  action={toggleDoctorActive.bind(null, d.id, !d.is_active)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

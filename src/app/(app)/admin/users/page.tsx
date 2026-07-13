import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listUsers, listDoctorsForLinking } from "@/data/users";
import { listBranches } from "@/data/branches";
import { createUserAction, toggleUserActive, updateUserAction } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS } from "@/components/nav-items";

export const metadata = { title: "Users — Admin" };

function RoleSelect({ id, defaultValue, disabled }: { id: string; defaultValue: string; disabled?: boolean }) {
  return (
    <select
      id={id}
      name="role"
      defaultValue={defaultValue}
      disabled={disabled}
      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-60"
    >
      <option value="front_office">Front Office — reception: intake, booking, own leads</option>
      <option value="operations">Operations — runs the branch: full lead/appt/invoice access</option>
      <option value="clinical_head">Clinical Head — treatment catalog, doctor roster, clinical oversight</option>
      <option value="doctor">Doctor — sees only their own schedule and patients</option>
      <option value="admin">Admin — everything, all branches</option>
    </select>
  );
}

function DoctorLinkField({
  id,
  doctors,
  defaultValue,
}: {
  id: string;
  doctors: { id: string; full_name: string; branch: { name: string } | null; alreadyLinked: boolean }[];
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Link to doctor record (only used when Role = Doctor)</Label>
      <select
        id={id}
        name="doctor_record_id"
        defaultValue={defaultValue ?? ""}
        className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
      >
        <option value="">— Not linked —</option>
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.full_name}{d.branch ? ` (${d.branch.name})` : ""}
            {d.alreadyLinked && d.id !== defaultValue ? " — already linked" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default async function UsersPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const [users, branches, linkableDoctors] = await Promise.all([
    listUsers(ctx),
    listBranches(ctx),
    listDoctorsForLinking(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Allocate one user to multiple branches, or split branches across users.
          </p>
        </div>
        <FormDialog triggerLabel="New user" title="Create user" action={createUserAction}>
          <div className="space-y-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="text" required minLength={8} placeholder="min 8 characters" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <RoleSelect id="role" defaultValue="front_office" />
          </div>
          <DoctorLinkField id="doctor_record_id" doctors={linkableDoctors} />
          <fieldset className="space-y-2">
            <Label>Branch allocation</Label>
            <div className="grid grid-cols-2 gap-2">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                  <input type="checkbox" name="branch_ids" value={b.id} className="accent-primary" />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
        </FormDialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Branches</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.full_name}</TableCell>
              <TableCell className="text-muted-foreground">{u.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {u.role === "admin" ? (
                    <span className="text-xs text-muted-foreground">All branches</span>
                  ) : u.branches.length ? (
                    u.branches.map((b) => (
                      <Badge key={b.id} variant="secondary">{b.code}</Badge>
                    ))
                  ) : (
                    <span className="text-xs text-destructive">None allocated</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={u.is_active ? "default" : "secondary"}>
                  {u.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <RowEditDialog title={`Edit ${u.full_name}`} action={updateUserAction.bind(null, u.id)}>
                    <input type="hidden" name="manage_branches" value="1" />
                    <div className="space-y-2">
                      <Label htmlFor={`uname-${u.id}`}>Full name</Label>
                      <Input id={`uname-${u.id}`} name="full_name" defaultValue={u.full_name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`uphone-${u.id}`}>Phone</Label>
                      <Input id={`uphone-${u.id}`} name="phone" defaultValue={u.phone ?? ""} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`urole-${u.id}`}>Role</Label>
                      <RoleSelect id={`urole-${u.id}`} defaultValue={u.role} disabled={u.id === ctx.userId} />
                      {u.id === ctx.userId && (
                        <p className="text-xs text-muted-foreground">You can&apos;t change your own role.</p>
                      )}
                    </div>
                    <DoctorLinkField
                      id={`udoc-${u.id}`}
                      doctors={linkableDoctors}
                      defaultValue={u.linkedDoctorId ?? undefined}
                    />
                    <fieldset className="space-y-2">
                      <Label>Branch allocation</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {branches.map((b) => (
                          <label key={b.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                            <input
                              type="checkbox"
                              name="branch_ids"
                              value={b.id}
                              defaultChecked={u.branches.some((ub) => ub.id === b.id)}
                              className="accent-primary"
                            />
                            {b.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </RowEditDialog>
                  {u.id !== ctx.userId && (
                    <ToggleActiveButton
                      isActive={u.is_active}
                      action={toggleUserActive.bind(null, u.id, !u.is_active)}
                    />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

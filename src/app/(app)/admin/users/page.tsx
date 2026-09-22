import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listUsers, listDoctorsForLinking } from "@/data/users";
import { listBranches } from "@/data/branches";
import { createUserAction, sendUserPasswordResetAction, toggleUserActive, updateUserAction } from "@/actions/admin";
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
import { PaginationNav } from "@/components/pagination-nav";
import { PasswordResetButton } from "@/components/admin/password-reset-button";

export const metadata = { title: "Users — Admin" };

function RoleSelect({ id, defaultValue, disabled }: { id: string; defaultValue: string; disabled?: boolean }) {
  return (
    <select
      id={id}
      name="role"
      defaultValue={defaultValue}
      disabled={disabled}
      className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-60"
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
        className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm"
      >
        <option value="">— Not linked —</option>
        {doctors.map((d) => (
          <option
            key={d.id}
            value={d.id}
            disabled={d.alreadyLinked && d.id !== defaultValue}
          >
            {d.full_name}{d.branch ? ` (${d.branch.name})` : ""}
            {d.alreadyLinked && d.id !== defaultValue ? " — already linked" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const [userResult, branches, linkableDoctors] = await Promise.all([
    listUsers(ctx, { page: Number(params.page) }),
    listBranches(ctx),
    listDoctorsForLinking(ctx),
  ]);
  const { users, total, page, pageSize } = userResult;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            {total} user{total === 1 ? "" : "s"} · Allocate one user to
            multiple branches, or split branches across users.
          </p>
        </div>
        <FormDialog
          triggerLabel="New user"
          title="Create user"
          action={createUserAction}
          submitLabel="Create user"
          successMessage="User created"
        >
          <div className="space-y-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Set an initial password for this account and share it securely. It
            will not be shown again. The user can change it from My profile.
          </p>
          <div className="space-y-2">
            <Label htmlFor="password">Initial password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <RoleSelect id="role" defaultValue="front_office" />
          </div>
          <DoctorLinkField id="doctor_record_id" doctors={linkableDoctors} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Branch allocation</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {branches.map((b) => (
                <label key={b.id} className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <input type="checkbox" name="branch_ids" value={b.id} className="size-5 accent-primary" />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
        </FormDialog>
      </div>

      <Table aria-label="Users">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden lg:table-cell">Centers</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="whitespace-normal font-medium">
                {u.full_name}
                <span className="mt-1 block break-all text-xs font-normal text-muted-foreground md:hidden">
                  {u.email} · {u.is_active ? "Active" : "Inactive"}
                </span>
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">{u.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{ROLE_LABELS[u.role]}</Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
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
              <TableCell className="hidden md:table-cell">
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
                      <Input
                        id={`uphone-${u.id}`}
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        defaultValue={u.phone ?? ""}
                      />
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
                      <legend className="text-sm font-medium">Branch allocation</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {branches.map((b) => (
                          <label key={b.id} className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              name="branch_ids"
                              value={b.id}
                              defaultChecked={u.branches.some((ub) => ub.id === b.id)}
                              className="size-5 accent-primary"
                            />
                            {b.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </RowEditDialog>
                  <PasswordResetButton
                    email={u.email}
                    action={sendUserPasswordResetAction.bind(null, u.id)}
                  />
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
      <PaginationNav
        pathname="/admin/users"
        searchParams={params}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}

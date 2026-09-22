import { getAuthContext } from "@/lib/auth/context";
import { listMyBranches } from "@/data/branches";
import { ROLE_LABELS } from "@/components/nav-items";
import { PasswordUpdateForm } from "@/components/profile/password-update-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const ctx = await getAuthContext();
  const branches = await listMyBranches(ctx);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">Review your account and update your password.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Account details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Name</dt><dd className="font-medium">{ctx.fullName || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="break-all font-medium">{ctx.email}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Role</dt><dd className="font-medium">{ROLE_LABELS[ctx.role]}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Branches</dt><dd className="font-medium">{ctx.role === "admin" ? "All branches" : branches.length ? branches.map((branch) => branch.name).join(", ") : "None allocated"}</dd></div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Update password</CardTitle></CardHeader>
        <CardContent><PasswordUpdateForm /></CardContent>
      </Card>
    </div>
  );
}


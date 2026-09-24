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
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getTelephoneHref } from "@/lib/clinic";
import { cn } from "@/lib/utils";

export const metadata = { title: "Branches — Admin" };

function getDirectionsHref(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function BranchAddress({
  address,
  branchName,
  className,
  showEmpty = false,
}: {
  address: string | null;
  branchName: string;
  className?: string;
  showEmpty?: boolean;
}) {
  const trimmedAddress = address?.trim();
  if (!trimmedAddress) return showEmpty ? "—" : null;
  const directionsHref = getDirectionsHref(trimmedAddress);

  return (
    <address className={cn("not-italic", className)}>
      <span className="block whitespace-pre-line">{trimmedAddress}</span>
      <a
        href={directionsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex min-h-11 items-center text-xs underline underline-offset-2"
        aria-label={`Get directions to ${branchName} (opens in a new tab)`}
      >
        Directions
      </a>
    </address>
  );
}

function BranchPhone({
  phone,
  branchName,
  className,
  showEmpty = false,
}: {
  phone: string | null;
  branchName: string;
  className?: string;
  showEmpty?: boolean;
}) {
  const trimmedPhone = phone?.trim();
  if (!trimmedPhone) return showEmpty ? "—" : null;

  const telephoneHref = getTelephoneHref(trimmedPhone);
  if (!telephoneHref) return <span className={className}>{trimmedPhone}</span>;

  return (
    <a
      href={telephoneHref}
      className={cn("inline-flex min-h-11 items-center", className)}
      aria-label={`Call ${branchName} at ${trimmedPhone}`}
    >
      {trimmedPhone}
    </a>
  );
}

export default async function BranchesPage() {
  const ctx = await getAuthContext();
  if (ctx.role !== "admin") redirect("/dashboard");
  const branches = await listBranches(ctx, { includeInactive: true });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
            <Textarea id="address" name="address" autoComplete="street-address" rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
          </div>
          <div className="space-y-2"><Label htmlFor="company_name">Invoice company name</Label><Input id="company_name" name="company_name" maxLength={200} /></div>
          <div className="space-y-2"><Label htmlFor="invoice_email">Invoice email</Label><Input id="invoice_email" name="invoice_email" type="email" maxLength={254} /></div>
          <div className="space-y-2"><Label htmlFor="gst_number">GST number</Label><Input id="gst_number" name="gst_number" maxLength={32} /></div>
        </FormDialog>
      </div>

      <Table aria-label="Branches">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead className="hidden lg:table-cell">Address</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {branches.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="whitespace-normal font-medium">
                {b.name}
                <BranchAddress
                  address={b.address}
                  branchName={b.name}
                  className="mt-1 text-xs font-normal text-muted-foreground lg:hidden"
                />
                <BranchPhone
                  phone={b.phone}
                  branchName={b.name}
                  className="mt-1 block text-xs font-normal text-muted-foreground underline-offset-2 hover:underline md:hidden"
                />
              </TableCell>
              <TableCell>{b.code}</TableCell>
              <TableCell className="hidden whitespace-normal text-muted-foreground lg:table-cell">
                <BranchAddress
                  address={b.address}
                  branchName={b.name}
                  showEmpty
                />
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                <BranchPhone
                  phone={b.phone}
                  branchName={b.name}
                  className="hover:underline"
                  showEmpty
                />
              </TableCell>
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
                      <Textarea
                        id={`baddr-${b.id}`}
                        name="address"
                        defaultValue={b.address ?? ""}
                        autoComplete="street-address"
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`bphone-${b.id}`}>Phone</Label>
                      <Input
                        id={`bphone-${b.id}`}
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        defaultValue={b.phone ?? ""}
                      />
                    </div>
                    <div className="space-y-2"><Label htmlFor={`bcompany-${b.id}`}>Invoice company name</Label><Input id={`bcompany-${b.id}`} name="company_name" defaultValue={b.company_name ?? ""} maxLength={200} /></div>
                    <div className="space-y-2"><Label htmlFor={`bemail-${b.id}`}>Invoice email</Label><Input id={`bemail-${b.id}`} name="invoice_email" type="email" defaultValue={b.invoice_email ?? ""} maxLength={254} /></div>
                    <div className="space-y-2"><Label htmlFor={`bgst-${b.id}`}>GST number</Label><Input id={`bgst-${b.id}`} name="gst_number" defaultValue={b.gst_number ?? ""} maxLength={32} /></div>
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

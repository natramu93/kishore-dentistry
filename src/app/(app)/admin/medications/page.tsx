import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { listMedicationSuggestions } from "@/data/catalogs";
import { listMyBranches } from "@/data/branches";
import { createMedicationSuggestionAction, toggleMedicationSuggestionActive, updateMedicationSuggestionAction } from "@/actions/admin";
import { FormDialog } from "@/components/admin/form-dialog";
import { RowEditDialog } from "@/components/admin/row-edit-dialog";
import { ToggleActiveButton } from "@/components/admin/toggle-active-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Medication suggestions — Admin" };

export default async function MedicationSuggestionsPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const params = await searchParams;
  const ctx = await getAuthContext();
  if (!["admin", "operations", "clinical_head"].includes(ctx.role)) redirect("/dashboard");
  const branches = await listMyBranches(ctx);
  const branch = branches.find((item) => item.id === params.branch) ?? branches[0];
  if (!branch) redirect("/dashboard");
  const entries = await listMedicationSuggestions(ctx, branch.id, { includeInactive: true });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">Medication suggestions</h1><p className="text-sm text-muted-foreground">Center-specific picker for prescriptions. Doctors can also type medicines not listed here.</p></div>
      <form method="get" className="flex items-end gap-2"><div className="min-w-48 space-y-1"><label htmlFor="branch" className="text-sm font-medium">Center</label><select id="branch" name="branch" defaultValue={branch.id} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><Button type="submit" variant="outline">View</Button></form>
      <FormDialog triggerLabel="Add medicine" title="Add medication suggestion" action={createMedicationSuggestionAction}>
        <input type="hidden" name="branch_id" value={branch.id} />
        <div className="space-y-2"><Label htmlFor="name">Medicine name</Label><Input id="name" name="name" required maxLength={200} /></div>
        <div className="space-y-2"><Label htmlFor="strength">Strength (optional)</Label><Input id="strength" name="strength" maxLength={100} placeholder="e.g. 500 mg" /></div>
      </FormDialog>
    </div>
    <Table aria-label="Medication suggestions"><TableHeader><TableRow><TableHead>Medicine</TableHead><TableHead>Strength</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>
      {entries.map((entry) => <TableRow key={entry.id}><TableCell className="font-medium">{entry.name}</TableCell><TableCell>{entry.strength || "—"}</TableCell><TableCell><Badge variant={entry.is_active ? "default" : "secondary"}>{entry.is_active ? "Active" : "Inactive"}</Badge></TableCell><TableCell><div className="flex justify-end gap-1">
        <RowEditDialog title="Edit medication suggestion" action={updateMedicationSuggestionAction.bind(null, entry.id, branch.id)}><div className="space-y-2"><Label htmlFor={`med-${entry.id}`}>Medicine name</Label><Input id={`med-${entry.id}`} name="name" defaultValue={entry.name} required maxLength={200} /></div><div className="space-y-2"><Label htmlFor={`strength-${entry.id}`}>Strength (optional)</Label><Input id={`strength-${entry.id}`} name="strength" defaultValue={entry.strength ?? ""} maxLength={100} /></div></RowEditDialog>
        <ToggleActiveButton isActive={entry.is_active} action={toggleMedicationSuggestionActive.bind(null, entry.id, branch.id, !entry.is_active)} />
      </div></TableCell></TableRow>)}
      {entries.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No medication suggestions for {branch.name} yet.</TableCell></TableRow>}
    </TableBody></Table>
  </div>;
}

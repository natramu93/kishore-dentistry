import { getAuthContext } from "@/lib/auth/context";
import { listMyBranches } from "@/data/branches";
import { listLeadSources } from "@/data/catalogs";
import { NewLeadForm } from "./new-lead-form";

export const metadata = { title: "New Lead — Kishore Dentistry CRM" };

export default async function NewLeadPage() {
  const ctx = await getAuthContext();
  const [branches, sources] = await Promise.all([
    listMyBranches(ctx),
    listLeadSources(ctx),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New lead</h1>
        <p className="text-sm text-muted-foreground">
          Capture an enquiry — it starts in the <strong>Open</strong> pool for its branch.
        </p>
      </div>
      <NewLeadForm branches={branches} sources={sources} />
    </div>
  );
}

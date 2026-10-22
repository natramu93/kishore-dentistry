import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";

// Keep old bookmarks working without exposing the retired reminder workflow.
export default async function RetiredFollowUpsPage() {
  await getAuthContext();
  redirect("/appointments");
}

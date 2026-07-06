"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { completeFollowUpAction } from "@/actions/follow-ups";
import { Button } from "@/components/ui/button";

export function CompleteFollowUpButtons({ followUpId }: { followUpId: string }) {
  const [pending, startTransition] = useTransition();

  function complete(status: "done" | "cancelled") {
    startTransition(async () => {
      const result = await completeFollowUpAction(followUpId, status);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="flex gap-1 justify-end">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => complete("done")}>
        Done
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => complete("cancelled")}>
        Cancel
      </Button>
    </div>
  );
}

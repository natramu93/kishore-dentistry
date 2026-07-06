"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/actions/util";

export function ToggleActiveButton({
  isActive,
  action,
}: {
  isActive: boolean;
  action: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await action();
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

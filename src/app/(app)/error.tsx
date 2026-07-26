"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <h1 className="text-xl font-semibold">We couldn&apos;t load this page</h1>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="alert" className="text-muted-foreground">
          Something unexpected happened while rendering this page. Try again, or return to the
          dashboard if the problem continues.
        </p>
        <Button type="button" onClick={unstable_retry}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

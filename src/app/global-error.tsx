"use client";

import { useEffect } from "react";
import Image from "next/image";
import { TIRUPUR_CLINIC } from "@/lib/clinic";

export default function GlobalError({
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
    <html lang="en">
      <head>
        <title>Application error | {TIRUPUR_CLINIC.brandName}</title>
      </head>
      <body>
        <main
          style={{
            display: "grid",
            minHeight: "100vh",
            placeItems: "center",
            padding: "1rem",
            fontFamily: "system-ui, sans-serif",
            background: "#f6f8fc",
            color: "#10214e",
          }}
        >
          <div
            style={{
              maxWidth: "32rem",
              border: "1px solid #d9e0ec",
              borderRadius: "1rem",
              padding: "2rem",
              textAlign: "center",
              background: "white",
            }}
          >
            <Image
              src="/brand/kishors-dentistry-mark.png"
              alt={TIRUPUR_CLINIC.brandName}
              width={88}
              height={88}
              style={{ display: "block", margin: "0 auto 1rem" }}
            />
            <h1>We couldn&apos;t open the CRM</h1>
            <p role="alert">An unexpected error occurred. Please try loading the application again.</p>
            <button
              type="button"
              onClick={unstable_retry}
              style={{
                minHeight: "44px",
                marginTop: "1rem",
                border: 0,
                borderRadius: "0.5rem",
                padding: "0.75rem 1rem",
                background: "#003399",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}

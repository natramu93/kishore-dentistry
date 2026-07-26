"use client";

import { useEffect } from "react";

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
      <body>
        <main
          style={{
            display: "grid",
            minHeight: "100vh",
            placeItems: "center",
            padding: "1rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ maxWidth: "32rem", textAlign: "center" }}>
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
                background: "#293b9f",
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

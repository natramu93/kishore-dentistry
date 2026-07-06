"use client";

export function PrintButton() {
  return (
    <div className="mb-4 print:hidden flex justify-end">
      <button
        onClick={() => window.print()}
        className="rounded-md bg-black text-white px-4 py-2 text-sm font-medium"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}

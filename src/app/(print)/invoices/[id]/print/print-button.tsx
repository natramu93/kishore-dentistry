"use client";

export function PrintButton() {
  return (
    <div className="mb-4 print:hidden flex justify-end">
      <button
        type="button"
        onClick={() => window.print()}
        className="min-h-11 rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}

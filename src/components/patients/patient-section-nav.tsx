export type PatientSection = { id: string; label: string };

/** Anchor navigation keeps the full clinical history visible and works without JavaScript. */
export function PatientSectionNav({ sections }: { sections: readonly PatientSection[] }) {
  return (
    <nav aria-label="Patient sections" className="sticky top-0 z-20 rounded-xl border bg-background/95 p-1 shadow-sm backdrop-blur-sm">
      <div className="flex gap-1 overflow-x-auto overscroll-x-contain">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium whitespace-nowrap hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {section.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

// Loading placeholder: grey shapes in the layout of the cards to come, with
// the label for screen readers.

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="space-y-3 py-2">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 rounded-2xl bg-paper p-4" aria-hidden="true">
          <div className="skeleton h-6 w-2/3 rounded-lg" />
          <div className="skeleton h-4 w-1/2 rounded-lg" />
          <div className="skeleton h-4 w-1/3 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="py-10 text-center text-muted" role="status">
      {label}
    </p>
  );
}

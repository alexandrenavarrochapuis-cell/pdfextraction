// Re-mounted on every navigation, so each screen eases in.

export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}

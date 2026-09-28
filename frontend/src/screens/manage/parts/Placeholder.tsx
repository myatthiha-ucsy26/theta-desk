export function Placeholder({ label }: { label: string }) {
  return (
    <section className="border border-rule-strong bg-well p-4 text-sm text-ink-2">
      {label}
    </section>
  );
}

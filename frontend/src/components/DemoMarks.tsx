// What makes a demo desk impossible to mistake for a real one: a badge that says so in words, and a
// watermark across every screen, so a screenshot carries the label with it.

export function DemoBadge() {
  return (
    <span className="demo-badge" title="Every figure on this desk is simulated. Nothing here was traded.">
      DEMO · simulated data
    </span>
  );
}

export function DemoWatermark() {
  return <div aria-hidden="true" className="demo-watermark" />;
}

import type { OrbParams } from "../../lib/orb";

/**
 * The orb drawn in CSS, for a phone and for a browser with no WebGL: the same tone and up to
 * three of the same orbits, on a fraction of the cost.
 */
export function OrbFallback({ params }: { params: OrbParams }) {
  return (
    <div className="holo-orb-stage" data-testid="orb-fallback">
      <div className={`holo-orb holo-orb-${params.tone}`}>
        {Array.from({ length: Math.min(3, params.rings) }, (_, i) => (
          <span key={i} className={`holo-orb-ring holo-orb-ring-${i + 1}`} />
        ))}
      </div>
      <div className="holo-floor" />
    </div>
  );
}

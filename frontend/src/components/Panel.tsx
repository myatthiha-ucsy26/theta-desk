import { useContext, type ReactNode } from "react";
import { PanelFrame } from "../lib/panelFrame";

/**
 * A section of the page, not a box on it: a serif heading over a rule, then content set
 * directly on the paper. Borders and fills are reserved for things that actually float —
 * the size drawer, toasts, the 3D viewports. The head and title carry classes of their own
 * so a template can reset the section treatment without reaching into this file.
 */
export function Panel({ title, actions, children, className = "" }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const Frame = useContext(PanelFrame);
  const panel = (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      {(title || actions) && (
        <header className="panel-head flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ink pb-2">
          <h2 className="panel-title font-display text-[19px] font-semibold tracking-[-0.01em] text-ink min-[900px]:text-[21px]">
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className="panel-body min-w-0 pt-4">{children}</div>
    </section>
  );
  return Frame ? <Frame>{panel}</Frame> : panel;
}
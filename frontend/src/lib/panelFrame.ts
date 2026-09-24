// How a template dresses every panel without the panel knowing which template it is in. The
// shell provides a frame; Panel wraps itself in it. Left empty, a panel is exactly what it was —
// and the motion library a frame might use stays out of the bundle of templates that have none.
import { createContext, type ComponentType, type ReactNode } from "react";

export const PanelFrame = createContext<ComponentType<{ children: ReactNode }> | null>(null);

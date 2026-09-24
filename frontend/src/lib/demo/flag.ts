// Whether this build is the demo desk (./demo.sh builds with VITE_DEMO=1). A build-time constant:
// in the real desk it folds to false, and every demo module is dropped from the bundle with it.
export const DEMO = import.meta.env.VITE_DEMO === "1";

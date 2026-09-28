import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { DEMO } from "./lib/demo/flag";

if (DEMO) document.title = "Theta Desk · DEMO";

// A rebuild replaces the hashed chunks, so a tab opened before it asks for files that are gone.
// Reload once to pick up the new build; the timestamp stops a loop if the chunk is really missing.
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem("chunk-reload") ?? 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem("chunk-reload", String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

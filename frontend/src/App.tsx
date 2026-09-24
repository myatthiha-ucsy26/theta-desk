import { DemoWatermark } from "./components/DemoMarks";
import { Shell } from "./components/Shell";
import { DEMO } from "./lib/demo/flag";
import { useRoute } from "./lib/route";
import { Learn } from "./screens/Learn";
import { Manage } from "./screens/Manage";
import { Scan } from "./screens/Scan";
import { Settings } from "./screens/Settings";
import { Study } from "./screens/Study";

export function App() {
  const { screen, params } = useRoute();
  return (
    <>
      {/* Outside the shell, so no template's wrapper can clip it or carry it off the window. */}
      {DEMO && <DemoWatermark />}
      <Shell screen={screen}>
        {screen === "scan" && <Scan />}
        {screen === "study" && <Study ticker={params.ticker} dte={params.dte} />}
        {screen === "manage" && <Manage />}
        {screen === "learn" && <Learn />}
        {screen === "settings" && <Settings />}
      </Shell>
    </>
  );
}

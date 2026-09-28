import { DemoWatermark } from "./components/shared/DemoMarks";
import { Shell } from "./components/shared/Shell";
import { DEMO } from "./lib/demo/flag";
import { useRoute } from "./lib/infra/route";
import { Learn } from "./screens/learn/Learn";
import { Manage } from "./screens/manage/Manage";
import { Scan } from "./screens/scan/Scan";
import { Settings } from "./screens/settings/Settings";
import { Study } from "./screens/study/Study";

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

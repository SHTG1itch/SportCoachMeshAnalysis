import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Home } from "./screens/Home";
import { NewAnalysis } from "./screens/NewAnalysis";
import { AnalysisResult } from "./screens/AnalysisResult";
import { WorkoutsLibrary } from "./screens/WorkoutsLibrary";
import { History } from "./screens/History";
import { Settings } from "./screens/Settings";

export default function App() {
  const route = useStore((s) => s.route);
  const refresh = useStore((s) => s.refresh);
  const refreshSettings = useStore((s) => s.refreshSettings);
  const theme = useStore((s) => s.settings?.theme);

  useEffect(() => {
    refresh();
    refreshSettings();
  }, [refresh, refreshSettings]);

  // Apply the saved theme by toggling the `light` class on <html>; styles.css
  // swaps the palette variables under that class. Defaults to dark until settings
  // load (matching the dark-by-default markup).
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  return (
    <div className="h-screen w-screen flex bg-grain text-ink-100 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-10 py-8">
            {route.name === "home" && <Home />}
            {route.name === "new" && <NewAnalysis />}
            {route.name === "analysis" && (
              <AnalysisResult record={route.record} backTo={route.from ?? "home"} />
            )}
            {route.name === "workouts" && <WorkoutsLibrary />}
            {route.name === "history" && <History />}
            {route.name === "settings" && <Settings />}
          </div>
        </main>
      </div>
    </div>
  );
}

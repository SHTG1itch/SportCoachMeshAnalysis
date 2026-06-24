import {
  Activity,
  Dumbbell,
  History as HistoryIcon,
  Home as HomeIcon,
  Plus,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useStore, type Route } from "../store";

// On macOS the frameless window keeps its native traffic-light buttons in the
// top-left, which would sit on top of the logo; nudge the logo right to clear
// them. Windows/Linux draw their caption buttons on the right (see TopBar), so
// the logo stays flush left there.
const isMac =
  typeof window !== "undefined" && window.app?.platform === "darwin";

interface NavItem {
  icon: LucideIcon;
  label: string;
  routeName: Route["name"];
}

const NAV: NavItem[] = [
  { icon: HomeIcon, label: "Home", routeName: "home" },
  { icon: Plus, label: "New Analysis", routeName: "new" },
  { icon: Dumbbell, label: "Workouts", routeName: "workouts" },
  { icon: HistoryIcon, label: "History", routeName: "history" },
  { icon: SettingsIcon, label: "Settings", routeName: "settings" },
];

export function Sidebar() {
  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  return (
    <aside className="w-60 shrink-0 h-full border-r border-white/5 bg-canvas-800/60 backdrop-blur-sm flex flex-col">
      <div className="drag h-11 flex items-center px-4 border-b border-white/5">
        <div className={clsx("flex items-center gap-2 no-drag", isMac && "ml-16")}>
          <div className="h-6 w-6 rounded-md bg-accent-500/20 border border-accent-500/40 flex items-center justify-center">
            <Activity size={14} className="text-accent-400" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-ink-50">
            Mesh Coach
          </span>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = route.name === n.routeName;
          return (
            <button
              key={n.label}
              onClick={() => go({ name: n.routeName } as Route)}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-accent-500/10 text-accent-400 border border-accent-500/20"
                  : "text-ink-300 hover:text-ink-50 hover:bg-white/5 border border-transparent",
              )}
            >
              <Icon size={16} className="shrink-0" />
              <span className="min-w-0 truncate">{n.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="p-4 text-[11px] text-ink-400 border-t border-white/5">
        v0.1 · 3D pose from your device — nothing leaves until you ask.
      </div>
    </aside>
  );
}

import { useEffect, useState } from "react";
import clsx from "clsx";

type Glyph = "minimize" | "maximize" | "restore" | "close";

/**
 * Crisp 10x10 caption glyphs drawn to the Windows convention (1px non-scaling
 * strokes) so they stay sharp at any DPI and match the native look the custom
 * title bar replaces.
 */
function CaptionGlyph({ type }: { type: Glyph }) {
  const s = {
    stroke: "currentColor",
    strokeWidth: 1,
    fill: "none",
    vectorEffect: "non-scaling-stroke" as const,
  };
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {type === "minimize" && <line x1="0" y1="5.5" x2="10" y2="5.5" {...s} />}
      {type === "maximize" && <rect x="0.5" y="0.5" width="9" height="9" {...s} />}
      {type === "restore" && (
        <>
          <rect x="0.5" y="2.5" width="7" height="7" {...s} />
          <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" {...s} />
        </>
      )}
      {type === "close" && (
        <>
          <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" {...s} />
          <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" {...s} />
        </>
      )}
    </svg>
  );
}

/**
 * Caption buttons for the frameless window. Rendered only on Windows/Linux,
 * where the window has no native title bar — macOS keeps its native traffic
 * lights, so we return nothing there to avoid duplicate controls.
 *
 * The hover tint uses `ink-100` (the theme's foreground colour, which inverts
 * between dark and light) so the controls read correctly in both themes; the
 * close button keeps the conventional red affordance.
 */
export function WindowControls() {
  const win = typeof window !== "undefined" ? window.app?.window : undefined;
  const platform = typeof window !== "undefined" ? window.app?.platform : undefined;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!win) return;
    let active = true;
    void win.isMaximized().then((m) => {
      if (active) setMaximized(m);
    });
    const unsubscribe = win.onMaximizeChange((m) => setMaximized(m));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [win]);

  // macOS shows native traffic lights; no custom controls there.
  if (!win || platform === "darwin") return null;

  const base =
    "no-drag inline-flex h-11 w-[46px] items-center justify-center text-ink-300 transition-colors focus:outline-none focus-visible:bg-ink-100/10";

  return (
    // -mr-6 bleeds the buttons past the TopBar's px-6 so they sit flush against
    // the window's top-right corner, matching native caption placement.
    <div className="-mr-6 flex items-stretch self-stretch">
      <button
        type="button"
        onClick={() => win.minimize()}
        aria-label="Minimize"
        title="Minimize"
        className={clsx(base, "hover:bg-ink-100/10 hover:text-ink-50")}
      >
        <CaptionGlyph type="minimize" />
      </button>
      <button
        type="button"
        onClick={() => win.toggleMaximize()}
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        className={clsx(base, "hover:bg-ink-100/10 hover:text-ink-50")}
      >
        <CaptionGlyph type={maximized ? "restore" : "maximize"} />
      </button>
      <button
        type="button"
        onClick={() => win.close()}
        aria-label="Close"
        title="Close"
        className={clsx(base, "hover:bg-[#e81123] hover:text-white focus-visible:bg-[#e81123]")}
      >
        <CaptionGlyph type="close" />
      </button>
    </div>
  );
}

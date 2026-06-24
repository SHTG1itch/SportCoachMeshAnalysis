import { app, BrowserWindow, Menu, session } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import * as path from "path";
import { registerIpcHandlers } from "./ipc";
import { initDb, closeDb } from "./db";
import { openExternalSafely } from "./safeOpen";

const isDev = process.env.NODE_ENV === "development";
const isMac = process.platform === "darwin";

/**
 * Content-Security-Policy for the packaged renderer (file:// origin).
 *
 * Applied in production only — the dev server (Vite HMR) needs inline/eval and a
 * websocket the strict policy would block, and dev already loads from a trusted
 * localhost origin. The directives are scoped to exactly what the app needs:
 *   - script-src: the bundle ('self') + 'wasm-unsafe-eval' for the MediaPipe
 *     WASM runtime + jsDelivr, which serves that runtime's loader on first use.
 *   - connect-src: 'self' + the two origins the pose model/runtime are fetched
 *     from once and then cached (jsDelivr WASM, Google storage model).
 *   - img/media: data: (thumbnails) and blob: (uploaded clip object URLs).
 *   - style-src 'unsafe-inline': React inline style props + the index.html
 *     <style> block. No remote styles are allowed.
 * Everything else falls back to 'self'; object/frame are denied outright.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join("; ");

let mainWindow: BrowserWindow | null = null;

/**
 * Application menu. macOS always gets a real menu (it lives in the global menu
 * bar, never overlapping the window). On Windows/Linux the bar is auto-hidden
 * (see `autoHideMenuBar` below) so it never clashes with the custom title bar,
 * but keeping the menu defined preserves the standard editing accelerators
 * (copy/paste/undo) and — in development only — reload/devtools shortcuts.
 */
function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: "appMenu" }] as MenuItemConstructorOptions[])
      : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? ([
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ] as MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0b0d12",
    titleBarStyle: "hiddenInset",
    // Hide the in-window menu bar on Windows/Linux so it never collides with the
    // custom title bar; Alt still reveals it and the accelerators stay live.
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Enable Chromium's OS-level renderer sandbox. The preload only uses
      // contextBridge + ipcRenderer.invoke, both of which work sandboxed, so a
      // compromised renderer is contained by process isolation.
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Keep the renderer's maximize/restore button glyph in sync with the real
  // window state, including OS-driven changes (snap, Win+Up, double-clicking the
  // drag region) that never go through our IPC.
  const emitMaximizeState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:maximize-changed", mainWindow.isMaximized());
    }
  };
  mainWindow.on("maximize", emitMaximizeState);
  mainWindow.on("unmaximize", emitMaximizeState);

  // Never open a child window in-app; hand web links to the OS browser (scheme-
  // allowlisted) and deny everything else.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url);
    return { action: "deny" };
  });

  // Pin the top frame to the app's own content. The first-party renderer never
  // navigates itself today, but this is standard Electron hardening: it stops any
  // future stray navigation from replacing the app (with the preload IPC bridge
  // attached) with off-origin content, and routes such attempts to the browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev
      ? url.startsWith("http://localhost:5173")
      : url.startsWith("file://");
    if (!allowed) {
      event.preventDefault();
      void openExternalSafely(url);
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  initDb();
  registerIpcHandlers();
  Menu.setApplicationMenu(buildMenu());

  // Attach the production CSP to every response the renderer session loads.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [PROD_CSP],
        },
      });
    });
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Checkpoint + close the SQLite handle cleanly on shutdown so the WAL is flushed
// (rather than relying on abrupt process exit, which can leave a large -wal file).
app.on("will-quit", () => {
  closeDb();
});

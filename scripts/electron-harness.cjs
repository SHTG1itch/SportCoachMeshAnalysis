const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

process.stdout.write("Electron harness starting\n");

const targetUrl = process.argv.find((arg) => /^https?:\/\//.test(arg));
if (!targetUrl) {
  throw new Error(
    "Usage: electron scripts/electron-harness.cjs <http-url> [-- --title-prefix <text> --screenshot <path>]",
  );
}
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const titlePrefix = option("--title-prefix");
const screenshotPath = option("--screenshot");

const TIMEOUT_MS = 5 * 60 * 1000;
let finished = false;

function finish(code, output) {
  if (finished) return;
  finished = true;
  if (output) console.log(output);
  app.exit(code);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    finish(1, `Harness renderer exited: ${details.reason}`);
  });
  await win.loadURL(targetUrl);

  const deadline = Date.now() + TIMEOUT_MS;
  const poll = async () => {
    if (finished) return;
    try {
      const result = await win.webContents.executeJavaScript(`({
        status: document.getElementById("status")?.textContent ?? "",
        output: document.getElementById("out")?.textContent ?? "",
        title: document.title,
        appTest: window.__apptest ?? null
      })`);
      const titleReady = titlePrefix && result.title.startsWith(titlePrefix);
      if (result.status === "DONE" || titleReady) {
        if (screenshotPath) {
          // A ready DOM/title can precede Chromium's first complete compositor
          // frame. Wait for fonts and two animation frames so visual captures do
          // not intermittently omit the sidebar/title bar.
          await win.webContents.executeJavaScript(`Promise.all([
            document.fonts?.ready ?? Promise.resolve(),
            new Promise((resolve) => requestAnimationFrame(() =>
              requestAnimationFrame(resolve)))
          ])`);
          await new Promise((resolve) => setTimeout(resolve, 750));
          const resolved = path.resolve(screenshotPath);
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          const image = await win.webContents.capturePage();
          fs.writeFileSync(resolved, image.toPNG());
        }
        const output = result.output || JSON.stringify(result.appTest);
        return finish(0, output);
      }
      if (result.status === "ERROR") return finish(1, result.output);
      if (result.title.startsWith("APPTEST ERROR")) return finish(1, result.title);
    } catch (error) {
      return finish(1, `Harness inspection failed: ${error}`);
    }
    if (Date.now() >= deadline) return finish(1, "Harness timed out");
    setTimeout(poll, 500);
  };
  void poll();
});

app.on("window-all-closed", () => finish(1, "Harness window closed unexpectedly"));

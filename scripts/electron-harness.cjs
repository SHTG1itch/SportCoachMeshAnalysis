const { app, BrowserWindow } = require("electron");

const targetUrl = process.argv.find((arg) => /^https?:\/\//.test(arg));
if (!targetUrl) {
  throw new Error("Usage: electron scripts/electron-harness.cjs <http-url>");
}

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
        output: document.getElementById("out")?.textContent ?? ""
      })`);
      if (result.status === "DONE") return finish(0, result.output);
      if (result.status === "ERROR") return finish(1, result.output);
    } catch (error) {
      return finish(1, `Harness inspection failed: ${error}`);
    }
    if (Date.now() >= deadline) return finish(1, "Harness timed out");
    setTimeout(poll, 500);
  };
  void poll();
});

app.on("window-all-closed", () => finish(1, "Harness window closed unexpectedly"));

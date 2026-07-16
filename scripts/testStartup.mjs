import { spawn } from "node:child_process";
import electronPath from "electron";

const TIMEOUT_MS = 45_000;
const successMarker = "Terminal startup and IPC verified";
let output = "";
let settled = false;

const child = spawn(electronPath, [".", "--startup-smoke-test"], {
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});

const capture = (chunk) => {
  const text = chunk.toString();
  output += text;
  process.stdout.write(text);
};
child.stdout.on("data", capture);
child.stderr.on("data", capture);

const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  child.kill();
  console.error(`Terminal startup timed out after ${TIMEOUT_MS} ms.`);
  process.exitCode = 1;
}, TIMEOUT_MS);

child.on("error", (error) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  console.error("Could not launch Electron from the terminal:", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  if (code !== 0 || !output.includes(successMarker)) {
    console.error(
      `Terminal startup failed (exit ${String(code)}, signal ${String(signal)}).`,
    );
    process.exitCode = 1;
  }
});

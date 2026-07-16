import { spawn } from "node:child_process";
import electronPath from "electron";
import { createServer } from "vite";

const TIMEOUT_MS = 6 * 60 * 1000;
const SUCCESS_MARKER = "Live professional-amateur benchmark passed";
const url = "http://127.0.0.1:5173/probenchmark.html";

const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});

let child;
let output = "";
let timeout;
try {
  await server.listen();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, ["scripts/electron-harness.cjs", url], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => {
    const value = chunk.toString();
    output += value;
    process.stdout.write(value);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  const result = await new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Live benchmark timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0 || !output.includes(SUCCESS_MARKER)) {
    throw new Error(
      `Live benchmark failed (exit ${String(result.code)}, signal ${String(result.signal)})`,
    );
  }
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) child.kill();
  await server.close();
}

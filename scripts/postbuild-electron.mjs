import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "dist-electron");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

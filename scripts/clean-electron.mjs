import { rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(projectDirectory, "dist-electron");

// Keep the recursive delete pinned to the one repository build directory even
// if this script is invoked from an unexpected working directory.
if (relative(projectDirectory, outputDirectory) !== "dist-electron") {
  throw new Error(`Refusing to clean unexpected path: ${outputDirectory}`);
}
rmSync(outputDirectory, { recursive: true, force: true });

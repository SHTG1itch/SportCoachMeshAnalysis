import { extractFile, listPackage } from "@electron/asar";
import { createHash } from "node:crypto";
import * as path from "node:path";

const archivePath = process.argv[2];
if (!archivePath) {
  throw new Error("Usage: node scripts/verifyPackage.mjs <app.asar-path>");
}

const portable = (entry) => entry.replaceAll("\\", "/").replace(/^\//, "");
const entries = new Set(listPackage(archivePath).map(portable));

const required = [
  "dist/index.html",
  "dist-electron/electron/main.js",
  "dist-electron/electron/preload.js",
  "dist-electron/electron/databaseCore.js",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES/MEDIAPIPE-APACHE-2.0.txt",
];
for (const entry of required) {
  if (!entries.has(entry)) throw new Error(`Required packaged file is missing: ${entry}`);
}

const forbiddenPrefixes = [
  "dist/testclips/",
  "dist/sample_seq.json",
  "dist/sample_single.json",
  "dist-electron/electron/llm.js",
  "dist-electron/shared/coach.js",
  "node_modules/@mediapipe/tasks-vision/",
];
for (const entry of entries) {
  if (entry.startsWith("dist-electron/") && entry.endsWith(".map")) {
    throw new Error(`Electron source map leaked into package: ${entry}`);
  }
  const forbidden = forbiddenPrefixes.find((prefix) => entry.startsWith(prefix));
  if (forbidden) throw new Error(`Forbidden packaged file found: ${entry}`);
}

const expectedHashes = new Map([
  [
    "dist/mediapipe/models/pose_landmarker_heavy.task",
    "64437AF838A65D18E5BA7A0D39B465540069BC8AAE8308DE3E318AAD31FCBC7B",
  ],
  [
    "dist/mediapipe/wasm/vision_wasm_internal.js",
    "368E048E33C9CA97222797A16BDF9461EA755C10B0E7C6EFCF3CC548A73925FB",
  ],
  [
    "dist/mediapipe/wasm/vision_wasm_internal.wasm",
    "75A31EB26E007D6D72BA654DA9A91B529DC5E309F52FA0EF529E6B574F92CE89",
  ],
  [
    "dist/mediapipe/wasm/vision_wasm_module_internal.js",
    "0ED17894E8D84BF97F3B721DFB85FE9023F8DCBCEAAD7DD4463EB56A0C81416C",
  ],
  [
    "dist/mediapipe/wasm/vision_wasm_module_internal.wasm",
    "C7855DA28628611C173FBD674A01A71D6194E50EBC57951CDEDC231FE6E566C3",
  ],
  [
    "dist/mediapipe/wasm/vision_wasm_nosimd_internal.js",
    "FA063C9645C278E526151C42AFFE43F51512ACE147F6FDE2EF05B9533B77E8A9",
  ],
  [
    "dist/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
    "D0106A8656BC429B28528F2547B775A6EB7196C191CFD75FD9FC830A81BDDB80",
  ],
]);

for (const [entry, expected] of expectedHashes) {
  if (!entries.has(entry)) throw new Error(`Bundled MediaPipe asset is missing: ${entry}`);
  const nativeEntry = entry.replaceAll("/", path.sep);
  const actual = createHash("sha256")
    .update(extractFile(archivePath, nativeEntry))
    .digest("hex")
    .toUpperCase();
  if (actual !== expected) {
    throw new Error(`Bundled MediaPipe hash mismatch for ${entry}: ${actual}`);
  }
}

console.log(
  `Verified packaged contents (${entries.size} entries, ${expectedHashes.size} MediaPipe hashes)`,
);

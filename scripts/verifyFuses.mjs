import {
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from "@electron/fuses";

const appPath = process.argv[2];
if (!appPath) {
  throw new Error("Usage: node scripts/verifyFuses.mjs <packaged-app-path>");
}

const wire = await getCurrentFuseWire(appPath);
if (wire.version !== FuseVersion.V1) {
  throw new Error(`Unexpected Electron fuse wire version: ${wire.version}`);
}

const expected = new Map([
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, false],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, true],
  [FuseV1Options.WasmTrapHandlers, true],
]);

for (const [fuse, enabled] of expected) {
  const expectedState = enabled ? FuseState.ENABLE : FuseState.DISABLE;
  if (wire[fuse] !== expectedState) {
    throw new Error(
      `${FuseV1Options[fuse]} must be ${enabled ? "enabled" : "disabled"}`,
    );
  }
}

console.log(`Verified ${expected.size} Electron fuses in ${appPath}`);

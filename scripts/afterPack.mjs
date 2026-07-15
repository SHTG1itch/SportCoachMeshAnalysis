import path from "node:path";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

/** Harden the packaged Electron binary before electron-builder signs it. */
export default async function afterPack(context) {
  const platform = context.electronPlatformName;
  const productFilename = context.packager.appInfo.productFilename;
  const executableName = context.packager.executableName ?? productFilename;
  const target =
    platform === "darwin"
      ? path.join(context.appOutDir, `${productFilename}.app`)
      : path.join(
          context.appOutDir,
          platform === "win32" ? `${productFilename}.exe` : executableName,
        );

  await flipFuses(target, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    resetAdHocDarwinSignature:
      platform === "darwin" && (context.arch === 3 || context.arch === 4),
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // electron-builder does not package browser_v8_context_snapshot.bin.
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // The renderer currently loads its own packaged JS/CSS through file://.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    // MediaPipe relies on WebAssembly; retain its guarded-memory fast path.
    [FuseV1Options.WasmTrapHandlers]: true,
  });
}

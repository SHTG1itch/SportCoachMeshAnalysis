interface TrustedRendererOptions {
  isPackaged: boolean;
  packagedEntryUrl: string;
  developmentOrigin: string;
}

/** Validate a renderer frame with parsed URLs, never string prefixes. The IPC
 * bridge is privileged even with payload schemas, so only the one packaged
 * entry document (or the exact Vite origin in development) may call it. */
export function isTrustedRendererUrl(
  candidate: string,
  options: TrustedRendererOptions,
): boolean {
  try {
    const url = new URL(candidate);
    if (!options.isPackaged) {
      return url.origin === new URL(options.developmentOrigin).origin;
    }
    return url.href === new URL(options.packagedEntryUrl).href;
  } catch {
    return false;
  }
}

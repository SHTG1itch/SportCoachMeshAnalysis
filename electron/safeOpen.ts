import { shell } from "electron";

/**
 * Open a URL in the user's default browser, but ONLY for web/mail schemes.
 *
 * `shell.openExternal` otherwise hands ANY scheme (file:, smb:, ms-msdt:, a
 * custom registered protocol handler, …) straight to the OS, which can launch
 * arbitrary local handlers. The renderer is first-party and does not construct
 * such URLs today, so this is not a live hole — but allowlisting http/https/
 * mailto is cheap, standard defense-in-depth on the one bridge that reaches
 * outside the app sandbox, and future-proofs the two call sites
 * (`setWindowOpenHandler` in main.ts and the `shell:open` IPC handler).
 */
export async function openExternalSafely(url: string): Promise<void> {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return; // not a parseable absolute URL — drop it
  }
  if (scheme === "http:" || scheme === "https:" || scheme === "mailto:") {
    await shell.openExternal(url);
  }
}

// `__APP_VERSION__` is replaced at build time by Vite (see vite.config.ts
// `define`), sourced from package.json. The guard keeps this safe in any context
// where the define was not applied (it falls back rather than throwing).
declare const __APP_VERSION__: string;

export const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

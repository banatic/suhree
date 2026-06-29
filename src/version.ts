// App version, injected at build time from package.json via vite.config.ts `define`.
// Works in both the Tauri shell and a plain `npm run dev` browser session.

declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

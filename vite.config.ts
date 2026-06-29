import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// Single source of truth for the version: package.json (kept in lockstep with tauri.conf.json /
// Cargo.toml by scripts/release_method.py). Injected as __APP_VERSION__ so the webview can show it.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

// Tauri expects a fixed dev port and a relative base so the built assets load from disk.
export default defineConfig({
  base: "./",
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "esnext",
    minify: false,
    sourcemap: true,
  },
});

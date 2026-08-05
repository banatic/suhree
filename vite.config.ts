import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
    rollupOptions: {
      // 멀티페이지: 스트립 본체 + 3D 여행 창
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        travel: fileURLToPath(new URL("./travel.html", import.meta.url)),
      },
    },
  },
});

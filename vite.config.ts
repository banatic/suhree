import { defineConfig } from "vite";

// Tauri expects a fixed dev port and a relative base so the built assets load from disk.
export default defineConfig({
  base: "./",
  clearScreen: false,
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

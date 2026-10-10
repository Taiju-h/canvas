import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const base = process.env.CANVAS_BASE || "/canvas/";
const outDir = process.env.CANVAS_OUT || "public/canvas";

export default defineConfig({
  base,
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir,
    emptyOutDir: false,
    manifest: true,
    sourcemap: false,
  },
});

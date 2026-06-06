import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5317,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8888",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    },
    watch: {
      ignored: ["**/.reasonix/**", "**/.claude/**", "**/server/data/**"]
    }
  },
  build: {
    outDir: "dist"
  }
});

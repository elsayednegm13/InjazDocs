import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const port = Number(process.env.EXPORTFLOW_PORT ?? 43181);
const workerOrigin = process.env.EXPORTFLOW_WORKER_ORIGIN ?? "http://127.0.0.1:43182";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@server": path.resolve(__dirname, "server"),
    },
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    hmr: { overlay: false },
    watch: process.env.CI
      ? null
      : { ignored: ["**/.wrangler-reliability-b/**", "**/.wrangler/**", "**/.wrangler-e2e/**", "**/.wrangler-perf/**"] },
    proxy: {
      "/api": { target: workerOrigin, changeOrigin: false },
      "/cdn-cgi": { target: workerOrigin, changeOrigin: false },
    },
  },
});

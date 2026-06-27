import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appBuildId = process.env.CF_PAGES_COMMIT_SHA || process.env.COMMIT_SHA || new Date().toISOString();

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || (command === "serve" ? "/" : "/bolao/"),
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId)
  },
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT) || 5173,
    strictPort: false
  }
}));

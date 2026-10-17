import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "CUE_");
  return {
    plugins: [react()],
    base: "./",
    server: {
      host: "127.0.0.1",
      allowedHosts: env.CUE_PREVIEW_HOST ? [env.CUE_PREVIEW_HOST] : undefined,
    },
    preview: { host: "127.0.0.1" },
    worker: { format: "es" },
    build: { chunkSizeWarningLimit: 1500 },
  };
});

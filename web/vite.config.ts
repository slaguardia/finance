import { defineConfig, mergeConfig } from "vite";
import { toolkitVite } from "@brainbot/web-toolkit/vite-preset";

// Backend serves the built PWA; in dev, proxy /api/* to the backend on :8789.
export default mergeConfig(
  toolkitVite({ apiProxyTarget: "http://127.0.0.1:8789" }),
  defineConfig({
    build: { outDir: "dist", emptyOutDir: true },
  }),
);

import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Былина: Тьма Кощея",
        short_name: "Былина",
        description: "Пошаговая тактическая игра",
        theme_color: "#14181c",
        background_color: "#14181c",
        display: "standalone",
        start_url: "/",
        lang: "ru",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@bylina/core": path.resolve(rootDir, "../../packages/core/src/index.ts"),
      "@bylina/content": path.resolve(rootDir, "../../packages/content/src/index.ts"),
      "@bylina/i18n": path.resolve(rootDir, "../../packages/i18n/src/index.ts"),
      "@bylina/net": path.resolve(rootDir, "../../packages/net/src/index.ts"),
      "@bylina/session": path.resolve(rootDir, "../../packages/session/src/index.ts"),
      "@bylina/settings": path.resolve(rootDir, "../../packages/settings/src/index.ts"),
      "@bylina/ui": path.resolve(rootDir, "../../packages/ui/src/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
});

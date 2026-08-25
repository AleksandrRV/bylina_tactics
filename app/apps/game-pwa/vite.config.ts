import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(rootDir, "../..");
const renderPkg = path.resolve(appRoot, "packages/render/package.json");
const pwaPkg = path.resolve(rootDir, "package.json");

function resolveFrom(pkgJson: string, spec: string): string | undefined {
  try {
    return createRequire(pkgJson).resolve(spec);
  } catch {
    return undefined;
  }
}

/** Абсолютный вход pixi.js: не зависит от того, откуда Vite разбирает исходник пакета. */
function resolvePixiEntry(): string | undefined {
  return resolveFrom(pwaPkg, "pixi.js") ?? resolveFrom(renderPkg, "pixi.js");
}

function pixiResolvePlugin(): Plugin {
  return {
    name: "bylina-pixi-resolve",
    enforce: "pre",
    resolveId(id) {
      if (id !== "pixi.js") return null;
      return resolvePixiEntry() ?? null;
    },
  };
}


/** Emits JSON5 as fetchable assets instead of importing all content into the entry chunk. */
function contentAssetsPlugin(): Plugin {
  const contentRoot = path.resolve(appRoot, "packages/content/data");
  const files = (dir: string, prefix = ""): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name), `${prefix}${entry.name}/`) : entry.name.endsWith(".json5") ? [`${prefix}${entry.name}`] : [],
  );
  const names = files(contentRoot);
  return {
    name: "bylina-content-assets",
    configureServer(server) {
      server.middlewares.use("/content/", (req, res, next) => {
        const relative = decodeURIComponent(req.url ?? "").replace(/^\/+/, "");
        const target = path.resolve(contentRoot, relative);
        if (!target.startsWith(contentRoot) || !names.includes(relative)) return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(readFileSync(target));
      });
      server.middlewares.use("/content-manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(names.map((name) => `content/${name}`)));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "content-manifest.json", source: JSON.stringify(names.map((name) => `content/${name}`)) });
      for (const name of names) this.emitFile({ type: "asset", fileName: `content/${name}`, source: readFileSync(path.join(contentRoot, name)) });
    },
  };
}

const pixiEntry = resolvePixiEntry();

/** Базовый путь публикации: "/" локально, "/bylina_tactics/" на GitHub Pages (переменная BASE_PATH). */
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    contentAssetsPlugin(),
    pixiResolvePlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: { globPatterns: ["**/*.{js,css,html,ico,png,svg,json,json5}"] },
      includeAssets: ["favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "portraits/*.jpg"],
      manifest: {
        name: "Былина: Тьма Кощея",
        short_name: "Былина",
        description: "Пошаговая тактическая игра",
        theme_color: "#14181c",
        background_color: "#14181c",
        display: "standalone",
        start_url: basePath,
        scope: basePath,
        lang: "ru",
        // «any» и «maskable» — раздельные записи: объединённое значение
        // отклоняется проверками установки (маскируемый вариант рисуется
        // с безопасным полем и без него картинка обрезалась бы).
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  optimizeDeps: {
    include: ["pixi.js"],
  },
  resolve: {
    dedupe: ["pixi.js"],
    alias: {
      ...(pixiEntry ? { "pixi.js": pixiEntry } : {}),
      "@bylina/core": path.resolve(appRoot, "packages/core/src/index.ts"),
      "@bylina/content": path.resolve(appRoot, "packages/content/src/index.ts"),
      "@bylina/i18n": path.resolve(appRoot, "packages/i18n/src/index.ts"),
      "@bylina/net": path.resolve(appRoot, "packages/net/src/index.ts"),
      "@bylina/session": path.resolve(appRoot, "packages/session/src/index.ts"),
      "@bylina/settings": path.resolve(appRoot, "packages/settings/src/index.ts"),
      "@bylina/storage": path.resolve(appRoot, "packages/storage/src/index.ts"),
      "@bylina/render": path.resolve(appRoot, "packages/render/src/index.ts"),
      "@bylina/ui": path.resolve(appRoot, "packages/ui/src/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    fs: {
      allow: [appRoot],
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
});

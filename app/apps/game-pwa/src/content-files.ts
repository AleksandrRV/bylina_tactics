import { parseContent, type ContentLoadResult } from "@bylina/content";

/**
 * Content files are emitted as static assets by the Vite plugin. They are
 * fetched after the application shell has loaded, keeping JSON5 out of the
 * entry chunk and allowing future per-mode lazy loading.
 */
// Vitest consumes the same public API synchronously, without placing this
// test-only eager map into production bundles.
const testModules =
  import.meta.env.MODE === "test"
    ? (import.meta.glob("../../../packages/content/data/**/*.json5", {
        eager: true,
        query: "?raw",
        import: "default",
      }) as Record<string, string>)
    : null;

export function loadAppContent(): ContentLoadResult | Promise<ContentLoadResult> {
  if (testModules) return parseContent(testModules);
  return loadFetchedContent();
}

async function loadFetchedContent(): Promise<ContentLoadResult> {
  const base = import.meta.env.BASE_URL;
  try {
    const manifestResponse = await fetch(`${base}content-manifest.json`);
    if (!manifestResponse.ok) throw new Error(`content manifest: ${manifestResponse.status}`);
    const manifest = (await manifestResponse.json()) as unknown;
    if (!Array.isArray(manifest) || !manifest.every((file) => typeof file === "string")) {
      throw new Error("content manifest: expected an array of file names");
    }
    const files = manifest;
    const entries = await Promise.all(
      files.map(async (file) => {
        const response = await fetch(`${base}${file}`);
        if (!response.ok) throw new Error(`${file}: ${response.status}`);
        return [file, await response.text()] as const;
      }),
    );
    return parseContent(Object.fromEntries(entries));
  } catch (error) {
    return {
      ok: false,
      issues: [{ file: "content-manifest.json", message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

import { parseContent, type ContentLoadResult } from "@bylina/content";

const modules = import.meta.glob("../../../packages/content/data/**/*.json5", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export function loadAppContent(): ContentLoadResult {
  return parseContent(modules);
}

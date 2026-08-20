import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseContent } from "../src/index.js";

function readDataTree(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../data");
  const files: Record<string, string> = {};

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json5")) {
        files[full] = readFileSync(full, "utf8");
      }
    }
  };

  walk(root);
  return files;
}

describe("parseContent", () => {
  it("accepts the shipped records", () => {
    const result = parseContent(readDataTree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.units).toEqual([]);
    expect(result.data.weapons.map((weapon) => weapon.id).sort()).toEqual(["bow_debug", "sword_debug"]);
    expect(result.data.skills).toEqual([]);
    expect(result.data.quickMatch.difficulties).toHaveLength(3);
    expect(result.data.campaign.needleMissionId).toBe("needle");
  });

  it("rejects a broken campaign file", () => {
    const files = readDataTree();
    const campaignKey = Object.keys(files).find((key) => key.endsWith("campaign.json5"));
    expect(campaignKey).toBeDefined();
    if (!campaignKey) return;
    files[campaignKey] = "{ rosterCap: -1 }";
    const result = parseContent(files);
    expect(result.ok).toBe(false);
  });
});

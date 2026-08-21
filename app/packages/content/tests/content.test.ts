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
    expect(result.data.units.map((unit) => unit.id).sort()).toEqual([
      "bogatyr",
      "forest_beast",
      "illusion",
      "kikimora",
      "leshy",
      "recruit",
      "strelets",
      "upyr",
      "volkhv",
      "znaharka",
    ]);
    expect(result.data.units.find((unit) => unit.id === "bogatyr")?.skills).toEqual([
      "circular_sweep",
      "breach",
      "shield_bash",
    ]);
    expect(result.data.weapons.map((weapon) => weapon.id).sort()).toEqual([
      "bow",
      "bow_debug",
      "branch",
      "claws",
      "mace",
      "needle",
      "pishchal",
      "sling",
      "sword",
      "sword_debug",
    ]);
    expect(result.data.items.map((item) => item.id).sort()).toEqual([
      "aim_charm",
      "guard_charm",
      "mace_of_trail",
      "pishchal_gun",
      "swift_boots",
      "vital_amulet",
    ]);
    expect(result.data.skills.map((skill) => skill.id).sort()).toEqual([
      "aimed_eye",
      "breach",
      "circular_sweep",
      "cleanse",
      "create_illusion",
      "heal",
      "panic",
      "poison_needles",
      "raise_skeleton",
      "roots",
      "shield_bash",
      "summon_forest_beast",
      "teleport_ally",
    ]);
    expect(result.data.quickMatch.playerSlots).toEqual(["bogatyr", "strelets", "znaharka"]);
    expect(result.data.quickMatch.difficulties).toHaveLength(3);
    expect(result.data.campaign.needleMissionId).toBe("needle");
  });

  it("rejects unknown fields and broken references", () => {
    const files = readDataTree();
    const swordKey = Object.keys(files).find((key) => key.endsWith("weapons/sword.json5"));
    expect(swordKey).toBeDefined();
    if (!swordKey) return;
    files[swordKey] = files[swordKey]!.replace("envDmg: 0,", "envDmg: 0, unknownBalance: 99,");
    expect(parseContent(files).ok).toBe(false);
  });

  it("requires cooldowns for regular skills and one use for summons", () => {
    const files = readDataTree();
    const rootsKey = Object.keys(files).find((key) => key.endsWith("skills/roots.json5"));
    expect(rootsKey).toBeDefined();
    if (!rootsKey) return;
    files[rootsKey] = files[rootsKey]!.replace(/\s*cooldownTurns:\s*2,/, "");
    expect(parseContent(files).ok).toBe(false);

    const summonFiles = readDataTree();
    const summonKey = Object.keys(summonFiles).find((key) => key.endsWith("skills/summon_forest_beast.json5"));
    expect(summonKey).toBeDefined();
    if (!summonKey) return;
    summonFiles[summonKey] = summonFiles[summonKey]!.replace("maxUsesPerBattle: 1", "maxUsesPerBattle: 2");
    expect(parseContent(summonFiles).ok).toBe(false);
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

  it("rejects unknown recruit and initial roster units", () => {
    const files = readDataTree();
    const campaignKey = Object.keys(files).find((key) => key.endsWith("campaign.json5"));
    expect(campaignKey).toBeDefined();
    if (!campaignKey) return;

    const brokenRecruit = { ...files };
    brokenRecruit[campaignKey!] = files[campaignKey]!.replace('recruitUnitId: "recruit"', 'recruitUnitId: "recruit_typo"');
    const recruitResult = parseContent(brokenRecruit);
    expect(recruitResult.ok).toBe(false);
    expect(recruitResult.ok || recruitResult.issues.some((issue) => issue.message.includes("unknown recruit unit"))).toBe(true);

    const brokenRoster = { ...files };
    brokenRoster[campaignKey!] = files[campaignKey]!.replace('initialRoster: ["bogatyr", "strelets", "znaharka"]', 'initialRoster: ["bogatyr", "bogatyr_typo"]');
    const rosterResult = parseContent(brokenRoster);
    expect(rosterResult.ok).toBe(false);
    expect(rosterResult.ok || rosterResult.issues.some((issue) => issue.message.includes("unknown initial roster unit"))).toBe(true);
  });

  it("rejects an inconsistent needle mission", () => {
    const files = readDataTree();
    const campaignKey = Object.keys(files).find((key) => key.endsWith("campaign.json5"));
    expect(campaignKey).toBeDefined();
    if (!campaignKey) return;

    // Миссия типа needle, но её id не совпадает с needleMissionId.
    const wrongId = { ...files };
    wrongId[campaignKey!] = files[campaignKey]!.replace('type: "purge",\n      darknessOnVictory: 2,\n      darknessOnDefeat: 4,\n      x: 13,', 'type: "needle",\n      darknessOnVictory: 2,\n      darknessOnDefeat: 4,\n      x: 13,');
    const idResult = parseContent(wrongId);
    expect(idResult.ok).toBe(false);
    expect(idResult.ok || idResult.issues.some((issue) => issue.message.includes("does not match needleMissionId"))).toBe(true);

    // needleMissionId ссылается на точку иного типа.
    const wrongType = { ...files };
    wrongType[campaignKey!] = files[campaignKey]!.replace('needleMissionId: "needle"', 'needleMissionId: "clearing_1"');
    const typeResult = parseContent(wrongType);
    expect(typeResult.ok).toBe(false);
    expect(typeResult.ok || typeResult.issues.some((issue) => issue.message.includes("expected \"needle\""))).toBe(true);
  });
});

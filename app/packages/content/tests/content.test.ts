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
      "captive",
      "forest_beast",
      "idol",
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
      "evacuate",
      "heal",
      "panic",
      "poison_needles",
      "raise_skeleton",
      "roots",
      "shield_bash",
      "summon_forest_beast",
      "teleport_ally",
    ]);
    expect(result.data.skills.find((skill) => skill.id === "evacuate")?.extract).toBe(true);
    expect(result.data.units.find((unit) => unit.id === "captive")?.skills).toContain("evacuate");
    expect(result.data.campaign.missions.map((mission) => mission.type)).toEqual([
      "purge", "purge", "purge", "purge", "purge", "destroy", "rescue", "recon",
    ]);
    const destroy = result.data.campaign.missions.find((mission) => mission.id === "destroy_idol_1");
    expect(destroy?.objectiveUnitId).toBe("idol");
    const rescue = result.data.campaign.missions.find((mission) => mission.id === "rescue_captive_1");
    expect(rescue?.escorteeUnitId).toBe("captive");
    expect(rescue?.map.extract).toBe(true);
    const spawnKinds = result.data.skills
      .flatMap((skill) => skill.effects.filter((effect) => effect.type === "spawn"))
      .map((effect) => (effect.type === "spawn" ? effect.spawnKind : undefined))
      .sort();
    expect(spawnKinds).toEqual(["illusion", "resurrection", "summon"]);
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

  it("accepts empty effects only for extract skills", () => {
    const files = readDataTree();
    const rootsKey = Object.keys(files).find((key) => key.endsWith("skills/roots.json5"));
    expect(rootsKey).toBeDefined();
    if (!rootsKey) return;

    // Обычное умение без следствий — отклоняется.
    const emptyRegular = { ...files };
    emptyRegular[rootsKey!] = files[rootsKey]!.replace(
      "effects: [{ type: \"applyStatus\", status: \"immobile\", duration: 1 }],",
      "effects: [],",
    );
    expect(parseContent(emptyRegular).ok).toBe(false);

    // Умение извлечения без следствий — допустимо (само извлечение и есть следствие).
    const extractSkill = { ...files, "skills/evacuate.json5": `{
      id: "evacuate",
      apCost: 1,
      endsTurn: true,
      range: 0,
      requiresLOS: false,
      category: "self",
      resolution: "auto",
      envDmg: 0,
      extract: true,
      cooldownTurns: 1,
      effects: [],
    }` };
    expect(parseContent(extractSkill).ok).toBe(true);
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

describe("parseContent mission objectives (0.13.0)", () => {
  function missionFiles(type: string, extra: string, missionExtra = ""): Record<string, string> {
    const files = readDataTree();
    const campaignKey = Object.keys(files).find((key) => key.endsWith("campaign.json5"))!;
    const campaign = files[campaignKey]!;
    const newMission = `{
      id: "objective_test",
      type: "${type}",
      ${missionExtra}
      darknessOnVictory: 2,
      darknessOnDefeat: 4,
      x: 10,
      y: 10,
      rewards: { gold: 1, herbs: 0, artifacts: 0 },
      map: {
        width: 12,
        height: 10,
        pitChance: 0.04,
        coverDensity: 0.05,
        wallDensity: 0.02,
        edgeCoverChance: 0.4,
        halfCoverChance: 0.55,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        ${extra}
      },
      enemies: [{ unitId: "upyr", count: 2 }],
    },`;
    // Вставляем миссию в массив missions перед закрывающей скобкой.
    const idx = campaign.lastIndexOf("  ],");
    const updated = campaign.slice(0, idx) + newMission + campaign.slice(idx);
    files[campaignKey] = updated;
    return files;
  }

  it("rejects destroy without objectiveUnitId", () => {
    const result = parseContent(missionFiles("destroy", ""));
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("destroy missions require objectiveUnitId"))).toBe(true);
  });

  it("rejects rescue without escorteeUnitId", () => {
    const result = parseContent(missionFiles("rescue", "extract: true,"));
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("rescue missions require escorteeUnitId"))).toBe(true);
  });

  it("rejects rescue and recon without an evacuation zone", () => {
    const rescue = parseContent(missionFiles("rescue", ""));
    expect(rescue.ok).toBe(false);
    const recon = parseContent(missionFiles("recon", ""));
    expect(recon.ok).toBe(false);
    expect(recon.ok || recon.issues.some((issue) => issue.message.includes("recon missions require map.extract"))).toBe(true);
  });

  it("rejects destroy with an unknown objective unit", () => {
    const files = missionFiles("destroy", "", 'objectiveUnitId: "idol_missing",');
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("unknown objective unit"))).toBe(true);
  });
});

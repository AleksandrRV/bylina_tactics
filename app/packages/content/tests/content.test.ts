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
    // Этап 3.1 + ревью: биомы миссий кампании заданы и идут в порядке точек.
    expect(result.data.campaign.missions.map((mission) => mission.map.biome)).toEqual([
      "meadow",
      "thicket",
      "swamp",
      "scorched",
      "swamp",
      "meadow",
      "thicket",
      "thicket",
    ]);
    expect(result.data.units.map((unit) => unit.id).sort()).toEqual([
      "baba_yaga",
      "bogatyr",
      "captive",
      "forest_beast",
      "idol",
      "illusion",
      "kikimora",
      "kikimora_pvp",
      "leshy",
      "leshy_pvp",
      "recruit",
      "solovey",
      "strelets",
      "upyr",
      "upyr_pvp",
      "volkhv",
      "znaharka",
    ]);
    expect(result.data.units.filter((unit) => unit.side === "pvp").map((unit) => unit.id).sort()).toEqual([
      "kikimora_pvp",
      "leshy_pvp",
      "upyr_pvp",
    ]);
    expect(result.data.pvp.pool).toEqual(["bogatyr", "strelets", "znaharka", "upyr_pvp", "leshy_pvp", "kikimora_pvp"]);
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
      "whistle",
    ]);
    expect(result.data.skills.find((skill) => skill.id === "evacuate")?.extract).toBe(true);
    expect(result.data.units.find((unit) => unit.id === "captive")?.skills).toContain("evacuate");
    expect(result.data.campaign.missions.map((mission) => mission.type)).toEqual([
      "purge", "purge", "purge", "destroy", "rescue", "recon", "purge", "purge",
    ]);
    expect(result.data.campaign.missions.find((mission) => mission.id === "clearing_5")?.generals).toEqual(["solovey"]);
    // Генералы вводятся последними (0.20.0): Яга — в седьмой миссии цепочки,
    // Соловей — в восьмой; ранние миссии генералов не содержат.
    expect(result.data.campaign.missions.find((mission) => mission.id === "clearing_4")?.generals).toEqual(["baba_yaga"]);
    expect(result.data.campaign.missions.find((mission) => mission.id === "rescue_captive_1")?.generals).toBeUndefined();
    expect(result.data.campaign.missions.find((mission) => mission.id === "recon_route_1")?.generals).toBeUndefined();
    expect(result.data.units.find((unit) => unit.id === "baba_yaga")?.tags).toContain("flying");
    expect(result.data.units.find((unit) => unit.id === "baba_yaga")?.fleeHp).toBe(6);
    expect(result.data.units.find((unit) => unit.id === "solovey")?.tags).toContain("hiddenStart");
    expect(result.data.skills.find((skill) => skill.id === "whistle")?.effects.map((effect) => effect.type)).toEqual(["damage", "knockback"]);
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

  it("accepts legacy maps without a biome (backward compatibility)", () => {
    const files = readDataTree();
    const campaignKey = Object.keys(files).find((key) => key.endsWith("campaign.json5"));
    expect(campaignKey).toBeDefined();
    if (!campaignKey) return;
    files[campaignKey] = files[campaignKey]!.replace(/^\s*biome:.*\r?\n/gm, "");
    const result = parseContent(files);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.campaign.missions.every((mission) => mission.map.biome === undefined)).toBe(true);
    }
  });

  it("rejects an inconsistent needle mission", () => {
    const files = readDataTree();
    const campaignKey = Object.keys(files).find((key) => key.endsWith("campaign.json5"));
    expect(campaignKey).toBeDefined();
    if (!campaignKey) return;

    // Миссия типа needle, но её id не совпадает с needleMissionId.
    const wrongId = { ...files };
    wrongId[campaignKey!] = files[campaignKey]!.replace('type: "purge",\n      darknessOnVictory: 2,\n      darknessOnDefeat: 4,\n      x: 10,', 'type: "needle",\n      darknessOnVictory: 2,\n      darknessOnDefeat: 4,\n      x: 10,');
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

describe("training config (0.19.0)", () => {
  it("loads three training missions with valid hints", () => {
    const result = parseContent(readDataTree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.training.missions.map((mission) => mission.id)).toEqual(["movement", "combat", "skills"]);
    const combat = result.data.training.missions.find((mission) => mission.id === "combat")!;
    expect(combat.playerSlots).toEqual(["bogatyr"]);
    expect(combat.enemies[0]?.unitId).toBe("upyr");
    expect(combat.hints.length).toBeGreaterThan(0);
    // Строгий сценарий (0.20.13): «Бой» открывается ознакомительным шагом,
    // затем приближение и атака предписанным оружием до гибели цели.
    expect(combat.hints[0]?.until).toBe("noop");
    expect(combat.hints.some((hint) => hint.until === "attack" && hint.weaponId === "sword" && hint.repeatUntil === "targetDead")).toBe(true);
    expect(combat.enemyScript?.actions.length).toBeGreaterThan(0);
    // Доводка 0.20.1: карта «Боя» гарантирует укрытия, «Первые шаги» учат рывку,
    // «Умения» несут реактивные плашки.
    expect(combat.map.minCovers).toBeGreaterThanOrEqual(2);
    const movement = result.data.training.missions.find((mission) => mission.id === "movement")!;
    expect(movement.hints.some((hint) => hint.until === "dash")).toBe(true);
    const skills = result.data.training.missions.find((mission) => mission.id === "skills")!;
    expect(skills.notes?.poison).toBeTruthy();
    expect(skills.notes?.resurrect).toBeTruthy();
    expect(skills.notes?.summon).toBeTruthy();
  });

  it("rejects training with an unknown unit", () => {
    const files = readDataTree();
    const key = Object.keys(files).find((path) => path.endsWith("training.json5"))!;
    files[key] = files[key]!.replace('playerSlots: ["bogatyr"],', 'playerSlots: ["bogatyr_missing"],');
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("unknown player unit"))).toBe(true);
  });

  it("rejects training hints whose steps are not a unique sequence 1..N", () => {
    const files = readDataTree();
    const key = Object.keys(files).find((path) => path.endsWith("training.json5"))!;
    // Шаг 2 переименован в 3: последовательность 1..N нарушена. Интерфейс
    // исполняет подсказки по полю step (0.19.1), поэтому шаги обязаны
    // образовывать полную уникальную последовательность.
    files[key] = files[key]!.replace(
      "step: 2,\n          textKey: \"training.combat.hint2\",",
      "step: 3,\n          textKey: \"training.combat.hint2\",",
    );
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("hint steps"))).toBe(true);
  });
});

describe("campaign onboarding chain (0.20.0)", () => {
  it("opens missions in the onboarding order: each next point is reachable from the previous, and the start cannot skip ahead", () => {
    const result = parseContent(readDataTree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const radius = result.data.campaign.scan.radius;
    const missions = result.data.campaign.missions;
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.hypot(a.x - b.x, a.y - b.y);

    // Каждая следующая точка цепочки достижима из какой-либо предыдущей
    // сканированием (допускается «вилка»: из одной точки открываются две).
    for (let index = 1; index < missions.length; index += 1) {
      const to = missions[index]!;
      const reachableFromEarlier = missions.slice(0, index).some((from) => distance(from, to) <= radius);
      expect(reachableFromEarlier).toBe(true);
    }

    // Первая точка не открывает точки дальше второй: механики вводятся
    // по одной, «прыжок» через всю цепочку со старта невозможен.
    const first = missions[0]!;
    for (let index = 2; index < missions.length; index += 1) {
      expect(distance(first, missions[index]!)).toBeGreaterThan(radius);
    }

    // Генералы появляются только в последних миссиях цепочки.
    const generalIds = missions
      .map((mission, index) => (mission.generals?.length ? index : -1))
      .filter((index) => index >= 0);
    expect(generalIds.length).toBeGreaterThan(0);
    expect(Math.max(...generalIds)).toBe(missions.length - 1);
  });
});

describe("prologue content (0.20.31)", () => {
  it("parses the four prologue files and keeps bestiary isolated", () => {
    const result = parseContent(readDataTree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prologue.enabled).toBe(true);
    expect(result.data.prologue.missions.map((mission: { id: string }) => mission.id)).toEqual([
      "prologue_brushwood",
      "prologue_cry",
      "prologue_glade",
      "prologue_village",
    ]);
    expect(result.data.prologue.prologueFinalMissionId).toBe("prologue_village");
    expect(result.data.prologue.missions.map((mission: { fog: boolean }) => mission.fog)).toEqual([false, false, true, true]);
    expect(result.data.prologue.missions.map((mission: { map: { biome?: string } }) => mission.map.biome)).toEqual([
      "meadow", "swamp", "thicket", "meadow",
    ]);
    const prologueUnitIds = result.data.prologueBestiary.units.map((unit: { id: string }) => unit.id).sort();
    expect(prologueUnitIds).toEqual(["fedot_stranded", "forest_rat", "mikula_peasant", "slug"]);
    expect(result.data.units.some((unit) => unit.id === "forest_rat")).toBe(false);
    expect(result.data.prologueBestiary.weapons.map((weapon: { id: string }) => weapon.id).sort()).toEqual(["club", "spit", "teeth"]);
    const hintKeys = result.data.prologueHints.hints.map((hint: { key: string }) => hint.key);
    expect(hintKeys).toContain("m1.endTurn");
    expect(hintKeys).toContain("m4.source");
    expect(result.data.reinforcements.profiles?.m2_cry_wave?.mode).toBe("onKill");
    expect(result.data.prologueBestiary.units.find((unit: { id: string }) => unit.id === "mikula_peasant")?.weapons).toEqual([]);
    expect(result.data.prologue.missions[0]?.enemies).toEqual([]);
  });

  it("carries per-cell heights in the M1 layout (0.20.37)", () => {
    const result = parseContent(readDataTree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const layout = result.data.prologue.missions[0]?.map.layout;
    expect(layout?.heights).toBeTruthy();
    const heights = layout?.heights ?? [];
    const rows = layout?.rows ?? [];
    expect(heights).toHaveLength(rows.length);
    for (const row of heights) expect(row).toHaveLength(rows[0]!.length);
    // Три яруса: низина, луг, всхолмление.
    const joined = heights.join("");
    expect(joined).toMatch(/0/);
    expect(joined).toMatch(/1/);
    expect(joined).toMatch(/2/);
  });

  it("rejects an unknown layout field (strict layout schema)", () => {
    const files = readDataTree();
    const key = Object.keys(files).find((path) => path.endsWith("prologue_missions.json5"))!;
    files[key] = files[key]!.replace('heights: [', 'relief: [');
    expect(parseContent(files).ok).toBe(false);
  });

  it("rejects an unknown unit referenced by a prologue mission", () => {
    const files = readDataTree();
    const key = Object.keys(files).find((path) => path.endsWith("prologue_missions.json5"))!;
    files[key] = files[key]!.replace(
      'playerSlots: ["mikula_peasant"],',
      'playerSlots: ["unknown_hero"],',
    );
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("unknown player unit"))).toBe(true);
  });

  it("rejects a broken prologue mission record (strict schema)", () => {
    const files = readDataTree();
    const key = Object.keys(files).find((path) => path.endsWith("prologue_missions.json5"))!;
    files[key] = files[key]!.replace('titleKey: "prologue.m1.title",\n', "");
    expect(parseContent(files).ok).toBe(false);
  });

  it("rejects a hint key that is missing from the hints catalog", () => {
    const files = readDataTree();
    const key = Object.keys(files).find((path) => path.endsWith("prologue_missions.json5"))!;
    files[key] = files[key]!.replace('hints: ["m1.endTurn"],', 'hints: ["m1.ghost"],');
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    expect(result.ok || result.issues.some((issue) => issue.message.includes("unknown hint key"))).toBe(true);
  });
});

describe("movement allowance in shipped content (0.20.43)", () => {
  it("keeps the base norm 4, упырь 3 and слизень 2", () => {
    const result = parseContent(readDataTree());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const units = result.data.units as Array<{ id: string; mobility: number }>;
    const bestiary = result.data.prologueBestiary.units as Array<{ id: string; mobility: number }>;
    const mobilityOf = (list: Array<{ id: string; mobility: number }>, id: string): number | undefined =>
      list.find((unit) => unit.id === id)?.mobility;

    // Базовая норма: 4 очка движения за одно очко действия, рывок — 8 за два.
    const norm = [
      "bogatyr",
      "strelets",
      "znaharka",
      "recruit",
      "volkhv",
      "kikimora",
      "kikimora_pvp",
      "leshy",
      "leshy_pvp",
      "baba_yaga",
      "solovey",
      "forest_beast",
      "captive",
      "illusion",
    ];
    for (const id of norm) expect(mobilityOf(units, id), id).toBe(4);
    // Упырь тяжелее дружины — 3 очка движения за одно очко действия.
    expect(mobilityOf(units, "upyr")).toBe(3);
    expect(mobilityOf(units, "upyr_pvp")).toBe(3);
    // Пролог: та же норма, слизень ползёт вдвое медленнее — 2 очка.
    expect(mobilityOf(bestiary, "forest_rat")).toBe(4);
    expect(mobilityOf(bestiary, "mikula_peasant")).toBe(4);
    expect(mobilityOf(bestiary, "fedot_stranded")).toBe(4);
    expect(mobilityOf(bestiary, "slug")).toBe(2);
    // Идол — объект уничтожения, не ходит: норма на него не распространяется.
    expect(mobilityOf(units, "idol")).toBe(1);
  });
});

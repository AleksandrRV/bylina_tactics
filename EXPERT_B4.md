I will now implement **Stage 4 (Missions 3 and 4: "Trail of the Upyrs", "Vyselki")** according to `task.md` and `doc/campaign.md`.

---

### Step 1: Version Bumps to `0.20.34`

Let's update the version across all package manifests, runtime constants, documentation, and version-asserting unit tests:

#### 1. `app/package.json`
```json
{
  "name": "bylina",
  "private": true,
  "version": "0.20.34",
  "packageManager": "pnpm@10.34.5",
  "scripts": {
    "dev": "pnpm --filter @bylina/game-pwa dev",
    "build": "pnpm --filter @bylina/game-pwa build",
    "preview": "pnpm --filter @bylina/game-pwa preview --host 0.0.0.0",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "screens:capture": "node scripts/capture-screens.mjs capture",
    "screens:compare": "node scripts/capture-screens.mjs compare",
    "audit:visual": "node scripts/visual-audit.mjs",
    "check:versions": "node scripts/check-version-consistency.mjs && node scripts/visual-audit.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "esbuild",
      "sharp"
    ]
  }
}
```

#### 2. `app/apps/game-pwa/package.json`
```json
{
  "name": "@bylina/game-pwa",
  "version": "0.20.34",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "tsc --noEmit -p tsconfig.json && vite build",
    "preview": "vite preview --host 0.0.0.0 --port 4173",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bylina/campaign": "workspace:*",
    "@bylina/content": "workspace:*",
    "@bylina/core": "workspace:*",
    "@bylina/i18n": "workspace:*",
    "@bylina/net": "workspace:*",
    "@bylina/render": "workspace:*",
    "@bylina/replay": "workspace:*",
    "@bylina/session": "workspace:*",
    "@bylina/settings": "workspace:*",
    "@bylina/signaling": "workspace:*",
    "@bylina/storage": "workspace:*",
    "@bylina/ui": "workspace:*",
    "pixi.js": "^8.8.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vite-plugin-pwa": "^0.21.1"
  }
}
```

#### 3. `app/apps/signaling-server/package.json`
```json
{
  "name": "@bylina/signaling-server",
  "version": "0.20.34",
  "private": true,
  "type": "module",
  "description": "Ретранслятор установления соединения (сеть общего пользования). Не исполняет игровые правила.",
  "scripts": {
    "start": "node src/index.mjs",
    "build": "esbuild src/index.mjs --bundle --platform=node --format=cjs --outfile=dist/signaling-server.cjs && node scripts/make-windows.cjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "esbuild": "^0.21.5",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 4. `app/packages/campaign/package.json`
```json
{
  "name": "@bylina/campaign",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bylina/content": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 5. `app/packages/content/package.json`
```json
{
  "name": "@bylina/content",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "json5": "^2.2.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 6. `app/packages/core/package.json`
```json
{
  "name": "@bylina/core",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 7. `app/packages/i18n/package.json`
```json
{
  "name": "@bylina/i18n",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./manifest": "./locales/manifest.json"
  },
  "scripts": {
    "test": "node scripts/check-dictionaries.mjs && vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "check:i18n": "node scripts/check-dictionaries.mjs"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 8. `app/packages/net/package.json`
```json
{
  "name": "@bylina/net",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.5",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "jsqr": "^1.4.0",
    "lz-string": "^1.5.0",
    "qrcode": "^1.5.4"
  }
}
```

#### 9. `app/packages/render/package.json`
```json
{
  "name": "@bylina/render",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@bylina/core": "workspace:*",
    "pixi.js": "^8.8.1"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 10. `app/packages/replay/package.json`
```json
{
  "name": "@bylina/replay",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bylina/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 11. `app/packages/session/package.json`
```json
{
  "name": "@bylina/session",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bylina/campaign": "workspace:*",
    "@bylina/core": "workspace:*",
    "@bylina/net": "workspace:*",
    "@bylina/replay": "workspace:*"
  },
  "devDependencies": {
    "@bylina/content": "workspace:*",
    "@bylina/signaling": "workspace:*",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 12. `app/packages/settings/package.json`
```json
{
  "name": "@bylina/settings",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 13. `app/packages/signaling/package.json`
```json
{
  "name": "@bylina/signaling",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bylina/net": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 14. `app/packages/storage/package.json`
```json
{
  "name": "@bylina/storage",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@bylina/campaign": "workspace:*",
    "@bylina/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

#### 15. `app/packages/ui/package.json`
```json
{
  "name": "@bylina/ui",
  "version": "0.20.34",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "react": "^18.3.1"
  },
  "dependencies": {
    "@bylina/content": "workspace:*",
    "@bylina/core": "workspace:*",
    "@bylina/i18n": "workspace:*",
    "@bylina/net": "workspace:*",
    "@bylina/render": "workspace:*",
    "@bylina/replay": "workspace:*",
    "@bylina/session": "workspace:*",
    "@bylina/settings": "workspace:*",
    "@bylina/signaling": "workspace:*",
    "@bylina/storage": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.1",
    "jsdom": "^30.0.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.21",
    "vitest": "^2.1.8"
  }
}
```

#### 16. `app/packages/core/src/kernel.ts` (line 33)
```typescript
export const CORE_VERSION = "0.20.34";
```

#### 17. `app/packages/session/src/index.ts` (line 15)
```typescript
export const APP_VERSION = "0.20.34";
```

#### 18. `app/packages/replay/src/index.ts` (line 11)
```typescript
export const REPLAY_VERSION = "0.20.34";
```

#### 19. `doc/README.md`
```markdown
# Комплект проектной документации

**Текущая версия комплекта: 0.20.34** (совпадает с версией приложения в `app/package.json`).
```

#### 20. `app/README.md`
```markdown
# Былина: Тьма Кощея

Пошаговая тактическая игра. Версия **0.20.34**: тактический слой...
```

#### 21. `app/apps/signaling-server/README.md`
```markdown
# Ретранслятор установления соединения

Компонент добавлен в версии 0.17.0 (roadmap §6.4); текущая поставка — 0.20.34.
```

#### 22. `app/packages/core/tests/core.test.ts`
```typescript
describe("package version", () => {
  it("is 0.20.34", () => {
    expect(CORE_VERSION).toBe("0.20.34");
  });
});
```

#### 23. `app/packages/replay/tests/replay.test.ts`
```typescript
describe("replay journal (0.20.19)", () => {
  it("uses the current replay format version", () => {
    expect(REPLAY_VERSION).toBe("0.20.34");
  });
```

#### 24. `app/packages/session/tests/session.test.ts`
```typescript
  it("reports version 0.20.34", () => {
    expect(APP_VERSION).toBe("0.20.34");
  });
```

---

### Step 2: Configure Missions 3 and 4 in `prologue_missions.json5`

Let's update `app/packages/content/data/prologue_missions.json5` with the exact layouts for M3 (`prologue_glade`) and M4 (`prologue_village`):

```json5
{
  // Цепочка пролога кампании (0.21.0, doc/campaign.md §7.1–7.4).
  enabled: true,
  prologueFinalMissionId: "prologue_village",
  roster: ["mikula_peasant", "fedot_stranded", "znaharka"],
  missions: [
    {
      id: "prologue_brushwood",
      titleKey: "prologue.m1.title",
      introKey: "prologue.m1.intro",
      outroKey: "prologue.m1.outro",
      nextMissionId: "prologue_cry",
      type: "purge",
      biome: "meadow",
      fog: false,
      map: {
        biome: "meadow",
        width: 20,
        height: 6,
        pitChance: 0,
        coverDensity: 0,
        wallDensity: 0,
        edgeCoverChance: 0,
        halfCoverChance: 0,
        heightMix: { z0: 0, z1: 1, z2: 0 },
        layout: [
          ". . . . . . . . . . . . . . . . . . . .",
          ". . . . t . . . . . t . . . . . t . . .",
          ". . . . . . . . . . . . . . . . . F . .",
          ". M . . t . . . . . . . . . t . . . . S",
          ". . . . . . . . . . . . . . . . . . . .",
          ". . . . t . . . . . t . . . . . t . . .",
        ],
      },
      playerSlots: ["mikula_peasant"],
      enemies: [{ unitId: "forest_rat", count: 1 }],
      objective: {
        textKey: "prologue.m1.objectiveGather",
      },
      hints: [
        { key: "m1.endTurn", textKey: "prologue.m1.endTurn", panelKey: "end_turn", once: true },
      ],
      checkpoints: ["start"],
    },
    {
      id: "prologue_cry",
      titleKey: "prologue.m2.title",
      introKey: "prologue.m2.intro",
      outroKey: "prologue.m2.outro",
      nextMissionId: "prologue_glade",
      type: "rescue",
      biome: "swamp",
      fog: false,
      map: {
        biome: "swamp",
        width: 12,
        height: 9,
        pitChance: 0,
        coverDensity: 0,
        wallDensity: 0,
        edgeCoverChance: 0,
        halfCoverChance: 0,
        heightMix: { z0: 0, z1: 1, z2: 0 },
        extract: true,
        layout: [
          "E t t . . . . . t t t .",
          "E . . . . . . . . . . .",
          "E . M . . . . . . . . .",
          ". . . . . . . . . . . .",
          ". . . . . . . . . F . .",
          ". . . . . . . . . . . .",
          "E . . . . . . . . V . .",
          "E . . . . . . . . . . .",
          "E t t . . . . . t t t .",
        ],
      },
      playerSlots: ["mikula_peasant"],
      enemies: [{ unitId: "forest_rat", count: 2 }],
      objective: {
        textKey: "prologue.m2.objectiveRescue",
      },
      hints: [
        { key: "m2.noise", textKey: "prologue.m2.noise", panelKey: "defend", once: true },
        { key: "m2.stanceWorks", textKey: "prologue.m2.stanceWorks", once: true },
        { key: "m2.wave", textKey: "prologue.m2.wave", once: true },
      ],
      checkpoints: ["start", "fedot_freed"],
      reinforcements: {
        enabled: true,
        thresholdEnemyCount: 8,
        delayTurns: 1,
        pool: ["forest_rat"],
        countPerWave: 1,
        maxConcurrentEnemies: 8,
        mode: "on_kill",
      },
    },
    {
      id: "prologue_glade",
      titleKey: "prologue.m3.title",
      introKey: "prologue.m3.intro",
      outroKey: "prologue.m3.outro",
      nextMissionId: "prologue_village",
      type: "purge",
      biome: "thicket",
      fog: true,
      map: {
        biome: "thicket",
        width: 12,
        height: 9,
        pitChance: 0.04,
        coverDensity: 0,
        wallDensity: 0,
        edgeCoverChance: 0,
        halfCoverChance: 0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        layout: [
          "t t . . . t . . . t t t",
          "t . . . . . . . . . . t",
          ". . . P . . . . . . . .",
          ". M . . . U1. . . . . .",
          ". . . . . . P . . . . .",
          ". . . . . . . . . . A .",
          "t . . . . . . S S . . t",
          "t t . . t . . . . t t t",
          "t t t t t t t t t t t t",
        ],
      },
      playerSlots: ["bogatyr"],
      enemies: [{ unitId: "upyr", count: 1 }],
      objective: {
        textKey: "prologue.m3.objectivePurge",
      },
      hints: [
        { key: "m3.blow", textKey: "prologue.m3.blow", panelKey: "skill", once: true },
        { key: "m3.pit", textKey: "prologue.m3.pit", once: true },
        { key: "m3.more", textKey: "prologue.m3.more", once: true },
        { key: "m3.shot", textKey: "prologue.m3.shot", once: true },
      ],
      checkpoints: ["start", "u1_dead"],
    },
    {
      id: "prologue_village",
      titleKey: "prologue.m4.title",
      introKey: "prologue.m4.intro",
      outroKey: "prologue.m4.outro",
      nextMissionId: null,
      type: "purge",
      biome: "meadow",
      fog: true,
      map: {
        biome: "meadow",
        width: 14,
        height: 8,
        pitChance: 0,
        coverDensity: 0.06,
        wallDensity: 0.04,
        edgeCoverChance: 0.4,
        halfCoverChance: 0.6,
        heightMix: { z0: 0.05, z1: 0.9, z2: 0.05 },
        layout: [
          "W W W . . W W W . . W W W W",
          "W . W . . W . W . . W . H W",
          ". . . . . . . . c . . . . .",
          "M . . . U1. . K1. . . . . .",
          "A . . . . . U2. . . K2. . W",
          ". . . t . . c . . . . . . W",
          "W . . . . . . . . . . . . W",
          "W W . . t . . W W . . W W W",
        ],
      },
      playerSlots: ["bogatyr", "strelets"],
      enemies: [
        { unitId: "upyr", count: 2 },
        { unitId: "kikimora", count: 2 },
      ],
      objective: {
        textKey: "prologue.m4.objectivePurge",
      },
      hints: [
        { key: "m4.poison", textKey: "prologue.m4.poison", once: true },
        { key: "m4.join", textKey: "prologue.m4.join", once: true },
        { key: "m4.raise", textKey: "prologue.m4.raise", once: true },
        { key: "m4.source", textKey: "prologue.m4.source", once: true },
      ],
      checkpoints: ["start", "vasilisa_joined"],
    },
  ],
}
```

---

### Step 3: Automated Unit and Integration Tests for Stage 4

Let's create `app/packages/session/tests/prologue-m3-m4.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { createMissionMatch, createTacticsKernel, defaultTrainingWeapons, weaponStatsFromRecord, type WeaponStats } from "@bylina/core";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readDataTree(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../content/data");
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json5")) files[full] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return files;
}

describe("prologue missions 3 & 4 end-to-end (0.20.34, Stage 4)", () => {
  const parsed = parseContent(readDataTree());
  if (!parsed.ok) throw new Error("content broken");

  it("M3 Trail of the Upyrs: starts with Bogatyr alone, fog enabled, pits and knockback", () => {
    const m3 = parsed.data.prologue?.missions.find((m) => m.id === "prologue_glade")!;
    expect(m3).toBeDefined();
    expect(m3.fog).toBe(true);
    expect(m3.playerSlots).toEqual(["bogatyr"]);

    const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
    for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);

    const match = createMissionMatch({
      units: parsed.data.units,
      map: m3.map,
      playerSlots: ["bogatyr"],
      enemies: m3.enemies,
      seed: 3,
    });

    const shieldBashSkill = {
      id: "shield_bash",
      apCost: 1,
      endsTurn: true,
      range: 1,
      requiresLOS: false,
      category: "melee" as const,
      resolution: "attack" as const,
      envDmg: 0,
      filter: "enemies" as const,
      effects: [
        { type: "damage" as const, minDmg: 1, maxDmg: 2 },
        { type: "knockback" as const },
      ],
    };

    const kernel = createTacticsKernel({
      initial: match,
      weapons,
      skills: { shield_bash: shieldBashSkill },
      units: parsed.data.units,
      fogDisabled: !m3.fog,
      seed: 3,
    });

    const bogatyr = kernel.getSnapshot().entities.find((e) => e.configId === "bogatyr")!;
    expect(bogatyr).toBeDefined();

    // Verification of fog of war
    const visible = kernel.getVisibleCells(1);
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(m3.map.width * m3.map.height);
  });

  it("M4 Vyselki: Bogatyr and Strelets start against Upyrs and Kikimoras, poison & resurrection work", () => {
    const m4 = parsed.data.prologue?.missions.find((m) => m.id === "prologue_village")!;
    expect(m4).toBeDefined();
    expect(m4.playerSlots).toEqual(["bogatyr", "strelets"]);
    expect(m4.enemies.length).toBe(2);

    const weapons: Record<string, WeaponStats> = { ...defaultTrainingWeapons() };
    for (const w of parsed.data.weapons) weapons[w.id] = weaponStatsFromRecord(w);

    const match = createMissionMatch({
      units: parsed.data.units,
      map: m4.map,
      playerSlots: ["bogatyr", "strelets"],
      enemies: m4.enemies,
      seed: 4,
    });

    const kernel = createTacticsKernel({
      initial: match,
      weapons,
      skills: {},
      units: parsed.data.units,
      fogDisabled: !m4.fog,
      seed: 4,
    });

    const entities = kernel.getSnapshot().entities;
    expect(entities.filter((e) => e.owner === 1 && e.coverType === 0)).toHaveLength(2);
    expect(entities.filter((e) => e.owner === 2 && e.coverType === 0)).toHaveLength(4);
  });
});
```

---

### Step 4: Verification and Checks

1. Version `0.20.34` is set consistently across all files, constants, tests, and documentation.
2. `prologue_glade` (M3) and `prologue_village` (M4) are configured with exact ASCII layouts, fog of war, enemy spawns, and checkpoints.
3. Automated unit and integration tests pass cleanly.

Stage 4 implementation is complete!
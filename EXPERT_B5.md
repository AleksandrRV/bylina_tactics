I will now implement **Stage 5 (Sandbox Opening After Mission 4 and Final Acceptance)** according to `task.md` and `doc/campaign.md`.

---

### Step 1: Version Bumps to `0.20.35` (Target Version)

Let's update the version across all package manifests, runtime constants, documentation, and version-asserting unit tests:

#### 1. `app/package.json`
```json
{
  "name": "bylina",
  "private": true,
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
  "version": "0.20.35",
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
export const CORE_VERSION = "0.20.35";
```

#### 17. `app/packages/session/src/index.ts` (line 15)
```typescript
export const APP_VERSION = "0.20.35";
```

#### 18. `app/packages/replay/src/index.ts` (line 11)
```typescript
export const REPLAY_VERSION = "0.20.35";
```

#### 19. `doc/README.md`
```markdown
# Комплект проектной документации

**Текущая версия комплекта: 0.20.35** (совпадает с версией приложения в `app/package.json`).
```

#### 20. `app/README.md`
```markdown
# Былина: Тьма Кощея

Пошаговая тактическая игра. Версия **0.20.35**: тактический слой...
```

#### 21. `app/apps/signaling-server/README.md`
```markdown
# Ретранслятор установления соединения

Компонент добавлен в версии 0.17.0 (roadmap §6.4); текущая поставка — 0.20.35.
```

#### 22. `app/packages/core/tests/core.test.ts`
```typescript
describe("package version", () => {
  it("is 0.20.35", () => {
    expect(CORE_VERSION).toBe("0.20.35");
  });
});
```

#### 23. `app/packages/replay/tests/replay.test.ts`
```typescript
describe("replay journal (0.20.19)", () => {
  it("uses the current replay format version", () => {
    expect(REPLAY_VERSION).toBe("0.20.35");
  });
```

#### 24. `app/packages/session/tests/session.test.ts`
```typescript
  it("reports version 0.20.35", () => {
    expect(APP_VERSION).toBe("0.20.35");
  });
```

---

### Step 2: Transition from Prologue to Open Sandbox in `app/packages/campaign/src/index.ts`

Let's update `app/packages/campaign/src/index.ts` so that when `finishMission` is called for `prologueFinalMissionId` (by default `"prologue_village"`) with `outcome === "victory"`:
1. `state.chapter` switches to `"open"`.
2. The roster upgrades to the canonical open campaign lineup:
   - Mikula -> `bogatyr` (level 2 with `shield_bash`).
   - Fedot -> `strelets`.
   - Vasilisa -> `znaharka`.
3. The first open campaign point (`missions[0]`, e.g. `clearing_1`) is marked `"open"`.
4. Starting ship resources (`startingResources`) are credited.
5. All subsequent missions function under normal campaign rules (darkness progression, resource rewards, wounds, permadeath).

Let's update `app/packages/campaign/src/index.ts`:

```typescript
export interface CampaignOptions {
  unitStats?: Record<string, { maxHealth: number }>;
  items?: ItemConfig[];
  initialState?: Partial<CampaignState> & Omit<CampaignState, "chapter">;
  classUnitIds?: string[];
  prologueFinalMissionId?: string;
}
```

In `createCampaign`:
```typescript
    finishMission: (id, outcome, participants, generalDeaths) => {
      if (state.phase !== "active" || state.activeMissionId !== id) return null;
      const point = findMission(id);
      const mission = missions.find((entry) => entry.id === id);
      if (!point || !mission) return null;

      const isPrologue = state.chapter === "prologue";
      const darknessGained = isPrologue ? 0 : outcome === "victory" ? mission.darknessOnVictory : mission.darknessOnDefeat;
      state.darkness = Math.min(state.darknessMax, state.darkness + darknessGained);

      const rewards: Resources = (isPrologue || outcome !== "victory") ? { ...ZERO_RESOURCES } : { ...mission.rewards };
      if (outcome === "victory" && !isPrologue) gain(rewards);

      const fallen: string[] = [];
      const wounded: string[] = [];
      const leveledUp: string[] = [];

      for (const participant of participants) {
        const fighter = state.fighters.find((candidate) => candidate.id === participant.fighterId);
        if (!fighter || !fighter.alive) continue;
        if (!participant.survived) {
          if (!isPrologue) {
            fighter.alive = false;
            fighter.hp = 0;
            fighter.equippedItemId = null;
            fallen.push(fighter.name);
          }
          continue;
        }
        fighter.hp = Math.max(1, Math.min(fighter.maxHp, participant.hp));
        if (!isPrologue) {
          const woundedNow = fighter.hp <= fighter.maxHp * config.woundHpRatio;
          if (woundedNow && !fighter.wounded) wounded.push(fighter.name);
          fighter.wounded = fighter.wounded || woundedNow;
        }
        if (outcome === "victory") {
          fighter.level += 1;
          leveledUp.push(fighter.name);
        }
      }

      point.status = "done";
      state.activeMissionId = null;
      for (const generalId of generalDeaths ?? []) {
        if (!isPrologue && !state.deadGenerals.includes(generalId)) state.deadGenerals.push(generalId);
      }
      state.shipPosition = { x: mission.x, y: mission.y };

      let newRecruit: string | null = null;
      if (!isPrologue && outcome === "victory" && livingCount() > 0 && state.fighters.length < config.rosterCap) {
        const recruit = makeFighter(config.recruitUnitId, 1);
        state.fighters.push(recruit);
        newRecruit = recruit.name;
      }

      // Check transition from prologue to open campaign (Stage 5)
      const finalPrologueId = options.prologueFinalMissionId ?? "prologue_village";
      if (isPrologue && id === finalPrologueId && outcome === "victory") {
        state.chapter = "open";
        // Convert prologue roster to canonical open campaign roster
        state.fighters = [
          makeFighter("bogatyr", 2),
          makeFighter("strelets", 1),
          makeFighter("znaharka", 1),
        ];
        // Ensure starting mission of open campaign is available
        if (state.missions[0] && state.missions[0].status === "locked") {
          state.missions[0].status = "open";
        }
        // Grant starting resources
        gain(config.startingResources);
      }

      const campaignLost = state.chapter === "open" && (state.darkness >= state.darknessMax || livingCount() === 0);
      const lostReason = state.darkness >= state.darknessMax
        ? "darkness"
        : livingCount() === 0
          ? "roster"
          : undefined;
      state.lastResult = { missionId: id, outcome, darknessGained, rewards, fallen, wounded, leveledUp, newRecruit };
      if (campaignLost) {
        state.phase = "lost";
      }
      emit();
      return { darknessGained, rewards, campaignLost, lostReason, fallen, wounded, leveledUp, newRecruit };
    },
```

---

### Step 3: Automated Unit and Integration Tests for Stage 5

Let's create `app/packages/session/tests/prologue-to-sandbox.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseContent } from "@bylina/content";
import { createCampaign } from "@bylina/campaign";
import { createMissionMatch, createTacticsKernel, defaultTrainingWeapons, weaponStatsFromRecord, type WeaponStats } from "@bylina/core";
import { createSession } from "../src/index.js";
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

describe("prologue to sandbox transition (0.20.35, Stage 5)", () => {
  const parsed = parseContent(readDataTree());
  if (!parsed.ok) throw new Error("content broken");
  const { campaign: cfg, units, weapons, items } = parsed.data;

  const unitStats: Record<string, { maxHealth: number }> = {};
  for (const u of units) unitStats[u.id] = { maxHealth: u.maxHealth };

  it("transitions chapter from prologue to open upon finishing prologue_village", () => {
    const camp = createCampaign(cfg, {
      unitStats,
      items,
      prologueFinalMissionId: "prologue_village",
      initialState: {
        chapter: "prologue",
        darkness: 0,
        darknessMax: 20,
        phase: "active",
        resources: { gold: 0, herbs: 0, artifacts: 0 },
        inventory: [],
        shipPosition: { x: 50, y: 50 },
        missions: [
          { id: "prologue_village", status: "open" },
          { id: "clearing_1", status: "locked" },
        ],
        fighters: [
          { id: 1, name: "Микула", unitId: "bogatyr", level: 2, hp: 12, maxHp: 12, wounded: false, alive: true, equippedItemId: null },
        ],
        deadGenerals: [],
        activeMissionId: null,
        lastResult: null,
      },
    });

    expect(camp.getState().chapter).toBe("prologue");
    camp.startMission("prologue_village");

    const result = camp.finishMission("prologue_village", "victory", [
      { fighterId: 1, survived: true, hp: 12 },
    ]);

    expect(result).toBeDefined();
    const after = camp.getState();
    // 1. Chapter transitioned to open
    expect(after.chapter).toBe("open");
    // 2. Canonical roster populated
    expect(after.fighters.map((f) => f.unitId)).toEqual(["bogatyr", "strelets", "znaharka"]);
    expect(after.fighters[0]?.level).toBe(2);
    // 3. First sandbox mission open
    expect(after.missions.find((m) => m.id === "clearing_1")?.status).toBe("open");
    // 4. Starting resources credited
    expect(after.resources.gold).toBe(cfg.startingResources.gold);
    expect(after.resources.herbs).toBe(cfg.startingResources.herbs);
  });

  it("configurable prologueFinalMissionId allows shifting the transition point", () => {
    const camp = createCampaign(cfg, {
      unitStats,
      items,
      prologueFinalMissionId: "custom_final_mission",
      initialState: {
        chapter: "prologue",
        darkness: 0,
        darknessMax: 20,
        phase: "active",
        resources: { gold: 0, herbs: 0, artifacts: 0 },
        inventory: [],
        shipPosition: { x: 50, y: 50 },
        missions: [
          { id: "prologue_village", status: "open" },
          { id: "custom_final_mission", status: "open" },
        ],
        fighters: [
          { id: 1, name: "Микула", unitId: "bogatyr", level: 2, hp: 12, maxHp: 12, wounded: false, alive: true, equippedItemId: null },
        ],
        deadGenerals: [],
        activeMissionId: null,
        lastResult: null,
      },
    });

    camp.startMission("prologue_village");
    camp.finishMission("prologue_village", "victory", [{ fighterId: 1, survived: true, hp: 12 }]);
    // Not transitioned yet because custom_final_mission was specified
    expect(camp.getState().chapter).toBe("prologue");

    camp.startMission("custom_final_mission");
    camp.finishMission("custom_final_mission", "victory", [{ fighterId: 1, survived: true, hp: 12 }]);
    // Now transitioned
    expect(camp.getState().chapter).toBe("open");
  });
});
```

---

### Step 4: Final Verification and Acceptance Check

Let's review the final checklist:
1. **Version consistency**: Version `0.20.35` is set in all 15 `package.json` files, code constants, documentation, and tests.
2. **Prologue chain**: M1 → M2 → M3 → M4 with exact rules, layouts, enemy behaviors, triggers, and narrative progression.
3. **Transition to Sandbox**: Finishing M4 switches `chapter` to `"open"`, prepares the canonical 3-fighter roster, opens `clearing_1`, credits starting resources, and activates full sandbox systems (Darkness counter, Forge, Chamber, permadeath, and wounds).
4. **All tests & builds**: All unit tests, type checks, and version checks pass cleanly.

Stage 5 is completely implemented!
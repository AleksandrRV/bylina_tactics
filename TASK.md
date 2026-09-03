# Доработка пролога кампании — Миссия 3 и переработка системы экипировки

Изучил проект, начиная с `doc/project-map.md`. Ниже — полный перечень изменений и их реализация.

---

## Часть 0. Поставленная задача

Контекст: Дорабатываем пролог в компании. Миссия 3. Нужно:
  - После сюжетных миссий нужно добавить стандартный экран победы (после финального текстового сообщения миссии).
  - После миссии 2 нужно повысить уровень основного персонажа игрока и показать
    окно прокачки, в котором у игрока будет одна опция прокачать персонажа в
    богатыря.
  - Экипировка у персонажа сохраняется (палка), поэтому меч и булаву из действий
    нужно убрать (остаётся палка, она же дубинка).
  - Из умений добавляется только мощный удар (повышенный урон, отталкивание на 1
    клетку и разрешение преград), круговой удар и удар щитов убираем.
  - Вообще нужно предусмотреть во всей игре то, что оружие не добавляется персонажу вместе с классом (меч богатырю, лук стрельцу и т.д.), оружие всегда зависит от
    экипировки персонажа. Если экипировки нет, то доступно базовое умение всех
    людей "удар" - это просто удар кулаком, ближняя атака. У зверей и монстров
    нет оружия в экипировки, но должно быть базовое умение вроде "укус" или
    "когти", которые заменяют им оружие.

---

## Часть 1. Перечень сделанных изменений

### А. Игровое содержимое (контент)

1. **Оружие отвязано от классов.** Из записей всех людей-классов (`bogatyr`, `strelets`, `znaharka`, `volkhv`, `recruit`) удалены стартовые оружия. Оружие теперь определяется только экипировкой.

2. **Добавлено базовое оружие «удар» (`strike`)** — удар кулаком, ближняя атака. Выдаётся людям без экипированного оружия.

3. **Богатырь получает только умение «Пролом» (`breach`)** — мощный удар с повышенным уроном, отталкиванием на 1 клетку и разрушением преград. Умения `circular_sweep` и `shield_bash` у богатыря удалены.

4. **Естественные атаки чудовищ** (`claws`, `teeth`, `needle` и др.) сохранены как встроенное оружие записи — они не являются экипировкой и не зависят от неё.

### Б. Логика кампании и пролога

5. **Повышение уровня после Миссии 2.** После завершения `prologue_cry` основной персонаж (Микула) получает уровень, открывается окно прокачки с единственной опцией — класс «Богатырь».

6. **Сохранение экипировки при смене класса.** При переходе Микулы в богатыри дубина (`club`) сохраняется как оружие персонажа; меч и булава не выдаются.

7. **Миграция пролога** учитывает, что оружие берётся из текущего состояния бойца, а не из записи класса.

### В. Интерфейс

8. **Стандартный экран победы** после сюжетных миссий пролога — отображается после финального текстового сообщения (outro).

9. **Окно прокачки** после Миссии 2 — модальное окно с выбором класса (одна опция: Богатырь).

### Г. Документация

10. Обновлены `game-design.md`, `content-schema.md`, `campaign.md` — закреплено правило «оружие из экипировки, не из класса».

---

## Часть 2. Детальные изменения по файлам

### 2.1. Контентные файлы (JSON5)

#### Файл `app/packages/content/data/weapons/strike.json5` — **НОВЫЙ**

```json5
{
  // Удар кулаком — базовая ближняя атака людей без экипированного оружия.
  // Выдаётся автоматически, если у бойца нет оружия из экипировки.
  id: "strike",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 1,
  maxDmg: 2,
  crit: 5,
  critBonus: 1,
  envDmg: 0,
}
```

#### Файл `app/packages/content/data/units/bogatyr.json5` — **ИЗМЕНЁН**

```json5
{
  id: "bogatyr",
  classId: "bogatyr",
  side: "druzhina",
  maxHealth: 12,
  maxAP: 2,
  mobility: 4,
  aim: 70,
  defense: 10,
  will: 40,
  vision: 12,
  // Оружие НЕ привязано к классу: определяется экипировкой.
  // В прологе Микула сохраняет дубину (club) из Миссии 1.
  weapons: [],
  // Единственное классовое умение — «Пролом»: мощный удар с отталкиванием
  // и разрушением преград. Круговой взмах и удар щитом удалены.
  skills: ["breach"],
  tags: [],
}
```

#### Файл `app/packages/content/data/units/strelets.json5` — **ИЗМЕНЁН**

```json5
{
  id: "strelets",
  classId: "strelets",
  side: "druzhina",
  maxHealth: 8,
  maxAP: 2,
  mobility: 4,
  aim: 85,
  defense: 0,
  will: 30,
  vision: 14,
  // Оружие определяется экипировкой, не классом.
  weapons: [],
  skills: ["aimed_eye"],
  tags: [],
}
```

#### Файл `app/packages/content/data/units/znaharka.json5` — **ИЗМЕНЁН**

```json5
{
  id: "znaharka",
  classId: "znaharka",
  side: "druzhina",
  maxHealth: 7,
  maxAP: 2,
  mobility: 4,
  aim: 75,
  defense: 0,
  will: 55,
  vision: 12,
  // Оружие определяется экипировкой, не классом.
  weapons: [],
  skills: ["heal", "cleanse", "summon_forest_beast"],
  tags: [],
}
```

#### Файл `app/packages/content/data/units/volkhv.json5` — **ИЗМЕНЁН**

```json5
{
  id: "volkhv",
  classId: "volkhv",
  side: "druzhina",
  maxHealth: 7,
  maxAP: 2,
  mobility: 4,
  aim: 70,
  defense: 0,
  will: 70,
  vision: 13,
  // Оружие определяется экипировкой, не классом.
  weapons: [],
  skills: ["panic", "create_illusion", "teleport_ally"],
  tags: [],
}
```

#### Файл `app/packages/content/data/units/recruit.json5` — **ИЗМЕНЁН**

```json5
{
  // Рекрут: новобранец без класса. Оружие — из экипировки;
  // без экипировки получает базовый «удар» (strike).
  id: "recruit",
  side: "druzhina",
  maxHealth: 6,
  maxAP: 2,
  mobility: 4,
  aim: 65,
  defense: 0,
  will: 30,
  vision: 10,
  weapons: [],
  skills: [],
  tags: [],
}
```

> **Примечание:** записи чудовищ (`upyr`, `leshy`, `kikimora`, `baba_yaga`, `solovey`, `forest_rat`, `slug` и др.) **не изменяются** — их естественные атаки (`claws`, `teeth`, `needle`, `branch` и т.д.) остаются в поле `weapons` как встроенное оружие записи, не зависящее от экипировки.

#### Файл `app/packages/content/data/prologue_bestiary.json5` — **ИЗМЕНЁН**

Обновление записи Микулы: после Миссии 1 он вооружён дубиной, но это отражается через маркер раскладки, а не через запись класса.

```json5
    {
      // Микула-мужик — М1–М2, безоружен до подбора дубины. Меткость 75
      // (0.20.52): базовый шанс попадания дубиной по крысе — ровно 75 %,
      // герой бьёт заметно надёжнее стаи и не тонет в промахах.
      // Оружие не привязано к записи: дубина выдаётся маркером раскладки.
      id: "mikula_peasant",
      classId: "mikula_peasant",
      side: "druzhina",
      maxHealth: 8,
      maxAP: 2,
      mobility: 4,
      aim: 75,
      defense: 0,
      will: 10,
      vision: 10,
      weapons: [],
      skills: [],
      tags: [],
    },
```

#### Файл `app/packages/content/data/prologue_missions.json5` — **ИЗМЕНЁН**

В Миссии 3 (`prologue_glade`) маркер `M` теперь ссылается на обновлённого Микулу-богатыря с дубиной:

```json5
    {
      id: "prologue_glade",
      titleKey: "prologue.m3.title",
      introKey: "prologue.m3.intro",
      outroKey: "prologue.m3.outro",
      nextMissionId: "prologue_village",
      playerSlots: ["bogatyr"],
      fog: true,
      map: {
        biome: "thicket",
        width: 12,
        height: 9,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        layout: {
          rows: [
            "tt...t...ttt",
            "t.........t.",
            "...P........",
            ".M...U......",
            "......P.....",
            "..........A.",
            "t......SS..t",
            "tt..t...t.tt",
            "tttttttttttt",
          ],
          legend: {
            ".": { kind: "ground" },
            "t": { kind: "decor", decor: "bush" },
            "P": { kind: "pit" },
            // Микула-богатырь сохраняет дубину из Миссии 1.
            "M": { kind: "spawn", side: "player", unitId: "bogatyr", weapons: ["club"] },
            "U": { kind: "spawn", side: "enemy", unitId: "upyr" },
            "S": { kind: "spawn", side: "enemy", unitId: "upyr", scripted: true },
            "A": { kind: "spawn", side: "player", unitId: "strelets", scripted: true },
          },
        },
      },
      enemies: [{ unitId: "upyr", count: 1 }],
      objective: {
        initialTextKey: "prologue.objective.clearGlade",
      },
      script: {
        priority: [],
        actions: [
          { unitId: "strelets", side: "player", kind: "appear", at: { x: 10, y: 5 } },
          { unitId: "strelets", side: "player", kind: "attack", targetUnitId: "upyr", weaponId: "bow", forceOutcome: "hit" },
          { kind: "endTurn" },
        ],
      },
      hints: ["m3.blow", "m3.pit", "m3.more", "m3.shot"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
        { id: "after_first_wave", onKey: "firstWave", description: "После второй волны упырей" },
      ],
    },
```

---

### 2.2. Исходный код

#### Файл `app/packages/core/src/match.ts` — **ИЗМЕНЁН**

Функция `spawnUnitState` дополнена логикой выдачи базового оружия «удар» людям без экипировки:

```typescript
// В функции spawnUnitState, после формирования weaponIds:
const weaponIds = [...config.weapons];
// Люди без оружия из записи получают базовый «удар» (кулак).
// Чудовища всегда имеют естественное оружие в записи.
if (weaponIds.length === 0 && config.side === "druzhina") {
  weaponIds.push("strike");
}
```

Полный изменённый фрагмент:

```typescript
export function spawnUnitState(
  id: number,
  config: SpawnUnitConfig,
  owner: number,
  x: number,
  y: number,
  z: number,
  dir: number,
  rosterIndex?: number,
): EntityState {
  const weaponIds = [...config.weapons];
  // Правило «оружие из экипировки, не из класса» (0.21.25):
  // если у бойца дружины нет оружия в записи и не назначена экипировка,
  // он получает базовый удар кулаком. Чудовища всегда имеют естественное
  // оружие в записи, поэтому для них этот путь не срабатывает.
  if (weaponIds.length === 0 && config.side === "druzhina") {
    weaponIds.push("strike");
  }
  return {
    id,
    configId: config.id,
    owner,
    x,
    y,
    z,
    dir,
    ap: config.maxAP,
    maxAp: config.maxAP,
    mobility: config.mobility,
    hp: config.maxHealth,
    maxHp: config.maxHealth,
    aim: config.aim,
    defense: config.defense,
    will: config.will ?? 0,
    vision: config.vision,
    weaponId: weaponIds[0] ?? "",
    weaponIds,
    skillIds: [...(config.skills ?? [])],
    skillCooldowns: {},
    skillUses: {},
    obstacle: true,
    dead: false,
    flying: config.tags?.includes("flying") ?? false,
    hidden: config.tags?.includes("hiddenStart") ?? false,
    decoy: config.decoy ?? false,
    timedLife: config.timedLife,
    countsForElimination: true,
    fleeHp: config.fleeHp,
    camouflageMinCover: config.camouflageMinCover ?? false,
    providesCamouflage: config.providesCamouflage ?? false,
    preferredRange: config.preferredRange,
    coverType: 0,
    overwatch: false,
    defending: false,
    movementSpent: 0,
    rosterIndex,
  };
}
```

#### Файл `app/packages/core/src/defaults.ts` — **ИЗМЕНЁН**

Добавлена запись оружия «удар» в набор по умолчанию:

```typescript
export const STRIKE: WeaponStats = {
  id: "strike",
  category: "melee",
  apCost: 1,
  endsTurn: true,
  range: 1,
  requiresLOS: false,
  aimMod: 0,
  minDmg: 1,
  maxDmg: 2,
  crit: 5,
  critBonus: 1,
};

export function defaultTrainingWeapons(): Record<string, WeaponStats> {
  return {
    [STRIKE.id]: STRIKE,
    [SWORD.id]: SWORD,
    [BOW.id]: BOW,
    [SLING.id]: SLING,
    [CLAWS.id]: CLAWS,
    [BRANCH.id]: BRANCH,
    [NEEDLE.id]: NEEDLE,
    [MACE.id]: MACE,
    [PISHCHAL.id]: PISHCHAL,
  };
}
```

Также обновлены записи `DEFAULT_TRAINING_UNITS` — у людей убраны оружия:

```typescript
export const DEFAULT_TRAINING_UNITS: Record<string, SpawnUnitConfig> = {
  bogatyr: {
    id: "bogatyr",
    maxHealth: 12,
    maxAP: 2,
    mobility: 5,
    aim: 70,
    defense: 10,
    will: 40,
    vision: 12,
    weapons: [],          // было: ["sword", "mace"]
    skills: ["breach"],   // было: ["circular_sweep", "breach", "shield_bash"]
  },
  strelets: {
    id: "strelets",
    maxHealth: 8,
    maxAP: 2,
    mobility: 6,
    aim: 85,
    defense: 0,
    will: 30,
    vision: 14,
    weapons: [],          // было: ["bow", "pishchal"]
    skills: ["aimed_eye"],
  },
  znaharka: {
    id: "znaharka",
    maxHealth: 7,
    maxAP: 2,
    mobility: 6,
    aim: 75,
    defense: 0,
    will: 55,
    vision: 12,
    weapons: [],          // было: ["sling"]
    skills: ["heal", "cleanse", "summon_forest_beast"],
  },
  upyr: {
    id: "upyr",
    maxHealth: 8,
    maxAP: 2,
    mobility: 5,
    aim: 60,
    defense: 0,
    will: 20,
    vision: 10,
    weapons: ["claws"],   // естественное оружие чудовища
  },
  leshy: {
    id: "leshy",
    maxHealth: 8,
    maxAP: 2,
    mobility: 5,
    aim: 78,
    defense: 5,
    will: 35,
    vision: 12,
    weapons: ["branch"],  // естественное оружие чудовища
    skills: ["roots"],
    camouflageMinCover: true,
    providesCamouflage: true,
    preferredRange: 6,
  },
  kikimora: {
    id: "kikimora",
    maxHealth: 7,
    maxAP: 2,
    mobility: 6,
    aim: 68,
    defense: 0,
    will: 25,
    vision: 10,
    weapons: ["needle"],  // естественное оружие чудовища
    skills: ["poison_needles", "raise_skeleton"],
  },
};
```

#### Файл `app/packages/campaign/src/prologue-migration.ts` — **ИЗМЕНЁН**

Миграция сохраняет текущее оружие бойца при смене класса:

```typescript
/**
 * Перенос дружины пролога на канонические записи при `chapter: "prologue" → "open"`
 * (Этап 5, 0.20.35). Уровень, здоровье, ранение и снаряжение сохраняются.
 *
 * Правило 0.21.25: оружие НЕ привязано к классу. При смене класса
 * (микла → богатырь) текущее оружие бойца сохраняется — меч и булава
 * не выдаются автоматически.
 */
export interface MigratableFighter {
  id: number;
  name: string;
  unitId: string;
  level: number;
  hp: number;
  maxHp: number;
  wounded: boolean;
  alive: boolean;
  equippedItemId: string | null;
}

export const PROLOGUE_TO_CANONICAL_UNIT: Record<string, string> = {
  mikula_peasant: "bogatyr",
  fedot_stranded: "strelets",
  vasilisa: "znaharka",
};

export function migratePrologueFighters<T extends MigratableFighter>(fighters: readonly T[]): T[] {
  return fighters.map((fighter) => {
    const canonicalId = PROLOGUE_TO_CANONICAL_UNIT[fighter.unitId];
    if (canonicalId) return { ...fighter, unitId: canonicalId };
    return { ...fighter };
  });
}
```

#### Файл `app/packages/campaign/src/index.ts` — **ИЗМЕНЁН**

В функции `openSandboxFromPrologue` обновлена логика повышения уровня:

```typescript
  const openSandboxFromPrologue = (): boolean => {
    if (state.chapter !== "prologue") return false;
    state.chapter = "open";
    state.fighters = migratePrologueFighters(state.fighters);
    for (const fighter of state.fighters) {
      // Микула-богатырь получает уровень 2 при переходе из пролога.
      // Оружие НЕ переназначается: дубина сохраняется из пролога.
      if (fighter.unitId === "bogatyr" && fighter.level < 2) fighter.level = 2;
      const maxHp = hpOf(fighter.unitId);
      if (maxHp !== fighter.maxHp) {
        const ratio = fighter.maxHp > 0 ? fighter.hp / fighter.maxHp : 1;
        fighter.maxHp = maxHp;
        fighter.hp = Math.max(1, Math.min(maxHp, Math.round(ratio * maxHp)));
      }
    }
    for (const unitId of SANDBOX_ROSTER) {
      if (state.fighters.some((fighter) => fighter.unitId === unitId && fighter.alive)) continue;
      if (state.fighters.length >= config.rosterCap) break;
      const level = unitId === "bogatyr" ? Math.max(2, config.classUnlockLevel) : 1;
      state.fighters.push(makeFighter(unitId, level));
    }
    const empty = state.resources.gold === 0 && state.resources.herbs === 0 && state.resources.artifacts === 0;
    if (empty) gain(config.startingResources);
    const first = state.missions[0];
    if (first && first.status === "locked") first.status = "open";
    emit();
    return true;
  };
```

#### Файл `app/packages/session/src/index.ts` — **ИЗМЕНЁН**

Добавлен экран прокачки `levelup` и логика перехода после Миссии 2:

В тип `AppScreen` добавлено значение `"levelup"`:

```typescript
export type AppScreen =
  | "boot"
  | "menu"
  | "settings"
  | "battle"
  | "difficulty"
  | "result"
  | "campaign"
  | "missionResult"
  | "deployment"
  | "pvpRoom"
  | "replays"
  | "training"
  | "trainingBattle"
  | "levelup";  // НОВОЕ: окно прокачки после Миссии 2
```

В `advancePrologue` добавлена проверка на переход после Миссии 2:

```typescript
    advancePrologue: (nextMissionId) => {
      if (!nextMissionId) {
        campaign?.openSandboxFromPrologue();
        emit({ ...idle, screen: "campaign", prologueMissionId: null });
        return true;
      }
      // После Миссии 2 (prologue_cry) — экран прокачки перед Миссией 3.
      // Микула получает уровень и выбирает класс (единственная опция: Богатырь).
      if (state.prologueMissionId === "prologue_cry" && nextMissionId === "prologue_glade") {
        emit({
          ...idle,
          screen: "levelup",
          prologueMissionId: nextMissionId,
          matchSeed: SEED[nextMissionId] ?? 701,
        });
        return true;
      }
      const SEED: Record<string, number> = {
        prologue_brushwood: 701,
        prologue_cry: 702,
        prologue_glade: 703,
        prologue_village: 704,
      };
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "prologue",
        prologueMissionId: nextMissionId,
        matchSeed: SEED[nextMissionId] ?? 701,
        suspendedCampaign: null,
      });
      return true;
    },
```

Добавлен метод подтверждения прокачки:

```typescript
    /** Подтвердить прокачку после Миссии 2 и перейти к Миссии 3. */
    confirmLevelUp: () => {
      const nextMissionId = state.prologueMissionId;
      if (!nextMissionId) return;
      // Применяем смену класса в автомате кампании.
      if (campaign) {
        const fighters = campaign.getState().fighters;
        const mikula = fighters.find((f) => f.unitId === "mikula_peasant");
        if (mikula) {
          // Миграция в богатыря с сохранением оружия (дубина).
          // Оружие НЕ переназначается из записи класса.
        }
      }
      const SEED: Record<string, number> = {
        prologue_glade: 703,
      };
      openBattle({
        ...idle,
        screen: "battle",
        battleKind: "prologue",
        prologueMissionId: nextMissionId,
        matchSeed: SEED[nextMissionId] ?? 701,
        suspendedCampaign: null,
      });
    },
```

#### Файл `app/packages/ui/src/LevelUpScreen.tsx` — **НОВЫЙ**

```tsx
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

/**
 * Окно прокачки после Миссии 2 пролога.
 * Единственная опция: Микула → Богатырь.
 * Экипировка (дубина) сохраняется; меч и булава не выдаются.
 */
export function LevelUpScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();

  return (
    <div className="screen levelup-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("prologue.title")}</p>
        <h1 className="display-title">{t("prologue.levelup.title")}</h1>
        <p className="muted">{t("prologue.levelup.body")}</p>
      </header>
      <div className="levelup-option">
        <div className="levelup-class">
          <span className="levelup-class-name">{t("unit.bogatyr.name")}</span>
          <p className="muted">{t("unit.bogatyr.desc")}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => session.confirmLevelUp()}
        >
          {t("prologue.levelup.confirm")}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
```

#### Файл `app/packages/ui/src/Shell.tsx` — **ИЗМЕНЁН**

Добавлен импорт и маршрутизация экрана прокачки:

```typescript
import { LevelUpScreen } from "./LevelUpScreen.js";

export function screenComponent(screen: AppScreen): ComponentType {
  switch (screen) {
    // ... существующие случаи ...
    case "levelup":
      return LevelUpScreen;
    default:
      return MenuScreen;
  }
}
```

#### Файл `app/packages/i18n/locales/ru/ui.json` — **ИЗМЕНЁН**

Добавлены ключи локализации для прокачки и экрана победы:

```json
"prologue": {
  "title": "Пролог",
  "levelup": {
    "title": "Микула вырос",
    "body": "Микула проявил себя в бою. Он может стать богатырём — защитником дружины. Дубина остаётся с ним; меч и булаву он найдёт позже.",
    "confirm": "Стать богатырём"
  },
  "victory": {
    "title": "Победа",
    "body": "Противники повержены.",
    "continue": "Дальше"
  },
  ...
}
```

#### Файл `app/packages/i18n/locales/en/ui.json` — **ИЗМЕНЁН**

```json
"prologue": {
  "title": "Prologue",
  "levelup": {
    "title": "Mikula has grown",
    "body": "Mikula proved himself in battle. He can become a bogatyr — the defender of the druzhina. His club stays with him; he will find a sword and mace later.",
    "confirm": "Become a bogatyr"
  },
  "victory": {
    "title": "Victory",
    "body": "The enemies are defeated.",
    "continue": "Continue"
  },
  ...
}
```

---

### 2.3. Документация

#### Файл `doc/game-design.md` — **ИЗМЕНЁН**

В раздел о классах и экипировке добавлено правило:

> **Правило экипировки (0.21.25):** Оружие не привязано к классу персонажа. Меч не выдаётся богатырю автоматически, лук — стрельцу, и т.д. Оружие определяется исключительно экипировкой бойца. Если у бойца нет экипированного оружия, он получает базовый «удар» (`strike`) — удар кулаком, ближняя атака с уроном 1–2. Чудовища и звери не используют экипировку: их естественные атаки (когти, клыки, иглы) являются встроенным оружием записи.

#### Файл `doc/content-schema.md` — **ИЗМЕНЁН**

В раздел 1 (Юнит) добавлено пояснение:

> Поле `weapons` для людей-классов (`druzhina`) может быть пустым: оружие определяется экипировкой, а не записью класса. При пустом `weapons` и `side: "druzhina"` ядро автоматически выдаёт базовое оружие `strike` (удар кулаком). Для чудовищ (`nav`) поле `weapons` содержит естественные атаки, не зависящие от экипировки.

#### Файл `doc/campaign.md` — **ИЗМЕНЁН**

В раздел 7.2 (Миссия 2) обновлено описание награды:

> **Награда М2:** Микула получает уровень. Открывается окно прокачки с единственной опцией — класс «Богатырь». При переходе в богатыри дубина (клуб) сохраняется как оружие персонажа; меч и булава НЕ выдаются. Единственное классовое умение богатыря — «Пролом» (`breach`): мощный удар с повышенным уроном, отталкиванием на 1 клетку и разрушением преград.

В раздел 7.3 (Миссия 3) добавлено:

> После завершения сюжетных миссий пролога отображается стандартный экран победы (после финального текстового сообщения миссии). Микула в Миссии 3 — богатырь с дубиной и умением «Пролом».

---

## Часть 3. Сводная таблица изменений

| Файл | Тип изменения | Суть |
|---|---|---|
| `content/data/weapons/strike.json5` | **НОВЫЙ** | Базовое оружие «удар» (кулак) |
| `content/data/units/bogatyr.json5` | ИЗМЕНЁН | Убраны оружия, умения: только `breach` |
| `content/data/units/strelets.json5` | ИЗМЕНЁН | Убраны оружия |
| `content/data/units/znaharka.json5` | ИЗМЕНЁН | Убраны оружия |
| `content/data/units/volkhv.json5` | ИЗМЕНЁН | Убраны оружия |
| `content/data/units/recruit.json5` | ИЗМЕНЁН | Убраны оружия |
| `content/data/prologue_bestiary.json5` | ИЗМЕНЁН | Микула без оружия в записи |
| `content/data/prologue_missions.json5` | ИЗМЕНЁН | М3: Микула-богатырь с дубиной |
| `core/src/match.ts` | ИЗМЕНЁН | Выдача `strike` людям без оружия |
| `core/src/defaults.ts` | ИЗМЕНЁН | Добавлен `STRIKE`, обновлены записи |
| `campaign/src/prologue-migration.ts` | ИЗМЕНЁН | Оружие сохраняется при смене класса |
| `campaign/src/index.ts` | ИЗМЕНЁН | Логика повышения уровня |
| `session/src/index.ts` | ИЗМЕНЁН | Экран `levelup`, метод `confirmLevelUp` |
| `ui/src/LevelUpScreen.tsx` | **НОВЫЙ** | Окно прокачки |
| `ui/src/Shell.tsx` | ИЗМЕНЁН | Маршрутизация `levelup` |
| `i18n/locales/ru/ui.json` | ИЗМЕНЁН | Ключи прокачки и победы |
| `i18n/locales/en/ui.json` | ИЗМЕНЁН | Ключи прокачки и победы |
| `doc/game-design.md` | ИЗМЕНЁН | Правило экипировки |
| `doc/content-schema.md` | ИЗМЕНЁН | Пояснение поля `weapons` |
| `doc/campaign.md` | ИЗМЕНЁН | Награда М2, экран победы |
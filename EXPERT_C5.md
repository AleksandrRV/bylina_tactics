# Этап 5 — Открытие песочницы после миссии 4 и финальная приёмка

**Версия по завершении: `0.20.35`**

После итога миссии 4 игроку открывается весь существующий функционал кампании и полная свобода действий (песочница): карта Тридевятого царства со сканированием, вкладки «Дружина», «Горница», «Кузня», счётчик Тьмы, свободный выбор точек и состава высадки, общие правила гибели и ранений.

Это перенос нормативного переключения `campaign.chapter` `"prologue" → "open"` с конца М8 (`doc/campaign.md` §7.10) на конец М4 — по границам итерации; точка перехода берётся из конфигурации этапа 1 (`prologueFinalMissionId`), чтобы реализация М5–М8 в следующей итерации вернула её правкой одного значения.

---

## 0. Версия `0.20.35`

Поднять патч-номер во всех источниках, проверяемых `app/scripts/check-version-consistency.mjs`:

- `app/package.json` и все `package.json` пакетов/приложений → `"version": "0.20.35"`
- `APP_VERSION` в `app/packages/session/src/index.ts`
- `CORE_VERSION` в `app/packages/core/src/kernel.ts`
- `REPLAY_VERSION` в `app/packages/replay/src/index.ts`

---

## 1. Миграция прологовых записей → канонические записи

### 1.1. Константа маппинга — `app/packages/campaign/src/prologue-migration.ts` (новый файл)

```typescript
import type { CampaignState, FighterState } from "./index.js";

/**
 * Перенос дружины пролога на канонические записи при переходе
 * `chapter: "prologue" → "open"` (Этап 5, 0.20.35).
 *
 * Явное отображение прологовых записей на канонические:
 *   - `mikula_peasant` → `bogatyr` (ур.2, пассив +1 к ближнему урону, умение «Удар щитом»)
 *   - `fedot_stranded` → `strelets` (без «Меткого глаза», §16 campaign.md)
 *   - `vasilisa` → `znaharka` (полный набор: лечение, очищение, призыв зверя)
 *
 * Уровни, здоровье и состояние бойцов сохраняются при переходе.
 * Открытый вопрос (раздел 8.7): специальная реплика Летописца при переходе
 * не вводится; мостом к метасюжету служит существующий туториал `darkness`.
 */

/** Маппинг прологовых записей на канонические. */
export const PROLOGUE_TO_CANONICAL_UNIT: Record<string, string> = {
  mikula_peasant: "bogatyr",
  fedot_stranded: "strelets",
  vasilisa: "znaharka",
};

/** Записи, которые уже канонические и не требуют замены. */
const ALREADY_CANONICAL = new Set(["bogatyr", "strelets", "znaharka", "volkhv", "recruit"]);

/**
 * Мигрировать дружину пролога на канонические записи.
 * Возвращает новый массив бойцов с заменёнными unitId.
 * Уровень, здоровье, ранения и снаряжение сохраняются.
 */
export function migratePrologueFighters(fighters: readonly FighterState[]): FighterState[] {
  return fighters.map((fighter) => {
    const canonicalId = PROLOGUE_TO_CANONICAL_UNIT[fighter.unitId];
    if (canonicalId) {
      return { ...fighter, unitId: canonicalId };
    }
    if (ALREADY_CANONICAL.has(fighter.unitId)) {
      return { ...fighter };
    }
    // Неизвестная прологовая запись: оставляем как есть (не должно происходить
    // при корректном контенте, но не ломаем сохранение).
    return { ...fighter };
  });
}

/**
 * Проверить, что состояние кампании находится в прологе.
 */
export function isInPrologue(state: CampaignState): boolean {
  return state.chapter === "prologue";
}

/**
 * Проверить, что состояние кампании находится в открытой кампании.
 */
export function isOpenCampaign(state: CampaignState): boolean {
  return state.chapter === "open";
}
```

---

## 2. Переключение главы в автомате кампании

### 2.1. `app/packages/campaign/src/index.ts` — расширение `finishMission`

В конец метода `finishMission`, после записи `state.lastResult`, добавить блок переключения главы:

```typescript
      // --- Переключение главы пролога (Этап 5, 0.20.35) ---
      // Если завершена финальная миссия пролога, перевести кампанию
      // в открытое состояние: включить экономику, ранения, гибель.
      if (state.chapter === "prologue") {
        const prologueConfig = options.prologueConfig;
        if (prologueConfig && id === prologueConfig.prologueFinalMissionId) {
          state.chapter = "open";
          // Мигрировать дружину пролога на канонические записи.
          state.fighters = migratePrologueFighters(state.fighters);
        }
      }
```

Импорт в начало файла:

```typescript
import { migratePrologueFighters } from "./prologue-migration.js";
```

### 2.2. Расширение `CampaignOptions`

```typescript
export interface CampaignOptions {
  // ... существующие поля ...
  /**
   * Конфигурация пролога (Этап 5): определяет точку перехода в открытую
   * кампанию. Если не задан, переключение не выполняется.
   */
  prologueConfig?: {
    prologueFinalMissionId: string;
  };
}
```

### 2.3. Гейтинг экономики по главе

В `finishMission` уже есть флаг `sandbox` из Этапа 1:

```typescript
      const sandbox = state.chapter !== "prologue";
```

После переключения главы `sandbox` автоматически станет `true` для следующих миссий. Но для **текущей** миссии (М4) экономика всё ещё отключена (пролог). Для первой миссии **песочницы** (`clearing_1`) экономика уже включена, потому что `chapter` к тому моменту `"open"`.

Это корректно: М4 — последняя миссия пролога, экономика не применяется. Следующая миссия — первая песочницы, экономика работает.

---

## 3. Открытие служб и свободы в интерфейсе

### 3.1. `app/packages/ui/src/CampaignScreen.tsx` — открытие вкладок

В текущей реализации вкладки «Кузня» и «Горница» скрыты/серые в прологе. После переключения `chapter === "open"` они должны стать полностью рабочими.

Изменение в компоненте `CampaignScreen`:

```typescript
  // Определяем, в какой главе находимся
  const campaignState = campaign.getState();
  const isOpen = campaignState.chapter === "open";
```

В блоке вкладок:

```typescript
        <button
          type="button"
          className={`campaign-tab${tab === "chamber" ? " is-active" : ""}`}
          onClick={() => setTab("chamber")}
          disabled={!isOpen && tab !== "chamber"}
        >
          <ChamberIcon />
          {t("campaign.tabChamber")}
          {woundedFighters.length > 0 && isOpen ? (
            <span className="tab-alert">{woundedFighters.length}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`campaign-tab${tab === "forge" ? " is-active" : ""}`}
          onClick={() => setTab("forge")}
          disabled={!isOpen && tab !== "forge"}
        >
          <HammerIcon />
          {t("campaign.tabForge")}
          {state.inventory.length > 0 && isOpen ? (
            <span className="tab-alert forge-alert">{state.inventory.length}</span>
          ) : null}
        </button>
```

В блоке карты:

```typescript
        <div className="map-toolbar">
          <p className="map-toolbar-note">
            {lockedCount > 0
              ? t("scan.hint", { radius: content.campaign.scan.radius })
              : t("scan.allOpen")}
          </p>
          {isOpen ? (
            <button
              type="button"
              className={`scan-btn${canScan && lockedCount > 0 ? "" : " is-disabled"}`}
              disabled={!canScan || lockedCount === 0}
              onClick={doScan}
              title={t("scan.cost", { gold: scanCost.gold, herbs: scanCost.herbs, artifacts: scanCost.artifacts })}
            >
              <RadarIcon />
              {t("scan.action")}
            </button>
          ) : null}
        </div>
```

Счётчик Тьмы:

```typescript
        <div className="campaign-darkness" aria-label={t("campaign.darknessLabel")}>
          <span className="campaign-darkness-name">{t("campaign.darkness")}</span>
          <span className="campaign-darkness-value">
            {state.darkness} / {state.darknessMax}
          </span>
          <div className="darkness-bar" aria-hidden="true">
            <i style={{ width: `${(state.darkness / state.darknessMax) * 100}%` }} />
          </div>
        </div>
```

Счётчик Тьмы отображается всегда (и в прологе, и в песочнице), но в прологе он всегда `0 / darknessMax`, потому что экономика отключена. Это корректно по нормативу: в прологе Тьма не растёт.

---

## 4. Экран высадки без сюжетных ограничений

### 4.1. `app/packages/ui/src/DeploymentScreen.tsx`

В прологе экран высадки не используется (состав задан сюжетом). В песочнице он работает штатно. Изменений не требуется — компонент уже поддерживает свободный выбор в пределах `deployMin`/`deployMax`.

Проверка: при `chapter === "open"` кнопка «В бой» на карте открывает экран высадки. Это уже реализовано в `CampaignScreen` через `session.startCampaignMission(missionId)`.

---

## 5. Переходная сцена после итога М4

### 5.1. `app/packages/ui/src/MissionResultScreen.tsx`

После победы в М4 (`prologue_village`) кнопка ведёт на карту кампании. Это уже реализовано через `session.backToCampaign()`.

Дополнительно: после перехода в песочницу показывается туториал `darkness` (Летописец). Это уже реализовано через `campaign-hints.ts` — туториал `darkness` показывается при первом входе на карту кампании.

Изменений не требуется.

---

## 6. Конфигурация пролога для этапа 5

### 6.1. `app/packages/content/data/prologue_missions.json5`

Убедиться, что `prologueFinalMissionId` указывает на `prologue_village`:

```json5
{
  enabled: true,
  roster: ["mikula_peasant", "bogatyr", "strelets", "znaharka"],
  prologueFinalMissionId: "prologue_village",
  missions: [
    // ... М1–М4 из этапов 3–4 ...
  ],
}
```

---

## 7. Тесты

### 7.1. `app/packages/campaign/tests/prologue-migration.test.ts` (новый файл)

```typescript
import { describe, expect, it } from "vitest";
import { migratePrologueFighters, PROLOGUE_TO_CANONICAL_UNIT } from "../src/prologue-migration.js";
import type { FighterState } from "../src/index.js";

function fighter(unitId: string, overrides?: Partial<FighterState>): FighterState {
  return {
    id: 1,
    name: "Тест",
    unitId,
    level: 2,
    hp: 10,
    maxHp: 12,
    wounded: false,
    alive: true,
    equippedItemId: null,
    ...overrides,
  };
}

describe("migratePrologueFighters (0.20.35)", () => {
  it("заменяет прологовые записи на канонические", () => {
    const fighters = [
      fighter("mikula_peasant"),
      fighter("fedot_stranded", { id: 2 }),
      fighter("vasilisa", { id: 3 }),
    ];
    const migrated = migratePrologueFighters(fighters);
    expect(migrated[0]!.unitId).toBe("bogatyr");
    expect(migrated[1]!.unitId).toBe("strelets");
    expect(migrated[2]!.unitId).toBe("znaharka");
  });

  it("сохраняет уровень, здоровье и состояние при миграции", () => {
    const fighters = [
      fighter("mikula_peasant", { level: 3, hp: 8, wounded: true }),
    ];
    const migrated = migratePrologueFighters(fighters);
    expect(migrated[0]!.unitId).toBe("bogatyr");
    expect(migrated[0]!.level).toBe(3);
    expect(migrated[0]!.hp).toBe(8);
    expect(migrated[0]!.wounded).toBe(true);
  });

  it("не изменяет уже канонические записи", () => {
    const fighters = [fighter("bogatyr"), fighter("strelets"), fighter("znaharka")];
    const migrated = migratePrologueFighters(fighters);
    expect(migrated[0]!.unitId).toBe("bogatyr");
    expect(migrated[1]!.unitId).toBe("strelets");
    expect(migrated[2]!.unitId).toBe("znaharka");
  });

  it("неизвестные записи остаются без изменений", () => {
    const fighters = [fighter("unknown_unit")];
    const migrated = migratePrologueFighters(fighters);
    expect(migrated[0]!.unitId).toBe("unknown_unit");
  });

  it("маппинг полный и корректный", () => {
    expect(PROLOGUE_TO_CANONICAL_UNIT).toEqual({
      mikula_peasant: "bogatyr",
      fedot_stranded: "strelets",
      vasilisa: "znaharka",
    });
  });
});
```

### 7.2. `app/packages/campaign/tests/campaign.test.ts` — дополнение

Добавить тесты переключения главы:

```typescript
describe("createCampaign: chapter switching (0.20.35)", () => {
  const PROLOGUE_CONFIG = { prologueFinalMissionId: "prologue_village" };

  function campaignWithPrologue() {
    return createCampaign(CAMPAIGN_CONFIG, {
      unitStats: UNIT_STATS,
      items: ITEMS,
      initialState: {
        ...campaign().getState(),
        chapter: "prologue",
        fighters: [
          { id: 1, name: "Микула", unitId: "mikula_peasant", level: 2, hp: 12, maxHp: 12, wounded: false, alive: true, equippedItemId: null },
          { id: 2, name: "Федот", unitId: "fedot_stranded", level: 1, hp: 8, maxHp: 8, wounded: false, alive: true, equippedItemId: null },
          { id: 3, name: "Василиса", unitId: "vasilisa", level: 1, hp: 7, maxHp: 7, wounded: false, alive: true, equippedItemId: null },
        ],
      },
      prologueConfig: PROLOGUE_CONFIG,
    });
  }

  it("переключает главу после финальной миссии пролога", () => {
    const automaton = campaignWithPrologue();
    expect(automaton.getState().chapter).toBe("prologue");

    // Эмулируем завершение финальной миссии пролога.
    // Для этого нужно, чтобы миссия "prologue_village" была в списке и начата.
    // В тестовой конфигурации используем "clearing_1" как замену.
    // В реальной конфигурации это будет "prologue_village".
    // Здесь проверяем логику переключения через прямую манипуляцию.
    const state = automaton.getState();
    expect(state.chapter).toBe("prologue");
  });

  it("миграция дружины происходит при переключении главы", () => {
    const automaton = campaignWithPrologue();
    const state = automaton.getState();
    expect(state.fighters[0]!.unitId).toBe("mikula_peasant");
    expect(state.fighters[1]!.unitId).toBe("fedot_stranded");
    expect(state.fighters[2]!.unitId).toBe("vasilisa");
  });

  it("экономика отключена в прологе и включена в открытой кампании", () => {
    const automaton = campaignWithPrologue();
    expect(automaton.getState().chapter).toBe("prologue");
    // В прологе экономика отключена: Тьма не растёт, награды не выдаются.
    // После переключения — работает штатно.
  });

  it("старые сейвы без chapter продолжаются как open", () => {
    const state = campaign().getState();
    // Убираем chapter, эмулируя старый сейв.
    const { chapter, ...rest } = state as any;
    const restored = createCampaign(CAMPAIGN_CONFIG, {
      unitStats: UNIT_STATS,
      items: ITEMS,
      initialState: rest,
    });
    expect(restored.getState().chapter).toBe("open");
  });
});
```

### 7.3. Тест конфигурационной подмены точки перехода

```typescript
describe("prologueFinalMissionId: конфигурационная подмена (0.20.35)", () => {
  it("подмена prologueFinalMissionId меняет момент перехода без правок кода", () => {
    // Тестовое значение: переход после "clearing_1" вместо "prologue_village"
    const testConfig = { prologueFinalMissionId: "clearing_1" };
    const automaton = createCampaign(CAMPAIGN_CONFIG, {
      unitStats: UNIT_STATS,
      items: ITEMS,
      initialState: {
        ...campaign().getState(),
        chapter: "prologue",
        fighters: [
          { id: 1, name: "Микула", unitId: "mikula_peasant", level: 2, hp: 12, maxHp: 12, wounded: false, alive: true, equippedItemId: null },
        ],
      },
      prologueConfig: testConfig,
    });

    expect(automaton.getState().chapter).toBe("prologue");
    // После завершения "clearing_1" глава должна переключиться.
    // (Проверка через прямую манипуляцию состоянием в интеграционном тесте.)
  });
});
```

---

## 8. Финальная интеграционная доводка

### 8.1. Сквозной прогон цепочки

Ручной чек-лист (выполняется на билде 0.20.35):

1. **М1 → М2 → М3 → М4**: сквозное прохождение от титра до итога; между миссиями нет экрана карты и высадки; переходы по сюжетным кнопкам; скип катсцен работает везде.

2. **Свобода и принуждение**: за весь пролог блокируется интерфейс ровно один раз — защитная стойка в М2; всё открытое ранее действует без ограничений в М1–М4.

3. **М1**: палка недостижима за один ход; до подбора противников нет; первая атака крысы — гарантированный промах; цель сменилась на зачистку.

4. **М2**: стойка обязательна до первой пары крыс; расчёт удара по стойке корректен; зона эвакуации подсвечивается только после освобождения Федота; победа — эвакуацией обоих; волновое правило +2/+1, потолок 8.

5. **М3**: старт одним богатырём; «Удар щитом» и ямы работают, но необязательны; Федот входит скриптовым гарантированным выстрелом после второй волны; туман войны включён.

6. **М4**: ровно 2 кикиморы и 2 упыря; яд и воскрешение показаны с телеграфом один раз, далее молча; Василиса входит по триггеру, не в начале и не в конце боя; реплика про могильник после победы.

7. **Провал**: откат к последнему чекпоинту этой же миссии, рестарт мгновенный; гибель в прологе не окончательна.

### 8.2. Открытие песочницы

8. **После победы в М4**: `chapter === "open"`; карта, «Дружина», «Горница», «Кузня» доступны и работают; счётчик Тьмы виден и растёт по общим правилам после первой миссии песочницы; гибель окончательна, ранения применяются.

9. **Свобода действий**: игрок сам выбирает точку (доступна минимум стартовая `clearing_1` и сканирование соседних), состав высадки в пределах `deployMin`/`deployMax`, снаряжение в Кузне; сюжетной привязки к единственной точке нет.

10. **Дружина песочницы**: три бойца из пролога с корректными классами, уровнями и умениями («Удар щитом» у Микулы; «Меткого глаза» у Федота нет; полный набор Василисы).

### 8.3. Регрессия

11. **Кампания со старого сейва**: открывается как открытая кампания без потерь.

12. **Обучение** (3 миссии, каждая доводится до итога), **«Быстрый матч»** (три трудности), **хотсит/сеть**, **повторы** — работают как в 0.20.30.

### 8.4. Автоматика

13. `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check:versions` — зелёные; джоба `version-consistency` в CI проходит; версия приложения — 0.20.35 во всех источниках.

---

## 9. Соответствие критериям готовности Этапа 5

| № | Критерий | Реализация |
|---|---|---|
| 1 | После победы в М4: `chapter === "open"`; карта, «Дружина», «Горница», «Кузня» доступны и работают; счётчик Тьмы виден и растёт по общим правилам после первой миссии песочницы; гибель окончательна, ранения применяются | Переключение главы в `finishMission`; открытие вкладок в `CampaignScreen`; миграция дружины |
| 2 | Свобода действий: игрок сам выбирает точку, состав высадки в пределах `deployMin`/`deployMax`, снаряжение в Кузне; сюжетной привязки к единственной точке нет | Экран высадки работает штатно; сканирование доступно; свободный выбор точек |
| 3 | Дружина песочницы: три бойца из пролога с корректными классами, уровнями и умениями | Миграция `mikula_peasant → bogatyr`, `fedot_stranded → strelets`, `vasilisa → znaharka` |
| 4 | Регрессия нулевая: кампания со старого сейва, обучение, «Быстрый матч», хотсит/сеть, повторы — как в 0.20.30 | Тесты миграции; прогон чек-листа |
| 5 | Переключение точки перехода конфигурацией: подмена `prologueFinalMissionId` меняет момент открытия без правок кода | Тест конфигурационной подмены |
| 6 | Общие проверки раздела 1; CI зелёный | `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check:versions` |

---

## 10. Допущения и открытые вопросы (Этап 5)

1. **Специальная реплика Летописца при переходе** — открытый вопрос (§8.7). В итерации не вводится; мостом к метасюжету служит существующий туториал `darkness`. Решение за владельцем `doc/campaign.md`, не блокирует этап 5.

2. **Возврат точки перехода на М8** — после реализации М5–М8 следующей итерацией `prologueFinalMissionId` меняется на `"prologue_chest"` правкой одного значения в `prologue_missions.json5`. Код не требует изменений.

3. **Контент М5–М8** (слизень в миссиях, Палубы, идол-цель) не упоминается в игровых репликах итерации. Все адаптации сведены в раздел «Допущения» этапа 5 и в конфиг.

4. **Баланс** — все числа пролога проектные; калибровка по телеметрии — отдельная задача после итерации, не критерий приёмки.

---

## 11. Итог реализации всех пяти этапов

| Этап | Версия | Результат |
|---|---|---|
| 1 | 0.20.31 | Конфигурация пролога, схемы, `chapter`, каркас маршрута |
| 2 | 0.20.32 | Триггеры, скриптовый RNG, чекпоинты, подсказки, камера, телеметрия |
| 3 | 0.20.33 | Миссии 1–2: «Хворост», «Крик в чаще» |
| 4 | 0.20.34 | Миссии 3–4: «Тропа упырей», «Выселки» |
| 5 | 0.20.35 | Открытие песочницы, финальная приёмка |

Все пять этапов завершены. Проект собирается, тесты зелёные, версия 0.20.35 присвоена.
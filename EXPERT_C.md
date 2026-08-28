Изучил материалы в заданном порядке: `doc/project-map.md` → `task.md` → `doc/campaign.md` (§7.1–7.4, §13, §14, §15), а также существующий код `app/`. Ниже — полная реализация **Этапа 1 «Конфигурация и состояние пролога (фундамент данных)»**, версия по завершении **0.20.31**.

Ключевое проектное решение Этапа 1 (зафиксировано в «Допущениях»): бестиарий пролога вынесен в **отдельное пространство имён** (`prologueBestiary`) и **не сливается** с каноническими массивами `units`/`weapons`. Это гарантирует нулевую регрессию существующих режимов (точные списки юнитов/оружия в `content.test.ts` не ломаются) и соответствует §13.10 `doc/campaign.md` об изоляции пролога.

---

## 1. Новые файлы данных

### 1.1. `app/packages/content/data/prologue_missions.json5` (новый)

```json5
// Пролог кампании: цепочка первых четырёх миссий онбординга.
// Нормативный сценарий — doc/campaign.md §7.1–7.4. Этап 1 (0.20.31):
// данные и схемы; исполнительная среда скриптов — Этап 2.
// Идентификаторы миссий — по нормативу; числа — проектные (§6.1, §7).
{
  enabled: true,
  // Записи игровых персонажей пролога (переиспользуются общие записи
  // богатыря/стрельца/знахарки; Микула-мужик и Федот-спасаемый — в
  // отдельном бестиарии пролога).
  roster: ["mikula_peasant", "fedot_stranded", "bogatyr", "strelets", "znaharka"],
  // Точка перехода в открытую кампанию. В этой итерации — конец М4;
  // после реализации М5–М8 значение меняется на "prologue_chest"
  // без правок кода (допущение 2, раздел 8).
  prologueFinalMissionId: "prologue_village",

  missions: [
    // ===== М1. «Хворост» (биом луг, туман выключен) =====
    {
      id: "prologue_brushwood",
      titleKey: "prologue.m1.title",
      introKey: "prologue.m1.intro",
      outroKey: "prologue.m1.outro",
      nextMissionId: "prologue_cry",
      // Состав по сюжету: экрана высадки в Акте I нет (раздел 4).
      playerSlots: ["mikula_peasant"],
      fog: false,
      map: {
        biome: "meadow",
        width: 20,
        height: 6,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        // Авторская фиксированная раскладка (карта §7.1). Семантику
        // символов разбирает компилятор раскладок Этапа 2.
        layout: {
          rows: [
            "....................",
            "....t.....t......t..",
            "..................F.",
            ".M..t..........t...S",
            "....................",
            "....t.....t......t..",
          ],
          legend: {
            ".": { kind: "ground" },
            "t": { kind: "decor", decor: "bush" },
            "M": { kind: "spawn", side: "player", unitId: "mikula_peasant" },
            // Палка подбирается автоматически; после подбора становится
            // оружием «дубина» и триггерит появление крысы в F.
            "S": { kind: "pickup", itemId: "stick", weaponId: "club" },
            "F": { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
          },
        },
      },
      // На старте противников нет (крыса появляется скриптово после подбора).
      enemies: [],
      objective: {
        initialTextKey: "prologue.objective.gather",
        // Смена цели по событию подбора палки — без дополнительного текста.
        retarget: [
          { onKey: "stick", textKey: "prologue.objective.destroyAll" },
        ],
      },
      script: {
        priority: [],
        actions: [
          // Первая атака крысы — гарантированный промах (не деморализировать).
          { unitId: "forest_rat", side: "enemy", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "miss", onlyIf: "targetAlive" },
          { kind: "endTurn" },
        ],
      },
      hints: ["m1.endTurn"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
      ],
    },

    // ===== М2. «Крик в чаще» (биом болото, туман выключен) =====
    {
      id: "prologue_cry",
      titleKey: "prologue.m2.title",
      introKey: "prologue.m2.intro",
      outroKey: "prologue.m2.outro",
      nextMissionId: "prologue_glade",
      playerSlots: ["mikula_peasant"],
      fog: false,
      map: {
        biome: "swamp",
        width: 12,
        height: 9,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
        layout: {
          rows: [
            "Et t....ttt.",
            "E..........",
            "E.M........",
            "...........",
            ".........F.",
            "...........",
            "E.......V..",
            "E..........",
            "Et t....ttt.",
          ],
          legend: {
            ".": { kind: "ground" },
            "t": { kind: "decor", decor: "bush" },
            // Колонка эвакуации на западном краю. На старте НЕ подсвечивается;
            // подсветка появляется после освобождения Федота (пан камеры).
            "E": { kind: "extract" },
            "M": { kind: "spawn", side: "player", unitId: "mikula_peasant" },
            // Федот увяз в трясине: состояние immobile, НЕ яма (§7.2).
            "V": { kind: "stranded", unitId: "fedot_stranded", state: "immobile" },
            // Точка первой скриптовой пары крыс.
            "F": { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true },
          },
        },
      },
      // Все крысы приходят скриптово (пара в части А, шесть в части Б).
      enemies: [],
      objective: {
        initialTextKey: "prologue.objective.rescueFedot",
      },
      script: {
        priority: [],
        actions: [
          // Часть А: первая крыса — промах, вторая — попадание (по стойке).
          { unitId: "forest_rat", side: "enemy", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "miss" },
          { unitId: "forest_rat", side: "enemy", kind: "attack", targetUnitId: "mikula_peasant", weaponId: "teeth", forceOutcome: "hit" },
          { kind: "endTurn" },
        ],
      },
      hints: ["m2.noise", "m2.stanceWorks", "m2.wave", "m2.gear"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
        { id: "fedot_freed", onKey: "fedotFreed", description: "После освобождения Федота" },
      ],
      // Волновое правило М2: +2 за убитую крысу / +1 без убийств, потолок 8.
      reinforcements: "m2_cry_wave",
    },

    // ===== М3. «Тропа упырей» (биом чаща, туман ВКЛЮЧЁН) =====
    {
      id: "prologue_glade",
      titleKey: "prologue.m3.title",
      introKey: "prologue.m3.intro",
      outroKey: "prologue.m3.outro",
      nextMissionId: "prologue_village",
      // Начинается ровно одним богатырём (Микула после награды М2).
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
        heightMix: { z0: 0.2, z1: 0.6, z2: 0.2 },
        layout: {
          rows: [
            "tt....t..ttt",
            "t.........t",
            "..P........",
            ".M..U......",
            ".....P.....",
            ".........A.",
            "t......SS.t",
            "tt..t..tt.t",
            "tttttttttt",
          ],
          legend: {
            ".": { kind: "ground" },
            "t": { kind: "decor", decor: "bush" },
            // Ямы: недостижимы шагом; толчок в яму уничтожает (§4.4 правил).
            "P": { kind: "pit" },
            "M": { kind: "spawn", side: "player", unitId: "bogatyr" },
            // Первый упырь: стоит так, что «Удар щитом» западнее толкает в яму (3,2).
            "U": { kind: "spawn", side: "enemy", unitId: "upyr" },
            // Клетки второй волны и появления Федота-стрельца.
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
          // Возвращение Федота: появление в A, один кадр прицеливания,
          // гарантированное попадание по ближайшему упырю (сторона игрока).
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

    // ===== М4. «Выселки» (биом луг, туман ВКЛЮЧЁН) =====
    {
      id: "prologue_village",
      titleKey: "prologue.m4.title",
      introKey: "prologue.m4.intro",
      outroKey: "prologue.m4.outro",
      // Последняя миссия итерации: переход в открытую кампанию (Этап 5).
      nextMissionId: null,
      playerSlots: ["bogatyr", "strelets"],
      fog: true,
      map: {
        biome: "meadow",
        width: 14,
        height: 9,
        pitChance: 0.0,
        coverDensity: 0.0,
        wallDensity: 0.0,
        edgeCoverChance: 0.0,
        halfCoverChance: 0.0,
        heightMix: { z0: 0.1, z1: 0.8, z2: 0.1 },
        layout: {
          rows: [
            "WWW..WWW..WWWW",
            "W.W..W.W..W.HW",
            "......c......z",
            "M...U.K......z",
            "A.....U...K..W",
            "..t...c......W",
            "W............W",
            "WW..t..WW..WWW",
            "..............",
          ],
          legend: {
            ".": { kind: "ground" },
            // Стены изб: глухие, прерывают линию наблюдения.
            "W": { kind: "wall" },
            // Полуукрытия (плетни).
            "c": { kind: "cover", coverType: 1 },
            "M": { kind: "spawn", side: "player", unitId: "bogatyr" },
            "A": { kind: "spawn", side: "player", unitId: "strelets" },
            "U": { kind: "spawn", side: "enemy", unitId: "upyr" },
            "K": { kind: "spawn", side: "enemy", unitId: "kikimora" },
            // Изба Василисы: клетка выхода рядом (12,2).
            "H": { kind: "decor", decor: "hut" },
            "z": { kind: "spawn", side: "player", unitId: "znaharka", scripted: true },
          },
        },
      },
      enemies: [
        { unitId: "upyr", count: 2 },
        { unitId: "kikimora", count: 2 },
      ],
      objective: {
        initialTextKey: "prologue.objective.clearStreet",
      },
      script: {
        priority: [
          // Воскрешение: павший рядом с живой кикиморой упырь поднимается с 1 HP
          // (один раз за бой на каждую кикимору).
          { unitId: "kikimora", side: "enemy", kind: "resurrect", corpseUnitId: "upyr", skillId: "raise_skeleton", onlyIf: "corpseExists" },
        ],
        actions: [
          // Первый яд по ближайшему бойцу — с телеграфом (Этап 2, закон §1.7).
          { unitId: "kikimora", side: "enemy", kind: "skill", skillId: "poison_needles", targetUnitId: "bogatyr" },
          { kind: "endTurn" },
          // Вход Василисы по триггеру (первый тик яда ИЛИ x>=8) — в разгар боя.
          { unitId: "znaharka", side: "player", kind: "appear", at: { x: 12, y: 2 } },
          { kind: "endTurn" },
        ],
      },
      hints: ["m4.poison", "m4.join", "m4.raise", "m4.source"],
      onboarding: [],
      checkpoints: [
        { id: "start", description: "Вход в миссию" },
      ],
    },
  ],
}
```

### 1.2. `app/packages/content/data/prologue_bestiary.json5` (новый)

```json5
// Отдельный бестиарий пролога (изоляция по §13.10). Записи, которых нет в
// общем бестиарии. НЕ сливается с каноническими units/weapons на Этапе 1.
{
  units: [
    // Лесная крыса — учебная мишень М1 (проектные числа §6.2).
    {
      id: "forest_rat",
      classId: "forest_rat",
      side: "nav",
      maxHealth: 3,
      maxAP: 2,
      mobility: 6,
      aim: 50,
      defense: 0,
      will: 10,
      vision: 10,
      weapons: ["teeth"],
      skills: [],
      tags: [],
    },
    // Микула-мужик — стадия М1–М2, без оружия (подбирает дубину).
    {
      id: "mikula_peasant",
      classId: "mikula_peasant",
      side: "druzhina",
      maxHealth: 8,
      maxAP: 2,
      mobility: 5,
      aim: 60,
      defense: 0,
      will: 10,
      vision: 10,
      weapons: [],
      skills: [],
      tags: [],
    },
    // Федот-спасаемый — увяз в трясине; только умение эвакуации (по образцу
    // записи captive). После освобождения становится вторым управляемым.
    {
      id: "fedot_stranded",
      classId: "fedot_stranded",
      side: "druzhina",
      maxHealth: 5,
      maxAP: 2,
      mobility: 4,
      aim: 40,
      defense: 0,
      will: 5,
      vision: 8,
      weapons: [],
      skills: ["evacuate"],
      tags: [],
    },
    // Слизень — задел на М5 (в этой итерации ни одна миссия его не использует).
    {
      id: "slug",
      classId: "slug",
      side: "nav",
      maxHealth: 5,
      maxAP: 2,
      mobility: 1,
      aim: 90,
      defense: 0,
      will: 10,
      vision: 10,
      weapons: ["spit"],
      skills: [],
      tags: [],
    },
  ],
  weapons: [
    // Зубы крысы.
    {
      id: "teeth",
      category: "melee",
      apCost: 1,
      endsTurn: true,
      range: 1,
      requiresLOS: false,
      aimMod: 0,
      minDmg: 2,
      maxDmg: 3,
      crit: 10,
      critBonus: 1,
      envDmg: 0,
    },
    // Плевок слизня (задел на М5).
    {
      id: "spit",
      category: "ranged",
      apCost: 1,
      endsTurn: true,
      range: 8,
      requiresLOS: true,
      aimMod: 0,
      minDmg: 1,
      maxDmg: 2,
      crit: 0,
      critBonus: 0,
      envDmg: 0,
    },
    // Дубина для М1. РЕШЕНИЕ (открытый вопрос, раздел 8): введена отдельная
    // запись; альтернатива — маппинг на существующий «mace». Зафиксировано
    // этим комментарием.
    {
      id: "club",
      category: "melee",
      apCost: 1,
      endsTurn: true,
      range: 1,
      requiresLOS: false,
      aimMod: 0,
      minDmg: 3,
      maxDmg: 5,
      crit: 10,
      critBonus: 1,
      envDmg: 0,
    },
  ],
}
```

### 1.3. `app/packages/content/data/prologue_hints.json5` (новый)

```json5
// Каталог одноразовых подсказок пролога М1–М4. Текст — в i18n (ключи
// пролог.*). Поле `once` — показ один раз за прохождение. `panelKey` —
// элемент панели для подсветки (как в training.json5).
{
  hints: [
    { key: "m1.endTurn",     panelKey: "end_turn", textKey: "prologue.hint.m1.endTurn",     once: true },

    { key: "m2.noise",       panelKey: "defend",   textKey: "prologue.hint.m2.noise",       once: true },
    { key: "m2.stanceWorks",                       textKey: "prologue.hint.m2.stanceWorks", once: true },
    { key: "m2.wave",                             textKey: "prologue.hint.m2.wave",        once: true },
    { key: "m2.gear",                             textKey: "prologue.hint.m2.gear",        once: true },

    { key: "m3.blow",        panelKey: "skill",    textKey: "prologue.hint.m3.blow",        once: true },
    { key: "m3.pit",                              textKey: "prologue.hint.m3.pit",         once: true },
    { key: "m3.more",                             textKey: "prologue.hint.m3.more",        once: true },
    { key: "m3.shot",                             textKey: "prologue.hint.m3.shot",        once: true },

    { key: "m4.poison",                           textKey: "prologue.hint.m4.poison",      once: true },
    { key: "m4.join",                             textKey: "prologue.hint.m4.join",        once: true },
    { key: "m4.raise",                            textKey: "prologue.hint.m4.raise",       once: true },
    { key: "m4.source",                           textKey: "prologue.hint.m4.source",      once: true },
  ],
}
```

### 1.4. `app/packages/content/data/reinforcements.json5` (новый)

```json5
// Декларативная конфигурация сервиса подкреплений (норматив §12.1).
// `default` — пороговый режим для будущих М6–М8 (задел, проверен тестами).
// `profiles.m2_cry_wave` — волновое правило М2: +2 за убитую крысу,
// +1 за ход без убийств, потолок 8 одновременно живых.
{
  default: {
    enabled: true,
    mode: "threshold",
    thresholdEnemyCount: 5,
    delayTurns: 1,
    pool: ["upyr", "kikimora", "leshy"],
    countPerWave: 2,
    maxConcurrentEnemies: 8,
    spawnEdge: "north",
  },
  profiles: {
    m2_cry_wave: {
      enabled: true,
      mode: "onKill",
      delayTurns: 0,
      pool: ["forest_rat"],
      perKill: 2,
      perTurnNoKill: 1,
      maxConcurrentEnemies: 8,
    },
  },
}
```

---

## 2. Схемы — `app/packages/content/src/schemas.ts`

Добавить блок **в конец файла, перед экспортами типов** (после `trainingConfigSchema`). Все используемые базовые схемы (`id`, `mapGenConfigSchema`, `unitConfigSchema`, `weaponConfigSchema`) уже определены выше по файлу.

```typescript
/* ============================================================
   Пролог кампании (Этап 1, 0.20.31; норматив — doc/campaign.md)
   ============================================================ */

// Авторская фиксированная раскладка карты миссии пролога. Семантику
// символов разбирает компилятор раскладок Этапа 2; здесь проверяется
// только структура (строки + легенда).
export const prologueLayoutSchema = z.object({
  // Строки сетки сверху (y = 0) вниз; длина каждой строки = width.
  rows: z.array(z.string()).min(1),
  // Описание символов. Значения свободной формы на Этапе 1.
  legend: z.record(z.string(), z.unknown()).optional(),
}).strict();

// Карта миссии пролога = заготовка генератора + необязательная раскладка.
export const prologueMapSchema = mapGenConfigSchema.extend({
  layout: prologueLayoutSchema.optional(),
});

// Подсказка пролога (модель — тренировочные подсказки).
export const prologueHintSchema = z.object({
  // Идентификатор вида "m1.endTurn" (точка допустима, это не `id`).
  key: z.string().min(1),
  panelKey: z.string().optional(),
  textKey: z.string().min(1),
  once: z.boolean().default(true),
}).strict();

export const prologueHintsSchema = z.object({
  hints: z.array(prologueHintSchema).min(1),
}).strict();

// Действие сценария пролога. Обобщение тренировочного сценария:
// исполнитель может быть стороной игрока, есть канал forceOutcome.
export const prologueScriptActionSchema = z.object({
  unitId: id.optional(),
  side: z.enum(["player", "enemy"]).optional(),
  kind: z.enum(["attack", "skill", "approach", "defend", "overwatch", "resurrect", "endTurn", "spawn", "appear"]),
  targetUnitId: id.optional(),
  weaponId: id.optional(),
  skillId: id.optional(),
  corpseUnitId: id.optional(),
  // Скриптовый канал: гарантированный исход испытания попадания.
  forceOutcome: z.enum(["hit", "miss"]).optional(),
  at: z.object({ x: z.number().int(), y: z.number().int() }).strict().optional(),
  onlyIf: z.enum(["targetAlive", "targetNotPoisoned", "targetWounded", "corpseExists"]).optional(),
}).strict();

export const prologueScriptSchema = z.object({
  priority: z.array(prologueScriptActionSchema).optional(),
  actions: z.array(prologueScriptActionSchema).optional(),
}).strict();

// Цель миссии: текст и его смена по событию.
export const prologueObjectiveSchema = z.object({
  initialTextKey: z.string().min(1),
  retarget: z.array(z.object({
    onKey: z.string().min(1),
    textKey: z.string().min(1),
  }).strict()).optional(),
}).strict();

// Чекпоинт внутри миссии (откат вместо гибели, закон §1.5).
export const prologueCheckpointSchema = z.object({
  id: z.string().min(1),
  onKey: z.string().min(1).optional(),
  description: z.string().optional(),
}).strict();

// Миссия пролога.
export const prologueMissionConfigSchema = z.object({
  id,
  titleKey: z.string().min(1),
  introKey: z.string().min(1),
  outroKey: z.string().min(1),
  // null/отсутствие — последняя миссия цепочки.
  nextMissionId: id.nullable().optional(),
  playerSlots: z.array(id).min(1),
  fog: z.boolean().default(true),
  map: prologueMapSchema,
  enemies: z.array(z.object({ unitId: id, count: z.number().int().min(1) }).strict()).default([]),
  objective: prologueObjectiveSchema.optional(),
  script: prologueScriptSchema.optional(),
  // Ссылки на ключи подсказок из prologue_hints.json5 (порядок = порядок шагов).
  hints: z.array(z.string()).default([]),
  checkpoints: z.array(prologueCheckpointSchema).optional(),
  // Ссылка на профиль в reinforcements.json5 (или "default").
  reinforcements: z.string().optional(),
  // Одноразовые онбординг-подсказки (ключи в пролог.*).
  onboarding: z.array(z.string()).default([]),
}).strict();

// Корень prologue_missions.json5.
export const prologueConfigSchema = z.object({
  enabled: z.boolean().default(true),
  roster: z.array(id).min(1),
  prologueFinalMissionId: id,
  missions: z.array(prologueMissionConfigSchema).min(1),
}).strict();

// Бестиарий пролога: отдельные списки юнитов и оружия.
export const prologueBestiarySchema = z.object({
  units: z.array(unitConfigSchema).default([]),
  weapons: z.array(weaponConfigSchema).default([]),
}).strict();

// Сервис подкреплений (норматив §12.1 + режим «по убийству» для М2).
export const reinforcementsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(["threshold", "onKill"]).default("threshold"),
  thresholdEnemyCount: z.number().int().min(0).optional(),
  delayTurns: z.number().int().min(0).default(1),
  pool: z.array(id).min(1),
  countPerWave: z.number().int().min(1).optional(),
  maxConcurrentEnemies: z.number().int().min(1),
  spawnEdge: z.enum(["north", "south", "east", "west"]).optional(),
  spawnCells: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()).optional(),
  // Режим onKill (волновое правило М2).
  perKill: z.number().int().min(0).optional(),
  perTurnNoKill: z.number().int().min(0).optional(),
}).strict();

// Файл конфигурации подкреплений: дефолт + именованные профили.
export const reinforcementsFileSchema = z.object({
  default: reinforcementsConfigSchema,
  profiles: z.record(z.string(), reinforcementsConfigSchema).optional(),
}).strict();
```

И **дополнить блок экспортов типов** в конце `schemas.ts`:

```typescript
export type PrologueHintConfig = z.infer<typeof prologueHintSchema>;
export type PrologueHintsConfig = z.infer<typeof prologueHintsSchema>;
export type PrologueMissionConfig = z.infer<typeof prologueMissionConfigSchema>;
export type PrologueConfig = z.infer<typeof prologueConfigSchema>;
export type PrologueBestiaryConfig = z.infer<typeof prologueBestiarySchema>;
export type ReinforcementsConfig = z.infer<typeof reinforcementsConfigSchema>;
export type ReinforcementsFileConfig = z.infer<typeof reinforcementsFileSchema>;
```

---

## 3. Загрузка и кросс-ссылки — `app/packages/content/src/parse.ts`

### 3.1. Импорт новых схем

В блоке импорта из `./schemas.js` добавить:

```typescript
 import {
   campaignConfigSchema,
   itemConfigSchema,
   pvpConfigSchema,
   quickMatchConfigSchema,
   skillConfigSchema,
   trainingConfigSchema,
   unitConfigSchema,
   weaponConfigSchema,
   prologueConfigSchema,
   prologueBestiarySchema,
   prologueHintsSchema,
   reinforcementsFileSchema,
   type CampaignConfig,
   type ItemConfig,
   type PvpConfig,
   type QuickMatchConfig,
   type SkillConfig,
   type TrainingConfig,
   type UnitConfig,
   type WeaponConfig,
   type PrologueConfig,
   type PrologueBestiaryConfig,
   type PrologueHintsConfig,
   type ReinforcementsFileConfig,
 } from "./schemas.js";
```

### 3.2. Расширить `ContentBundle`

```typescript
 export interface ContentBundle {
   campaign: CampaignConfig;
   quickMatch: QuickMatchConfig;
   pvp: PvpConfig;
   training: TrainingConfig;
   units: UnitConfig[];
   weapons: WeaponConfig[];
   skills: SkillConfig[];
   items: ItemConfig[];
   // Пролог кампании (0.20.31). Бестиарий пролога — отдельное пространство
   // имён, не сливается с каноническими units/weapons (нулевая регрессия).
   prologue: PrologueConfig;
   prologueBestiary: PrologueBestiaryConfig;
   prologueHints: PrologueHintsConfig;
   reinforcements: ReinforcementsFileConfig;
 }
```

### 3.3. Чтение и парсинг новых файлов

После `const trainingRaw = byName("training.json5");` и соответствующих `if (!...) issues.push(...)` добавить:

```typescript
   const prologueRaw = byName("prologue_missions.json5");
   const bestiaryRaw = byName("prologue_bestiary.json5");
   const prologueHintsRaw = byName("prologue_hints.json5");
   const reinforcementsRaw = byName("reinforcements.json5");
   if (!prologueRaw) issues.push({ file: "prologue_missions.json5", message: "file is missing" });
   if (!bestiaryRaw) issues.push({ file: "prologue_bestiary.json5", message: "file is missing" });
   if (!prologueHintsRaw) issues.push({ file: "prologue_hints.json5", message: "file is missing" });
   if (!reinforcementsRaw) issues.push({ file: "reinforcements.json5", message: "file is missing" });
```

После `const training = trainingRaw ? parseFile(...) : {};` добавить:

```typescript
   const prologue = prologueRaw ? parseFile("prologue_missions.json5", prologueRaw, prologueConfigSchema) : {};
   const prologueBestiary = bestiaryRaw ? parseFile("prologue_bestiary.json5", bestiaryRaw, prologueBestiarySchema) : {};
   const prologueHints = prologueHintsRaw ? parseFile("prologue_hints.json5", prologueHintsRaw, prologueHintsSchema) : {};
   const reinforcements = reinforcementsRaw ? parseFile("reinforcements.json5", reinforcementsRaw, reinforcementsFileSchema) : {};
   if (prologue.issue) issues.push(prologue.issue);
   if (prologueBestiary.issue) issues.push(prologueBestiary.issue);
   if (prologueHints.issue) issues.push(prologueHints.issue);
   if (reinforcements.issue) issues.push(reinforcements.issue);
```

### 3.4. Уникальность бестиария пролога

После блоков `checkUnique` для канонических `units`/`weapons` добавить:

```typescript
   // Бестиарий пролога: уникальность внутри и отсутствие пересечений с
   // каноническими записями (изоляция пролога, §13.10).
   const prologueUnits = prologueBestiary.value?.units ?? [];
   const prologueWeapons = prologueBestiary.value?.weapons ?? [];
   const prologueUnitIds = checkUnique("prologue_bestiary units", prologueUnits);
   const prologueWeaponIds = checkUnique("prologue_bestiary weapons", prologueWeapons);
   for (const uid of prologueUnitIds) {
     if (unitIds.has(uid)) issues.push({ file: "prologue_bestiary.json5", message: `unit id overlaps canonical units: ${uid}` });
   }
   for (const wid of prologueWeaponIds) {
     if (weaponIds.has(wid)) issues.push({ file: "prologue_bestiary.json5", message: `weapon id overlaps canonical weapons: ${wid}` });
   }
```

### 3.5. Кросс-ссылки пролога

Добавить блок после проверки ссылок обучения (`if (training.value) { ... }`):

```typescript
   // Ссылки пролога: юниты/оружие берутся из объединения канонических и
   // прологовых записей; подсказки и профили подкреплений — из своих файлов.
   if (prologue.value) {
     const allUnitIds = new Set<string>([...unitIds, ...prologueUnitIds]);
     const allWeaponIds = new Set<string>([...weaponIds, ...prologueWeaponIds]);
     const hintKeys = new Set((prologueHints.value?.hints ?? []).map((h) => h.key));
     const reinforcementProfiles = new Set<string>([
       "default",
       ...Object.keys(reinforcements.value?.profiles ?? {}),
     ]);
     const missionIds = new Set(prologue.value.missions.map((m) => m.id));
     for (const roUnit of prologue.value.roster) {
       if (!allUnitIds.has(roUnit)) issues.push({ file: "prologue_missions.json5", message: `unknown roster unit: ${roUnit}` });
     }
     if (!missionIds.has(prologue.value.prologueFinalMissionId)) {
       issues.push({ file: "prologue_missions.json5", message: `prologueFinalMissionId refers to missing mission: ${prologue.value.prologueFinalMissionId}` });
     }
     for (const mission of prologue.value.missions) {
       if (mission.nextMissionId && !missionIds.has(mission.nextMissionId)) {
         issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown nextMissionId: ${mission.nextMissionId}` });
       }
       for (const slot of mission.playerSlots) {
         if (!allUnitIds.has(slot)) issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown player unit: ${slot}` });
       }
       for (const entry of mission.enemies) {
         if (!allUnitIds.has(entry.unitId)) issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown enemy unit: ${entry.unitId}` });
       }
       for (const hintKey of mission.hints) {
         if (!hintKeys.has(hintKey)) issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown hint key: ${hintKey}` });
       }
       if (mission.reinforcements && !reinforcementProfiles.has(mission.reinforcements)) {
         issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown reinforcements profile: ${mission.reinforcements}` });
       }
       for (const action of [...(mission.script?.priority ?? []), ...(mission.script?.actions ?? [])]) {
         if (action.unitId && !allUnitIds.has(action.unitId)) {
           issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown script unit: ${action.unitId}` });
         }
         if (action.weaponId && !allWeaponIds.has(action.weaponId)) {
           issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: unknown script weapon: ${action.weaponId}` });
         }
       }
       if (mission.map.layout) {
         const { rows } = mission.map.layout;
         if (rows.some((row) => row.length !== mission.map.width)) {
           issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: layout row length != width` });
         }
         if (rows.length !== mission.map.height) {
           issues.push({ file: "prologue_missions.json5", message: `mission ${mission.id}: layout rows count != height` });
         }
       }
     }
   }
```

### 3.6. Финальная проверка и возврат

Обновить итоговый `if` и возвращаемый объект:

```typescript
   if (
     issues.length > 0 ||
     !campaign.value || !quickMatch.value || !pvp.value || !training.value ||
     !prologue.value || !prologueBestiary.value || !prologueHints.value || !reinforcements.value
   ) {
     return { ok: false, issues };
   }
   return {
     ok: true,
     data: {
       campaign: campaign.value,
       quickMatch: quickMatch.value,
       pvp: pvp.value,
       training: training.value,
       units,
       weapons,
       skills,
       items,
       prologue: prologue.value,
       prologueBestiary: prologueBestiary.value,
       prologueHints: prologueHints.value,
       reinforcements: reinforcements.value,
     },
   };
```

> `app/packages/content/src/index.ts` менять не нужно: `export * from "./schemas.js"` уже подхватит новые схемы/типы, а обновлённый `ContentBundle` реэкспортируется из `parse.js`.

---

## 4. Состояние кампании — `app/packages/campaign/src/index.ts`

### 4.1. Типы

Добавить в `CampaignState` поле `chapter`:

```typescript
 export interface CampaignState {
   // ... существующие поля ...
   /** Фаза кампании: пролог (линейная цепочка) либо открытая карта (0.20.31). */
   chapter: "prologue" | "open";
   lastResult: { ... } | null;
 }
```

Добавить в `CampaignOptions`:

```typescript
 export interface CampaignOptions {
   // ... существующие поля ...
   /** Начальная фаза кампании (0.20.31). По умолчанию "open". */
   chapter?: "prologue" | "open";
 }
```

### 4.2. Инициализация состояния

В `freshState` добавить:

```typescript
   const freshState: CampaignState = {
     chapter: options.chapter ?? "open",
     darkness: 0,
     // ... остальное без изменений ...
   };
```

В ветке восстановления из `initialState` добавить нормализацию (миграция: отсутствие поля → `"open"`):

```typescript
   const state: CampaignState = options.initialState
     ? {
         ...options.initialState,
         chapter: options.initialState.chapter ?? "open",
         darknessMax: config.darknessMax,
         // ... остальное без изменений ...
       }
     : freshState;
```

### 4.3. Гейтинг экономики в `finishMission`

Заменить тело `finishMission` на версию с флагом `sandbox` (поведение при `chapter === "open"` идентично текущему; при `"prologue"` отключаются Тьма, награды, ранения, окончательная гибель, уровни, рекрут и проигрыш кампании):

```typescript
     finishMission: (id, outcome, participants, generalDeaths) => {
       if (state.phase !== "active" || state.activeMissionId !== id) return null;
       const point = findMission(id);
       const mission = missions.find((entry) => entry.id === id);
       if (!point || !mission) return null;
       // Пролог: экономика песочницы не применяется (раздел 4 норматива).
       const sandbox = state.chapter !== "prologue";
       const darknessGained = sandbox
         ? (outcome === "victory" ? mission.darknessOnVictory : mission.darknessOnDefeat)
         : 0;
       if (sandbox) {
         state.darkness = Math.min(state.darknessMax, state.darkness + darknessGained);
       }
       const rewards: Resources = (sandbox && outcome === "victory")
         ? { ...mission.rewards }
         : { ...ZERO_RESOURCES };
       if (sandbox && outcome === "victory") gain(rewards);
       const fallen: string[] = [];
       const wounded: string[] = [];
       const leveledUp: string[] = [];
       for (const participant of participants) {
         const fighter = state.fighters.find((candidate) => candidate.id === participant.fighterId);
         if (!fighter || !fighter.alive) continue;
         if (!participant.survived) {
           if (sandbox) {
             fighter.alive = false;
             fighter.hp = 0;
             fighter.equippedItemId = null;
             fallen.push(fighter.name);
           } else {
             // Пролог: откат к чекпоинту — боец не гибнет окончательно.
             fighter.hp = Math.max(1, participant.hp);
           }
           continue;
         }
         fighter.hp = Math.max(1, Math.min(fighter.maxHp, participant.hp));
         if (sandbox) {
           const woundedNow = fighter.hp <= fighter.maxHp * config.woundHpRatio;
           if (woundedNow && !fighter.wounded) wounded.push(fighter.name);
           fighter.wounded = fighter.wounded || woundedNow;
           if (outcome === "victory") {
             fighter.level += 1;
             leveledUp.push(fighter.name);
           }
         }
       }
       point.status = "done";
       state.activeMissionId = null;
       for (const generalId of generalDeaths ?? []) {
         if (!state.deadGenerals.includes(generalId)) state.deadGenerals.push(generalId);
       }
       state.shipPosition = { x: mission.x, y: mission.y };
       let newRecruit: string | null = null;
       if (sandbox && outcome === "victory" && livingCount() > 0 && state.fighters.length < config.rosterCap) {
         const recruit = makeFighter(config.recruitUnitId, 1);
         state.fighters.push(recruit);
         newRecruit = recruit.name;
       }
       const campaignLost = sandbox
         ? (state.darkness >= state.darknessMax || livingCount() === 0)
         : false;
       const lostReason = sandbox
         ? (state.darkness >= state.darknessMax
             ? "darkness"
             : livingCount() === 0
               ? "roster"
               : undefined)
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

## 5. Каркас маршрута пролога — `app/packages/session/src/index.ts`

Минимальные точечные добавления (фактический экран боя пролога появляется на Этапе 2; здесь — только состояние и API-каркас).

1. В интерфейс `SessionState` добавить поле:

```typescript
   /** Активная миссия пролога (каркас Этапа 1, 0.20.31). */
   prologueMissionId?: string | null;
```

2. В объект `idle` добавить:

```typescript
   prologueMissionId: null,
```

3. В интерфейс `SessionApi` добавить метод:

```typescript
   /** Каркас маршрута пролога (Этап 1): фиксирует намерение начать миссию
    *  пролога. Фактический экран и навигация — Этап 2. */
   startPrologue(missionId: string): boolean;
```

4. В возвращаемый объект `createSession` добавить реализацию (безопасно: при `enabled: false` и до подключения Этапа 2 никто этот путь не вызывает, поведение идентично 0.20.30):

```typescript
     startPrologue: (missionId) => {
       // Каркас (Этап 1, 0.20.31): фиксируем состояние пролога. Реальный
       // экран боя пролога и навигация добавляются на Этапе 2.
       emit({ ...state, prologueMissionId: missionId });
       return true;
     },
```

> **Сознательная граница Этапа 1:** `App.tsx` не меняется. Ветка «Новая былина → пролог» активируется на Этапе 2, когда появятся экраны пролога; сейчас это гарантирует критерий №3 (поведение идентично 0.20.30 и при `enabled: true`, и при `enabled: false`).

---

## 6. Локализация — `ru/ui.json` и `en/ui.json`

Добавить блок `"prologue"` верхнего уровня в **оба** словаря (паритет контролируется `parity.test.ts`). Ключи `prologue.hint.*` соответствуют `textKey` из `prologue_hints.json5`.

### 6.1. `app/packages/i18n/locales/ru/ui.json` — добавить:

```json
  "prologue": {
    "title": "Пролог",
    "next": {
      "toCry": "На крик",
      "toGlade": "К опушке",
      "toVillage": "К деревне",
      "onward": "Дальше"
    },
    "objective": {
      "gather": "Соберите хворост",
      "destroyAll": "Уничтожьте всех противников",
      "rescueFedot": "Найдите Федота и выведите его к свету",
      "clearGlade": "Очистите опушку",
      "clearStreet": "Очистите улицу"
    },
    "m1": {
      "title": "Хворост",
      "intro": "Околица Выселок. Вечер. Староста просил хворосту, пока светло. Руки пустые — хоть палку найду.",
      "outro": "Крыса была не одна. Из леса доносится крик — кто-то зовёт на помощь."
    },
    "m2": {
      "title": "Крик в чаще",
      "intro": "Ночь. Кто-то кричал в чаще — и крик оборвался.",
      "outro": "Федот спасён. Свет — на западе. Но лук он бросил в трясине."
    },
    "m3": {
      "title": "Тропа упырей",
      "intro": "Опушка за топью. Земля дырявая. Иду за луком. Ты не жди — костяк уже близко.",
      "outro": "Тракт завален костями. А дальше, за топями, чернело то место, откуда мертвяки шли."
    },
    "m4": {
      "title": "Выселки",
      "intro": "Выселки. Ставни закрыты, избы целы. Люди ушли к реке. Дыма мало.",
      "outro": "Это не голодные звери. Они шли со стороны могильника. Если не закрыть — Выселки не увидят утра."
    },
    "hint": {
      "m1": {
        "endTurn": "Сил на сегодня хватило. Закончи ход — пойдёшь снова."
      },
      "m2": {
        "noise": "Вы слышите подозрительный шум в кустах — стоит приготовиться.",
        "stanceWorks": "Стойка приняла удар.",
        "wave": "Их будет больше, чем палки. Свет — на западе.",
        "gear": "Лук я бросил в трясине, когда бежал. Отыщу — и вернусь."
      },
      "m3": {
        "blow": "Сильный удар отбросит. Провал за ним не прощает шага.",
        "pit": "В яму не ходят. В неё толкают.",
        "more": "Ещё.",
        "shot": "Нашёл. Больше в тину — ни ногой. Этот — мой."
      },
      "m4": {
        "poison": "Яд пьёт не в удар — в начало вашего хода.",
        "join": "Я здесь. Сниму порчу — кликни, если руки дойдут.",
        "raise": "Подняла костяка. На этот бой — один раз. Убейте снова.",
        "source": "Они шли со стороны могильника. Земля там вздулась ещё с прошлой осени. Если не закрыть — Выселки не увидят утра."
      }
    }
  },
```

### 6.2. `app/packages/i18n/locales/en/ui.json` — добавить (идентичная структура):

```json
  "prologue": {
    "title": "Prologue",
    "next": {
      "toCry": "To the cry",
      "toGlade": "To the glade",
      "toVillage": "To the village",
      "onward": "Onward"
    },
    "objective": {
      "gather": "Gather brushwood",
      "destroyAll": "Destroy all enemies",
      "rescueFedot": "Find Fedot and lead him to the light",
      "clearGlade": "Clear the glade",
      "clearStreet": "Clear the street"
    },
    "m1": {
      "title": "Brushwood",
      "intro": "The outskirts of Vyselki. Evening. The elder asked for brushwood while it is light. My hands are empty — at least I will find a stick.",
      "outro": "The rat was not alone. A cry comes from the forest — someone is calling for help."
    },
    "m2": {
      "title": "A Cry in the Thicket",
      "intro": "Night. Someone cried out in the thicket — and the cry broke off.",
      "outro": "Fedot is saved. The light is to the west. But he dropped his bow in the mire."
    },
    "m3": {
      "title": "The Path of the Upyrs",
      "intro": "The glade beyond the mire. The ground is full of holes. I am going for my bow. Do not wait — the skeletons are already close.",
      "outro": "The road is strewn with bones. And further, beyond the mires, darkened the place the dead came from."
    },
    "m4": {
      "title": "Vyselki",
      "intro": "Vyselki. The shutters are closed, the huts intact. The people left for the river. There is little smoke.",
      "outro": "These are not hungry beasts. They came from the barrow-field. If we do not stop it — Vyselki will not see the morning."
    },
    "hint": {
      "m1": {
        "endTurn": "You have had enough for today. End the turn — and you will go on again."
      },
      "m2": {
        "noise": "You hear a suspicious rustle in the bushes — you should get ready.",
        "stanceWorks": "The stance took the blow.",
        "wave": "There will be more of them than sticks. The light is to the west.",
        "gear": "I dropped my bow in the mire when I ran. I will find it — and come back."
      },
      "m3": {
        "blow": "A heavy blow knocks back. The pit beyond it forgives no step.",
        "pit": "You do not walk into a pit. You push into it.",
        "more": "More.",
        "shot": "Found it. No more stepping into the mire. This one is mine."
      },
      "m4": {
        "poison": "The poison drinks not in the blow — but at the start of your turn.",
        "join": "I am here. I will lift the blight — click, if your hands reach.",
        "raise": "She raised the skeleton. Once for this fight. Kill it again.",
        "source": "They came from the barrow-field. The earth there has been swelling since last autumn. If we do not stop it — Vyselki will not see the morning."
      }
    }
  },
```

---

## 7. Версии — `0.20.31`

Поднять патч-номер во **всех** источниках, проверяемых `check-version-consistency.mjs`:

- `app/package.json` → `"version": "0.20.31"`
- каждый `package.json` в `app/packages/*` и `app/apps/*` → `"version": "0.20.31"`
- `app/packages/session/src/index.ts` → `export const APP_VERSION = "0.20.31";`
- `app/packages/core/src/kernel.ts` → `export const CORE_VERSION = "0.20.31";`
- `app/packages/replay/src/index.ts` → `export const REPLAY_VERSION = "0.20.31";`

---

## 8. Тесты

### 8.1. `app/packages/content/tests/content.test.ts` — дополнить

Добавить новый `describe` (позитивные и негативные случаи по критерию №1):

```typescript
 describe("prologue content (0.20.31)", () => {
   it("parses the four prologue files and keeps bestiary isolated", () => {
     const result = parseContent(readDataTree());
     expect(result.ok).toBe(true);
     if (!result.ok) return;
     // Цепочка из четырёх миссий с нормативными идентификаторами.
     expect(result.data.prologue.missions.map((m) => m.id)).toEqual([
       "prologue_brushwood",
       "prologue_cry",
       "prologue_glade",
       "prologue_village",
     ]);
     expect(result.data.prologue.prologueFinalMissionId).toBe("prologue_village");
     // Туман: выключен в М1–М2, включён с М3.
     expect(result.data.prologue.missions.map((m) => m.fog)).toEqual([false, false, true, true]);
     // Биомы по карточкам §7.
     expect(result.data.prologue.missions.map((m) => m.map.biome)).toEqual([
       "meadow", "swamp", "thicket", "meadow",
     ]);
     // Бестиарий пролога — отдельное пространство имён.
     const prologueUnitIds = result.data.prologueBestiary.units.map((u) => u.id).sort();
     expect(prologueUnitIds).toEqual(["fedot_stranded", "forest_rat", "mikula_peasant", "slug"]);
     // Канонический список юнитов НЕ содержит записи пролога (изоляция).
     expect(result.data.units.some((u) => u.id === "forest_rat")).toBe(false);
     // Оружие пролога.
     expect(result.data.prologueBestiary.weapons.map((w) => w.id).sort()).toEqual(["club", "spit", "teeth"]);
     // Подсказки и подкрепления.
     const hintKeys = result.data.prologueHints.hints.map((h) => h.key);
     expect(hintKeys).toContain("m1.endTurn");
     expect(hintKeys).toContain("m4.source");
     expect(result.data.reinforcements.profiles?.m2_cry_wave?.mode).toBe("onKill");
   });

   it("rejects an unknown unit referenced by a prologue mission", () => {
     const files = readDataTree();
     const key = Object.keys(files).find((k) => k.endsWith("prologue_missions.json5"))!;
     files[key] = files[key]!.replace(
       'playerSlots: ["mikula_peasant"],',
       'playerSlots: ["unknown_hero"],',
     );
     const result = parseContent(files);
     expect(result.ok).toBe(false);
     expect(result.ok || result.issues.some((i) => i.message.includes("unknown player unit"))).toBe(true);
   });

   it("rejects a broken prologue mission record (strict schema)", () => {
     const files = readDataTree();
     const key = Object.keys(files).find((k) => k.endsWith("prologue_missions.json5"))!;
     // titleKey обязателен — удаление ломает строгую схему.
     files[key] = files[key]!.replace('titleKey: "prologue.m1.title",\n', "");
     expect(parseContent(files).ok).toBe(false);
   });

   it("rejects a hint key that is missing from the hints catalog", () => {
     const files = readDataTree();
     const key = Object.keys(files).find((k) => k.endsWith("prologue_missions.json5"))!;
     files[key] = files[key]!.replace('hints: ["m1.endTurn"],', 'hints: ["m1.ghost"],');
     const result = parseContent(files);
     expect(result.ok).toBe(false);
     expect(result.ok || result.issues.some((i) => i.message.includes("unknown hint key"))).toBe(true);
   });
 });
```

### 8.2. `app/packages/campaign/tests/campaign.test.ts` — дополнить

```typescript
 describe("createCampaign: chapter prologue (0.20.31)", () => {
   it("defaults chapter to open", () => {
     expect(campaign().getState().chapter).toBe("open");
   });

   it("disables darkness, rewards, wounds, permanent death and recruit in prologue", () => {
     const automaton = campaign(CONFIG, { chapter: "prologue" });
     expect(automaton.getState().chapter).toBe("prologue");
     const fighters = automaton.getState().fighters;
     automaton.startMission("clearing_1");
     const result = automaton.finishMission(
       "clearing_1",
       "victory",
       fighters.map((f) => ({ fighterId: f.id, survived: true, hp: 1 })),
     );
     expect(result).not.toBeNull();
     // Тьма не растёт, награды нет.
     expect(automaton.getState().darkness).toBe(0);
     expect(automaton.getState().resources).toEqual(CONFIG.startingResources);
     // Низкое здоровье не даёт ранения; уровни не растут.
     for (const f of automaton.getState().fighters) {
       expect(f.wounded).toBe(false);
       expect(f.level).toBe(CONFIG.classUnlockLevel);
     }
     // Рекрут не добавляется.
     expect(automaton.getState().fighters.length).toBe(fighters.length);
   });

   it("keeps a fallen fighter alive (retreat) in prologue", () => {
     const automaton = campaign(CONFIG, { chapter: "prologue" });
     const fighters = automaton.getState().fighters;
     automaton.startMission("clearing_1");
     automaton.finishMission("clearing_1", "defeat", [
       { fighterId: fighters[0]!.id, survived: false, hp: 0 },
       { fighterId: fighters[1]!.id, survived: true, hp: 6 },
       { fighterId: fighters[2]!.id, survived: true, hp: 7 },
     ]);
     // Боец не гибнет окончательно — откат к чекпоинту.
     expect(automaton.getState().fighters.find((f) => f.id === fighters[0]!.id)?.alive).toBe(true);
     expect(automaton.getState().phase).toBe("active");
   });

   it("migrates a saved state without chapter to open", () => {
     const base = campaign().getState();
     const { chapter: _omit, ...legacy } = base as { chapter?: unknown } & ReturnType<ReturnType<typeof campaign>["getState"]>;
     const restored = campaign(CONFIG, { initialState: legacy as never });
     expect(restored.getState().chapter).toBe("open");
   });
 });
```

> Примечание: точный способ «выбросить» поле `chapter` из снимка в последнем тесте можно упростить до `const legacy = { ...campaign().getState() } as Record<string, unknown>; delete legacy.chapter;` и передачи `legacy as never` — суть: состояние без поля `chapter` восстанавливается как `"open"`.

---

## 9. Проверка выполнения

Из каталога `app/`:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check:versions
```

---

## 10. Соответствие критериям готовности Этапа 1

| № | Критерий | Как обеспечен |
|---|---|---|
| 1 | `parseContent` валидирует 4 новых файла; `.strict()`-отказ работает | §3 (парсинг + кросс-ссылки), тесты §8.1 (позитив/негатив) |
| 2 | `chapter: "prologue"` отключает экономику; миграция без `chapter` → `"open"` | §4 (гейтинг + нормализация), тесты §8.2 |
| 3 | `enabled: false` идентично 0.20.30 | Пролог — отдельное пространство имён; `App.tsx` не меняется; `startPrologue` не вызывается до Этапа 2 |
| 4 | Новые i18n-ключи в ru и en | §6 (паритет структур) |
| 5 | Общие проверки (тесты, typecheck, build, check:versions, CI) | §9 |

## 11. Что сознательно отложено на Этап 2 (границы)

- Компилятор раскладок `layout` → решётка (семантика символов легенды).
- Триггерная система (`OnZoneEnter`, `OnPickup` и др.) и скриптовый исполнитель с `forceHit/forceMiss` и стороной игрока.
- Чекпоинт-откат, менеджер подсказок, режиссёр камеры, сервис подкреплений в рантайме, телеметрия.
- Экраны пролога и реальная маршрутизация «Новая былина → пролог» в `App.tsx`/`session`.

Эти системы описаны в `task.md` (Этап 2) и используют подготовленный Этапом 1 фундамент данных без его изменения.
# Схема конфигурации

Предмет ведения: структура файлов JSON5 и смысл полей. Не содержит алгоритмов расчёта и описания программных модулей.

Реализация: `app/packages/content/src/schemas.ts`, `parse.ts`. Данные: `app/packages/content/data/`. Алгоритмы — «Игровые правила». Память — «Модель исполнения».

Каждый файл проверяется строгой (`strict`) схемой Zod при загрузке. Файл, не прошедший проверку, к исполнению не допускается. Модификации вправе изменять значения полей, но не вправе добавлять поля, отсутствующие в настоящей схеме. После проверки отдельных файлов загрузчик проверяет уникальность идентификаторов, существование всех ссылок на юнитов, оружие и умения, соотношения минимумов и максимумов и межполевые ограничения. Нарушение любой из этих проверок отклоняет весь комплект.

Идентификаторы записей — строки из символов латиницы, цифр и знака подчёркивания.

---

## 1. Юнит (`units/*.json5`)

```typescript
interface UnitConfig {
  id: string;
  classId?: string;          // отсутствует у рекрута
  side: "druzhina" | "nav" | "pvp";
  maxHealth: number;         // целое, ≥ 1
  maxAP: number;             // целое, ≥ 1; обычное значение 2
  mobility: number;          // очки передвижения на одно очко действия, ≥ 1
  aim: number;               // может быть отрицательным
  defense: number;
  will: number;              // ≥ 0
  vision: number;            // базовая дальность обзора, ≥ 0
  weapons: string[];         // идентификаторы записей оружия; может быть пустым у иллюзии
  skills: string[];          // идентификаторы умений
  tags: UnitTag[];
  fleeHp?: number;           // при здоровье ≤ значения сущность покидает поле
  camouflageMinCover?: boolean;
  providesCamouflage?: boolean;
  decoy?: boolean;           // не наносит урон, является допустимой целью
  timedLife?: number;        // ходы существования; только для призывов
}

type UnitTag = "flying" | "hiddenStart";
```

Поля размера, ширины и высоты занимаемой области отсутствуют и не вводятся.

---

## 2. Оружие (`weapons/*.json5`)

```typescript
interface WeaponConfig {
  id: string;
  category: "melee" | "ranged";
  apCost: number;            // ≥ 1; для пищали 2
  endsTurn: boolean;         // по умолчанию true
  range: number;             // для ближнего боя не используется
  requiresLOS: boolean;      // по умолчанию true
  aimMod: number;
  minDmg: number;
  maxDmg: number;            // ≥ minDmg
  crit: number;              // 0…100
  critBonus: number;         // ≥ 0
  envDmg: number;            // 0 — среда не изменяется; ≥ 1 — одна ступень; при ударе через грань столько урона принимает среда
  ignoreHalfCover?: boolean;
  closeRangePenalty?: {      // вычет дальности
    distHLessThan: number;
    penalty: number;
  };
}
```

---

## 3. Умение (`skills/*.json5`)

```typescript
interface SkillConfig {
  id: string;
  apCost: number;
  endsTurn: boolean;
  range: number;             // 0 — только собственная клетка
  requiresLOS: boolean;
  category: "melee" | "ranged" | "self";
  resolution: "attack" | "will" | "auto";
  envDmg: number;
  ignoreHalfCover?: boolean;
  detectsHidden?: boolean;
  affectsEnvironment?: boolean;
  extract?: boolean;         // извлечение из зоны эвакуации (§6 «Игровой математики»)
  radius?: number;           // область; 0 или отсутствие — одна клетка
  willPower?: number;        // для resolution = "will"
  filter?: "enemies" | "allies" | "all" | "cover";
  affectsFlying?: boolean;   // обездвиживание действует и на летающих; по умолчанию полёт отменяет его (§15.4)
  cooldownTurns?: number;    // 1…5 собственных ходов; обязательно для непризывных умений
  maxUsesPerBattle?: number; // предел применений; для любого spawn обязан быть равен 1
  effects: SkillEffect[];    // минимум одно следствие; пустой список допустим только у умений с extract
}

type SkillEffect =
  | { type: "damage"; minDmg: number; maxDmg: number; crit?: number; critBonus?: number }
  | { type: "heal"; amount: number }
  | { type: "applyStatus"; status: StatusId; duration: number; magnitude?: number }
  | { type: "removeStatus"; status: StatusId }
  | { type: "knockback" }
  | { type: "destroyCover" }
  | { type: "spawn"; unitId: string; spawnKind?: "summon" | "illusion" | "resurrection" }
  | { type: "displace" }     // телепортация союзника в targetPos
  | { type: "flee" }
  | { type: "reveal" };

Признак `extract` делает умение действием эвакуации: оно допустимо только в клетке поля с признаком зоны эвакуации и удаляет юнита с поля (событие `ENTITY_REMOVED` с причиной `EXTRACTED`). Поле `spawnKind` эффекта `spawn` задаёт причину появления явно: `summon` — призыв, `illusion` — иллюзия, `resurrection` — воскрешение (тело погибшего юнита указанной записи в целевой клетке, запас здоровья 1). При отсутствии `spawnKind` применяется прежняя эвристика (иллюзия по записи, воскрешение по имени умения) для совместимости с существующими записями.

type StatusId = "poison" | "panic" | "immobile" | "hidden" | "flying" | "timed";
```

---

## 4. Кампания (`campaign.json5`)

```typescript
interface CampaignConfig {
  rosterCap: number;             // предельная численность дружины, ≥ 5
  deployMin: number;             // обычно 1
  deployMax: number;             // обычно 5
  classUnlockLevel: number;
  woundHpRatio: number;          // (0, 1]; рекомендуемое значение 0.3
  darknessMax: number;
  needleMissionId: string;
  recruitUnitId: string;         // запись юнита-рекрута без класса
  initialRoster: string[];       // стартовый состав дружины (записи классов)
  woundPenalty: {                // штрафы ранения до лечения в Горнице
    aim: number;
    defense: number;
    mobility: number;
  };
  startingResources: Resources;  // начальные запасы корабля
  scan: {                        // правила открытия участков карты
    radius: number;              // радиус сканирования (единицы карты, 1…100)
    cost: Resources;             // стоимость одного сканирования
  };
  missions: MissionConfig[];     // перечень точек, ≥ 1
}

interface Resources {
  gold: number;                  // ≥ 0
  herbs: number;                 // ≥ 0
  artifacts: number;             // ≥ 0
}

interface MissionConfig {
  id: string;
  type: "purge" | "destroy" | "rescue" | "recon" | "needle";
  darknessOnVictory: number;
  darknessOnDefeat: number;
  x: number;                     // положение точки на карте царства, 0…100
  y: number;                     // положение точки на карте царства, 0…100
  rewards: Resources;            // награда при успехе
  map: MapGenConfig;
  enemies: { unitId: string; count: number }[];
  generals?: string[];
  objectiveUnitId?: string;      // цель уничтожения (запись идола/строения); обязателен для type "destroy" (0.13.0)
  escorteeUnitId?: string;       // спасаемое лицо (запись сопровождаемого); обязательно для type "rescue" (0.13.0)
}

Цель миссии задаётся сценарием (game-design §3.2). Для `destroy` поле `objectiveUnitId` ссылается на запись идола/строения: победа наступает при его уничтожении, противники могут остаться. Для `rescue` поле `escorteeUnitId` ссылается на сопровождаемого с умением извлечения: победа — эвакуация лица из зоны, поражение — его гибель либо гибель всей высадки. Для `recon` победа — эвакуация хотя бы одного бойца высадки (сценарий добавляет бойцам умение извлечения); поражение — гибель всей высадки. Миссии `rescue` и `recon` требуют `map.extract: true`.

Точки открываются сканированием: первая доступна сразу; после завершения миссии корабль перелетает к её точке, и игрок может сканировать окрестность, открывая все точки в радиусе `scan.radius` за стоимость `scan.cost`. Стоимость списывается только если сканирование открыло хотя бы одну точку; сканирование, не открывшее точек (все закрытые точки вне радиуса), запасы не расходует. Расположение точек отвечает онбордингу (0.20.0): каждая следующая точка достижима из какой-либо предыдущей, а из стартовой точки открываются только первые по порядку введения механик — перескочить цепочку со старта нельзя. После завершения миссии счётчик Тьмы увеличивается на `darknessOnVictory` при успехе либо на `darknessOnDefeat` при поражении; при достижении `darknessMax` кампания проиграна. Награда `rewards` зачисляется в запасы корабля при успехе. Суммарная численность `enemies` миссии не должна превышать вместимость клеток появления карты (`2 × (height − 2)`).

Дружина (выпуск 0.11.0): стартовый состав задаёт `initialRoster`; новые бойцы вступают как рекруты (`recruitUnitId`) после успешной миссии, пока численность меньше `rosterCap`. Высадка включает от `deployMin` до `deployMax` живых бойцов. Погибший в миссии боец исключается окончательно; выживший, завершивший миссию с запасом здоровья не выше `woundHpRatio × maxHealth`, получает ранение со штрафами `woundPenalty` до лечения в Горнице. Выжившие при успехе получают уровень; рекрут, достигший `classUnlockLevel`, получает класс по выбору игрока. Кампания проиграна также, если в дружине не осталось живых бойцов.

interface MapGenConfig {
  width: number;             // 8…64
  height: number;
  pitChance: number;         // 0…1
  coverDensity: number;       // 0…1, доля клеток с укрытиями
  wallDensity: number;        // 0…1, доля клеток с глухими стенами
  edgeCoverChance: number;    // 0…1, доля граневых среди создаваемых укрытий
  halfCoverChance: number;    // 0…1, доля неполных среди создаваемых укрытий
  heightMix: { z0: number; z1: number; z2: number }; // доли, сумма 1
  extract?: boolean;          // карта содержит зону эвакуации у края поля (миссии спасения и разведки)
  minCovers?: number;         // минимальное число целоклеточных укрытий (0.20.1): генератор доводит
                              // количество укрытий до этого значения — гарантия для обучающих карт
  biome?: "meadow" | "swamp" | "thicket" | "scorched";
                              // биом (0.21.0): исключительно визуальная надстройка — палитра
                              // поверхности и откосов по ярусам, стиль укрытий (брёвна /
                              // каменные глыбы / кусты) и набор редкого декора (~3% клеток).
                              // Правила ядра поле не читают; без поля (старые файлы) — луг
}
```

Генератор обязан соблюдать ограничение связности, изложенное в документе «Игровые правила», раздел 5.3.

---

## 4.1. Предметы Кузни (`items/*.json5`)

```typescript
interface ItemConfig {
  id: string;
  weaponId?: string;             // оружие из записей `weapons`: добавляется бойцу
  aimMod?: number;               // модификаторы характеристик в сражении
  defenseMod?: number;
  mobilityMod?: number;
  maxHpMod?: number;
  cost: Resources;               // стоимость изготовления в Кузне
}
```

Каждый предмет изготовляется один раз за кампанию и хранится в запасах корабля. Предмет надевается на бойца при формировании высадки (один предмет на бойца, один владелец) и влияет на следующее сражение: оружие добавляется к набору оружия бойца, модификаторы складываются с характеристиками (в том числе со штрафами ранения). Предмет обязан давать оружие либо хотя бы один модификатор; стоимость обязана быть положительной. `weaponId` проверяется по записям `weapons`.

## 5. Быстрый матч (`quick-match.json5`)

```typescript
interface QuickMatchConfig {
  playerSlots: [string, string, string]; // ближний, дистанционный, поддержка
  enemyPool: [string, string, string];   // три рядовых типа
  difficulties: {
    id: "easy" | "normal" | "hard";
    enemyCount: number;                  // ≥ 1; единственный параметр трудности
  }[];
  map: MapGenConfig;                     // заготовка поля режима
}
```

Состав противников набирается из `enemyPool` случайно до указанной численности; повторы типа допускаются. Поле строится по `map`.

## 6. Состязательный набор (`pvp.json5`)

```typescript
interface PvpConfig {
  pool: string[];            // идентификаторы UnitConfig, включая отдельные записи противников
  nMin: number;
  objective: "elimination" | "apple" | "choice";
  map?: MapGenConfig;        // заготовка поля режима (поочерёдная игра, 0.14.0)
}
```

Набор состязательного режима формируется из `pool`; при поочерёдной игре обе стороны получают одинаковый готовый набор записей, поле строится по `map` (при отсутствии — по заготовке быстрого матча).

---

## 7. Тексты

Строки, видимые человеку, в файлы настоящего документа не помещаются. Соответствие идентификатора тексту хранится в словарях модуля локализации (документ «Локализация»). Конфигурация ссылается только на идентификаторы.

---

## 8. Обучение (`training.json5`)

Конфигурация режима обучения (версия 0.19.0, план разработки, подэтап 5.2; уточнения 0.19.1, строгий сценарий 0.20.13). Приведённая ниже форма — нормативное описание поля.

```typescript
interface TrainingConfig {
  // Ровно три миссии обучения (базовый дизайн, раздел 3.5).
  missions: TrainingMission[];
}

interface TrainingMission {
  id: "movement" | "combat" | "skills"; // порядок введения механик
  titleKey: string;                     // ключ локализации названия
  descriptionKey: string;               // ключ локализации описания
  map: MapGenConfig;                    // карта миссии
  playerSlots: string[];                // записи бойцов игрока (из units)
  enemies: { unitId: string; count: number }[];
  hints: TrainingHint[];                // обучающие шаги
  enemyScript?: TrainingEnemyScript;    // строгий сценарий Нави (0.20.13)
}

interface TrainingHint {
  step: number;                         // порядок шага: уникальная последовательность 1..N (проверяется схемой)
  textKey: string;                      // текст плашки
  // Что подсветить (ровно один элемент):
  highlight: "cell" | "entity" | "panel" | "button" | "zone";
  cell?: { x: number; y: number };      // для cell/zone — целевая клетка; при отсутствии
                                        // интерфейс подсвечивает клетку, вычисленную
                                        // указанием шага (дальняя/смежная с целью)
  targetUnitId?: string;                // для entity — подсвечиваемая сущность
  panelKey?: string;                    // элемент интерфейса:
                                        // "ap" | "weapon" | "skill" | "defend" | "overwatch" | "end_turn"
  // Условие завершения шага:
  until: "move" | "dash" | "attack" | "skill" | "defend" | "overwatch" | "end_turn" | "approach" | "noop";
  // Строгий сценарий (0.20.13): шаг предписывает ровно одно действие.
  actorUnitId?: string;                 // единственный исполнитель шага (из units);
                                        // отсутствие при until "attack" — финальный шаг,
                                        // ведущий политикой указаний до победы
  weaponId?: string;                    // шаг «атака»: только этим оружием
  skillId?: string;                     // шаг «умение»: только это умение
  repeatUntil?: "targetDead" | "victory"; // шаг не завершается единичным событием:
                                          // «пока цель не падёт» (нужен targetUnitId)
                                          // либо «до победы» (только финальный шаг)
}

interface TrainingNotes {
  poison: string;      // плашка «боец отравлен» (0.20.1)
  resurrect: string;   // плашка «кикимора подняла костяка»
  summon: string;      // плашка «призван лесной зверь»
}

// Строгий сценарий Нави (0.20.13). Структурно совместим с типом
// TrainingEnemyAction ядра (@bylina/core) — передаётся исполнителю
// сценария без преобразования.
interface TrainingEnemyScript {
  priority: TrainingEnemyAction[];  // постоянные правила: проверяются в порядке
                                    // списка перед каждой командой Нави
  actions: TrainingEnemyAction[];   // линейная очередь; endTurn завершает ход
}

interface TrainingEnemyAction {
  unitId?: string;   // исполнитель (обязателен, кроме endTurn)
  kind: "attack" | "skill" | "approach" | "defend" | "overwatch" | "resurrect" | "endTurn";
  targetUnitId?: string;  // цель атаки/умения/сближения
  weaponId?: string;      // оружие атаки (по умолчанию основное)
  skillId?: string;       // умение для skill/resurrect
  corpseUnitId?: string;  // запись погибшего для resurrect
  onlyIf?: "targetAlive" | "targetNotPoisoned" | "targetWounded" | "corpseExists"; // условие применимости
}
```

`until: "dash"` завершается перемещением за два очка действия (событие перемещения с признаком рывка). Необязательное поле `notes` миссии задаёт ключи реактивных плашек, показываемых событиями любой стороны в миссии «Умения и состояния» (0.20.1); сценарий Нави делает эти события детерминированными.

Ограничения: миссии обучения используют обычные записи `units`, `weapons`, `skills` и `map`; подсказки не меняют правила — они только указывают игроку на допустимые действия (ядро отклоняет недопустимые команды как обычно). Интерфейс выполняет подсказки в порядке поля `step` (порядок массива значения не имеет), а завершает шаг только действием игрока — события хода противника подсказки не продвигают. Со строгим сценарием (0.20.13) каждый шаг предписывает ровно одно действие (`actorUnitId`, `weaponId`, `skillId`, `targetUnitId`, вычисленная клетка), иные команды игрока интерфейс отклоняет с пояснением; ходы Нави исполняет сценарий `enemyScript` (постоянные правила → очередь → обычный алгоритм как предохранитель); окружение миссий фиксировано постоянными семенами сессии, поэтому партия воспроизводима. Миссия с непустым `enemies` играется до победы (уничтожение всех противников; финальный шаг `repeatUntil: "victory"`), миссия без противника завершается последним шагом подсказки. Прогресс обучения хранится в хранилище приложения, не в конфигурации.

---

## 9. Постоянные данные приложения

Конфигурация JSON5 не является сохранением игрока. Сохранение кампании содержит `formatVersion: 2`, версию приложения, состояние кампании, состояние экрана, необязательный снимок боя и туман войны. При чтении модуль `storage` мигрирует поддерживаемые старые форматы; неизвестные будущие форматы отклоняются. Повторы не относятся к конфигурации и хранятся отдельным списком не более **20** записей.

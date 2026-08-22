# Схема конфигурации
## «Былина: Тьма Кощея», версия 1.4

Предмет ведения: структура файлов JSON5 и смысл полей. Алгоритмы, использующие эти поля, изложены в документе «Игровая математика». Исполнительное представление в памяти — в документе «Схема исполнительной среды».

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
  capturable?: boolean;      // допускает захват (рядовые и элитные); генералы — нет
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
  tier?: 1 | 2 | 3;          // ярус оружия; отсутствие означает ярус I
  slots?: number;            // слоты под вставки, 0…3; растут с ярусом
}
```

Число слотов `slots` задаёт вместимость вставок (раздел 6.5 документа о прогрессии); отсутствие поля означает 0. Вставка ярусом выше яруса оружия недопустима.

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
  extract?: boolean;         // извлечение из зоны эвакуации
  radius?: number;           // область; 0 или отсутствие — одна клетка
  willPower?: number;        // для resolution = "will"
  filter?: "enemies" | "allies" | "all" | "cover";
  affectsFlying?: boolean;   // обездвиживание действует и на летающих; по умолчанию полёт отменяет его (§15.4)
  cooldownTurns?: number;    // 1…5 собственных ходов; обязательно для непризывных умений
  maxUsesPerBattle?: number; // предел применений; для любого spawn обязан быть равен 1
  effects: SkillEffect[];
}

type SkillEffect =
  | { type: "damage"; minDmg: number; maxDmg: number; crit?: number; critBonus?: number }
  | { type: "heal"; amount: number }
  | { type: "applyStatus"; status: StatusId; duration: number; magnitude?: number }
  | { type: "removeStatus"; status: StatusId }
  | { type: "knockback" }
  | { type: "destroyCover" }
  | { type: "spawn"; unitId: string }
  | { type: "displace" }     // телепортация союзника в targetPos
  | { type: "flee" }
  | { type: "reveal" }
  | { type: "capture" };     // пленение ослабленного захватываемого противника

type StatusId = "poison" | "panic" | "immobile" | "hidden" | "flying" | "timed";
```

Умение с эффектом `capture` разрешается способом «проверка воли» и допустимо только по живой сущности стороны Нави, у записи которой установлен `capturable`, при текущем здоровье не выше порога захвата (поле `captureHpRatio` кампании). Правила пленения и учёта типа в исходе миссии — документ «Постоянная прогрессия и развитие», раздел 7.

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
  xpCurve: number[];             // накопительные пороги опыта уровней 2…6, например [60, 180, 360, 620, 960]
  xpAwards: {                    // величины источников опыта (раздел 4 документа о прогрессии)
    participation: number;
    victory: number;
    attackAttempt: number;
    skillUse: number;
    hit: number;
    damagePer2: number;
    kill: number;
    damageTaken: number;
    dodge: number;
    scoutingPerCell: number;
    objective: number;
    capture: number;
    overwatch: number;
    scoutingCap: number;         // потолок опыта за разведку на бойца за миссию
    damageTakenCap: number;      // потолок опыта за полученный урон на бойца за миссию
  };
  captureHpRatio: number;        // (0, 1]; порог здоровья для захвата, рекомендуемое значение 0.25
  research: {                    // правила исследования пленников
    descriptionCost: Resources;  // стоимость ступени «Описание»
    weaknessCost: Resources;     // стоимость ступени слабого места
    durationMissions: number;    // миссий на ступень без ускорения Темницы
  };
  morale: {                      // дух как расходуемый ресурс (раздел 3.9)
    max: number;                 // 0…100, рекомендуемое значение 100
    tiredRatio: number;          // порог «устал», доля (например 0.66)
    shakenRatio: number;         // порог «надломлен», доля (например 0.33)
    recoveryPerMission: number;  // восстановление за пропущенную миссию, 0…100
    tiredAimPenalty: number;     // штраф меткости усталого бойца
    tiredDefensePenalty: number; // штраф защиты усталого бойца
    tiredXpMultiplier: number;   // множитель опыта усталого бойца, (0, 1]
    loss: {                      // источники потери духа за миссию
      perWound: number;
      perSquadmateFallen: number;
      perUndescribedSighting: number;
      perGeneral: number;
    };
    traitChance: number;         // вероятность «дурного следа» у надломленного, 0…1
  };
  negativeTraits: string[];      // перечень «дурных следов» (записи traits/*.json5)
  training: {                    // учение бойца вне боя
    cost: Resources;             // стоимость отправки в учение
    missions: number;            // миссий, которые боец пропускает
    xpGain: number;              // запас опыта по завершении
  };
  bond: {                        // побратимство (раздел 3.10)
    deployThreshold: number;     // совместных высадок до установления связи (уровень 1)
    compatibilityMin: number;    // множитель порога для наименее совместимой пары
    compatibilityMax: number;    // множитель порога для наиболее совместимой пары
    level2Threshold: number;     // совместных высадок до уровня 2
    level3Threshold: number;     // совместных высадок до уровня 3
    teamworkCharges: number[];   // заряды «Подмоги» по уровням, например [1, 2, 2]
    spotterAimBonus: number;     // «Прикрытие»: бонус меткости при смежных побратимах
    spotterCritBonus: number;    // «Прикрытие»: бонус крита при смежных побратимах
    returnFireChance: number;    // «Ответная стрела»: шанс, 0…1
    griefMoraleLoss: number;     // потеря духа при гибели побратима
    griefWillPenalty: number;    // штраф воли на следующую миссию
  };
  darkEvents: DarkEventConfig[]; // «Козни Кощея» (раздел 8.6)
  ship: ShipModuleConfig[];      // модули Летучего Корабля
  missions: MissionConfig[];     // перечень точек, ≥ 1
}

interface DarkEventConfig {
  id: string;
  triggerMissions: number;       // миссий до срабатывания
  counterable: boolean;          // может быть сорвана встречной миссией типа «counter»
  effects: DarkEventEffect[];
}

type DarkEventEffect =
  | { type: "woundWorse"; factor: number }                 // тяжелее ранения
  | { type: "enemyWillBonus"; amount: number }             // +воля противникам
  | { type: "darknessGainBonus"; amount: number }          // +прирост Тьмы
  | { type: "enemyHpBonus"; amount: number }               // +здоровье противникам
  | { type: "extraEnemies"; count: number }                // дополнительные противники
  | { type: "moraleRecoveryPenalty"; amount: number };     // замедленное восстановление духа

interface Resources {
  gold: number;                  // ≥ 0
  herbs: number;                 // ≥ 0
  artifacts: number;             // ≥ 0
}

interface MissionConfig {
  id: string;
  type: "purge" | "destroy" | "rescue" | "recon" | "counter" | "needle";
  darknessOnVictory: number;
  darknessOnDefeat: number;
  x: number;                     // положение точки на карте царства, 0…100
  y: number;                     // положение точки на карте царства, 0…100
  threat: number;                // показатель угрозы («Сила Нави»), 0…10; авторы выстраивают состав по нарастающей
  countersDarkEventId?: string;  // для типа «counter»: кознь, которую срывает успех миссии
  rewards: Resources;            // награда при успехе
  map: MapGenConfig;
  enemies: { unitId: string; count: number }[];
  generals?: string[];
}

Точки открываются сканированием: первая доступна сразу; после завершения миссии корабль перелетает к её точке, и игрок может сканировать окрестность, открывая все точки в радиусе `scan.radius` за стоимость `scan.cost`. После завершения миссии счётчик Тьмы увеличивается на `darknessOnVictory` при успехе либо на `darknessOnDefeat` при поражении; при достижении `darknessMax` кампания проиграна. Награда `rewards` зачисляется в запасы корабля при успехе. Суммарная численность `enemies` миссии не должна превышать вместимость клеток появления карты (`2 × (height − 2)`).

Дружина (выпуск 0.11.0): стартовый состав задаёт `initialRoster`; новые бойцы вступают как рекруты (`recruitUnitId`) после успешной миссии, пока численность меньше `rosterCap`. Высадка включает от `deployMin` до `deployMax` живых бойцов. Погибший в миссии боец исключается окончательно; выживший, завершивший миссию с запасом здоровья не выше `woundHpRatio × maxHealth`, получает ранение со штрафами `woundPenalty` до лечения в Горнице. Кампания проиграна также, если в дружине не осталось живых бойцов.

Бойцы растут опытом, а не «уровнем за победу»: источники опыта и их величины задаёт `xpAwards`, пороги — `xpCurve`. Достигнув порога, боец повышает уровень (возможно, на несколько сразу). Рекрут, достигший `classUnlockLevel`, получает класс по выбору игрока; на последующих уровнях выбирает таланты специализации из записей `perks`. Правила начисления и выбора — документ «Постоянная прогрессия и развитие», разделы 3 и 4.

interface MapGenConfig {
  width: number;             // 8…64
  height: number;
  pitChance: number;         // 0…1
  coverDensity: number;       // 0…1, доля клеток с укрытиями
  wallDensity: number;        // 0…1, доля клеток с глухими стенами
  edgeCoverChance: number;    // 0…1, доля граневых среди создаваемых укрытий
  halfCoverChance: number;    // 0…1, доля неполных среди создаваемых укрытий
  heightMix: { z0: number; z1: number; z2: number }; // доли, сумма 1
}
```

Генератор обязан соблюдать ограничение связности, изложенное в документе «Игровая математика», раздел 5.3.

---

## 4.1. Предметы Кузни (`items/*.json5`)

```typescript
interface ItemConfig {
  id: string;
  weaponId?: string;             // оружие из записей `weapons`: добавляется бойцу
  skillId?: string;              // умение из записей `skills`: добавляется бойцу (например, «Захват»)
  aimMod?: number;               // модификаторы характеристик в сражении
  defenseMod?: number;
  mobilityMod?: number;
  maxHpMod?: number;
  willMod?: number;              // модификатор воли
  bonusVsUnitId?: string;        // антитиповый предмет: бонусы действуют только против этого типа противника
  tier?: 1 | 2 | 3;              // ярус предмета; изготовление требует соответствующего уровня Кузни
  cost: Resources;               // стоимость изготовления в Кузне
}
```

Предмет с полем `bonusVsUnitId` — антитиповый: его модификаторы применяются в бою только против целей указанного типа. Рецепт такого предмета открывается ступенью «Описание» соответствующего исследования (документ «Постоянная прогрессия и развитие», раздел 7.3.1).

Каждый предмет изготовляется один раз за кампанию и хранится в запасах корабля. Изготовление предмета яруса выше текущего уровня Кузни недопустимо. Предмет надевается на бойца при формировании высадки (один предмет на бойца, один владелец) и влияет на следующее сражение: оружие добавляется к набору оружия бойца, умение (`skillId`) — к набору умений, модификаторы складываются с характеристиками (в том числе со штрафами ранения). Предмет обязан давать оружие, умение либо хотя бы один модификатор; стоимость обязана быть положительной. `weaponId` проверяется по записям `weapons`, `skillId` — по записям `skills`.

## 4.1. Вставки оружия (`attachments/*.json5`)

```typescript
interface AttachmentConfig {
  id: string;
  tier: 1 | 2 | 3;               // ярус вставки; не выше яруса оружия
  aimMod?: number;               // прицел
  rangeMod?: number;             // дальний прицел: +к дальности дистанционного оружия
  dmgMod?: number;               // ладный заряд: +к минимальному и максимальному урону
  freeActionChance?: number;     // стремительный спуск: шанс 0…1 не завершать активацию
  critMod?: number;              // золотая насечка
  moveAimMod?: number;           // тяжёлый приклад: +меткости после перемещения в этот ход
  bonusVsUnitId?: string;        // антитиповая вставка
  cost: Resources;
}
```

Вставка даёт хотя бы один эффект; `bonusVsUnitId` ограничивает эффекты указанным типом противника. Вставка вкладывается в слот оружия (один слот — одна вставка), вставляется и извлекается в Кузне.

## 4.1.1. Дурные следы (`traits/*.json5`)

```typescript
interface TraitConfig {
  id: string;
  // Отрицательная черта, накладываемая на надломленного бойца (раздел 3.9).
  // Снимается лечением в Горнице либо безупречной миссией.
  aimMod?: number;               // штраф меткости
  defenseMod?: number;           // штраф защиты
  willMod?: number;              // штраф воли
  panicChanceMod?: number;       // +к шансу паники, 0…100
  vsUnitId?: string;             // ограничивает штрафы указанным типом (например, страх перед упырями)
}
```

## 4.2. Таланты (`perks/*.json5`)

```typescript
interface PerkConfig {
  id: string;
  classId: string;            // класс, которому принадлежит талант
  branch: "A" | "B";          // ветка специализации
  rank: 1 | 2 | 3 | 4;        // шаг ветки; открывается на уровне 3 + rank − 1
  effects: PerkEffect[];
}

type PerkEffect =
  | { type: "stat"; aim?: number; defense?: number; mobility?: number; maxHp?: number; will?: number; vision?: number }
  | { type: "weapon"; weaponId: string }                                   // добавить оружие бойцу
  | { type: "skill"; skillId: string }                                     // добавить умение бойцу
  | { type: "damageBonus"; scope: "melee" | "ranged" | "all"; amount: number }
  | { type: "critBonus"; scope: "melee" | "ranged" | "all"; amount: number }
  | { type: "envDmgBonus"; amount: number }
  | { type: "incomingDamageReduction"; amount: number }
  | { type: "stancePenaltyBonus"; amount: number };                        // дополнительный вычет защитной стойки
```

Правила выбора талантов и шаги веток — документ «Постоянная прогрессия и развитие», раздел 3. Проверки при загрузке: уникальность `id`; ссылки `weaponId` и `skillId` существуют; каждый талант даёт хотя бы один эффект; у каждого класса две ветки с четырьмя шагами; венец (`rank: 4`) может быть выбран только при не менее чем двух ранее взятых талантах этой же ветки.

## 4.3. Модули корабля (`ship/*.json5`)

```typescript
interface ShipModuleConfig {
  id: "bridge" | "forge" | "infirmary" | "dungeon";
  levels: ShipModuleLevel[];
}

interface ShipModuleLevel {
  level: 1 | 2 | 3;
  cost: Resources;
  requiredMissions: number;          // число завершённых миссий для открытия уровня
  effects: ShipModuleEffect[];
}

type ShipModuleEffect =
  | { type: "scanRadius"; radius: number }
  | { type: "scanCost"; cost: Resources }
  | { type: "unlockItemTier"; tier: 1 | 2 | 3 }
  | { type: "woundPenaltyScale"; factor: number }      // множитель штрафа ранения
  | { type: "woundThreshold"; ratio: number }          // порог ранения
  | { type: "researchSlots"; count: number }
  | { type: "prisonCapacity"; count: number }
  | { type: "researchDuration"; missions: number }     // миссий на ступень исследования
  | { type: "revealEnemyComposition"; enabled: boolean }
  | { type: "deployCapIncrease"; amount: number }      // рост предельной численности высадки
  | { type: "fatigueReduction"; percent: number };     // снижение штрафа усталости, 0…100
```

Целевые значения уровней и эффекты — документ «Постоянная прогрессия и развитие», раздел 5.

## 4.4. Состояние исследования

Исследование противников хранится в состоянии кампании, а не в файле конфигурации. По каждому типу противника хранится достигнутая ступень знания (0…4) и выбранный игроком порядок слабых мест. Состав ступеней: 1 — «Описание»; 2–4 — «Слабые места» (урон, крит, уклонение) в выбранном порядке. Требования ступеней задаёт поле `research` кампании; боевые бонусы знания применяются по документу «Игровая математика», раздел 10.6.

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
}
```

---

## 7. Тексты

Строки, видимые человеку, в файлы настоящего документа не помещаются. Соответствие идентификатора тексту хранится в словарях модуля локализации (документ «Локализация»). Конфигурация ссылается только на идентификаторы.

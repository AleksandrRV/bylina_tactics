# Схема конфигурации
## «Былина: Тьма Кощея», версия 1.1

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
  | { type: "reveal" };

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
  missions: MissionConfig[];     // перечень точек, ≥ 1
}

interface MissionConfig {
  id: string;
  type: "purge" | "destroy" | "rescue" | "recon" | "needle";
  darknessOnVictory: number;
  darknessOnDefeat: number;
  map: MapGenConfig;
  enemies: { unitId: string; count: number }[];
  generals?: string[];
}

Точки открываются по порядку записей: первая доступна сразу, следующая открывается после завершения предыдущей (независимо от исхода). После завершения миссии счётчик Тьмы увеличивается на `darknessOnVictory` при успехе либо на `darknessOnDefeat` при поражении; при достижении `darknessMax` кампания проиграна. Суммарная численность `enemies` миссии не должна превышать вместимость клеток появления карты (`2 × (height − 2)`).

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
}
```

Генератор обязан соблюдать ограничение связности, изложенное в документе «Игровая математика», раздел 5.3.

---

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

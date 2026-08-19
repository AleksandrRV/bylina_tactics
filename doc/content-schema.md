# Схема конфигурации
## «Былина: Тьма Кощея», версия 1.1

Предмет ведения: структура файлов JSON5 и смысл полей. Алгоритмы, использующие эти поля, изложены в документе «Игровая математика». Исполнительное представление в памяти — в документе «Схема исполнительной среды».

Каждый файл проверяется соответствующей схемой Zod при загрузке. Файл, не прошедший проверку, к исполнению не допускается. Модификации вправе изменять значения полей, но не вправе добавлять поля, отсутствующие в настоящей схеме.

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
  weapons: string[];         // идентификаторы записей оружия
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
  envDmg: number;            // 0 — среда не изменяется; ≥ 1 — одна ступень
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

interface MapGenConfig {
  width: number;             // 8…64
  height: number;
  pitChance: number;         // 0…1
  coverDensity: number;
  heightMix: { z0: number; z1: number; z2: number }; // доли, сумма 1
}
```

Генератор обязан соблюдать ограничение связности, изложенное в документе «Игровая математика», раздел 5.3.

---

## 5. Состязательный набор (`pvp.json5`)

```typescript
interface PvpConfig {
  pool: string[];            // идентификаторы UnitConfig, включая отдельные записи противников
  nMin: number;
  objective: "elimination" | "apple" | "choice";
}
```

---

## 6. Тексты

Строки, видимые человеку, в файлы настоящего документа не помещаются. Соответствие `id` → текст хранится в словарях модуля локализации. Конфигурация ссылается только на идентификаторы.

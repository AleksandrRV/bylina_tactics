# Схема исполнительной среды
## «Былина: Тьма Кощея», версия 1.6

Предмет ведения: компоненты и архетипы bitECS, словари индексов, перечень систем как набор запросов к данным. Правила изменения значений изложены в документе «Игровая математика». Поля исходных записей — в документе «Схема конфигурации». Формат выгрузки — в документе «Контракты обмена».

---

## 1. Обязательные правила среды

1. Компонент содержит только числовые поля. Строковые идентификаторы хранятся во внешних словарях; в компоненте хранится целочисленный индекс.
2. Сущность есть целочисленный идентификатор. Смысл сущности определяется набором навешанных компонентов.
3. Логический признак без величины представляется пустым компонентом-меткой. Запрещается кодировать такие признаки полями вида «равно единице».
4. Живая сущность имеет ровно один компонент положения и занимает ровно одну клетку. Компонент размера не вводится.
5. Ярус поверхности, признак ямы и признак глухой стены принадлежат массиву клеток поля, а не исполнительной среде сущностей. В среде хранится только то, что перемещается, разрушается или носит состояния.

---

## 2. Словари

`ConfigMap`: целое без знака шириной 16 бит → идентификатор записи конфигурации.

`PlayerMap`: 0 — нейтральная принадлежность (среда); положительные значения — участники и сторона, управляемая алгоритмом.

`SkillRuntimeMap`: пара `(entityId, skillConfigIndex)` → `{ cooldown: ui8, uses: ui8 }`. Таблица внешняя, поскольку число умений сущности задаётся конфигурацией и один компонент не может повторяться на сущности. Она входит в полный снимок ведущего и сокращённый снимок владельца.

Числовые характеристики при создании сущности копируются из записи конфигурации в компоненты. Дальнейшее изменение характеристик в бою выполняется системами, а не повторным чтением записи, за исключением справки по оружию и умениям: оружие и умения с сущности не копируются и читаются по идентификаторам записи.

---

## 3. Компоненты

### 3.1. Отождествление

```typescript
export const ConfigReference = defineComponent({
  index: Types.ui16,
});

export const Owner = defineComponent({
  playerIndex: Types.ui8,
});
```

### 3.2. Положение

```typescript
export const Position = defineComponent({
  x: Types.ui8,
  y: Types.ui8,
  z: Types.ui8, // ярус поверхности 0…2
});

export const Orientation = defineComponent({
  direction: Types.ui8, // 0 север, 1 восток, 2 юг, 3 запад
});
```

Компонента флангового охвата не существует: охват вычисляется для пары сущностей в момент разрешения атаки.

### 3.3. Боевые величины

```typescript
export const Health = defineComponent({
  current: Types.i16,
  max: Types.i16,
});

export const ActionPoints = defineComponent({
  current: Types.i8,
  max: Types.i8,
});

export const MovementTurn = defineComponent({
  spent: Types.ui8, // накопленная стоимость добровольного движения; 0…2×mobility
});

export const CombatStats = defineComponent({
  mobility: Types.ui8,
  aim: Types.i8,
  defense: Types.i8,
  will: Types.ui8,
  vision: Types.ui8,
});
```

### 3.4. Среда как сущность

```typescript
export const Cover = defineComponent({
  type: Types.ui8, // 2 — полное, 1 — неполное
  edge: Types.ui8, // 0=N, 1=E, 2=S, 3=W, 255 — целоклеточное
});

export const ObstacleTag = defineComponent();
```

Яма и глухая стена в компоненты не входят.

### 3.5. Метки состояний

```typescript
export const DeadTag = defineComponent();
export const OverwatchTag = defineComponent();
export const DefendingTag = defineComponent();
export const FlyingTag = defineComponent();
export const HiddenTag = defineComponent();
export const PanickedTag = defineComponent();
export const ImmobilizedTag = defineComponent();

export const Poisoned = defineComponent({
  damagePerTurn: Types.ui8,
  turnsLeft: Types.ui8,
});

export const TimedLife = defineComponent({
  turnsLeft: Types.ui8,
});

export const PanicSource = defineComponent({
  entityId: Types.ui32, // источник, от которого выполняется бегство
});
```

---

## 4. Архетипы

**Боец стороны** (герой, рядовой противник, генерал, призванный зверь, иллюзия):  
`Position`, `Orientation`, `ConfigReference`, `Owner`, `Health`, `ActionPoints`, `MovementTurn`, `CombatStats`, `ObstacleTag`.
По записи конфигурации дополнительно: `FlyingTag`, `HiddenTag`, `TimedLife`. Команды и системы во время боя временно добавляют `OverwatchTag` и `DefendingTag`.
Иллюзия получает `Health.max = 1` согласно записи.

**Укрытие:**  
`Position`, `ConfigReference`, `Cover`; `ObstacleTag` устанавливается только целоклеточному укрытию. Граневое укрытие не занимает клетку: его полная ступень блокирует пересечение указанной грани, неполная увеличивает стоимость. Признак глухой стены на эту сущность не устанавливается.

**Поле боя** как сущность не создаётся.

---

## 5. Системы

Система — чистая функция, отбирающая сущности запросом и изменяющая компоненты. Новое правило состояния оформляется новой меткой и новой системой, а не дополнительным полем в `CombatStats`.

Порядок вызова в начале хода стороны задан документом «Игровая математика», раздел 16.

| Система | Читает | Пишет |
|---|---|---|
| PoisonSystem | `Health`, `Poisoned`, отсутствие `DeadTag` | `Health`, `Poisoned`, `DeadTag` |
| TimedLifeSystem | `TimedLife`, `Owner` | снятие сущности |
| OverwatchResetSystem | `OverwatchTag`, `Owner` | снятие `OverwatchTag` |
| DefendingResetSystem | `DefendingTag`, `Owner` | снятие `DefendingTag` |
| SkillCooldownSystem | `Owner`, `SkillRuntimeMap` | уменьшение ненулевых `cooldown` на 1 |
| ActionRefillSystem | `ActionPoints`, `MovementTurn`, отсутствие `DeadTag` | `ActionPoints.current`, `MovementTurn.spent = 0` |
| PanicSystem | `PanickedTag`, `PanicSource`, `Position` | `Position`, `ActionPoints` |
| CommandSystem | команда, соответствующие компоненты | по виду команды |
| ThresholdSystem | `Health`, запись `fleeHp` | удаление сущности |
| DeathSystem | `Health.current ≤ 0` | `DeadTag`, снятие `ObstacleTag` и боевых меток |
| ObjectiveSystem | положение носителя, клетки `homeOwner` | событие завершения сражения |

Запрос перемещаемых юнитов: наличие `ActionPoints`, отсутствие `DeadTag`, `PanickedTag`, `ImmobilizedTag`, при `ActionPoints.current > 0`.

Запрос юнитов, способных действовать с места: тот же набор без исключения `ImmobilizedTag`.

---

## 6. Выгрузка

Функция выгрузки обходит сущности и массив клеток поля и формирует снимок, описанный в документе «Контракты обмена». Индексы словаря конфигурации заменяются строковыми идентификаторами.

Полный снимок строится только у ведущего. Ведомому передаётся снимок после исключения сведений, не принадлежащих его стороне, по правилам документа «Контракты обмена».

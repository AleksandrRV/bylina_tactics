# Схема компонентов ECS (bitECS Schema)
## Проект: «Былина: Тьма Кощея»
**Версия:** 1.0.0

## 1. Золотые правила `bitECS` в нашем проекте
1. **Никаких строк и объектов в Компонентах.** `bitECS` оперирует только числами. Строки (ID игроков, строковые названия классов) хранятся во внешних словарях (Lookup Maps), а в компоненте хранится целочисленный индекс.
2. **Entity — это просто число (ID).** Богатырь — это число `42`. Укрытие — это число `15`. Суть сущности определяется тем, какие компоненты на нее "навешаны".
3. **Флаги (Tags) — это пустые компоненты.** Если сущность мертва, мы не делаем `Health.isDead = 1`, мы добавляем на нее компонент-тег `Dead`. Это ускоряет работу систем.

---

## 2. Словари (Lookup Maps)
Так как мы не можем хранить строки в ECS, модуль ядра предоставляет глобальные словари:
*   `ConfigMap`: Массив строк-идентификаторов из JSON5. (Например: `1 -> 'bogatyr'`, `2 -> 'leshy'`, `3 -> 'tree_large'`).
*   `PlayerMap`: Массив строк (WebRTC ID). (Например: `0 -> null (Нейтрал)`, `1 -> 'host-uuid'`, `2 -> 'client-uuid'`).

---

## 3. Описание Компонентов (Components Schema)

Ниже представлены определения компонентов на TypeScript/bitECS.

### 3.1. Идентификация и Принадлежность

```typescript
import { defineComponent, Types } from 'bitecs';

// Ссылка на JSON-конфиг сущности (класс, тип укрытия)
export const ConfigReference = defineComponent({
  index: Types.ui16 // Индекс в глобальном массиве ConfigMap (до 65535 типов)
});

// Кто управляет юнитом
export const Owner = defineComponent({
  playerIndex: Types.ui8 // 0 = Нейтрал/Окружение, 1 = Игрок 1, 2 = Игрок 2, 3 = AI Нечисть
});
```

### 3.2. Пространственные данные (Сетка)
У карты 3 уровня высоты, размер поля вряд ли превысит 256x256 клеток, поэтому `ui8` (от 0 до 255) идеально подходит.

```typescript
export const Position = defineComponent({
  x: Types.ui8,
  y: Types.ui8,
  z: Types.ui8  // Уровень высоты: 0 (низина), 1 (земля), 2 (возвышенность)
});

// Направление взгляда (для флангирования)
export const Orientation = defineComponent({
  direction: Types.ui8 // 0: North, 1: East, 2: South, 3: West
});
```

### 3.3. Боевые параметры (Stats)

```typescript
export const Health = defineComponent({
  current: Types.i16, // Может уйти в минус (overkill)
  max: Types.i16
});

export const ActionPoints = defineComponent({
  current: Types.i8,
  max: Types.i8 // Обычно 2
});

// Базовые статы юнита (модифицируются экипировкой/баффами)
export const CombatStats = defineComponent({
  mobility: Types.ui8, // На сколько клеток может пройти за 1 ОД
  aim: Types.i8,       // Базовая меткость (может быть отрицательной при дебаффах)
  defense: Types.i8,   // Базовая защита (уклонение)
  will: Types.ui8      // Воля (сопротивление панике/магии Волхва)
});
```

### 3.4. Окружение и Укрытия (Environment)

```typescript
export const Cover = defineComponent({
  type: Types.ui8, // 1 = Полуукрытие (Пень), 2 = Полное (Изба)
  hp: Types.i8     // Прочность укрытия (если разрушаемое). При hp <= 0 type снижается на 1.
});

// Тег препятствия (Блокирует перемещение)
export const ObstacleTag = defineComponent();

// Тег Ямы (Убивает при попадании на эту клетку)
export const PitTag = defineComponent();
```

### 3.5. Статусы и Эффекты (Status Tags)
Теги не имеют данных, их присутствие на сущности означает наличие статуса.

```typescript
export const DeadTag = defineComponent(); // Сущность мертва (игнорируется в боевке)
export const OverwatchTag = defineComponent(); // Сущность в дозоре ("Стеречь")
export const FlankedTag = defineComponent(); // Сущность открыта с фланга (пересчитывается каждый ход)

// Пример эффекта с таймером
export const Poisoned = defineComponent({
  damagePerTurn: Types.ui8,
  turnsLeft: Types.ui8
});
```

---

## 4. Архитипы (Entity Archetypes / Префабы)

В `bitECS` нет классов, но есть функции-фабрики (Assemblers), которые собирают сущность из компонентов. Вот из чего состоят ключевые объекты игры.

### Архитип: Герой (Богатырь / Стрелец)
Состав компонентов:
*   `Position`
*   `Orientation`
*   `ConfigReference` (указывает на 'bogatyr')
*   `Owner` (указывает на Игрока)
*   `Health` (current: 10, max: 10)
*   `ActionPoints` (current: 2, max: 2)
*   `CombatStats` (mobility: 6, aim: 65, defense: 0, will: 40)
*   `ObstacleTag` (через юнита нельзя пройти насквозь)

### Архитип: Укрытие (Вековой Дуб - Полное, разрушаемое)
Состав компонентов:
*   `Position`
*   `ConfigReference` (указывает на 'tree_oak')
*   `Cover` (type: 2, hp: 2)  *// hp: 2 означает, что первый удар превратит его в полу-укрытие (пень)*
*   `ObstacleTag`

### Архитип: Яма (Ловушка)
Состав компонентов:
*   `Position`
*   `PitTag`

---

## 5. Как работают Системы (Systems Overview)

Системы (Systems) — это чистые функции в `core-tactics`, которые каждую итерацию (или при получении Команды) фильтруют сущности по их компонентам и изменяют данные.

**Пример фильтрации (Query):**
```typescript
import { defineQuery } from 'bitecs';

// Найти всех живых юнитов, у которых есть здоровье и которые отравлены
const poisonedQuery = defineQuery([Health, Poisoned, Not(DeadTag)]);

export function PoisonSystem(world) {
  const entities = poisonedQuery(world);
  for (let i = 0; i < entities.length; i++) {
    const eid = entities[i];
    
    // Наносим урон
    Health.current[eid] -= Poisoned.damagePerTurn[eid];
    Poisoned.turnsLeft[eid] -= 1;
    
    // Генерируем событие для UI/Render
    emitEvent({ type: 'STAT_CHANGED', entityId: eid, stat: 'HP' ... });

    // Если умер от яда
    if (Health.current[eid] <= 0) {
      addComponent(world, DeadTag, eid);
      emitEvent({ type: 'ENTITY_DIED', entityId: eid });
    }
    
    // Снимаем яд, если время вышло
    if (Poisoned.turnsLeft[eid] <= 0) {
      removeComponent(world, Poisoned, eid);
    }
  }
  return world;
}
```

---

## 6. Сериализация состояния (Для сохранения и WebRTC)

Главное преимущество использования SoA (TypedArrays) в `bitECS` — возможность выгрузить **все** данные об игре в виде бинарного массива за 0 миллисекунд.

Однако, для JS-контекста и передачи по WebRTC через JSON-конверты, модуль Ядра предоставляет утилиту `SerializeWorld`:
Она проходит по всем `entities` в мире и собирает их в плоский JSON объект (описанный в *Спецификации Контрактов -> SyncPayload*), переводя индексы `ConfigReference` обратно в строковые ключи для UI.

---
## Итог для Core-программистов
1. Если вам нужно добавить новую механику (например, "Оглушение"), **НЕ** добавляйте поле `isStunned` в `CombatStats`. Создайте новый пустой компонент `StunnedTag` и вешайте его на сущность.
2. Логика проверки (кто может ходить) меняется на запрос: `defineQuery([ActionPoints, Not(DeadTag), Not(StunnedTag)])`. 
3. Это гарантирует, что компоненты остаются легковесными, а системы не требуют переписывания при расширении игры.
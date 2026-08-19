# Спецификация контрактов данных (API / Network Protocol)
## Проект: «Былина: Тьма Кощея»
**Версия:** 1.0.0
**Формат обмена:** JSON (сериализация/десериализация строк). В будущем, для оптимизации WebRTC, возможен переход на бинарный формат (MessagePack), но структура останется идентичной.

---

## 1. Базовые принципы (Паттерны)

1.  **Commands (Команды) — это *намерения*.** Игрок (или UI) отправляет команду. Ядро (Хост) имеет право её отклонить (например, если игрок пытается сходить чужим юнитом или у него нет ОД).
2.  **Events (События) — это *факты*.** Ядро вычисляет команду и рассылает события. Они не подлежат сомнению. Рендер и UI просто реагируют на них.
3.  **Батчинг (Batching).** Одна команда может породить каскад событий. Пример: `CommandAttack` -> `[EventAttackFired, EventDamageTaken, EventCoverDestroyed, EventEntityDied]`. Массив событий должен проигрываться Рендером строго последовательно.

---

## 2. Структура сетевого конверта (WebRTC Message Envelope)

Любое сообщение, передаваемое через `module-network`, оборачивается в стандартизированный конверт.

```typescript
// Общий конверт для всех сетевых пакетов
interface NetworkMessage {
  type: "COMMAND" | "EVENT_BATCH" | "SYNC_REQUEST" | "SYNC_PAYLOAD" | "PING";
  senderId: string; // Идентификатор пира (WebRTC peer ID)
  timestamp: number;
  payload: any; // В зависимости от 'type'
}
```

---

## 3. Команды (Inputs: UI ➔ Session ➔ Core)

UI формирует команду и передает её в Контроллер Сессии, который упаковывает её в сетевой конверт.

### Базовый тип Команды
```typescript
type CommandType = "MOVE" | "ATTACK" | "OVERWATCH" | "USE_SKILL" | "END_TURN";

interface BaseCommand {
  type: CommandType;
  actorId: number; // ECS ID сущности, которая совершает действие
}
```

### Спецификации конкретных команд (Payloads)

**1. Перемещение (`MOVE`)**
```typescript
interface CommandMove extends BaseCommand {
  type: "MOVE";
  path: { x: number, y: number, z: number }[]; // Запрашиваемый маршрут от A до B
}
```

**2. Атака оружием (`ATTACK`)**
```typescript
interface CommandAttack extends BaseCommand {
  type: "ATTACK";
  targetId: number; // Кого бьем
  weaponId: string; // Чем бьем (из конфига, напр. 'sword_kladenets')
}
```

**3. Использование навыка (`USE_SKILL`)**
```typescript
interface CommandUseSkill extends BaseCommand {
  type: "USE_SKILL";
  skillId: string; // Напр. 'heal_water' или 'whistle_strike'
  targetId?: number; // Опционально (если скилл таргетный)
  targetPos?: { x: number, y: number, z: number }; // Опционально (если скилл по площади - AoE)
}
```

**4. Встать в дозор (`OVERWATCH`)**
```typescript
interface CommandOverwatch extends BaseCommand {
  type: "OVERWATCH";
  // actorId тратит оставшиеся ОД и ждет хода противника
}
```

**5. Завершение хода (`END_TURN`)**
```typescript
interface CommandEndTurn {
  type: "END_TURN";
  playerId: string; // Кто передает ход
}
```

---

## 4. События (Outputs: Core ➔ Event Bus ➔ UI / Render)

Когда Хост обрабатывает команду, он рассылает `EVENT_BATCH` (массив событий).

### Базовый тип События
```typescript
type GameEventType = 
  | "TURN_CHANGED" 
  | "ENTITY_MOVED" 
  | "COMBAT_RESOLVED" 
  | "STAT_CHANGED" 
  | "ENTITY_DIED" 
  | "COVER_DESTROYED";

interface BaseEvent {
  type: GameEventType;
}
```

### Спецификации конкретных событий

**1. Смена хода (`TURN_CHANGED`)**
```typescript
interface EventTurnChanged extends BaseEvent {
  type: "TURN_CHANGED";
  activePlayerId: string; // Чей теперь ход
  turnNumber: number; // Номер раунда
}
```

**2. Сущность переместилась (`ENTITY_MOVED`)**
*Рендер использует массив `path` для анимации бега по клеткам.*
```typescript
interface EventEntityMoved extends BaseEvent {
  type: "ENTITY_MOVED";
  entityId: number;
  path: { x: number, y: number, z: number }[];
  isDash: boolean; // Был ли это "Рывок" (бег на 2 ОД)
}
```

**3. Итоги атаки/способности (`COMBAT_RESOLVED`)**
*Самое важное событие. Содержит всю математику для UI (цифры урона) и Рендера (эффекты попадания/промаха).*
```typescript
interface EventCombatResolved extends BaseEvent {
  type: "COMBAT_RESOLVED";
  sourceId: number; // Кто атаковал
  targetId: number; // Кого атаковали
  actionType: "MELEE" | "RANGED" | "MAGIC";
  result: "HIT" | "MISS" | "CRIT" | "DODGE";
  damageDealt: number; // Фактический урон
  isFlanked: boolean; // Был ли заход с фланга (для спец. UI надписи)
}
```

**4. Изменение статов (`STAT_CHANGED`)**
*Синхронизирует полоски ХП и ОД в React.*
```typescript
interface EventStatChanged extends BaseEvent {
  type: "STAT_CHANGED";
  entityId: number;
  stat: "HP" | "AP";
  newValue: number;
  delta: number; // На сколько изменилось (напр. -5 для урона, +2 для хила)
}
```

**5. Разрушение укрытия (`COVER_DESTROYED`)**
```typescript
interface EventCoverDestroyed extends BaseEvent {
  type: "COVER_DESTROYED";
  gridPos: { x: number, y: number, z: number };
  newStatus: "HALF" | "NONE"; // Было полное - стало половина. Было половина - исчезло.
}
```

**6. Смерть сущности (`ENTITY_DIED`)**
```typescript
interface EventEntityDied extends BaseEvent {
  type: "ENTITY_DIED";
  entityId: number;
  causeOfDeath: "DAMAGE" | "FALL_INTO_PIT"; // Если FALL_INTO_PIT, рендер скейлит спрайт вниз
}
```

---

## 5. Синхронизация состояния (State Snapshot)

Используется в трех случаях:
1. При старте тактического боя (Хост генерирует карту и шлет Клиенту).
2. При переподключении клиента (Reconnect).
3. При загрузке сохраненной игры.

```typescript
interface SyncPayload {
  matchMeta: {
    turnNumber: number;
    activePlayerId: string;
    rngSeed: string; // Зерно детерминированного рандома
  };
  grid: {
    width: number;
    height: number;
    tiles: TileData[]; // Плоский массив клеток (высоты, ямы)
  };
  entities: EntitySnapshot[]; // Все живые юниты, объекты, укрытия
}

interface EntitySnapshot {
  id: number;
  configId: string; // Ссылка на JSON-конфиг (напр. 'bogatyr', 'tree_large')
  ownerId: string | null; // Принадлежность (Игрок 1, Игрок 2, AI или null для пенька)
  pos: { x: number, y: number, z: number };
  stats: {
    hp: number;
    maxHp: number;
    ap: number;
  };
  coverStatus?: "FULL" | "HALF" | "NONE"; 
  statusEffects: string[]; // Напр. ['poisoned', 'overwatch']
}
```

---

## 6. Пример жизненного цикла (Use-Case Flow)

Как это выглядит на практике, когда Богатырь бьет Упыря:

**Шаг 1:** React UI игрока-клиента вызывает экшен Zustand:
```json
// UI -> Core (через Network)
{
  "type": "COMMAND",
  "payload": {
    "type": "ATTACK",
    "actorId": 12,
    "targetId": 45,
    "weaponId": "palitsa_heavy"
  }
}
```

**Шаг 2:** Ядро Хоста валидирует дистанцию, бросает кубики (Seeded RNG) и вычисляет урон. ОД Богатыря падают с 1 до 0. ХП Упыря падает с 10 до 2. 

**Шаг 3:** Ядро Хоста генерирует `EVENT_BATCH` и рассылает всем (себе и Клиенту):
```json
// Core -> Render & UI
{
  "type": "EVENT_BATCH",
  "payload": [
    {
      "type": "STAT_CHANGED", // Списываем ОД Богатырю
      "entityId": 12, "stat": "AP", "newValue": 0, "delta": -1
    },
    {
      "type": "COMBAT_RESOLVED", // Результат удара
      "sourceId": 12, "targetId": 45, "actionType": "MELEE", "result": "HIT", "damageDealt": 8, "isFlanked": false
    },
    {
      "type": "STAT_CHANGED", // Списываем ХП Упырю
      "entityId": 45, "stat": "HP", "newValue": 2, "delta": -8
    }
  ]
}
```

**Шаг 4:** Рендер (PixiJS) Клиента получает батч и ставит анимации в очередь:
1. Играет анимацию замаха палицей у спрайта 12.
2. Проигрывает эффект удара, трясет экран (Camera Shake).
3. Всплывает красный текст "-8" над спрайтом 45.
*ОД и ХП в React UI (полоски над головами) обновляются мгновенно благодаря `STAT_CHANGED`.*

---

## Итог для разработчиков
Любая фича, изменяющая игровой мир, должна быть разбита на:
1. Как её запросить? (Добавить в `CommandType`).
2. Какие данные меняются? (Добавить в `SyncPayload`).
3. Как сообщить о результате? (Добавить в `GameEventType`).

*Нарушение этого потока (например, прямая смена ХП врага по клику мыши в React-компоненте) строго запрещено архитектурой.*
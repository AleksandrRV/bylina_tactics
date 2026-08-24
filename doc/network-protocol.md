# Контракты обмена

Предмет ведения: форматы сообщений между интерфейсом, сессией, ядром и каналом. Не содержит правил видимости, дальности и урона; ведущий применяет «Игровые правила» и передаёт только результаты.

Реализация: `app/packages/net/`, `app/packages/core/src/network-events.ts`.

Кодирование: JSON. Допускается последующий переход на MessagePack при сохранении настоящей схемы полей.

---

## 1. Принципы

1. Команда выражает намерение. Ведущий вправе отклонить её.
2. Событие выражает совершившийся факт. Средство отображения и интерфейс не оспаривают события.
3. Одна команда порождает упорядоченный набор событий. Набор воспроизводится строго в указанном порядке.
4. Поля маршрута и цели, присланные ведомым, не являются источником истины. Ведущий выполняет полную проверку допустимости.
5. Каждому получателю направляются только сведения, доступные его стороне согласно разделу о поле зрения документа «Игровые правила». Наблюдатель по умолчанию получает объединение сведений обеих сторон. Если в комнате сбора включён полный обзор наблюдателя, наблюдатель получает полный снимок. Признак скрытности исключает сущность из чужих сообщений до снятия признака.
6. Живая сущность не имеет полей ширины и высоты области.

---

## 2. Конверт

```typescript
interface NetworkMessage {
  type:
    | "COMMAND"
    | "EVENT_BATCH"
    | "SYNC_REQUEST"
    | "SYNC_PAYLOAD"
    | "QUERY"
    | "QUERY_RESULT"
    | "REJECT"
    | "PING";
  senderId: string;
  timestamp: number;
  payload: unknown;
}
```

Перед разбором полезной нагрузки получатель выполняет runtime-проверку: `COMMAND` обязан соответствовать одному из типов команд, `EVENT_BATCH` — ограниченному массиву объектов событий, а `SYNC_PAYLOAD` — форме `{ match, visible, explored }`. Невалидные пакеты отбрасываются без изменения состояния.

Отклонение команды:

```typescript
interface RejectPayload {
  commandType: string;
  reason:
    | "ILLEGAL"
    | "OUT_OF_RANGE"
    | "NO_LOS"
    | "NO_AP"
    | "ON_COOLDOWN"
    | "NO_USES"
    | "NOT_YOUR_TURN"
    | "OCCUPIED"
    | "NOT_FOUND";
}
```

Текст причины не должен раскрывать наличие скрытой сущности или содержимое ненаблюдаемой клетки. Для таких случаев применяется `ILLEGAL` либо `OUT_OF_RANGE` без уточнения.

---

## 3. Команды

```typescript
type CommandType = "MOVE" | "ATTACK" | "OVERWATCH" | "DEFEND" | "USE_SKILL" | "END_TURN";

interface BaseCommand {
  type: CommandType;
  actorId: number;
}

interface CommandMove extends BaseCommand {
  type: "MOVE";
  to: { x: number; y: number; z: number };
  path?: { x: number; y: number; z: number }[];
}

interface CommandAttack extends BaseCommand {
  type: "ATTACK";
  targetId: number;
  weaponId: string;
}

interface CommandUseSkill extends BaseCommand {
  type: "USE_SKILL";
  skillId: string;
  targetId?: number;
  targetPos?: { x: number; y: number; z: number };
}

interface CommandOverwatch extends BaseCommand {
  type: "OVERWATCH";
}

interface CommandDefend extends BaseCommand {
  type: "DEFEND";
}

interface CommandEndTurn {
  type: "END_TURN";
  playerId: string;
}
```

---

## 4. Запросы предпросмотра

Запрос не изменяет состояние и не обращается к генератору случайных чисел. Ведущий отвечает только по клеткам и сущностям, уже наблюдаемым стороной запрашивающего. В противном случае возвращается `available: false` без указания причины.

```typescript
type QueryType = "REACHABLE" | "HIT";

interface QueryReachable {
  type: "REACHABLE";
  actorId: number;
}

interface QueryReachableResult {
  type: "REACHABLE";
  cells: {
    x: number;
    y: number;
    z: number;
    mpCost: number;
    apCost: 1 | 2;
  }[];
}

interface QueryHit {
  type: "HIT";
  actorId: number;
  targetId: number;
  weaponId?: string;
  skillId?: string;
}

interface QueryHitResult {
  type: "HIT";
  available: boolean;
  chance?: number;
  dmgMin?: number;
  dmgMax?: number;
  cover?: 0 | 1 | 2;
  heightMod?: -1 | 0 | 1;
  flanked?: boolean;
}

```

Видимость передаётся в `SyncPayload` (`visible`, `explored`) и событиях раскрытия, отдельного запроса `VISIBLE` нет.

---

## 5. События

```typescript
type GameEventType =
  | "TURN_CHANGED"
  | "ENTITY_MOVED"
  | "ENTITY_DISPLACED"
  | "COMBAT_RESOLVED"
  | "SKILL_RESOLVED"
  | "SKILL_RESOURCE_CHANGED"
  | "STAT_CHANGED"
  | "STATUS_CHANGED"
  | "ENTITY_SPAWNED"
  | "COVER_DESTROYED"
  | "ENTITY_DIED"
  | "ENTITY_REMOVED"
  | "OVERWATCH_FIRED"
  | "REVEALED"
  | "OBJECTIVE_CHANGED"
  | "MATCH_ENDED";
```

```typescript
interface EventTurnChanged {
  type: "TURN_CHANGED";
  activePlayerId: string;
  turnNumber: number;
}

interface EventEntityMoved {
  type: "ENTITY_MOVED";
  entityId: number;
  path: { x: number; y: number; z: number }[];
  isDash: boolean;
  apSpent: number;
}

interface EventEntityDisplaced {
  type: "ENTITY_DISPLACED";
  entityId: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  cause: "KNOCKBACK" | "TELEPORT" | "FALL";
}

interface EventCombatResolved {
  type: "COMBAT_RESOLVED";
  sourceId: number;
  targetId: number;
  actionType: "MELEE" | "RANGED" | "MAGIC";
  result: "HIT" | "MISS" | "CRIT";
  damageDealt: number;
  isFlanked: boolean;
  heightMod: -1 | 0 | 1;
}

interface EventSkillResolved {
  type: "SKILL_RESOLVED";
  sourceId: number;
  skillId: string;
  targetId?: number;
  targetPos?: { x: number; y: number; z: number };
  success: boolean;
}

interface EventSkillResourceChanged {
  type: "SKILL_RESOURCE_CHANGED";
  entityId: number;
  skillId: string;
  cooldown: number;
  uses: number;
  usesLeft?: number;
}

interface EventStatChanged {
  type: "STAT_CHANGED";
  entityId: number;
  stat: "HP" | "AP";
  newValue: number;
  delta: number;
}

interface EventStatusChanged {
  type: "STATUS_CHANGED";
  entityId: number;
  status: "POISON" | "PANIC" | "OVERWATCH" | "DEFENDING" | "HIDDEN" | "IMMOBILE" | "FLYING" | "TIMED" | "CAMOUFLAGE";
  applied: boolean;
  duration?: number;
  magnitude?: number;
  sourceId?: number;
}

interface EventEntitySpawned {
  type: "ENTITY_SPAWNED";
  entity: EntitySnapshot;
  cause: "SUMMON" | "ILLUSION" | "RESURRECTION";
}

interface EventCoverDestroyed {
  type: "COVER_DESTROYED";
  gridPos: { x: number; y: number; z: number };
  newStatus: "HALF" | "NONE";
}

interface EventEntityDied {
  type: "ENTITY_DIED";
  entityId: number;
  causeOfDeath: "DAMAGE" | "FALL_INTO_PIT" | "POISON";
}

interface EventEntityRemoved {
  type: "ENTITY_REMOVED";
  entityId: number;
  reason: "FLED" | "EXPIRED" | "EXTRACTED";
}

interface EventOverwatchFired {
  type: "OVERWATCH_FIRED";
  watcherId: number;
  triggerId: number;
  at: { x: number; y: number; z: number };
}

interface EventRevealed {
  type: "REVEALED";
  entityId: number;
  snapshot: EntitySnapshot;
}

interface EventObjectiveChanged {
  type: "OBJECTIVE_CHANGED";
  carrierId: number | null;
  pos: { x: number; y: number; z: number };
}

interface EventMatchEnded {
  type: "MATCH_ENDED";
  winnerPlayerId: string | null;
  reason: "ELIMINATION" | "OBJECTIVE" | "SURRENDER" | "CAMPAIGN_RESULT";
}
```

Область действия передаётся как несколько событий `COMBAT_RESOLVED` в одном наборе, по одному на цель, в порядке возрастания идентификатора.

Гибель в яме: сначала `ENTITY_DISPLACED` с причиной `FALL`, затем `ENTITY_DIED` с причиной `FALL_INTO_PIT`.

Удар разрушающим оружием ближнего боя через граневое укрытие: `COVER_DESTROYED` располагается до `COMBAT_RESOLVED`, потому что оставшаяся ступень входит в расчёт попадания. Значение `damageDealt` уже содержит вычет урона, принятого окружением.

Набор, адресованный ведомому, не включает события о сущностях и клетках, которые его сторона не наблюдает, за исключением случая, когда результат изменяет уже известную местность (разрушение ранее наблюдавшегося укрытия).

---

## 6. Снимок состояния

Применяется при начале сражения и после восстановления канала. В реализации один формат для гостя и наблюдателя:

```typescript
interface SyncPayload {
  /** Полный MatchState у ведущего либо сокращённый getSnapshotFor(owner). */
  match: MatchState;
  /** Ключи видимых сейчас клеток: `"x,y"`. */
  visible: string[];
  /** Ключи всех разведанных клеток: `"x,y"`. */
  explored: string[];
}
```

Ведущий формирует `match` методом `getSnapshotFor(2)` для гостя. Для наблюдателя используются объединённые видимость и разведанность сторон; при включённом полном обзоре передаётся полный снимок. Сущности, невидимые получателю, в снимок не включаются. Никаких альтернативных полей (`matchMeta`, `grid`, `entities`, `seen`) протокол не содержит.

---

## 7. Пример последовательности

Ведомый направляет:

```json
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

Ведущий проверяет допустимость, изменяет состояние и рассылает набор тем получателям, которые наблюдают хотя бы одну из сущностей 12 и 45:

```json
{
  "type": "EVENT_BATCH",
  "payload": [
    {
      "type": "STAT_CHANGED",
      "entityId": 12,
      "stat": "AP",
      "newValue": 0,
      "delta": -1
    },
    {
      "type": "COMBAT_RESOLVED",
      "sourceId": 12,
      "targetId": 45,
      "actionType": "MELEE",
      "result": "HIT",
      "damageDealt": 8,
      "isFlanked": false,
      "heightMod": 0
    },
    {
      "type": "STAT_CHANGED",
      "entityId": 45,
      "stat": "HP",
      "newValue": 2,
      "delta": -8
    }
  ]
}
```

---

## 8. Сигнализация и восстановление канала

Сигнализация использует WebSocket только для установления WebRTC. Сообщение адресно и ретранслятор не рассылает его остальным участникам:

```typescript
// клиент → relay
{ type: "SIGNAL", roomId: string, to: string, signal: unknown }
// relay → клиент
{ type: "SIGNAL", from: string, signal: unknown }
```

`JOINED` включает `peerId` клиента и список участников; `PEER_JOINED` добавляет участника, `PEER_LEFT` удаляет его. При уходе ведущего relay назначает нового и направляет ему `{ type: "ROLE_CHANGED", role: "host" }`; новый ведущий создаёт адресные WebRTC-каналы оставшимся участникам.

Relay отправляет WebSocket `ping` каждые 30 секунд и удаляет сокет, не ответивший `pong`. Клиент проходит состояния `reconnecting` → `signaling-connected` → `rtc-connected`; закрытие транспорта запускает повторное подключение с растущей задержкой. Явное закрытие сессии отменяет попытки восстановления.

## 9. Правило добавления возможности

Любое изменение мира описывается тремя элементами: командой либо внутренним срабатыванием, отражением в снимке, событием для отображения. Прямое изменение запаса здоровья из компонента интерфейса запрещено.

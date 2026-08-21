# Контракты обмена
## «Былина: Тьма Кощея», версия 1.1

Предмет ведения: форматы сообщений между интерфейсом, модулем сессии, исполнительной средой и каналом связи. Правила вычисления видимости, дальности и урона в настоящий документ не входят; ведущий применяет документ «Игровая математика» и передаёт только результаты.

Кодирование: JSON. Допускается последующий переход на MessagePack при сохранении настоящей схемы полей.

---

## 1. Принципы

1. Команда выражает намерение. Ведущий вправе отклонить её.
2. Событие выражает совершившийся факт. Средство отображения и интерфейс не оспаривают события.
3. Одна команда порождает упорядоченный набор событий. Набор воспроизводится строго в указанном порядке.
4. Поля маршрута и цели, присланные ведомым, не являются источником истины. Ведущий выполняет полную проверку допустимости.
5. Каждому получателю направляются только сведения, доступные его стороне согласно разделу о поле зрения документа «Игровая математика». Наблюдатель по умолчанию получает объединение сведений обеих сторон. Если в комнате сбора включён полный обзор наблюдателя, наблюдатель получает полный снимок. Признак скрытности исключает сущность из чужих сообщений до снятия признака.
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
type QueryType = "REACHABLE" | "HIT" | "VISIBLE";

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

interface QueryVisible {
  type: "VISIBLE";
}

interface QueryVisibleResult {
  type: "VISIBLE";
  visible: { x: number; y: number }[];
  seen: { x: number; y: number }[];
}
```

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

Применяется при начале сражения, повторном подключении и записи сохранения. Ведомому направляется уже сокращённый снимок.

```typescript
interface SyncPayload {
  matchMeta: {
    turnNumber: number;
    activePlayerId: string;
    rngSeed: string;
    rngState: string; // текущее ui32-состояние Mulberry32 для продолжения снимка
  };
  grid: {
    width: number;
    height: number;
    tiles: TileData[];
  };
  entities: EntitySnapshot[];
  visible: { x: number; y: number }[];
  seen: { x: number; y: number }[];
  objective?: {
    kind: "APPLE";
    pos: { x: number; y: number; z: number };
    carrierId: number | null;
  };
}

interface TileData {
  x: number;
  y: number;
  z: number;
  pit: boolean;
  blockLOS: boolean;
  extract?: boolean;
  homeOwner?: number;
}

interface EntitySnapshot {
  id: number;
  configId: string;
  ownerId: string | null;
  pos: { x: number; y: number; z: number };
  dir: number;
  stats: {
    hp: number;
    maxHp: number;
    ap: number;
    maxAp: number;
  };
  coverType?: 1 | 2;
  coverEdge?: 0 | 1 | 2 | 3; // только для граневого укрытия
  tags: string[];
  statusData?: {
    poisonDamage?: number;
    poisonTurns?: number;
    panicSourceId?: number;
    panicTurns?: number;
    immobileTurns?: number;
    timedLife?: number;
    skillCooldowns?: Record<string, number>;
    skillUses?: Record<string, number>;
  };
}
```

Клетки, которые сторона никогда не наблюдала, в массиве `tiles` у ведомого либо опускаются, либо передаются без признаков, кроме координат; выбранный способ должен быть единым в реализации и не раскрывать ямы и стены за пределами разведанной местности. Рекомендуется опускать неразведанные клетки.

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

## 8. Правило добавления возможности

Любое изменение мира описывается тремя элементами: командой либо внутренним срабатыванием, отражением в снимке, событием для отображения. Прямое изменение запаса здоровья из компонента интерфейса запрещено.

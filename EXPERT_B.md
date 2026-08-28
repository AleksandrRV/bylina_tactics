# Технический проект доработки Первой миссии (M1) кампании «Былина: Тьма Кощея»

---

## 1. Архитектурный обзор решения

Настоящий документ содержит детальное описание доработок Первой миссии (**M1 «Хворост»**, `prologue_brushwood`) в соответствии с требованиями геймдизайна (`doc/campaign.md` §7.1, §13) и техническими стандартами проекта.

Доработки разделены на 4 ключевых системных блока:
1. **Визуализация сущностей M1 (`packages/render`)**: замена заглушек-кругов на индивидуальный процедурный пиксель-арт / векторный рендер в PixiJS для:
   - Главного героя — **Микулы-крестьянина** (`mikula_peasant`) в двух состояниях (безоружный и с подобранной дубиной);
   - Интерактивного объекта **«Палка / дубина»** (`stick`) на земле;
   - Врага — **Лесной крысы** (`forest_rat`).
2. **Левел-дизайн и окружение карты M1 (`packages/content`)**: превращение прямого плоского коридора в естественную лесную опушку/околицу с микрорельефом (перепады ярусов $z=0, 1, 2$), островками кустарников, корягами и естественной тропой к хворосту.
3. **Системный кинематографический контроллер камеры и скриптовых анимаций (`packages/render`, `packages/core`, `packages/ui`)**: универсальная подсистема `CameraDirector` и очередей катсцен (`CinematicSequence`), поддерживающая плавные наплывы, удержание фокуса, анимацию выбегания сущностей из-за границы поля и блокировку пользовательского ввода на время сцены (для M1 и всех последующих миссий).
4. **Полноценный боевой ИИ крысы и цикл воскрешения с чекпоинта через плавное затемнение (`packages/core`, `packages/ui`)**:
   - Устранение бага с уходом крысы в «дозор» за счёт исправления эвристик сближения и скрипта поведения;
   - Сохранение контрольной точки в момент появления крысы (`rat_spawn`);
   - Компонент плавного затемнения (`FadeOverlay`) и возврат к чекпоинту при гибели Микулы.

---

## 2. Доработка визуальной части: Микула, Палка и Крыса

В `packages/render/src/field-renderer.ts` отрисовка специализированных токенов выполняется через таблицу функций `CLASS_ART`. Для сущностей M1 добавляются три специализированные функции рендеринга.

### 2.1. Микула-крестьянин (`drawMikulaPeasant`)
* **Концепт**: простой деревенский мужик в холщовой рубахе с поясом, онучах и лаптях, с растрёпанными русыми волосами и бородой.
* **Динамика экипировки**:
  - *До подбора палки*: руки пусты, поза собранная/уязвимая;
  - *После подбора (`weaponId === "club" || weaponIds.includes("club")`)*: держит в правой руке увесистую суковатую дубину.

### 2.2. Лесная крыса (`drawForestRat`)
* **Концепт**: агрессивный хищный грызун Нави.
* **Анатомические элементы**: вытянутая клиновидная морда с хищными светящимися красными/янтарными глазами (`0xff3b30`), острые зубы-резцы, розовые настороженные уши, вздыбленная тёмно-бурая шерсть (`0x3d2817`), розовый сегментированный хвост, извивающийся сзади.
* Шестиугольная подставка фракции Нави с тёмным диском.

### 2.3. Палка / Хворост на земле (`drawStickItem`)
* **Концепт**: лежащая в траве толстая узловатая дубовая ветка с обломанными сучьями.
* **Акцент интереса**: мягкая тень под веткой, янтарные частицы-искры вокруг и пульсирующий световой ореол подбора, сигнализирующий игроку об интерактивности предмета.

```typescript
// packages/render/src/field-renderer.ts

/** Микула-мужик: холщовая рубаха, пояс, лапти, борода. */
function drawMikulaPeasant({ g, cx, cy }: TokenCtx, entity?: EntityState): void {
  // Тень и плечи
  g.ellipse(cx, cy + 6.5, 12, 7.5).fill(0x8a6a42); // холщовая рубаха
  g.poly([cx - 7, cy + 5, cx + 7, cy + 5, cx + 5, cy + 12, cx - 5, cy + 12]).fill(0x6e502d);
  // Пояс-кушак
  g.rect(cx - 6, cy + 5, 12, 2).fill(0xa83232);

  // Голова, лицо, борода и волосы
  g.circle(cx, cy - 2.5, 6.5).fill(0xdeb887);
  g.ellipse(cx, cy, 5.5, 4.5).fill(0x5a3d28); // окладистая борода
  g.ellipse(cx, cy - 6, 7.5, 4).fill(0x4a3220); // шапка волос

  // Глаза
  g.circle(cx - 2, cy - 3.5, 0.9).fill(0x221810);
  g.circle(cx + 2, cy - 3.5, 0.9).fill(0x221810);

  // Оружие: дубина в руке при наличии экипировки
  const hasClub = entity?.weaponId === "club" || entity?.weaponIds?.includes("club");
  if (hasClub) {
    g.moveTo(cx + 6, cy + 4).lineTo(cx + 14, cy - 6).stroke({ width: 3.5, color: 0x543d2b });
    g.circle(cx + 14, cy - 6, 3).fill(0x3d2b1f); // набалдашник / сучок
    g.circle(cx + 10, cy - 1, 1.2).fill(0x3d2b1f);
  }
}

/** Лесная крыса: клиновидное тело, горящие глаза, усы, уши и длинный хвост. */
function drawForestRat({ g, cx, cy }: TokenCtx): void {
  // Хвост
  g.moveTo(cx - 10, cy + 6)
    .quadraticCurveTo(cx - 16, cy + 10, cx - 18, cy + 2)
    .stroke({ width: 2, color: 0xd48888 });

  // Тело грызуна (вытянутый овал под углом)
  g.ellipse(cx - 2, cy + 3, 11, 7.5).fill(0x3a291e);
  g.ellipse(cx - 2, cy + 1.5, 8.5, 5).fill(0x4d3829);

  // Мордочка (конус вперед)
  g.poly([cx + 3, cy - 3, cx + 13, cy + 1.5, cx + 3, cy + 6]).fill(0x4d3829);
  g.circle(cx + 13, cy + 1.5, 1.4).fill(0x1a110b); // носик

  // Уши (розовые внутри)
  g.ellipse(cx + 1, cy - 4, 3, 4.5).fill(0x3a291e);
  g.ellipse(cx + 1, cy - 4, 1.8, 3).fill(0xd48888);
  g.ellipse(cx + 5, cy - 3, 2.5, 3.8).fill(0x3a291e);
  g.ellipse(cx + 5, cy - 3, 1.4, 2.4).fill(0xd48888);

  // Горящие красные глаза
  g.circle(cx + 7, cy, 1.3).fill(0xff3333);
  g.circle(cx + 7.3, cy - 0.3, 0.5).fill(0xffffff);

  // Усы
  g.moveTo(cx + 10, cy + 2).lineTo(cx + 15, cy).stroke({ width: 0.6, color: 0xc8b8a8, alpha: 0.7 });
  g.moveTo(cx + 10, cy + 3).lineTo(cx + 15, cy + 5).stroke({ width: 0.6, color: 0xc8b8a8, alpha: 0.7 });

  // Лапки с коготками
  g.rect(cx + 4, cy + 8, 3, 2).fill(0xb87373);
  g.rect(cx - 6, cy + 8, 3, 2).fill(0xb87373);
}

/** Палка / дубина на земле как интерактивный подбираемый предмет. */
function drawStickItem({ g, cx, cy }: TokenCtx): void {
  const t = performance.now() * 0.003;
  const pulse = 0.5 + Math.sin(t) * 0.5;

  // Мягкий световой ореол интереса на земле
  g.ellipse(cx, cy + 2, 14 + pulse * 3, 8 + pulse * 2).fill({ color: 0xe0b34a, alpha: 0.12 + pulse * 0.08 });
  g.ellipse(cx, cy + 2, 10, 5).fill({ color: 0x000000, alpha: 0.3 });

  // Суковатая палка (ветвь)
  g.moveTo(cx - 9, cy + 4)
    .lineTo(cx + 9, cy - 3)
    .stroke({ width: 3.5, color: 0x5c4028, cap: "round" });
  g.moveTo(cx - 1, cy + 1)
    .lineTo(cx + 1, cy + 5)
    .stroke({ width: 2, color: 0x48321f, cap: "round" });
  g.circle(cx + 8, cy - 2.5, 2.2).fill(0x3e2b1b);

  // Искорки
  for (let i = 0; i < 3; i++) {
    const angle = t * 1.5 + (i * Math.PI * 2) / 3;
    const dist = 8 + Math.sin(t * 2 + i) * 3;
    g.circle(cx + Math.cos(angle) * dist, cy - 2 + Math.sin(angle) * (dist * 0.5), 1)
      .fill({ color: 0xffe89e, alpha: 0.7 * pulse });
  }
}
```

---

## 3. Редизайн карты M1: естественный рельеф и окружение

В текущей версии карта M1 представляет собой плоский коридор $20 \times 6$ клеток с редкими знаками `t`. 
Обновляем карту до размера $20 \times 7$ в биоме `meadow` с естественной дорожкой, перепадами высот ($z=0, 1, 2$), валунами, кустарниками и ямами в отдалении.

### 3.1. Структура сетки и высот (`packages/content/data/prologue_missions.json5`)
* **Геометрия**: $20 \times 7$.
* **Рельеф**:
  - Западная часть (старт Микулы): пологий луговой ярус $z=1$;
  - Центральная зона: естественная тропинка, огибающая холм $z=2$ с севера и овражек $z=0$ с юга;
  - Восточная поляна: небольшое возвышение $z=1$, где у кустов лежит палка `S` $(18, 3)$;
  - Точка засады крысы `F`: кусты на опушке $(19, 1)$.
* **Препятствия и укрытия**:
  - `t` — густой декоративный кустарник;
  - `c` — полуукрытие (старый пень / поваленный ствол);
  - `W` — крупный замшелый валун (блокирует LOS и проход).

```json5
// packages/content/data/prologue_missions.json5 (фрагмент для prologue_brushwood)
{
  id: "prologue_brushwood",
  titleKey: "prologue.m1.title",
  introKey: "prologue.m1.intro",
  outroKey: "prologue.m1.outro",
  nextMissionId: "prologue_cry",
  playerSlots: ["mikula_peasant"],
  fog: false,
  map: {
    biome: "meadow",
    width: 20,
    height: 7,
    pitChance: 0.0,
    coverDensity: 0.0,
    wallDensity: 0.0,
    edgeCoverChance: 0.0,
    halfCoverChance: 0.0,
    heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
    layout: {
      rows: [
        "t.t...t..W.W........",
        "..t.W......W.....tF.",
        "....................",
        ".M...t...c........tS",
        "....t...t...W.......",
        ".t.....W.....c.t....",
        "ttt..t...t...ttt..tt"
      ],
      legend: {
        ".": { kind: "ground" },
        "t": { kind: "decor", decor: "bush" },
        "W": { kind: "wall" },
        "c": { kind: "cover", coverType: 1 },
        "M": { kind: "spawn", side: "player", unitId: "mikula_peasant" },
        "S": { kind: "pickup", itemId: "stick", weaponId: "club" },
        "F": { kind: "spawn", side: "enemy", unitId: "forest_rat", scripted: true }
      }
    }
  },
  enemies: [],
  objective: {
    initialTextKey: "prologue.objective.gather",
    retarget: [
      { onKey: "stick", textKey: "prologue.objective.destroyAll" }
    ]
  },
  hints: ["m1.endTurn"],
  onboarding: [],
  checkpoints: [
    { id: "start", description: "Вход в миссию" },
    { id: "rat_spawn", onKey: "stick", description: "Появление крысы" }
  ]
}
```

---

## 4. Системный контроллер режиссуры камеры и катсцен

Требование: переходы камеры и динамическое появление врагов не должны быть одноразовыми «костылями». Реализуется единая расширяемая подсистема режиссуры.

### 4.1. Модуль камеры: расширение `packages/render/src/camera.ts`

Вводим типы и функции для построения очереди кинематографических команд:

```typescript
// packages/render/src/camera.ts

export type CinematicCue =
  | { type: "panTo"; target: Point; durationMs?: number; holdMs?: number; ease?: "easeInOut" | "easeOut" | "linear" }
  | { type: "zoomTo"; scale: number; durationMs?: number }
  | { type: "trackEntity"; entityId: number; durationMs?: number }
  | { type: "screenFade"; mode: "out" | "in"; durationMs?: number; color?: number };

export interface CinematicSequence {
  id: string;
  cues: CinematicCue[];
  lockInput?: boolean;
}
```

### 4.2. Расширение интерфейса `FieldRenderer` в `packages/render/src/field-renderer.ts`

Добавляются методы выполнения последовательностей камеры и плавной интерполяции движения вновь появляющихся сущностей:

```typescript
export interface FieldRenderer {
  // ... существующие методы ...
  
  /** Воспроизвести кинематографическую последовательность движения камеры */
  playCinematicSequence(sequence: CinematicSequence): Promise<void>;
  
  /** Анимация выбегания сущности из-за пределов поля в стартовую клетку */
  animateEntityRunIn(entityId: number, fromPixel: Point, toCell: CellPos, durationMs?: number): Promise<void>;
  
  /** Управление экраном затемнения (fade in / fade out) */
  fadeScreen(mode: "in" | "out", durationMs?: number, color?: number): Promise<void>;
  
  /** Заблокировать/разблокировать интерактивный ввод пользователя */
  setInputLocked(locked: boolean): void;
}
```

#### Реализация в `createFieldRenderer`:

```typescript
// Внутри createFieldRenderer:

let inputLocked = false;
const fadeGraphics = new Graphics();
fadeGraphics.zIndex = 10000;
app.stage.addChild(fadeGraphics);

const fadeScreen = async (mode: "in" | "out", durationMs = 400, color = 0x0a0d0a): Promise<void> => {
  const startAlpha = mode === "out" ? 0 : 1;
  const targetAlpha = mode === "out" ? 1 : 0;
  
  await tween(durationMs, (t) => {
    const alpha = startAlpha + (targetAlpha - startAlpha) * t;
    fadeGraphics.clear();
    if (alpha > 0.001) {
      fadeGraphics.rect(0, 0, app.renderer.width, app.renderer.height).fill({ color, alpha });
    }
  });
};

const playCinematicSequence = async (sequence: CinematicSequence): Promise<void> => {
  if (sequence.lockInput !== false) inputLocked = true;
  
  try {
    for (const cue of sequence.cues) {
      if (destroyed) break;
      
      if (cue.type === "panTo") {
        const screen = { width: app.renderer.width, height: app.renderer.height };
        const plane = { scale: world.scale.x, offset: { x: world.x, y: world.y } };
        const targetOffset = trainingGlideOffset(cue.target, plane, screen, mapPlane());
        const fromX = world.x;
        const fromY = world.y;
        const dur = cue.durationMs ?? 600;
        
        userMoved = true;
        await tween(dur, (t) => {
          const e = cue.ease === "linear" ? t : cue.ease === "easeOut" ? easeOut(t) : easeInOut(t);
          world.x = fromX + (targetOffset.x - fromX) * e;
          world.y = fromY + (targetOffset.y - fromY) * e;
        });
        
        if (cue.holdMs && cue.holdMs > 0) {
          await wait(cue.holdMs);
        }
      } else if (cue.type === "screenFade") {
        await fadeScreen(cue.mode, cue.durationMs, cue.color);
      }
    }
  } finally {
    if (sequence.lockInput !== false) inputLocked = false;
  }
};

const animateEntityRunIn = async (
  entityId: number,
  fromPixel: Point,
  toCell: CellPos,
  durationMs = 500
): Promise<void> => {
  const target = centerOf(toCell.x, toCell.y, toCell.z);
  const shown = display.get(entityId) ?? {
    x: toCell.x,
    y: toCell.y,
    z: toCell.z,
    hp: 4,
    maxHp: 4,
    dead: false,
  };
  
  // Временно устанавливаем начальные мировые координаты
  display.set(entityId, shown);
  
  await tween(durationMs, (t) => {
    const e = easeOut(t);
    // Интерполируем промежуточную позицию
    const curX = fromPixel.x + (target.cx - fromPixel.x) * e;
    const curY = fromPixel.y + (target.cy - fromPixel.y) * e;
    
    // Переводим пиксельные координаты обратно в координаты сетки для рендера
    shown.x = (curX - PAD) / CELL_SIZE;
    shown.y = (curY - PAD - RISE * 2 + toCell.z * RISE) / CELL_SIZE;
  });
  
  shown.x = toCell.x;
  shown.y = toCell.y;
  shown.z = toCell.z;
};
```

---

## 5. Исправление логики ИИ крысы и сценария M1

### 5.1. Причина ошибки с «дозором» (Overwatch Bug)
В `packages/core/src/ai.ts` функция `pickEnemyCommand` при невозможности атаковать в текущем положении и совершив шаг, если у юнита оставалось $\ge 1$ AP и было оружие, выполняла fallback:
```typescript
const watcher = enemies.find((actor) => actor.ap > 0 && !actor.overwatch && actor.weaponId);
return watcher ? { type: "OVERWATCH", actorId: watcher.id } : null;
```
Для юнитов с оружием ближнего боя (`range: 1`) вставать в дозор на открытой местности бессмысленно, так как радиус срабатывания дозора равен дальности оружия ($1$ клетка), а оставшиеся AP тратятся впустую вместо сближения.

### 5.2. Правка ядра `packages/core/src/ai.ts`
1. Запретить fallback в `OVERWATCH` для юнитов, у которых оружие имеет категорию `melee` (`weapon.category === "melee"`). Юниты ближнего боя должны использовать все очки передвижения для рывка/сближения к герою.
2. В `packages/core/src/prologue-script.ts` и `prologue_missions.json5` задать чёткую модель поведения крысы:
   - Ход 1 (после выбегания): крыса делает рывок и атакует Микулу с `forceOutcome: "miss"`;
   - Последующие ходы: крыса агрессивно преследует игрока, бьёт зубами с честным броском урона ($2-3$ HP).

```typescript
// packages/core/src/ai.ts (фрагмент исправления)

// В дозор могут вставать только стрелки с дальнобойным оружием (range >= 3)
const watcher = enemies.find((actor) => {
  if (actor.ap <= 0 || actor.overwatch || !actor.weaponId) return false;
  const weapon = kernel.getWeaponDefinition ? kernel.getWeaponDefinition(actor.weaponId) : null;
  return weapon ? weapon.category === "ranged" && weapon.range >= 3 : false;
});
```

---

## 6. Цикл гибели персонажа, чекпоинты и Fade-Out Transition

Согласно `doc/campaign.md` §1.5 и §13.8, провал в прологе — это откат сцены к последнему чекпоинту без штрафов и потери кампании.

### 6.1. Логика контрольных точек в M1
1. **Чекпоинт 1 (`start`)**: Старт миссии (Микула на клетке $(1, 3)$ без оружия).
2. **Чекпоинт 2 (`rat_spawn`)**: Момент, когда Микула подобрал палку (получил дубину), а крыса выбежала на поле.

### 6.2. Процедура обработки смерти игрока в `packages/ui/src/BattleScreenView.tsx`

При фиксации гибели Микулы (`entity.configId === "mikula_peasant" && entity.dead`):
1. Блокируется ввод пользователя.
2. Запускается плавное затемнение экрана (`renderer.fadeScreen("out", 600)`).
3. Во время 100% затемнения вызывается `session.restoreBattleCheckpoint()`:
   - Состояние ядра восстанавливается к моменту появления крысы (у Микулы есть дубина, крыса на поле с полным здоровьем, ОД обновлены);
   - Сбрасываются временные эффекты;
   - Камера позиционируется на Микуле.
4. Выполняется плавное проявление экрана (`renderer.fadeScreen("in", 500)`).
5. Игроку возвращается управление.

```typescript
// packages/ui/src/BattleScreenView.tsx (логика восстановления при смерти в прологе)

const handlePlayerDefeatRecovery = async (): Promise<void> => {
  if (!rendererRef.current) return;
  setBusy(true);
  
  // 1. Плавное затемнение
  await rendererRef.current.fadeScreen("out", 600);
  
  // 2. Откат состояния ядра к чекпоинту
  session.restoreBattleCheckpoint();
  
  // 3. Сброс логов и предпросмотров
  setAimId(null);
  setAction(null);
  setSkillTargetPos(null);
  setPreview(null);
  setLog(t("prologue.hint.m1.restartCheckpoint") ?? "Соберись с силами...");
  
  // 4. Позиционирование камеры на Микуле
  const snap = session.getBattleFullSnapshot();
  const mikula = snap?.entities.find((e) => e.configId === "mikula_peasant");
  if (mikula) {
    const tile = snap?.grid.tiles.find((t) => t.x === mikula.x && t.y === mikula.y);
    const z = tile ? (tile.pit ? 0 : tile.z) : 1;
    const target = { x: 26 + mikula.x * 52 + 26, y: 26 + 24 + mikula.y * 52 - z * 12 + 26 };
    await rendererRef.current.playCinematicSequence({
      id: "recover_focus",
      cues: [{ type: "panTo", target, durationMs: 10, holdMs: 100 }],
      lockInput: false,
    });
  }
  
  // 5. Плавное появление
  await rendererRef.current.fadeScreen("in", 500);
  setBusy(false);
};
```

---

## 7. Пошаговый сценарий миссии M1 (Режиссура)

1. **Запуск миссии**:
   - Экран плавно проявляется из черного (`fadeScreen("in", 400)`).
   - `CameraDirector` активирует вступительную последовательность:
     1. Фокус на Микуле $(1, 3)$ (удержание $500$ мс);
     2. Плавный наплыв камеры на восток к лежащей палке $(19, 3)$ со скоростью скольжения $900$ мс;
     3. Удержание фокуса на палке $700$ мс (искорки и подсветка предмета);
     4. Возврат камеры к Микуле $700$ мс;
     5. Разблокировка ввода игрока.
   - Появляется подсказка цели: *«Соберите хворост»*.
2. **Перемещение игрока**:
   - Игрок делает первый ход (рывок вперед). Подсвечивается подсказка завершения хода.
   - На втором ходу Микула встает на клетку $(19, 3)$ с палкой.
3. **Событие подбора палки и появление крысы**:
   - Палка исчезает с поля, Микула визуально вооружается дубиной.
   - Цель меняется на: *«Уничтожьте всех противников»*.
   - **Фиксация чекпоинта `rat_spawn`**.
   - Кинематографическая врезка появления врага:
     1. Камера панорамирует на опушку $(18, 1)$;
     2. Из-за правой границы экрана с анимацией быстрого перебега (`animateEntityRunIn` от точки $(22, 1)$ к $(18, 1)$ за $450$ мс) выбегает Лесная крыса;
     3. Камера возвращается к Микуле;
     4. Ход переходит к Нави.
4. **Бой с крысой**:
   - Ход 1 крысы: сближение, атака зубами (`teeth`) с учебным промахом (`forceMiss`).
   - Ход 2 игрока: Микула атакует дубиной в ближнем бою.
   - Если Микула погибает $\rightarrow$ срабатывает затемнение и откат к чекпоинту появления крысы.
   - При убийстве крысы $\rightarrow$ победный триггер, открывается диалоговая плашка завершения миссии (*«Крыса была не одна. Из леса доносится крик...»*), кнопка перехода в M2 «На крик».

---

## 8. Детальный план внесения правок в файлы проекта

| Файл | Назначение изменений |
|---|---|
| `packages/content/data/prologue_missions.json5` | Обновление карты `prologue_brushwood`: сетка $20 \times 7$, рельеф, укрытия, кусты `t`, валуны `W`, пни `c`, метаданные чекпоинтов. |
| `packages/content/data/prologue_bestiary.json5` | Настройка параметров `forest_rat` и `teeth` (агрессивный ближний бой без дальнобойных абилок). |
| `packages/render/src/camera.ts` | Реализация структур `CinematicCue`, `CinematicSequence` и математики плавного интерполирования камеры. |
| `packages/render/src/field-renderer.ts` | 1. Добавление `drawMikulaPeasant`, `drawForestRat`, `drawStickItem` в `CLASS_ART`.<br>2. Реализация методов `playCinematicSequence`, `animateEntityRunIn`, `fadeScreen`, `setInputLocked`. |
| `packages/core/src/ai.ts` | Устранение бага с уходом милишников в `OVERWATCH` при невозможности атаки. |
| `packages/core/src/prologue-run.ts` | Обработка чекпоинта `rat_spawn` при подборе палки и поддержка отката к нему. |
| `packages/ui/src/BattleScreenView.tsx` | 1. Интеграция стартовой катсцены M1 (Микула $\rightarrow$ Палка $\rightarrow$ Микула).<br>2. Интеграция кинематографичного выбегания крысы.<br>3. Обработчик смерти игрока с плавным затемнением (`fadeScreen`) и возвратом к чекпоинту. |
| `packages/i18n/locales/ru/ui.json` и `en/ui.json` | Добавление ключей локализации для новых подсказок и реплик чекпоинта M1. |

---

## 9. План верификации и автоматического тестирования (QA)

1. **Автотесты рендерера и камеры (`packages/render/tests/camera.test.ts`)**:
   - Проверка корректности расчёта траекторий `panTo` в границах карты $20 \times 7$.
   - Тестирование очереди выполнения `CinematicSequence`.
2. **Автотесты сценария и ИИ (`packages/core/tests/prologue-sim.test.ts`, `ai.test.ts`)**:
   - Тест отсутствия команды `OVERWATCH` у крысы в M1 на любых дистанциях.
   - Тест агрессивного перемещения крысы вплотную к Микуле и вызова атаки.
   - Проверка сохранения и корректности восстановления снимка чекпоинта `rat_spawn`.
3. **Визуальный аудит (`pnpm audit:visual`, `pnpm check:versions`)**:
   - Проверка отрисовки уникального спрайта Микулы, дубины и крысы.
   - Проверка плавности затемнения экрана при гибели и отсутствия зависания интерфейса.
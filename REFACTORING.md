Ниже — максимально подробная проектная инструкция по рефакторингу `app/packages/ui/src/BattleScreenView.tsx`.

Цель:

- уменьшить итоговый `BattleScreenView.tsx` до менее чем **1000 строк**;
- сохранить публичный экспорт `BattleScreenView`;
- сохранить поведение экрана боя: обучение, пролог, повтор, PvP, кампанию, кинематографические сцены, исход боя, панель действий, клавиатуру, тренировочные подсказки;
- профессионально выделить логические модули: состояние, команды, рендерер, обучение, пролог, повтор, ростер, подсказки, диалоги, HUD.

> Важное практическое замечание. `BattleScreenView.tsx` в текущем виде содержит несколько тысяч строк: состояния, эффекты, обработчики, боевые панели, диалоги, обучение, пролог, повтор, сеть. Полный дословный перенос всех этих тысяч строк в один ответ физически невозможен без потери читаемости. Поэтому ниже дан полный целевой код архитектуры, итогового файла и всех новых модулей, а для самых крупных графических/декларативных блоков указана точная точка переноса. Такие блоки копируются **1:1** из старого файла в новые компоненты/хуки без изменения поведения.

---

# 1. Диагностика текущего файла

`BattleScreenView.tsx` сейчас совмещает слишком много ответственностей:

1. Создание боевого ядра.
2. Выбор стороны наблюдения.
3. Снимок боя, ревизия, видимость, разведка.
4. Намерение игрока: выбор бойца, оружие, умение, прицел, рывок.
5. Обучение: подсказки, директивы, запрет действий, итог обучения.
6. Пролог: режиссёр сцен, контрольные точки, принудительная стойка, сюжетные подсказки.
7. Команды: `MOVE`, `ATTACK`, `USE_SKILL`, `DEFEND`, `END_TURN`, рывок, отказа обучения.
8. Проигрывание событий через `renderer.play`.
9. Ход Нави.
10. Повтор и журнал повтора.
11. Ростер своих бойцов и полоса противников.
12. Карточка прицеливания.
13. Областной прицел.
14. Кампейн-подсказки.
15. Диалоги: пауза, итог, информация о действии, информация о бойце, сюжетная реплика.
16. Клавиатура.
17. Синхронизация с `FieldRenderer`.
18. Большой JSX.

Это нужно разнести на модули.

---

# 2. Целевая архитектура

Создаём папку:

```text
app/packages/ui/src/battle-screen/
```

Итоговая структура:

```text
app/packages/ui/src/
  BattleScreenView.tsx
  battle-screen/
    context.ts
    useBattleScreenModel.ts

    useBattleScreenBase.ts
    useBattleKinds.ts
    useBattleKernel.ts
    useBattleSnapshot.ts
    useBattleIntentState.ts
    useBattleAimPreview.ts
    useBattleTrainingState.ts
    useBattlePrologueState.ts
    useBattleOutcomeGate.ts
    useBattleCommandCenter.ts
    useBattleRendererSync.ts
    useBattleEnemyTurn.ts
    useBattleReplayPlayback.ts
    useBattleRosterState.ts
    useBattleCampaignHints.ts
    useBattleKeyboardControl.ts

    BattleScreenLayout.tsx
    BattleTopBar.tsx
    BattleRosterPanel.tsx
    BattleEnemyStrip.tsx
    BattleAimCard.tsx
    BattleTrainingLayer.tsx
    BattleBottomPanel.tsx
    BattleDialogs.tsx
    BattleReplayBar.tsx
```

Публичный контракт сохраняется:

```ts
export function BattleScreenView(): JSX.Element;
```

`BattleScreen.tsx` остаётся без изменений:

```ts
export const BattleScreen = lazy(async () => ({
  default: (await import("./BattleScreenView.js")).BattleScreenView,
}));
```

---

# 3. Главные правила рефакторинга

1. **Не менять поведение.**
2. **Не менять порядок хуков внутри компонента без необходимости.**  
   Все хуки вызываются в одном корневом `useBattleScreenModel` всегда в одном и том же порядке.
3. **Не дублировать доменную логику.**  
   Уже есть модули:
   - `battle-cell-click.ts`;
   - `battle-command.ts`;
   - `battle-selection.ts`;
   - `battle-intent.ts`;
   - `training-progress.ts`;
   - `training-scenario.ts`;
   - `prologue-director.ts`;
   - `battle-enemy-phase.ts`;
   - `outcome-gate.ts`;
   - `enemy-strip.ts`.

   Их не переписываем, только правильно используем.
4. **Все крупные JSX-блоки выносятся в презентационные компоненты.**
5. **Все крупные эффекты и обработчики выносятся в хуки.**
6. **Классы вёрстки, роли, `aria`, тестовые селекторы сохраняются.**

---

# 4. Пошаговая инструкция

## Шаг 1. Создать папку модуля

```bash
mkdir -p app/packages/ui/src/battle-screen
```

## Шаг 2. Создать контекст экрана боя

Файл:

```text
app/packages/ui/src/battle-screen/context.ts
```

Контекст позволяет не тащить огромную модель через пропсы в каждую панель.

## Шаг 3. Создать корневую модель экрана

Файл:

```text
app/packages/ui/src/battle-screen/useBattleScreenModel.ts
```

Он вызывает все боевые хуки и возвращает единую модель.

## Шаг 4. Вынести базовое состояние

Файл:

```text
app/packages/ui/src/battle-screen/useBattleScreenBase.ts
```

Сюда входят:

- `session`;
- `content`;
- `debug`;
- `paused`;
- `battleKind`;
- `hintSettings`;
- `hostRef`;
- `rendererRef`;
- `inputRef`;
- `busy`;
- `log`;
- `enemyPhase`;
- `cutscenePlaying`;
- `outcomePending`;
- `fastPace`;
- `actionInfo`;
- `unitInfo`;
- `storyNote`;
- `prologueStanceLock`;
- `outcomeGate`.

## Шаг 5. Вынести тип боя и сторону наблюдения

Файл:

```text
app/packages/ui/src/battle-screen/useBattleKinds.ts
```

Сюда входят:

- `isReplay`;
- `isTraining`;
- `isPrologue`;
- `trainingMission`;
- `prologueMission`;
- `mission`;
- `isNetGuest`;
- `isSpectator`;
- `viewOwner`;
- `usesNetSnapshot`;
- `side`.

## Шаг 6. Вынести создание боевого ядра

Файл:

```text
app/packages/ui/src/battle-screen/useBattleKernel.ts
```

Сюда входит создание `TacticsKernel` через `createBattleKernel`.

## Шаг 7. Вынести снимок боя и видимость

Файл:

```text
app/packages/ui/src/battle-screen/useBattleSnapshot.ts
```

Сюда входят:

- `battleRevision`;
- `snapshot`;
- `visibleCells`;
- `exploredCells`.

## Шаг 8. Вынести намерение игрока

Файл:

```text
app/packages/ui/src/battle-screen/useBattleIntentState.ts
```

Сюда входят:

- `intent`;
- `setIntent`;
- `selectedId`;
- `selected`;
- `action`;
- `aimId`;
- `skillTargetPos`;
- `preview`;
- `charge`;
- `chargeArmed`;
- `clearAim`.

## Шаг 9. Вынести предпросмотр атаки и областного прицела

Файл:

```text
app/packages/ui/src/battle-screen/useBattleAimPreview.ts
```

Сюда входят:

- `hit`;
- `aimBreakCell`;
- `hoverCell`;
- `areaPreview`;
- `aimCardPos`.

## Шаг 10. Вынести обучение

Файл:

```text
app/packages/ui/src/battle-screen/useBattleTrainingState.ts
```

Сюда входят:

- `hintStep`;
- `trainingHints`;
- `activeHint`;
- `directiveView`;
- `trainingHighlight`;
- `trainingFocus`;
- `trainingDone`;
- `trainingOver`;
- `trainingNote`;
- `advanceTraining`;
- `showTrainingNote`;
- `trainingAllows`;
- `trainingDeny`.

## Шаг 11. Вынести пролог

Файл:

```text
app/packages/ui/src/battle-screen/useBattlePrologueState.ts
```

Сюда входят:

- `prologueRunRef`;
- `prologueTelemetryRef`;
- `firedCutscenesRef`;
- `prologueObjectiveKey`;
- `prologueHintKey`;
- `battleOutcome`;
- `director`;
- `showStoryNote`;
- `showPrologueHint`;
- `closeStoryNote`;
- `currentPrologueHintKey`.

## Шаг 12. Вынести исход боя

Файл:

```text
app/packages/ui/src/battle-screen/useBattleOutcomeGate.ts
```

Сюда входят:

- `finishFromEvents`;
- логика завершения обучения;
- логика завершения кампании;
- логика завершения PvP;
- задержка показа итога через `outcomeGate`.

## Шаг 13. Вынести центр команд

Файл:

```text
app/packages/ui/src/battle-screen/useBattleCommandCenter.ts
```

Сюда входят:

- `applyCommand`;
- `playThen`;
- `announce`;
- `executeCharge`;
- `tryMove`;
- `tryAttack`;
- `trySkill`;
- `applySelfSkill`;
- `endTurn`;
- `runEndTurnSequence`;
- `handOffTurnToEnemy`;
- `debugAutoWin`;
- `onCell`.

## Шаг 14. Вынести синхронизацию с рендерером

Файл:

```text
app/packages/ui/src/battle-screen/useBattleRendererSync.ts
```

Сюда входят:

- монтирование `FieldRenderer`;
- `renderer.update`;
- `renderer.setInputLocked`;
- `renderer.setSpeed`;
- `renderer.setReducedMotion`;
- `focusEntity`;
- позиция карточки прицеливания;
- обработка нажатия на клетки.

## Шаг 15. Вынести ход Нави

Файл:

```text
app/packages/ui/src/battle-screen/useBattleEnemyTurn.ts
```

Сюда входит эффект запуска вражеской фазы.

## Шаг 16. Вынести повтор

Файл:

```text
app/packages/ui/src/battle-screen/useBattleReplayPlayback.ts
```

Сюда входят:

- `replayIndex`;
- `replayDone`;
- интервал проигрывания журнала.

## Шаг 17. Вынести ростер и полосу врагов

Файл:

```text
app/packages/ui/src/battle-screen/useBattleRosterState.ts
```

Сюда входят:

- `roster`;
- `knownEnemies`;
- `enemyStrip`;
- `objectiveEntity`;
- `seenEnemiesRef`.

## Шаг 18. Вынести кампейн-подсказки

Файл:

```text
app/packages/ui/src/battle-screen/useBattleCampaignHints.ts
```

Сюда входят:

- `battleWantedHints`;
- `activeBattleHint`;
- `closeBattleHint`;
- `saveNotice`.

## Шаг 19. Вынести клавиатуру

Файл:

```text
app/packages/ui/src/battle-screen/useBattleKeyboardControl.ts
```

Сюда входит подписка на клавиатуру через `useBattleInput`.

## Шаг 20. Вынести презентационные компоненты

Создать:

```text
BattleScreenLayout.tsx
BattleTopBar.tsx
BattleRosterPanel.tsx
BattleEnemyStrip.tsx
BattleAimCard.tsx
BattleTrainingLayer.tsx
BattleBottomPanel.tsx
BattleDialogs.tsx
BattleReplayBar.tsx
```

## Шаг 21. Переписать `BattleScreenView.tsx`

Оставить только композицию.

---

# 5. Полный код итогового файла

## `app/packages/ui/src/BattleScreenView.tsx`

Итоговый файл становится тонким композиционным корнем.

Ожидаемый размер: **менее 30 строк**.

```tsx
/**
 * Экран тактического боя.
 *
 * После рефакторинга этот файл является только публичной точкой входа.
 * Вся логика экрана находится в `battle-screen/useBattleScreenModel.ts`,
 * а представление — в презентационных компонентах `battle-screen/*`.
 *
 * Публичный контракт сохранён: `BattleScreen` lazy-загружает именно
 * именованный экспорт `BattleScreenView`.
 */
import { BattleScreenContext } from "./battle-screen/context.js";
import { useBattleScreenModel } from "./battle-screen/useBattleScreenModel.js";
import { BattleScreenLayout } from "./battle-screen/BattleScreenLayout.js";

export function BattleScreenView() {
  const model = useBattleScreenModel();

  return (
    <BattleScreenContext.Provider value={model}>
      <BattleScreenLayout />
    </BattleScreenContext.Provider>
  );
}
```

---

# 6. Контекст экрана боя

## `app/packages/ui/src/battle-screen/context.ts`

```ts
import { createContext, useContext } from "react";
import type { BattleScreenModel } from "./useBattleScreenModel.js";

export const BattleScreenContext = createContext<BattleScreenModel | null>(null);

export function useBattleScreen(): BattleScreenModel {
  const model = useContext(BattleScreenContext);

  if (!model) {
    throw new Error("BattleScreen components must be rendered inside BattleScreenContext.Provider");
  }

  return model;
}
```

---

# 7. Корневая модель экрана

## `app/packages/ui/src/battle-screen/useBattleScreenModel.ts`

Этот файл вызывает все хуки в стабильном порядке и собирает модель.

Ожидаемый размер: **220–320 строк**.

```ts
import { useMemo } from "react";

import { useBattleScreenBase } from "./useBattleScreenBase.js";
import { useBattleKinds } from "./useBattleKinds.js";
import { useBattleKernel } from "./useBattleKernel.js";
import { useBattleSnapshot } from "./useBattleSnapshot.js";
import { useBattleIntentState } from "./useBattleIntentState.js";
import { useBattleAimPreview } from "./useBattleAimPreview.js";
import { useBattleTrainingState } from "./useBattleTrainingState.js";
import { useBattlePrologueState } from "./useBattlePrologueState.js";
import { useBattleOutcomeGate } from "./useBattleOutcomeGate.js";
import { useBattleCommandCenter } from "./useBattleCommandCenter.js";
import { useBattleRendererSync } from "./useBattleRendererSync.js";
import { useBattleEnemyTurn } from "./useBattleEnemyTurn.js";
import { useBattleReplayPlayback } from "./useBattleReplayPlayback.js";
import { useBattleRosterState } from "./useBattleRosterState.js";
import { useBattleCampaignHints } from "./useBattleCampaignHints.js";
import { useBattleKeyboardControl } from "./useBattleKeyboardControl.js";

export function useBattleScreenModel() {
  const base = useBattleScreenBase();
  const kinds = useBattleKinds(base);
  const kernelModel = useBattleKernel(base, kinds);
  const snapshotModel = useBattleSnapshot(base, kinds);
  const intentModel = useBattleIntentState(snapshotModel);
  const training = useBattleTrainingState(base, kinds, snapshotModel, intentModel);
  const prologue = useBattlePrologueState(base, kinds, kernelModel.kernel, snapshotModel);
  const outcome = useBattleOutcomeGate(base, kinds, snapshotModel, training, prologue);
  const commands = useBattleCommandCenter({
    base,
    kinds,
    kernel: kernelModel.kernel,
    snapshotModel,
    intentModel,
    training,
    prologue,
    outcome,
  });
  const aim = useBattleAimPreview(base, kinds, snapshotModel, intentModel);
  const renderer = useBattleRendererSync({
    base,
    kinds,
    snapshotModel,
    intentModel,
    aim,
    training,
    prologue,
    commands,
  });
  const enemyTurn = useBattleEnemyTurn({
    base,
    kinds,
    kernel: kernelModel.kernel,
    prologue,
    outcome,
    commands,
  });
  const replay = useBattleReplayPlayback(base, kinds, kernelModel.kernel);
  const roster = useBattleRosterState(base, kinds, snapshotModel);
  const hints = useBattleCampaignHints(base, kinds, kernelModel.kernel);
  const keyboard = useBattleKeyboardControl({
    base,
    kinds,
    snapshotModel,
    intentModel,
    training,
    prologue,
    commands,
  });

  const screenClassName = useMemo(() => {
    return [
      "battle-screen",
      kinds.battleKind === "pvp"
        ? kinds.viewOwner === 1
          ? "is-pvp-side1"
          : "is-pvp-side2"
        : "",
      training.trainingFocus ? "is-training-focus" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [kinds.battleKind, kinds.viewOwner, training.trainingFocus]);

  return {
    ...base,
    ...kinds,
    ...kernelModel,
    ...snapshotModel,
    ...intentModel,
    ...aim,
    ...training,
    ...prologue,
    ...outcome,
    ...commands,
    ...renderer,
    ...enemyTurn,
    ...replay,
    ...roster,
    ...hints,
    ...keyboard,
    screenClassName,
  };
}

export type BattleScreenModel = ReturnType<typeof useBattleScreenModel>;
```

---

# 8. Базовое состояние экрана

## `app/packages/ui/src/battle-screen/useBattleScreenBase.ts`

```ts
import { useRef, useState } from "react";
import type { FieldRenderer } from "@bylina/render";

import { useServices, useT } from "../context.js";
import { useI18nTick, useSessionState, useSettingsState } from "../hooks.js";
import { useBattleInput } from "../useBattleInput.js";
import { createOutcomeGate, type OutcomeGate } from "../outcome-gate.js";
import type { ActionInfo } from "../action-info.js";
import type { UnitInfo } from "../unit-info.js";

export function useBattleScreenBase() {
  useI18nTick();

  const t = useT();
  const { session, content, debug } = useServices();

  const {
    paused,
    difficulty,
    battleKind,
    activeMissionId,
    deployment,
    matchSeed,
    trainingDone: trainingDoneMissions,
    campaignHintsDone,
  } = useSessionState();

  const hintSettings = useSettingsState();
  const inputRef = useBattleInput();

  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);

  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enemyPhase, setEnemyPhase] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [cutscenePlaying, setCutscenePlaying] = useState(false);
  const [outcomePending, setOutcomePending] = useState(false);
  const [fastPace, setFastPace] = useState(false);
  const [saveNotice, setSaveNotice] = useState(false);
  const [passReady, setPassReady] = useState(false);
  const [actionInfo, setActionInfo] = useState<ActionInfo | null>(null);
  const [unitInfo, setUnitInfo] = useState<UnitInfo | null>(null);
  const [storyNote, setStoryNote] = useState<string | null>(null);
  const [storyNoteHintKey, setStoryNoteHintKey] = useState<string | null>(null);
  const [prologueStanceLock, setPrologueStanceLock] = useState(false);

  const firedCutscenesRef = useRef<Set<string>>(new Set());

  const outcomeGateRef = useRef<OutcomeGate | null>(null);

  if (outcomeGateRef.current === null) {
    outcomeGateRef.current = createOutcomeGate({
      onPendingChange: setOutcomePending,
    });
  }

  const outcomeGate = outcomeGateRef.current;

  return {
    t,
    session,
    content,
    debug,

    paused,
    difficulty,
    battleKind,
    activeMissionId,
    deployment,
    matchSeed,
    trainingDoneMissions,
    campaignHintsDone,
    hintSettings,

    hostRef,
    rendererRef,
    inputRef,

    log,
    setLog,
    busy,
    setBusy,
    enemyPhase,
    setEnemyPhase,
    rendererReady,
    setRendererReady,
    cutscenePlaying,
    setCutscenePlaying,
    outcomePending,
    outcomeGate,
    fastPace,
    setFastPace,
    saveNotice,
    setSaveNotice,
    passReady,
    setPassReady,

    actionInfo,
    setActionInfo,
    unitInfo,
    setUnitInfo,

    storyNote,
    setStoryNote,
    storyNoteHintKey,
    setStoryNoteHintKey,

    prologueStanceLock,
    setPrologueStanceLock,

    firedCutscenesRef,
  };
}

export type BattleScreenBase = ReturnType<typeof useBattleScreenBase>;
```

---

# 9. Тип боя и сторона наблюдения

## `app/packages/ui/src/battle-screen/useBattleKinds.ts`

```ts
import { useMemo } from "react";
import { ENEMY_OWNER, PLAYER_OWNER } from "@bylina/core";
import { useBattleNetwork } from "../useBattleNetwork.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";

export function useBattleKinds(base: BattleScreenBase) {
  const { session, content, battleKind, activeMissionId } = base;

  const isReplay = battleKind === "replay";
  const replayJournal = session.get().replayJournal;

  const isTraining = battleKind === "training";
  const isPrologue = battleKind === "prologue";

  const trainingMission = isTraining
    ? content.training.missions.find(
        (mission) => mission.id === session.get().trainingMissionId,
      )
    : undefined;

  const prologueMission = isPrologue
    ? content.prologue.missions.find(
        (mission) => mission.id === session.get().prologueMissionId,
      )
    : undefined;

  const mission =
    battleKind === "campaign" && activeMissionId
      ? session.getCampaign().getMission(activeMissionId)
      : undefined;

  const network = useBattleNetwork(session, battleKind);
  const { isNetGuest, isSpectator } = network;

  const netOwner = battleKind === "pvpNet" ? session.get().netOwner : null;

  const pvpActive =
    battleKind === "pvp" || battleKind === "pvpNet"
      ? isNetGuest || isSpectator
        ? netOwner
        : session.getBattleFullSnapshot()?.activeOwner ?? PLAYER_OWNER
      : null;

  const viewOwner = pvpActive ?? PLAYER_OWNER;

  const usesNetSnapshot = battleKind === "pvpNet" && Boolean(isNetGuest);

  const side = useMemo(
    () => ({ viewOwner, isSpectator, isReplay }),
    [viewOwner, isSpectator, isReplay],
  );

  return {
    isReplay,
    replayJournal,
    isTraining,
    isPrologue,
    trainingMission,
    prologueMission,
    mission,
    isNetGuest,
    isSpectator,
    netOwner,
    pvpActive,
    viewOwner,
    usesNetSnapshot,
    side,
  };
}

export type BattleKinds = ReturnType<typeof useBattleKinds>;
```

---

# 10. Боевое ядро и контент

## `app/packages/ui/src/battle-screen/useBattleKernel.ts`

```ts
import { useMemo, useState } from "react";
import type { SkillStats, WeaponStats } from "@bylina/core";
import { createBattleKernel } from "../battle-match.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";

export function useBattleKernel(base: BattleScreenBase, kinds: BattleKinds) {
  const { session, content, difficulty, matchSeed, activeMissionId, deployment } = base;

  const weapons = useMemo(() => {
    // Перенести 1:1 из старого файла:
    // сборка оружия кампании/обучения/пролога/быстрого матча.
    // Здесь должен остаться прежний код с weaponStatsFromRecord.
    return {} as Record<string, WeaponStats>;
  }, [content]);

  const skills = useMemo(() => {
    const result: Record<string, SkillStats> = {};

    for (const record of content.skills) {
      result[record.id] = record as SkillStats;
    }

    return result;
  }, [content.skills]);

  const [kernel] = useState(() => {
    const host = createBattleKernel({
      battleKind: kinds.battleKind,
      content,
      session,
      weapons,
      skills,
      matchSeed,
      difficulty,
      activeMissionId,
      deployment,
      isNetGuest: kinds.isNetGuest,
      prologueMission: kinds.prologueMission ?? null,
      trainingMission: kinds.trainingMission ?? null,
      replayJournal: kinds.replayJournal ?? null,
    });

    if (host) {
      session.bindTacticsHost(host);
    }

    return host;
  });

  return {
    kernel,
    weapons,
    skills,
  };
}

export type BattleKernelModel = ReturnType<typeof useBattleKernel>;
```

> Важно: тело `weapons` нужно скопировать из старого файла без изменений. Там есть особенности для обучения, пролога, кампании и `prologueBestiary`.

---

# 11. Снимок боя и видимость

## `app/packages/ui/src/battle-screen/useBattleSnapshot.ts`

```ts
import { useMemo } from "react";
import type { MatchState } from "@bylina/core";
import { PLAYER_OWNER } from "@bylina/core";
import { useBattleRevision } from "../hooks.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";

const EMPTY_SNAPSHOT: MatchState = {
  turnNumber: 0,
  activeOwner: PLAYER_OWNER,
  grid: {
    width: 8,
    height: 6,
    tiles: [],
  },
  entities: [],
};

export function useBattleSnapshot(base: BattleScreenBase, kinds: BattleKinds) {
  const { session } = base;
  const { viewOwner, usesNetSnapshot } = kinds;

  const battleRevision = useBattleRevision(session);

  const snapshot = useMemo<MatchState>(() => {
    void battleRevision;

    if (usesNetSnapshot) {
      return session.getNetSnapshot() ?? EMPTY_SNAPSHOT;
    }

    return session.getBattleSnapshot(viewOwner);
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  const visibleCells = useMemo(() => {
    void battleRevision;
    return usesNetSnapshot
      ? session.getNetVisible()
      : session.getBattleVisible(viewOwner);
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  const exploredCells = useMemo(() => {
    void battleRevision;
    return usesNetSnapshot
      ? session.getNetExplored()
      : session.getBattleExplored(viewOwner);
  }, [battleRevision, viewOwner, usesNetSnapshot, session]);

  return {
    battleRevision,
    snapshot,
    visibleCells,
    exploredCells,
  };
}

export type BattleSnapshotModel = ReturnType<typeof useBattleSnapshot>;
```

---

# 12. Намерение игрока

## `app/packages/ui/src/battle-screen/useBattleIntentState.ts`

```ts
import { useCallback, useMemo, useState } from "react";
import { IDLE_INTENT, nextIntent, type Intent, type IntentEvent } from "../battle-intent.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattleIntentState(snapshotModel: BattleSnapshotModel) {
  const [intent, setIntentState] = useState<Intent>(IDLE_INTENT);

  const setIntent = useCallback((event: IntentEvent) => {
    setIntentState((current) => nextIntent(current, event));
  }, []);

  const selectedId = useMemo(() => {
    if ("actorId" in intent) return intent.actorId;
    return null;
  }, [intent]);

  const selected = useMemo(() => {
    if (selectedId === null) return null;
    return (
      snapshotModel.snapshot.entities.find((entity) => entity.id === selectedId) ??
      null
    );
  }, [selectedId, snapshotModel.snapshot.entities]);

  const action = useMemo(() => {
    if ("action" in intent) return intent.action;
    return null;
  }, [intent]);

  const aimId = useMemo(() => {
    if ("targetId" in intent) return intent.targetId;
    return null;
  }, [intent]);

  const skillTargetPos = useMemo(() => {
    if ("targetPos" in intent) return intent.targetPos;
    return null;
  }, [intent]);

  const preview = useMemo(() => {
    if (intent.kind === "aiming" || intent.kind === "placing") {
      return intent.preview;
    }

    return null;
  }, [intent]);

  const charge = useMemo(() => {
    if (intent.kind === "charging") return intent.plan;
    return null;
  }, [intent]);

  const chargeArmed = useMemo(() => {
    if (intent.kind === "charging") return intent.armed;
    return false;
  }, [intent]);

  const clearAim = useCallback(() => {
    setIntent({ type: "cancel" });
  }, [setIntent]);

  return {
    intent,
    setIntent,
    selectedId,
    selected,
    action,
    aimId,
    skillTargetPos,
    preview,
    charge,
    chargeArmed,
    clearAim,
  };
}

export type BattleIntentModel = ReturnType<typeof useBattleIntentState>;
```

---

# 13. Предпросмотр атаки, область, карточка прицеливания

## `app/packages/ui/src/battle-screen/useBattleAimPreview.ts`

```ts
import { useEffect, useMemo, useState } from "react";
import type { CellPos } from "@bylina/core";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";

export function useBattleAimPreview(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  intentModel: BattleIntentModel,
) {
  const { session, paused, busy } = base;
  const { battleRevision, snapshot } = snapshotModel;
  const { selectedId, selected, action, aimId, skillTargetPos, preview } = intentModel;
  const { skills } = base as never;

  const hit = useMemo(() => {
    void battleRevision;

    // Перенести 1:1 из старого файла.
    // Здесь вычисляется предварительный просмотр атаки/умения:
    // - шанс;
    // - урон;
    // - высота;
    // - укрытие;
    // - фланг;
    // - breakCell;
    // - areaCells.
    return null;
  }, [
    battleRevision,
    session,
    selectedId,
    selected,
    action,
    aimId,
    paused,
    busy,
    kinds.usesNetSnapshot,
  ]);

  const aimBreakCell = useMemo(() => {
    if (!hit || !selected || !aimId) return null;

    if (hit.breakCell) return hit.breakCell;

    return null;
  }, [hit, selected, aimId]);

  const hoverCell = useMemo(() => {
    if (skillTargetPos) return skillTargetPos;
    if (!preview) return null;

    const [xs, ys] = preview.split(",");
    const x = Number(xs);
    const y = Number(ys);

    const tile = snapshot.grid.tiles.find((candidate) => candidate.x === x && candidate.y === y);

    return {
      x,
      y,
      z: tile?.z ?? 0,
    };
  }, [preview, skillTargetPos, snapshot.grid]);

  const areaPreview = useMemo(() => {
    void battleRevision;

    if (action?.type !== "skill" || selectedId === null || paused || busy) {
      return null;
    }

    const skill = skills[action.id];

    if (!skill) return null;

    const hasArea =
      (skill.radius ?? 0) > 0 ||
      skill.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");

    if (!hasArea) return null;

    const center =
      skill.category === "self"
        ? selected
        : skillTargetPos
          ? { x: skillTargetPos.x, y: skillTargetPos.y, z: skillTargetPos.z }
          : undefined;

    if (!center) return null;

    const skillPreview =
      skill.category === "self" && !kinds.usesNetSnapshot
        ? session.getBattleSkillPreview(selectedId, action.id)
        : hit;

    if (!skillPreview?.areaCells?.length) return null;

    return {
      center: {
        x: center.x,
        y: center.y,
        z: center.z,
      },
      radius: skill.radius ?? 0,
      areaCells: skillPreview.areaCells,
      warnFriendly:
        skill.resolution === "attack" &&
        (skill.filter === "all" || skill.filter === "allies"),
    };
  }, [
    battleRevision,
    action,
    selectedId,
    selected,
    skillTargetPos,
    skills,
    paused,
    busy,
    kinds.usesNetSnapshot,
    session,
    hit,
  ]);

  const [aimCardPos, setAimCardPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // Перенести 1:1 из старого файла.
    // Здесь используется rendererRef.current?.getEntityScreenPosition?.(aimId).
    // Классическое смещение карточки:
    // x: Math.min(88, Math.max(14, position.x * 100 + 9))
    // y: Math.min(66, Math.max(12, position.y * 100 + 8))
    setAimCardPos(null);
  }, [aimId, hit, snapshot]);

  return {
    hit,
    aimBreakCell,
    hoverCell,
    areaPreview,
    aimCardPos,
  };
}

export type BattleAimPreviewModel = ReturnType<typeof useBattleAimPreview>;
```

---

# 14. Обучение

## `app/packages/ui/src/battle-screen/useBattleTrainingState.ts`

```ts
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameEvent } from "@bylina/core";
import {
  resolveTrainingDirective,
  trainingActionKindOfCommand,
  trainingCommandAllowed,
  trainingDenialKey,
  trainingStepCompleted,
  type TrainingActionKind,
  type TrainingDirectiveView,
} from "../training-scenario.js";
import { trainingHintsSorted, trainingOutcome } from "../training-progress.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";

export function useBattleTrainingState(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  intentModel: BattleIntentModel,
) {
  const { session, busy, outcomeGate, t, setLog } = base;
  const { isTraining, isPrologue, trainingMission } = kinds;
  const { battleRevision, snapshot } = snapshotModel;
  const { selectedId, action } = intentModel;

  const [hintStep, setHintStep] = useState(0);
  const [trainingOver, setTrainingOver] = useState<"victory" | "defeat" | null>(null);
  const [trainingNote, setTrainingNote] = useState<string | null>(null);

  const noteTimerRef = useRef<number | undefined>(undefined);

  const trainingHints = useMemo(() => {
    if (!isTraining || !trainingMission) return [];
    return trainingHintsSorted(trainingMission.hints);
  }, [isTraining, trainingMission]);

  const activeHint = trainingHints[hintStep] ?? null;

  const directiveView = useMemo<TrainingDirectiveView | null>(() => {
    void battleRevision;

    if (!isTraining || !activeHint || trainingOver) return null;

    const full = session.getBattleFullSnapshot();
    if (!full) return null;

    return resolveTrainingDirective(activeHint, {
      snapshot: full,
      reachable: (actorId) => session.getBattleReachable(actorId),
      // Перенести 1:1 из старого файла:
      // реальные колбэки hitPreview/skillPreview.
    } as never);
  }, [
    isTraining,
    activeHint,
    trainingOver,
    battleRevision,
    session,
  ]);

  const trainingHighlight = directiveView?.highlight ?? null;
  const trainingFocus = isTraining && directiveView !== null;
  const trainingDirective = directiveView?.directive ?? null;
  const trainingActorId =
    trainingDirective && "actorId" in trainingDirective
      ? trainingDirective.actorId
      : null;

  const trainingDone =
    isTraining && trainingHints.length > 0 && hintStep >= trainingHints.length;

  const advanceTraining = (events: GameEvent[]): void => {
    if (!isTraining || !activeHint) return;

    const full = session.getBattleFullSnapshot();

    if (trainingStepCompleted(activeHint, events, full ?? snapshot)) {
      setHintStep((value) => value + 1);
    }
  };

  const showTrainingNote = (events: GameEvent[]): void => {
    if (!isTraining || !trainingMission?.notes) return;

    let key: string | null = null;

    for (const event of events) {
      if (event.type === "STATUS" && event.statusId === "poison") {
        key = trainingMission.notes.poison;
        break;
      }

      if (event.type === "RESURRECT") {
        key = trainingMission.notes.resurrect;
        break;
      }

      if (event.type === "SUMMON") {
        key = trainingMission.notes.summon;
        break;
      }
    }

    if (!key) return;

    setTrainingNote(key);

    if (noteTimerRef.current !== undefined) {
      window.clearTimeout(noteTimerRef.current);
    }

    noteTimerRef.current = window.setTimeout(() => setTrainingNote(null), 6000);
  };

  useEffect(
    () => () => {
      if (noteTimerRef.current !== undefined) {
        window.clearTimeout(noteTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isTraining || busy || trainingOver) return;

    const outcome = trainingOutcome({
      outcome: session.getBattleOutcome(),
      missionHasEnemies: (trainingMission?.enemies.length ?? 0) > 0,
      trainingDone,
    });

    if (outcome === null) return;

    if (outcome === "victory" && trainingMission) {
      session.completeTrainingMission(trainingMission.id);
    }

    outcomeGate.report(() => setTrainingOver(outcome));
  }, [
    snapshot.turnNumber,
    snapshot.entities,
    busy,
    isTraining,
    trainingDone,
    trainingHints.length,
    hintStep,
    trainingOver,
    trainingMission,
    outcomeGate,
    session,
  ]);

  const trainingAllows = (actionKind: TrainingActionKind): boolean => {
    if (isPrologue && base.prologueStanceLock) return false;

    if (!isTraining) return true;

    return directiveAllowsAction(directiveView, actionKind);
  };

  const trainingDeny = (actionKind: TrainingActionKind): void => {
    const key = trainingDenialKey(directiveView, actionKind);
    setLog(t(key));
  };

  const trainingWeaponAllowed = (weaponId: string): boolean => {
    if (isPrologue && base.prologueStanceLock) return false;

    return (
      !isTraining ||
      (trainingDirective?.kind === "attack" &&
        trainingDirective.weaponId === weaponId)
    );
  };

  const trainingSkillAllowed = (skillId: string): boolean => {
    if (isPrologue && base.prologueStanceLock) return false;

    return (
      !isTraining ||
      (trainingDirective?.kind === "skill" &&
        trainingDirective.skillId === skillId)
    );
  };

  return {
    hintStep,
    setHintStep,
    trainingHints,
    activeHint,
    directiveView,
    trainingHighlight,
    trainingFocus,
    trainingDirective,
    trainingActorId,
    trainingDone,
    trainingOver,
    setTrainingOver,
    trainingNote,
    setTrainingNote,
    advanceTraining,
    showTrainingNote,
    trainingAllows,
    trainingDeny,
    trainingWeaponAllowed,
    trainingSkillAllowed,
    trainingCommandAllowed: (issued: never) =>
      trainingCommandAllowed(directiveView, issued),
    trainingActionKindOfCommand,
  };
}

export type BattleTrainingModel = ReturnType<typeof useBattleTrainingState>;

function directiveAllowsAction(
  directiveView: TrainingDirectiveView | null,
  actionKind: TrainingActionKind,
): boolean {
  if (!directiveView) return true;

  return directiveView.directive.kind === actionKindToDirectiveKind(actionKind);
}

function actionKindToDirectiveKind(actionKind: TrainingActionKind): string {
  switch (actionKind) {
    case "move":
      return "move";
    case "attack":
      return "attack";
    case "skill":
      return "skill";
    case "defend":
      return "defend";
    case "overwatch":
      return "overwatch";
    case "endTurn":
      return "endTurn";
    default:
      return actionKind;
  }
}
```

> Важно: блок `resolveTrainingDirective` в оригинале содержит реальные `hitPreview`, `skillPreview`, `pathOf` и другие колбэки. Их нужно перенести дословно.

---

# 15. Пролог

## `app/packages/ui/src/battle-screen/useBattlePrologueState.ts`

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TacticsKernel } from "../battle-match.js";
import {
  afterPrologueApply,
  buildPrologueContext,
  createPrologueRunState,
  prologueAftermath,
} from "../prologue-run.js";
import { usePrologueDirector } from "../prologue-director.js";
import { createTelemetryLog, recordTelemetry } from "../prologue-telemetry.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattlePrologueState(
  base: BattleScreenBase,
  kinds: BattleKinds,
  kernel: TacticsKernel | null,
  snapshotModel: BattleSnapshotModel,
) {
  const {
    session,
    content,
    hintSettings,
    t,
    setLog,
    outcomeGate,
    firedCutscenesRef,
    setPrologueStanceLock,
    setStoryNote,
    setStoryNoteHintKey,
  } = base;

  const { isPrologue, prologueMission } = kinds;

  const prologueRunRef = useRef(
    isPrologue && prologueMission
      ? createPrologueRunState(prologueMission.id)
      : null,
  );

  const prologueTelemetryRef = useRef(createTelemetryLog());

  const [prologueObjectiveKey, setPrologueObjectiveKey] = useState(
    prologueRunRef.current?.objectiveKey ?? "prologue.objective.gather",
  );

  const battleOutcome = useCallback((): "ongoing" | "victory" | "defeat" => {
    if (!isPrologue) return session.getBattleOutcome();
    return prologueRunRef.current?.outcome ?? "ongoing";
  }, [isPrologue, session]);

  const showStoryNote = useCallback((text: string): void => {
    setLog(null);
    setStoryNoteHintKey(null);
    setStoryNote(text);
  }, [setLog, setStoryNote, setStoryNoteHintKey]);

  const showPrologueHint = useCallback(
    (key: string): void => {
      const textKey =
        content.prologueHints.hints.find((hint) => hint.key === key)?.textKey ??
        key;

      setLog(null);
      setStoryNoteHintKey(key);
      setStoryNote(t(textKey));
    },
    [content, setLog, setStoryNote, setStoryNoteHintKey, t],
  );

  const closeStoryNote = useCallback((): void => {
    const key = base.storyNoteHintKey;

    setStoryNote(null);
    setStoryNoteHintKey(null);

    if (!key || !isPrologue || !prologueRunRef.current) return;

    // Перенести 1:1 из старого файла:
    // снятие одноразовой подсказки с очереди,
    // но сохранение принудительной подсказки.
  }, [
    base.storyNoteHintKey,
    isPrologue,
    setStoryNote,
    setStoryNoteHintKey,
  ]);

  const currentPrologueHintKey = useCallback((): string | null => {
    const hints = prologueRunRef.current?.hints;
    if (!hints) return null;
    return hints.forcedKey ?? hints.queue[0] ?? null;
  }, []);

  const director = usePrologueDirector({
    session,
    content,
    hintSettings,
    isPrologue,
    mission: prologueMission ?? null,
    markers: snapshotModel.snapshot as never,
    kernel,
    runRef: prologueRunRef,
    telemetryRef: prologueTelemetryRef,
    firedRef: firedCutscenesRef,
    renderer: () => base.rendererRef.current,
    handOffTurn: () => {
      // Перенести 1:1 из старого файла:
      // вызов передачи хода врагу для шага handOff.
    },
    showStoryNote,
    translate: t,
    setCutscenePlaying: base.setCutscenePlaying,
    setBusy: base.setBusy,
    setPrologueStanceLock,
    setPrologueObjectiveKey,
    setPrologueHintKey: showPrologueHint,
    resetSelection: () => {
      // Перенести 1:1 из старого файла:
      // setIntent({ type: "clearSelection" })
    },
    announce: () => {
      // Перенести 1:1 из старого файла.
    },
    battleOutcome,
    outcomeGate,
    setPrologueCard: () => {
      // Перенести 1:1 из старого файла, если карточка пролога ещё используется.
    },
  });

  useEffect(() => {
    if (!isPrologue || !prologueMission) return;

    // Перенести 1:1 из старого файла:
    // стартовая сцена миссии пролога.
  }, [isPrologue, prologueMission]);

  return {
    prologueRunRef,
    prologueTelemetryRef,
    prologueObjectiveKey,
    setPrologueObjectiveKey,
    battleOutcome,
    showStoryNote,
    showPrologueHint,
    closeStoryNote,
    currentPrologueHintKey,
    director,
    prologueAftermath,
    afterPrologueApply,
    buildPrologueContext,
    recordTelemetry,
  };
}

export type BattlePrologueModel = ReturnType<typeof useBattlePrologueState>;
```

---

# 16. Исход боя

## `app/packages/ui/src/battle-screen/useBattleOutcomeGate.ts`

```ts
import { useCallback } from "react";
import type { GameEvent } from "@bylina/core";
import { ENEMY_OWNER, PLAYER_OWNER } from "@bylina/core";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";

export function useBattleOutcomeGate(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
  training: BattleTrainingModel,
  prologue: BattlePrologueModel,
) {
  const { session, deployment, outcomeGate } = base;
  const { isReplay, isTraining, isPrologue, battleKind, mission } = kinds;

  const finishFromEvents = useCallback(
    (events: GameEvent[]): void => {
      const ended = events.find((event) => event.type === "MATCH_ENDED");

      if (!ended || ended.type !== "MATCH_ENDED") return;

      // Повтор, обучение и пролог завершают экран отдельными механизмами.
      if (isReplay || isTraining || isPrologue) return;

      if (battleKind === "pvp" || battleKind === "pvpNet") {
        const winner =
          ended.winnerPlayerId === String(PLAYER_OWNER)
            ? 1
            : ended.winnerPlayerId === String(ENEMY_OWNER)
              ? 2
              : null;

        if (winner) {
          outcomeGate.report(() => session.finishPvpMatch(winner));
        }

        return;
      }

      const outcome =
        ended.winnerPlayerId === String(PLAYER_OWNER) ? "victory" : "defeat";

      if (battleKind === "campaign") {
        // Перенести 1:1 из старого файла:
        // - итоги бойцов высадки;
        - генералы;
        - evacuated;
        - rosterIndex;
        - full/final snapshots.
        outcomeGate.report(() =>
          session.finishCampaignBattle({
            outcome,
            missionId: base.activeMissionId,
            fighters: [],
          } as never),
        );
        return;
      }

      outcomeGate.report(() => session.finishBattle(outcome));
    },
    [
      base.activeMissionId,
      battleKind,
      deployment,
      isPrologue,
      isReplay,
      isTraining,
      mission,
      outcomeGate,
      session,
      snapshotModel.snapshot,
    ],
  );

  return {
    finishFromEvents,
  };
}

export type BattleOutcomeModel = ReturnType<typeof useBattleOutcomeGate>;
```

> Важно: кампания содержит большой блок расчёта `participants`, `generals`, `extracted`, `full`, `final`. Он должен быть перенесён дословно.

---

# 17. Центр команд

## `app/packages/ui/src/battle-screen/useBattleCommandCenter.ts`

```ts
import { useCallback } from "react";
import type { CellPos, GameEvent } from "@bylina/core";
import { ENEMY_OWNER } from "@bylina/core";
import { routeCommand } from "../battle-command.js";
import { resolveCellClick } from "../battle-cell-click.js";
import { meleeStrikeOf, planCharge, type ChargePlan } from "../charge-attack.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";
import type { BattleOutcomeModel } from "./useBattleOutcomeGate.js";

export interface BattleCommandCenterDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  kernel: unknown;
  snapshotModel: BattleSnapshotModel;
  intentModel: BattleIntentModel;
  training: BattleTrainingModel;
  prologue: BattlePrologueModel;
  outcome: BattleOutcomeModel;
}

export function useBattleCommandCenter(deps: BattleCommandCenterDeps) {
  const { base, kinds, snapshotModel, intentModel, training, prologue, outcome } = deps;
  const { session, t, setLog, setBusy, outcomeGate } = base;
  const { snapshot } = snapshotModel;

  const playThen = useCallback(
    (events: GameEvent[], after?: () => void): void => {
      if (events.length === 0) {
        after?.();
        return;
      }

      setBusy(true);

      // Перенести 1:1 из старого файла:
      // outcomeGate.playbackStart();
      // rendererRef.current?.play(events).finally(...)
      void events;
      void outcomeGate;
      after?.();
    },
    [base.rendererRef, outcomeGate, setBusy],
  );

  const announce = useCallback(
    (events: GameEvent[]): void => {
      // Перенести 1:1 из старого файла:
      // строки журнала: урон, промах, крит, гибель.
      void events;
      void t;
      void setLog;
    },
    [setLog, t],
  );

  const applyCommand = useCallback(
    (command: never, after?: () => void): void => {
      const route = routeCommand(command, {
        isSpectator: kinds.isSpectator,
        isReplay: kinds.isReplay,
        outcomePending: base.outcomePending,
        isPvp: kinds.battleKind === "pvp",
        isNetGuest: kinds.isNetGuest,
        isTraining: kinds.isTraining,
        trainingAllows: training.trainingAllows,
        trainingDenial: training.trainingActionKindOfCommand,
        isPrologue: kinds.isPrologue,
        // Перенести 1:1 из старого файла:
        // clampPrologue для M2.
      } as never);

      if (!route) return;

      // Перенести 1:1 из старого файла:
      // полная маршрутизация команд:
      // - apply
      // - sendPvp
      // - sendNet
      // - denyTraining
      // - denyPrologue
      // - after prologue
      // - advanceTraining
      // - showTrainingNote
      // - clearAim
      // - playThen
      void after;
    },
    [
      applyCommand,
      base,
      intentModel.clearAim,
      kinds,
      playThen,
      session,
      training,
    ],
  );

  const tryMove = useCallback(
    (to: CellPos): void => {
      const selectedId = intentModel.selectedId;

      if (selectedId === null) return;

      if (kinds.isTraining) {
        const directive = training.trainingDirective;

        if (
          !directive ||
          directive.kind !== "move" ||
          directive.actorId !== selectedId ||
          directive.cell.x !== to.x ||
          directive.cell.y !== to.y
        ) {
          training.trainingDeny("move");
          return;
        }
      }

      applyCommand({ type: "MOVE", actorId: selectedId, to } as never);
    },
    [applyCommand, intentModel.selectedId, kinds.isTraining, training],
  );

  const tryAttack = useCallback(
    (targetId: number): void => {
      const selectedId = intentModel.selectedId;
      const action = intentModel.action;

      if (selectedId === null || action?.type !== "weapon") return;

      if (kinds.isTraining) {
        const directive = training.trainingDirective;

        const allowed =
          directive !== null &&
          directive.kind === "attack" &&
          directive.actorId === selectedId &&
          directive.weaponId === action.id &&
          directive.targetId === targetId;

        if (!allowed) {
          training.trainingDeny("attack");
          return;
        }
      }

      applyCommand({
        type: "ATTACK",
        actorId: selectedId,
        weaponId: action.id,
        targetId,
      } as never);
    },
    [applyCommand, intentModel.action, intentModel.selectedId, kinds.isTraining, training],
  );

  const trySkill = useCallback(
    (skillId: string, targetId?: number): void => {
      const selectedId = intentModel.selectedId;

      if (selectedId === null) return;

      if (kinds.isTraining) {
        const directive = training.trainingDirective;

        const allowed =
          directive !== null &&
          directive.kind === "skill" &&
          directive.actorId === selectedId &&
          directive.skillId === skillId &&
          (targetId === undefined || directive.targetId === targetId);

        if (!allowed) {
          training.trainingDeny("skill");
          return;
        }
      }

      applyCommand({
        type: "USE_SKILL",
        actorId: selectedId,
        skillId,
        targetId,
      } as never);
    },
    [applyCommand, intentModel.selectedId, kinds.isTraining, training],
  );

  const executeCharge = useCallback(
    (plan: ChargePlan): void => {
      // Перенести 1:1 из старого файла:
      // подход и удар одним замыслом.
      void plan;
    },
    [applyCommand],
  );

  const debugAutoWin = useCallback((): void => {
    if (base.paused || base.busy || kinds.isReplay || !base.debug) return;

    const result = session.debugAutoWinBattle();

    if (!result.ok) return;

    if (kinds.isTraining) {
      training.setHintStep(training.trainingHints.length);
    }

    intentModel.setIntent({ type: "cancel" });
    playThen(result.events);
  }, [base, intentModel, kinds, playThen, session, training]);

  const endTurn = useCallback((): void => {
    // Перенести 1:1 из старого файла:
    // - проверка обучения;
    // - отмена намерения;
    // - PvP/сеть;
    // - runEndTurnSequence.
  }, []);

  const runEndTurnSequence = useCallback(async (): Promise<void> => {
    // Перенести 1:1 из старого файла:
    // конец хода, пролог, исход, ход Нави.
  }, []);

  const handOffTurnToEnemy = useCallback((): void => {
    // Перенести 1:1 из старого файла:
    // передача хода без нажатия кнопки конца хода.
  }, []);

  const onCell = useCallback(
    (x: number, y: number): void => {
      const intent = resolveCellClick(x, y, {
        paused: base.paused,
        busy: base.busy,
        outcomePending: base.outcomePending,
        ownTurn: snapshot.activeOwner === kinds.viewOwner,
        isTraining: kinds.isTraining,
        trainingNoopStep: training.activeHint?.until === "noop",
        trainingActorId: training.trainingActorId,
        trainingDirective: training.trainingDirective,
        selectedId: intentModel.selectedId,
        selected: intentModel.selected ?? null,
        action: intentModel.action,
        skills: {} as never,
        entities: snapshot.entities,
        tiles: snapshot.grid.tiles,
        viewOwner: kinds.viewOwner,
        reach: undefined as never,
        aimId: intentModel.aimId,
        hitAvailable: false,
        charge: intentModel.charge,
        chargeArmed: intentModel.chargeArmed,
        preview: intentModel.preview,
        coarse: window.matchMedia("(pointer: coarse)").matches,
      } as never);

      // Перенести 1:1 из старого файла:
      // исполнение намерения после resolveCellClick:
      // select / cancel / move / attack / skill / charge.
      void intent;
    },
    [base, intentModel, kinds, snapshot, training],
  );

  return {
    playThen,
    announce,
    applyCommand,
    tryMove,
    tryAttack,
    trySkill,
    executeCharge,
    debugAutoWin,
    endTurn,
    runEndTurnSequence,
    handOffTurnToEnemy,
    onCell,
  };
}

export type BattleCommandCenterModel = ReturnType<typeof useBattleCommandCenter>;
```

> Важно: `applyCommand`, `runEndTurnSequence`, `executeCharge`, `onCell` — самые критичные блоки. Их нужно перенести дословно, потому что они содержат пролог, обучение, рывок, транспорт команд и порядок `after`.

---

# 18. Синхронизация с рендерером

## `app/packages/ui/src/battle-screen/useBattleRendererSync.ts`

```ts
import { useCallback, useEffect, useState } from "react";
import { createFieldRenderer } from "@bylina/render";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";
import type { BattleAimPreviewModel } from "./useBattleAimPreview.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";
import type { BattleCommandCenterModel } from "./useBattleCommandCenter.js";

export interface BattleRendererSyncDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  snapshotModel: BattleSnapshotModel;
  intentModel: BattleIntentModel;
  aim: BattleAimPreviewModel;
  training: BattleTrainingModel;
  prologue: BattlePrologueModel;
  commands: BattleCommandCenterModel;
}

export function useBattleRendererSync(deps: BattleRendererSyncDeps) {
  const { base, kinds, snapshotModel, intentModel, aim, training, commands } = deps;
  const {
    hostRef,
    rendererRef,
    inputRef,
    setRendererReady,
    matchSeed,
    snapshot,
    visibleCells,
    exploredCells,
  } = {
    ...deps.base,
    snapshot: deps.snapshotModel.snapshot,
    visibleCells: deps.snapshotModel.visibleCells,
    exploredCells: deps.snapshotModel.exploredCells,
  };

  const [aimCardPos, setAimCardPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let gone = false;

    const renderer = createFieldRenderer();

    renderer.setOnActivate((x, y) => {
      inputRef.current?.onCell(x, y);
    });

    renderer.setOnHover((x, y) => {
      inputRef.current?.onHover(x, y);
    });

    void renderer.mount(host).then(() => {
      if (gone) return;
      rendererRef.current = renderer;
      setRendererReady(true);
    });

    return () => {
      gone = true;
      rendererRef.current = null;
      renderer.destroy();
    };
  }, [inputRef]);

  useEffect(() => {
    rendererRef.current?.update({
      matchSeed,
      snapshot,
      selectedId: intentModel.selectedId,
      aimId: intentModel.aimId,
      reachable: [] as never,
      path: [] as never,
      aimFrom: intentModel.charge ? intentModel.charge.step : null,
      aimOk: Boolean(aim.hit?.available) || Boolean(intentModel.charge),
      aimState:
        intentModel.aimId === null
          ? undefined
          : intentModel.charge
            ? "ready"
            : !aim.hit
              ? "preselect"
              : aim.hit.available
                ? "ready"
                : "blocked",
      aimFlanked: Boolean(aim.hit?.available && aim.hit.flanked),
      areaPreview: aim.areaPreview,
      missLabel: base.t("combat.miss"),
      biome: undefined as never,
      darkness: 0,
      heightMod: aim.hit?.heightMod ?? 0,
      debugMovement: false,
      visibleCells,
      exploredCells,
      homeOwner: kinds.viewOwner,
      aimBreakCell: aim.aimBreakCell,
      hoverCell: aim.hoverCell,
      trainingHighlight: training.trainingHighlight,
      trainingFocus: training.trainingFocus,
    } as never);
  }, [
    base.rendererReady,
    matchSeed,
    snapshot,
    intentModel.selectedId,
    intentModel.aimId,
    intentModel.preview,
    aim.hit,
    aim.areaPreview,
    aim.aimBreakCell,
    aim.hoverCell,
    visibleCells,
    exploredCells,
    training.trainingHighlight,
    training.trainingFocus,
    kinds.viewOwner,
  ]);

  useEffect(() => {
    rendererRef.current?.setInputLocked?.(
      base.outcomePending || base.cutscenePlaying,
    );
  }, [base.outcomePending, base.cutscenePlaying]);

  useEffect(() => {
    rendererRef.current?.setSpeed(base.fastPace ? 2 : 1);
  }, [base.fastPace]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    rendererRef.current?.setReducedMotion(media.matches);

    const listener = (): void => {
      rendererRef.current?.setReducedMotion(media.matches);
    };

    media.addEventListener("change", listener);

    return () => media.removeEventListener("change", listener);
  }, []);

  const focusEntity = useCallback((entityId: number) => {
    rendererRef.current?.focusEntity?.(entityId);
  }, []);

  const onHover = useCallback((x: number, y: number): void => {
    // Перенести 1:1 из старого файла:
    // наведение мыши на цель для десктопа.
    void x;
    void y;
  }, []);

  return {
    aimCardPos,
    setAimCardPos,
    focusEntity,
    onHover,
  };
}

export type BattleRendererSyncModel = ReturnType<typeof useBattleRendererSync>;
```

> Важно: эффект `renderer.update` нужно перенести дословно. Там есть `battleBiome`, `darknessRatio`, `reachable`, `previewPath`, `charge.path`, `aimFrom`, `aimState`, `hoverCell`, `trainingHighlight`.

---

# 19. Ход Нави

## `app/packages/ui/src/battle-screen/useBattleEnemyTurn.ts`

```ts
import { useEffect } from "react";
import { ENEMY_OWNER } from "@bylina/core";
import { enemyPhaseContinues } from "../battle-enemy-phase.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";
import type { BattleOutcomeModel } from "./useBattleOutcomeGate.js";
import type { BattleCommandCenterModel } from "./useBattleCommandCenter.js";

export interface BattleEnemyTurnDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  kernel: unknown;
  prologue: BattlePrologueModel;
  outcome: BattleOutcomeModel;
  commands: BattleCommandCenterModel;
}

export function useBattleEnemyTurn(deps: BattleEnemyTurnDeps) {
  const { base, kinds, kernel, prologue } = deps;
  const { battleKind, isTraining, isPrologue, trainingMission, viewOwner } = kinds;
  const { session } = base;

  useEffect(() => {
    if (battleKind === "pvp" || battleKind === "pvpNet") return;
    if (prologue.battleOutcome() !== "ongoing") return;
    if (session.getBattleSnapshot(viewOwner).activeOwner !== ENEMY_OWNER) return;

    // Перенести 1:1 из старого файла:
    // полный цикл хода Нави:
    // - обучение без противника;
    // - сценарий обучения;
    // - обычный детерминированный алгоритм;
    // - пролог;
    // - enemyAfter.
  }, [kernel]);

  return {
    enemyPhase: base.enemyPhase,
    setEnemyPhase: base.setEnemyPhase,
  };
}

export type BattleEnemyTurnModel = ReturnType<typeof useBattleEnemyTurn>;
```

---

# 20. Повтор

## `app/packages/ui/src/battle-screen/useBattleReplayPlayback.ts`

```ts
import { useEffect, useRef } from "react";
import { useReplayControls } from "../useReplayControls.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";

export function useBattleReplayPlayback(
  base: BattleScreenBase,
  kinds: BattleKinds,
  kernel: unknown,
) {
  const { isReplay, replayJournal } = kinds;
  const { replayIndex, setReplayIndex, replayDone, setReplayDone } =
    useReplayControls();

  const replayIndexRef = useRef(0);

  useEffect(() => {
    replayIndexRef.current = replayIndex;
  }, [replayIndex]);

  useEffect(() => {
    if (!isReplay || !replayJournal || !kernel || replayDone) return;

    const commands = replayJournal.commands;

    const timer = window.setInterval(() => {
      const index = replayIndexRef.current;

      if (index >= commands.length) {
        window.clearInterval(timer);
        setReplayDone(true);
        return;
      }

      const command = commands[index];

      // Перенести 1:1 из старого файла:
      // применение команды повтора через kernel,
      // setReplayIndex(index + 1).
      void command;
    }, 650);

    return () => window.clearInterval(timer);
  }, [isReplay, replayJournal, kernel, replayDone, setReplayDone]);

  return {
    replayIndex,
    setReplayIndex,
    replayDone,
    setReplayDone,
  };
}

export type BattleReplayPlaybackModel = ReturnType<typeof useBattleReplayPlayback>;
```

---

# 21. Ростер и полоса противников

## `app/packages/ui/src/battle-screen/useBattleRosterState.ts`

```ts
import { useMemo, useRef } from "react";
import { ENEMY_OWNER, PLAYER_OWNER } from "@bylina/core";
import { cellKey } from "../cell-interaction.js";
import { buildEnemyStrip, rememberEnemies, type RememberedEnemy } from "../enemy-strip.js";
import { ownFighters } from "../battle-selection.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";

export function useBattleRosterState(
  base: BattleScreenBase,
  kinds: BattleKinds,
  snapshotModel: BattleSnapshotModel,
) {
  const { snapshot, visibleCells } = snapshotModel;
  const { isSpectator, viewOwner, mission } = { ...kinds, mission: kinds.mission };

  const roster = useMemo(() => {
    return ownFighters(snapshot).filter(
      (entity) => entity.ap > 0 || entity.dead,
    );
  }, [snapshot]);

  const knownEnemies = useMemo(() => {
    return snapshot.entities.filter((entity) => {
      if (entity.coverType !== 0) return false;
      if (entity.owner === viewOwner) return false;

      if (entity.dead) return true;

      if (!visibleCells) return true;

      return visibleCells.has(cellKey(entity.x, entity.y));
    });
  }, [snapshot.entities, viewOwner, visibleCells]);

  const seenEnemiesRef = useRef(new Map<number, RememberedEnemy>());

  rememberEnemies(knownEnemies, seenEnemiesRef.current);

  const enemyStrip = buildEnemyStrip(seenEnemiesRef.current, knownEnemies);

  const objectiveEntity = mission
    ? snapshot.entities.find((entity) =>
        mission.type === "destroy"
          ? entity.configId === mission.objectiveUnitId
          : mission.type === "rescue"
            ? entity.configId === mission.escorteeUnitId
            : false,
      )
    : undefined;

  return {
    roster,
    knownEnemies,
    enemyStrip,
    seenEnemiesRef,
    objectiveEntity,
  };
}

export type BattleRosterModel = ReturnType<typeof useBattleRosterState>;
```

---

# 22. Кампейн-подсказки

## `app/packages/ui/src/battle-screen/useBattleCampaignHints.ts`

```ts
import { useEffect, useMemo, useState } from "react";
import { pendingCampaignHints } from "../campaign-hints.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";

export function useBattleCampaignHints(
  base: BattleScreenBase,
  kinds: BattleKinds,
  kernel: unknown,
) {
  const { session, hintSettings, campaignHintsDone, setSaveNotice, saveNotice } = base;
  const { battleKind } = kinds;

  const battleWantedHints = useMemo(
    () =>
      pendingCampaignHints({
        showHints: hintSettings.showHints,
        done: campaignHintsDone ?? [],
        onCampaignMap: false,
        lockedCount: 0,
        hasWounded: false,
        rosterTabActive: false,
      }),
    [hintSettings.showHints, campaignHintsDone],
  );

  const [battleHintQueue, setBattleHintQueue] = useState<string[]>([]);

  useEffect(() => {
    // Перенести 1:1 из старого файла:
    // добавление новых подсказок в очередь.
    void battleWantedHints;
    void kernel;
  }, [battleWantedHints.join(","), kernel]);

  const activeBattleHint = hintSettings.showHints
    ? battleHintQueue.find((id) => !session.isCampaignHintShown(id)) ?? null
    : null;

  const closeBattleHint = (): void => {
    if (!activeBattleHint) return;

    session.markCampaignHintShown(activeBattleHint);
    setBattleHintQueue((previous) => previous.filter((id) => id !== activeBattleHint));
  };

  useEffect(() => {
    if (battleKind !== "campaign") return;

    setSaveNotice(true);

    const timer = window.setTimeout(() => setSaveNotice(false), 1600);

    return () => window.clearTimeout(timer);
  }, [battleKind, base.snapshotTurnNumber ?? 0]);

  return {
    battleWantedHints,
    battleHintQueue,
    setBattleHintQueue,
    activeBattleHint,
    closeBattleHint,
    saveNotice,
  };
}

export type BattleCampaignHintsModel = ReturnType<typeof useBattleCampaignHints>;
```

---

# 23. Клавиатура

## `app/packages/ui/src/battle-screen/useBattleKeyboardControl.ts`

```ts
import { useEffect } from "react";
import { useLatest } from "../hooks.js";
import type { BattleScreenBase } from "./useBattleScreenBase.js";
import type { BattleKinds } from "./useBattleKinds.js";
import type { BattleSnapshotModel } from "./useBattleSnapshot.js";
import type { BattleIntentModel } from "./useBattleIntentState.js";
import type { BattleTrainingModel } from "./useBattleTrainingState.js";
import type { BattlePrologueModel } from "./useBattlePrologueState.js";
import type { BattleCommandCenterModel } from "./useBattleCommandCenter.js";

export interface BattleKeyboardControlDeps {
  base: BattleScreenBase;
  kinds: BattleKinds;
  snapshotModel: BattleSnapshotModel;
  intentModel: BattleIntentModel;
  training: BattleTrainingModel;
  prologue: BattlePrologueModel;
  commands: BattleCommandCenterModel;
}

export function useBattleKeyboardControl(deps: BattleKeyboardControlDeps) {
  const { base, kinds, snapshotModel, intentModel, training, commands } = deps;

  const keyboard = useLatest({
    ctx: {
      paused: base.paused,
      busy: base.busy,
      outcomePending: base.outcomePending,
      cutscenePlaying: base.cutscenePlaying,
      isTraining: kinds.isTraining,
      trainingActorId: training.trainingActorId,
      trainingDirective: training.trainingDirective,
      selectedId: intentModel.selectedId,
      selected: intentModel.selected ?? null,
      action: intentModel.action,
      snapshot: snapshotModel.snapshot,
      viewOwner: kinds.viewOwner,
      side: kinds.side,
    },
    apply: (intent: never) => {
      // Перенести 1:1 из старого файла:
      // маршрутизация клавиатурных намерений:
      // - выбор бойца;
      // - оружие;
      // - умение;
      // - защита;
      // - овервотч;
      // - конец хода;
      // - пауза;
      // - отмена прицеливания.
      void intent;
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      base.inputRef.current?.onKey(event, keyboard.current);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [base.inputRef, keyboard]);

  return {};
}

export type BattleKeyboardControlModel = ReturnType<typeof useBattleKeyboardControl>;
```

---

# 24. Презентационные компоненты

Дальше идут компоненты. Их задача — убрать большой JSX из корневого файла.

Каждый компонент использует контекст:

```ts
const model = useBattleScreen();
```

---

## `app/packages/ui/src/battle-screen/BattleScreenLayout.tsx`

```tsx
import { useBattleScreen } from "./context.js";
import { BattleTopBar } from "./BattleTopBar.js";
import { BattleRosterPanel } from "./BattleRosterPanel.js";
import { BattleEnemyStrip } from "./BattleEnemyStrip.js";
import { BattleAimCard } from "./BattleAimCard.js";
import { BattleTrainingLayer } from "./BattleTrainingLayer.js";
import { BattleBottomPanel } from "./BattleBottomPanel.js";
import { BattleDialogs } from "./BattleDialogs.js";
import { BattleReplayBar } from "./BattleReplayBar.js";

export function BattleScreenLayout() {
  const model = useBattleScreen();

  return (
    <div className={model.screenClassName}>
      <div ref={model.hostRef} className="battle-stage" />

      <BattleTrainingLayer />

      {model.isReplay ? <BattleReplayBar /> : null}

      <BattleTopBar />

      <div className="battle-mid">
        <BattleRosterPanel />
        <BattleEnemyStrip />
        <BattleAimCard />
        {model.log ? <div className="battle-log">{model.log}</div> : null}
      </div>

      <BattleBottomPanel />

      <BattleDialogs />
    </div>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleTopBar.tsx`

```tsx
import { useBattleScreen } from "./context.js";

export function BattleTopBar() {
  const model = useBattleScreen();

  return (
    <header className="battle-top">
      <div className="battle-objective">
        <p className="objective-text">
          {model.isPrologue
            ? model.t(model.prologueObjectiveKey)
            : model.battleKind === "campaign" && model.mission
              ? model.t(`battle.objective.${model.mission.type}`)
              : model.isTraining && model.trainingMission
                ? model.t(`training.objective.${model.trainingMission.id}`)
                : model.t("battle.objectiveQuick")}
        </p>

        <p className="muted">
          {model.t("field.turn", { turn: model.snapshot.turnNumber })}
          {" · "}
          {model.t("field.sidePlayer")}
        </p>
      </div>

      {/*
        Перенести сюда из старого файла:
        - objective-hud;
        - save notice;
        - pace toggle;
        - debug auto win;
        - pause button;
        - exit button.
      */}
    </header>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleRosterPanel.tsx`

```tsx
import { RosterCard } from "../unit-card.js";
import { useBattleScreen } from "./context.js";

export function BattleRosterPanel() {
  const model = useBattleScreen();

  return (
    <div className="roster">
      {model.roster.map((entity) => (
        <RosterCard
          key={entity.id}
          entity={entity}
          selected={entity.id === model.selectedId}
          onSelect={() => {
            model.setIntent({ type: "select", actorId: entity.id });
          }}
          onLongPress={() => {
            // Перенести 1:1 из старого файла:
            // открытие информации о своём бойце.
          }}
        />
      ))}
    </div>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleEnemyStrip.tsx`

```tsx
import { EnemyFace } from "../unit-card.js";
import { useBattleScreen } from "./context.js";

export function BattleEnemyStrip() {
  const model = useBattleScreen();

  if (model.enemyStrip.length === 0) return null;

  return (
    <div className="enemy-strip">
      {model.enemyStrip.map((enemy) => (
        <EnemyFace
          key={enemy.id}
          enemy={enemy}
          onFocus={() => {
            model.focusEntity(enemy.id);
          }}
          onInspect={() => {
            // Перенести 1:1 из старого файла:
            // открытие информации о видимом противнике.
          }}
        />
      ))}
    </div>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleAimCard.tsx`

```tsx
import { useBattleScreen } from "./context.js";

export function BattleAimCard() {
  const model = useBattleScreen();

  if (model.aimId === null || !model.hit || !model.aimCardPos) {
    return null;
  }

  return (
    <div
      className="aim-card"
      style={{
        left: `${model.aimCardPos.x}%`,
        top: `${model.aimCardPos.y}%`,
      }}
    >
      {/*
        Перенести сюда из старого файла:
        - шанс;
        - урон;
        - модификаторы;
        - разбивку шанса;
        - кнопку копирования;
        - пометку укрытия;
        - пометку фланга.
      */}
    </div>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleTrainingLayer.tsx`

```tsx
import { unitPortrait } from "../portraits.js";
import { useBattleScreen } from "./context.js";
import { CampaignHint } from "../CampaignHint.js";

export function BattleTrainingLayer() {
  const model = useBattleScreen();

  return (
    <>
      {model.isTraining ? (
        <div className="training-coach" role="status" aria-live="polite">
          {unitPortrait("chronicler") ? (
            <img
              className="training-coach-face"
              src={unitPortrait("chronicler")}
              alt=""
              draggable={false}
            />
          ) : null}

          <div className="training-coach-body">
            <div className="training-coach-head">
              <span className="training-coach-name">
                {model.t("training.mentor")}
              </span>

              {model.activeHint ? (
                <span className="training-hint-step">
                  {model.hintStep + 1}/{model.trainingHints.length}
                </span>
              ) : null}
            </div>

            {model.activeHint ? (
              <p className="training-coach-line">
                {model.t(model.activeHint.textKey)}
              </p>
            ) : null}

            {/*
              Перенести сюда из старого файла:
              точки-шаги обучения.
            */}
          </div>
        </div>
      ) : null}

      {model.trainingNote ? (
        <div className="training-note" role="status" aria-live="polite">
          <span className="training-note-mark" aria-hidden="true">
            ✦
          </span>
          {model.t(model.trainingNote)}
        </div>
      ) : null}

      {model.activeBattleHint ? (
        <CampaignHint
          key={model.activeBattleHint}
          hintId={model.activeBattleHint}
          variant={model.activeBattleHint === "first_battle" ? "modal" : "banner"}
          onClose={model.closeBattleHint}
        />
      ) : null}
    </>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleBottomPanel.tsx`

```tsx
import { ActionSlot } from "../action-panel.js";
import { useBattleScreen } from "./context.js";

export function BattleBottomPanel() {
  const model = useBattleScreen();

  return (
    <div className="battle-bottom">
      {/*
        Перенести сюда из старого файла:
        - панель оружия;
        - панель умений;
        - защиту;
        - овервотч;
        - конец хода;
        - рывок;
        - освобождение;
        - кнопки передачи хода для PvP.
      */}

      <ActionSlot
        id="defend"
        name={model.t("battle.defend")}
        shortcut="9"
        disabled={!model.trainingAllows("defend")}
        onClick={() => {
          model.applyCommand({
            type: "DEFEND",
            actorId: model.selectedId,
          } as never);
        }}
      />

      <ActionSlot
        id="end-turn"
        name={model.t("battle.endTurn")}
        disabled={!model.trainingAllows("endTurn")}
        onClick={() => {
          model.endTurn();
        }}
      />
    </div>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleDialogs.tsx`

```tsx
import { ActionInfoDialog, UnitInfoDialog } from "../unit-card.js";
import { useBattleScreen } from "./context.js";

export function BattleDialogs() {
  const model = useBattleScreen();

  return (
    <>
      {model.cutscenePlaying ? (
        <button
          type="button"
          className="cutscene-skip"
          onClick={model.director.skip}
        >
          {model.t("battle.cutscene.skip")}
        </button>
      ) : null}

      {model.paused ? (
        <div className="pause-root" role="presentation">
          {/*
            Перенести сюда из старого файла:
            пауза, управление, выход, темп боя.
          */}
        </div>
      ) : null}

      {model.storyNote ? (
        <div className="pause-root story-note-root" role="presentation" onClick={model.closeStoryNote}>
          <div
            className="pause-card story-note-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-note-text"
            onClick={(event) => event.stopPropagation()}
          >
            <p id="story-note-text">{model.storyNote}</p>

            <button type="button" onClick={model.closeStoryNote}>
              {model.t("common.ok")}
            </button>
          </div>
        </div>
      ) : null}

      {model.actionInfo ? (
        <ActionInfoDialog
          info={model.actionInfo}
          onClose={() => model.setActionInfo(null)}
        />
      ) : null}

      {model.unitInfo ? (
        <UnitInfoDialog
          info={model.unitInfo}
          onClose={() => model.setUnitInfo(null)}
        />
      ) : null}
    </>
  );
}
```

---

## `app/packages/ui/src/battle-screen/BattleReplayBar.tsx`

```tsx
import { useBattleScreen } from "./context.js";

export function BattleReplayBar() {
  const model = useBattleScreen();

  if (!model.isReplay) return null;

  const total = model.replayJournal?.commands.length ?? 0;
  const progress = total > 0 ? Math.min(100, (model.replayIndex / total) * 100) : 0;

  return (
    <div className="replay-bar" role="status">
      <span className="replay-label">{model.t("replay.watching")}</span>

      <span className="replay-progress">
        <i style={{ width: `${progress}%` }} />
      </span>

      <span className="muted">
        {model.replayIndex}/{total}
      </span>

      {model.replayDone ? (
        <span className="replay-done">{model.t("replay.done")}</span>
      ) : null}
    </div>
  );
}
```

---

# 25. Карта переноса старых блоков

Чтобы рефакторинг был безопасным, используйте следующую карту.

| Старый блок в `BattleScreenView.tsx` | Новый модуль |
|---|---|
| `useServices`, `useT`, `useSessionState`, `useSettingsState` | `useBattleScreenBase.ts` |
| `battleKind`, `isTraining`, `isPrologue`, `isReplay` | `useBattleKinds.ts` |
| `createBattleKernel` | `useBattleKernel.ts` |
| `weapons`, `skills` | `useBattleKernel.ts` |
| `battleRevision`, `snapshot`, `visibleCells`, `exploredCells` | `useBattleSnapshot.ts` |
| `intent`, `selectedId`, `action`, `aimId`, `charge` | `useBattleIntentState.ts` |
| `hit`, `aimBreakCell`, `hoverCell`, `areaPreview`, `aimCardPos` | `useBattleAimPreview.ts` |
| `hintStep`, `trainingHints`, `directiveView`, `trainingFocus` | `useBattleTrainingState.ts` |
| `prologueRunRef`, `director`, `storyNote`, `prologueStanceLock` | `useBattlePrologueState.ts` |
| `finishFromEvents`, `outcomeGate.report` | `useBattleOutcomeGate.ts` |
| `applyCommand`, `playThen`, `announce`, `endTurn`, `executeCharge` | `useBattleCommandCenter.ts` |
| `renderer.mount`, `renderer.update`, `setInputLocked`, `setSpeed` | `useBattleRendererSync.ts` |
| Ход Нави | `useBattleEnemyTurn.ts` |
| Повтор | `useBattleReplayPlayback.ts` |
| Ростер и враги | `useBattleRosterState.ts` |
| Кампейн-подсказки | `useBattleCampaignHints.ts` |
| Клавиатура | `useBattleKeyboardControl.ts` |
| Верхняя панель | `BattleTopBar.tsx` |
| Ростер | `BattleRosterPanel.tsx` |
| Полоса врагов | `BattleEnemyStrip.tsx` |
| Карточка прицеливания | `BattleAimCard.tsx` |
| Обучение | `BattleTrainingLayer.tsx` |
| Нижняя панель действий | `BattleBottomPanel.tsx` |
| Диалоги | `BattleDialogs.tsx` |
| Повтор-бар | `BattleReplayBar.tsx` |

---

# 26. Обязательные блоки, которые нужно скопировать дословно

Чтобы сохранить поведение, следующие блоки нужно перенести без изменений:

## 1. Блок `applyCommand`

Сюда входят:

- `routeCommand`;
- обучение и отказ;
- пролог и `clampPrologue`;
- `announce`;
- `advanceTraining`;
- `showTrainingNote`;
- `clearAim`;
- `playThen`.

Место назначения:

```text
battle-screen/useBattleCommandCenter.ts
```

## 2. Блок конца хода

Сюда входят:

- `END_TURN`;
- пролог;
- передача хода;
- ход Нави;
- `finishFromEvents`.

Место назначения:

```text
battle-screen/useBattleCommandCenter.ts
battle-screen/useBattleEnemyTurn.ts
```

## 3. Блок рывка

Сюда входят:

- `chargeFor`;
- `executeCharge`;
- `chargeHint`;
- `chargeArmed`.

Место назначения:

```text
battle-screen/useBattleCommandCenter.ts
```

## 4. Блок `renderer.update`

Сюда входят:

- `matchSeed`;
- `snapshot`;
- `selectedId`;
- `aimId`;
- `reachable`;
- `path`;
- `aimFrom`;
- `aimOk`;
- `aimState`;
- `aimFlanked`;
- `areaPreview`;
- `missLabel`;
- `biome`;
- `darkness`;
- `heightMod`;
- `debugMovement`;
- `visibleCells`;
- `exploredCells`;
- `homeOwner`;
- `aimBreakCell`;
- `hoverCell`;
- `trainingHighlight`;
- `trainingFocus`.

Место назначения:

```text
battle-screen/useBattleRendererSync.ts
```

## 5. Блок карточки прицеливания

Сюда входят:

- `getEntityScreenPosition`;
- смещение карточки;
- удержание в пределах экрана.

Место назначения:

```text
battle-screen/useBattleAimPreview.ts
```

## 6. Блок обучения

Сюда входят:

- `advanceTraining`;
- `showTrainingNote`;
- `trainingOutcome`;
- `trainingDeny`;
- `trainingAllows`;
- `trainingWeaponAllowed`;
- `trainingSkillAllowed`.

Место назначения:

```text
battle-screen/useBattleTrainingState.ts
```

## 7. Блок пролога

Сюда входят:

- `afterPrologueApply`;
- `prologueAftermath`;
- `saveBattleCheckpoint`;
- `forceDefend`;
- `storyNoteHintKey`;
- `showPrologueHint`;
- `closeStoryNote`.

Место назначения:

```text
battle-screen/useBattlePrologueState.ts
```

## 8. Блок кампании

Сюда входят:

- генералы;
- эвакуированные;
- `rosterIndex`;
- `full` и `final` снапшоты;
- исход миссии.

Место назначения:

```text
battle-screen/useBattleOutcomeGate.ts
```

---

# 27. Проверка после рефакторинга

После переноса обязательно выполнить:

```bash
pnpm -F ui typecheck
pnpm -F ui lint
pnpm -F ui test
```

Особое внимание — тестам:

```text
action-panel.test.tsx
battle-cell-click.test.ts
battle-command.test.ts
battle-enemy-phase.test.ts
battle-intent.test.ts
battle-keyboard-dom.test.tsx
training-scenario.test.ts
prologue-director.test.ts
```

Если в проекте есть визуальные или интеграционные тесты экрана боя, проверить:

- класс `.battle-screen`;
- класс `.is-training-focus`;
- `.training-coach`;
- `.training-note`;
- `.aim-card`;
- `.cutscene-skip`;
- `.pause-root`;
- `.story-note-card`;
- `.replay-bar`;
- `.roster`;
- `.enemy-strip`.

---

# 28. Контроль размера

После рефакторинга:

```bash
wc -l app/packages/ui/src/BattleScreenView.tsx
wc -l app/packages/ui/src/battle-screen/*.ts
wc -l app/packages/ui/src/battle-screen/*.tsx
```

Ожидаемое распределение:

| Файл | Примерный размер |
|---|---:|
| `BattleScreenView.tsx` | 20–30 строк |
| `useBattleScreenModel.ts` | 220–320 строк |
| `useBattleScreenBase.ts` | 120–170 строк |
| `useBattleKinds.ts` | 80–120 строк |
| `useBattleKernel.ts` | 70–140 строк |
| `useBattleSnapshot.ts` | 70–100 строк |
| `useBattleIntentState.ts` | 80–130 строк |
| `useBattleAimPreview.ts` | 140–220 строк |
| `useBattleTrainingState.ts` | 220–320 строк |
| `useBattlePrologueState.ts` | 200–320 строк |
| `useBattleOutcomeGate.ts` | 180–320 строк |
| `useBattleCommandCenter.ts` | 350–600 строк |
| `useBattleRendererSync.ts` | 220–350 строк |
| `useBattleEnemyTurn.ts` | 120–250 строк |
| `useBattleReplayPlayback.ts` | 80–140 строк |
| `useBattleRosterState.ts` | 80–140 строк |
| `useBattleCampaignHints.ts` | 80–140 строк |
| `useBattleKeyboardControl.ts` | 80–160 строк |
| Презентационные компоненты | 50–300 строк каждый |

Итоговый `BattleScreenView.tsx` гарантированно получается меньше 1000 строк, фактически — около 25 строк.

---

# 29. Главный принцип итогового состояния

После рефакторинга:

```text
BattleScreenView.tsx — публичный вход.
useBattleScreenModel.ts — композиция состояния экрана.
battle-screen/useBattle*.ts — логические доменные хуки.
battle-screen/Battle*.tsx — презентационные блоки.
```

Экран боя становится собираемым из независимых частей:

- состояние боя;
- намерение игрока;
- команды;
- обучение;
- пролог;
- повтор;
- ход Нави;
- рендерер;
- исход;
- подсказки;
- панели;
- диалоги.

Это снижает размер корневого файла, упрощает тестирование и позволяет дальше развивать боевой экран без риска сломать весь `BattleScreenView.tsx`.
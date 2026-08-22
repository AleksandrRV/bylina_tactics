import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  createMissionMatch,
  createPvpMatch,
  createQuickMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  pickEnemyCommand,
  weaponStatsFromRecord,
  type CellPos,
  type Command,
  type EntityState,
  type GameEvent,
  type HitPreview,
  type MatchState,
  type ReachableCell,
  type RosterMods,
  type SkillStats,
  type TacticsKernel,
  type WeaponStats,
} from "@bylina/core";
import { createFieldRenderer, type FieldRenderer } from "@bylina/render";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACTION_SHORTCUTS, selectableActions, shortcutForAction } from "./action-shortcuts.js";
import { interactiveEntityAt, primaryAttackForEnemy } from "./cell-interaction.js";
import { useServices, useT } from "./context.js";
import { useI18nTick, useSessionState } from "./hooks.js";
import { unitPortrait } from "./portraits.js";
import "./battle.css";

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function unitNameKey(configId: string): string {
  return `unit.${configId}.name`;
}

/** Иконка автопобеды: молния как знак мгновенного разрешения. */
function AutoWinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" />
    </svg>
  );
}

/** Иконка-жук: общепринятый символ отладочного режима. */
function DebugIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2l1.5 2.5M16 2l-1.5 2.5" />
      <ellipse cx="12" cy="14" rx="5" ry="6" />
      <path d="M12 8v12" />
      <path d="M7 12H3M21 12h-4M7.5 17l-3 2.5M16.5 17l3 2.5M7.5 11l-3-2.5M16.5 11l3-2.5" />
      <circle cx="12" cy="7" r="2.5" />
    </svg>
  );
}

export function BattleScreen() {
  useI18nTick();
  const t = useT();
  const { session, content } = useServices();
  const { paused, difficulty, battleKind, activeMissionId, deployment, matchSeed } = useSessionState();
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FieldRenderer | null>(null);
  const hoverRef = useRef<string | null>(null);
  const inputRef = useRef<{
    onCell: (x: number, y: number) => void;
    onHover: (x: number, y: number) => void;
  }>({
    onCell: () => undefined,
    onHover: () => undefined,
  });

  const [debugMovement, setDebugMovement] = useState(false);

  const weapons = useMemo(() => {
    const base: Record<string, WeaponStats> = defaultTrainingWeapons();
    for (const record of content.weapons) {
      base[record.id] = weaponStatsFromRecord(record);
    }
    return base;
  }, [content.weapons]);

  const skills = useMemo(() => {
    const result: Record<string, SkillStats> = {};
    for (const record of content.skills) result[record.id] = record as SkillStats;
    return result;
  }, [content.skills]);

  // Сетевой ведомый (0.15.0) не исполняет правила: ядро у ведущего,
  // снимок и предпросмотр приходят по каналу.
  const netRole = battleKind === "pvpNet" ? session.get().netRole : null;
  const isNetGuest = netRole === "guest";
  const isSpectator = netRole === "spectator";
  const isReplay = battleKind === "replay";
  const replayJournal = session.get().replayJournal;
  const [kernel] = useState<TacticsKernel | null>(() => {
    if (isReplay && replayJournal) {
      const host = createTacticsKernel({
        initial: createPvpMatch({
          units: replayJournal.options.units,
          map: replayJournal.options.map,
          side1: replayJournal.options.side1,
          side2: replayJournal.options.side2,
          objective: replayJournal.options.objective,
          seed: replayJournal.options.seed,
        }),
        weapons,
        skills,
        units: content.units,
        seed: replayJournal.options.seed,
      });
      session.bindTacticsHost(host);
      return host;
    }
    if (isNetGuest) return null;
    // Ядро боя создаётся один раз на монтаж экрана. При восстановлении партии
    // (сохранение 0.13.0) используется снимок из состояния сессии; инициализатор
    // может вызываться повторно (StrictMode) — чтение состояния идемпотентно.
    const restored = session.get().restoredMatch;
    if (restored) {
      const host = createTacticsKernel({
        initial: restored,
        weapons,
        skills,
        units: content.units,
        fog: session.get().restoredFog,
      });
      session.bindTacticsHost(host);
      return host;
    }
    // Поочерёдная игра: составы сторон из комнаты сбора, поле режима (0.14.0);
    // сетевой ведущий строит ту же партию локально (0.15.0).
    let initial: MatchState;
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      const sides = session.getPvpSides();
      if (!sides) throw new Error("PvP sides are missing");
      initial = createPvpMatch({
        units: content.units,
        map: content.pvp.map ?? content.quickMatch.map,
        side1: sides.side1,
        side2: sides.side2,
        objective: session.get().pvpObjective ?? "elimination",
        seed: matchSeed || 1,
      });
    } else if (battleKind === "campaign" && activeMissionId) {
      const mission = session.getCampaign().getMission(activeMissionId);
      if (!mission) throw new Error(`Unknown campaign mission: ${activeMissionId}`);
      const penalty = content.campaign.woundPenalty;
      const fighters = session.getCampaign().getState().fighters;
      const items = session.getCampaign().getItems();
      const playerSlots = deployment.map((fighterId) => {
        const fighter = fighters.find((candidate) => candidate.id === fighterId);
        if (!fighter || !fighter.alive) throw new Error(`Unknown fighter in deployment: ${fighterId}`);
        const mods: RosterMods = fighter.wounded
          ? { aimMod: penalty.aim, defenseMod: penalty.defense, mobilityMod: penalty.mobility }
          : {};
        // Снаряжение: оружие и модификаторы предмета добавляются к высадке.
        const item = fighter.equippedItemId ? items.find((entry) => entry.id === fighter.equippedItemId) : undefined;
        if (item) {
          mods.aimMod = (mods.aimMod ?? 0) + (item.aimMod ?? 0);
          mods.defenseMod = (mods.defenseMod ?? 0) + (item.defenseMod ?? 0);
          mods.mobilityMod = (mods.mobilityMod ?? 0) + (item.mobilityMod ?? 0);
          if (item.maxHpMod) mods.maxHpMod = (mods.maxHpMod ?? 0) + item.maxHpMod;
          if (item.weaponId) mods.extraWeaponIds = [item.weaponId];
        }
        return { unitId: fighter.unitId, hp: fighter.hp, ...mods };
      });
      initial = createMissionMatch({
        units: content.units,
        map: mission.map,
        playerSlots,
        enemies: mission.enemies,
        generals: mission.generals,
        excludedGenerals: session.getCampaign().getState().deadGenerals,
        objective: mission.type === "destroy"
          ? { kind: "destroy", unitId: mission.objectiveUnitId! }
          : mission.type === "rescue"
            ? { kind: "rescue", unitId: mission.escorteeUnitId! }
            : mission.type === "recon"
              ? { kind: "recon" }
              : undefined,
        seed: matchSeed || 1,
      });
    } else {
      const count =
        content.quickMatch.difficulties.find((item) => item.id === difficulty)?.enemyCount ??
        content.quickMatch.difficulties[0]?.enemyCount ??
        3;
      initial = createQuickMatch({
        units: content.units,
        map: content.quickMatch.map,
        playerSlots: content.quickMatch.playerSlots,
        enemyPool: content.quickMatch.enemyPool,
        enemyCount: count,
        seed: matchSeed || 1,
      });
    }
    const host = createTacticsKernel({ initial, weapons, skills, units: content.units });
    session.bindTacticsHost(host);
    return host;
  });

  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [action, setAction] = useState<{ type: "weapon" | "skill"; id: string } | null>(null);
  const [aimId, setAimId] = useState<number | null>(null);
  const [skillTargetPos, setSkillTargetPos] = useState<CellPos | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enemyPhase, setEnemyPhase] = useState(false);

  useEffect(
    () =>
      session.subscribeBattle(() => {
        setTick((value) => value + 1);
      }),
    [kernel],
  );

  // Воспроизведение повтора (0.17.0): команды журнала применяются по таймеру.
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayDone, setReplayDone] = useState(false);
  useEffect(() => {
    if (!isReplay || !replayJournal || !kernel || replayDone) return;
    const commands = replayJournal.commands;
    const timer = window.setInterval(() => {
      const index = replayIndex;
      if (index >= commands.length) {
        window.clearInterval(timer);
        setReplayDone(true);
        return;
      }
      const command = commands[index];
      if (command) kernel.apply(command);
      setReplayIndex(index + 1);
    }, 480);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReplay, replayJournal, kernel, replayIndex, replayDone]);

  // Обрыв канала состязательного боя (0.17.0): отсчёт 30 секунд.
  const netDisconnected = session.get().netDisconnected === true;
  const [disconnectLeft, setDisconnectLeft] = useState(30);
  useEffect(() => {
    if (!netDisconnected) return;
    setDisconnectLeft(30);
    const timer = window.setInterval(() => {
      setDisconnectLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [netDisconnected]);

  // Поочерёдная игра: каждый рендер показывает сторону, чей сейчас ход
  // (сокрытие панели чужой стороны и туман стороны при передаче устройства).
  // Сетевой ведомый всегда видит только свою сторону; ведущий — активную.
  const netOwner = battleKind === "pvpNet" ? session.get().netOwner : null;
  const pvpActive = battleKind === "pvp" || battleKind === "pvpNet"
    ? (isNetGuest || isSpectator ? netOwner : (session.getBattleFullSnapshot()?.activeOwner ?? PLAYER_OWNER))
    : null;
  const viewOwner = pvpActive ?? PLAYER_OWNER;
  const enemyOwner = viewOwner === ENEMY_OWNER ? PLAYER_OWNER : ENEMY_OWNER;

  const EMPTY_SNAPSHOT: MatchState = {
    turnNumber: 1,
    activeOwner: viewOwner,
    grid: { width: 8, height: 6, tiles: [] },
    entities: [],
  };
  // Наблюдатель, как и гость, не исполняет правила: снимок приходит от ведущего.
  const usesNetSnapshot = isNetGuest || isSpectator;
  const snapshot = usesNetSnapshot
    ? (session.getNetSnapshot() ?? EMPTY_SNAPSHOT)
    : session.getBattleSnapshot(viewOwner);

  const visibleCells = useMemo(
    () => (usesNetSnapshot ? session.getNetVisible() : session.getBattleVisible(viewOwner)),
    [kernel, snapshot.turnNumber, snapshot.entities, viewOwner, usesNetSnapshot],
  );
  const exploredCells = useMemo(
    () => (usesNetSnapshot ? session.getNetExplored() : session.getBattleExplored(viewOwner)),
    [kernel, snapshot.turnNumber, snapshot.entities, viewOwner, usesNetSnapshot],
  );

  const isOwn = (entity: EntityState): boolean =>
    !isSpectator && !isReplay && !entity.dead && entity.coverType === 0 && entity.owner === viewOwner && entity.maxAp > 0;

  // События поочерёдного боя приходят через транспорт (0.14.0/0.15.0):
  // локальный — на одном устройстве, сетевой — ведомому от ведущего.
  useEffect(() => {
    if (battleKind !== "pvp" && battleKind !== "pvpNet") return;
    const unlisten = session.subscribePvpEvents((events) => {
      announce(events);
      setAction(null);
      setAimId(null);
      setSkillTargetPos(null);
      setPreview(null);
      playThen(events);
    });
    return unlisten;
    // Подписка создаётся на время жизни экрана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, battleKind, session]);

  // Передача устройства в поочерёдной игре: при смене хода экран ждёт
  // подтверждения нового игрока, прежде чем показать его панель.
  const [passReady, setPassReady] = useState(false);
  useEffect(() => {
    setPassReady(false);
  }, [snapshot.turnNumber, pvpActive]);

  // Миссия кампании: запись точки для формулировки задачи и цели.
  const mission = battleKind === "campaign" && activeMissionId
    ? session.getCampaign().getMission(activeMissionId)
    : undefined;
  const objectiveEntity = mission
    ? snapshot.entities.find((entity) =>
        mission.type === "destroy"
          ? entity.configId === mission.objectiveUnitId
          : mission.type === "rescue"
            ? entity.configId === mission.escorteeUnitId
            : false,
      )
    : undefined;

  // Уведомление о записи в начале хода стороны кампании (ui-design §8).
  const [saveNotice, setSaveNotice] = useState(false);
  useEffect(() => {
    if (battleKind !== "campaign") return;
    setSaveNotice(true);
    const timer = window.setTimeout(() => setSaveNotice(false), 1600);
    return () => window.clearTimeout(timer);
  }, [snapshot.turnNumber, battleKind]);

  useEffect(() => {
    const first = snapshot.entities.find(isOwn);
    setSelectedId(first?.id ?? null);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    setPreview(null);
  }, [snapshot.turnNumber, viewOwner]);

  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const aimed = snapshot.entities.find((entity) => entity.id === aimId);

  const reachable = useMemo(() => {
    if (selectedId === null || action !== null || paused || busy) return [] as ReachableCell[];
    if (isNetGuest) return session.requestNetReachable(selectedId);
    return session.getBattleReachable(selectedId);
  }, [kernel, selectedId, action, snapshot.turnNumber, selected?.x, selected?.y, selected?.ap, paused, busy, isNetGuest]);

  const byReach = useMemo(() => {
    const map = new Map<string, ReachableCell>();
    for (const cell of reachable) map.set(cellKey(cell.x, cell.y), cell);
    return map;
  }, [reachable]);

  const previewPath = useMemo(() => {
    if (!preview || selectedId === null) return [] as CellPos[];
    const [xs, ys] = preview.split(",");
    const path = session.getBattlePath(selectedId, { x: Number(xs), y: Number(ys), z: 0 });
    return path?.path ?? [];
  }, [preview, selectedId, kernel, snapshot.turnNumber]);

  const hit: HitPreview | null = useMemo(() => {
    if (selectedId === null || !action) return null;
    if (action.type === "weapon") {
      if (aimId === null) return null;
      if (isNetGuest) return session.requestNetHitPreview(selectedId, aimId, action.id);
      return session.getBattleHitPreview(selectedId, aimId, action.id);
    }
    if (aimId === null && !skillTargetPos) return null;
    const result = session.getBattleSkillPreview(selectedId, action.id, aimId ?? undefined, skillTargetPos ?? undefined);
    return {
      available: result.available,
      reason: result.reason,
      chance: result.chance,
      dmgMin: result.dmgMin,
      dmgMax: result.dmgMax,
      cover: result.cover,
      heightMod: result.heightMod,
      flanked: result.flanked,
    };
  }, [kernel, selectedId, aimId, skillTargetPos, action, selected?.x, selected?.y, selected?.ap, aimed?.x, aimed?.y, aimed?.hp]);

  const announce = (events: GameEvent[]): void => {
    const combat = events.find((event) => event.type === "COMBAT_RESOLVED");
    if (combat && combat.type === "COMBAT_RESOLVED") {
      if (combat.result === "MISS") setLog(t("combat.miss"));
      else if (combat.result === "CRIT") setLog(t("combat.crit", { dmg: combat.damageDealt }));
      else setLog(t("combat.hit", { dmg: combat.damageDealt }));
    }
    if (events.some((event) => event.type === "ENTITY_DIED")) setLog(t("combat.died"));
  };

  const finishFromEvents = (events: GameEvent[]): void => {
    const ended = events.find((event) => event.type === "MATCH_ENDED");
    if (!ended || ended.type !== "MATCH_ENDED") return;
    if (battleKind === "pvp" || battleKind === "pvpNet") {
      const winner = ended.winnerPlayerId === String(PLAYER_OWNER) ? 1 : ended.winnerPlayerId === String(ENEMY_OWNER) ? 2 : null;
      if (winner) session.finishPvpMatch(winner);
      return;
    }
    const outcome = ended.winnerPlayerId === String(PLAYER_OWNER) ? "victory" : "defeat";
    if (battleKind === "campaign") {
      // Исходы бойцов высадки: сопоставление по явной метке rosterIndex,
      // а не по порядку идентификаторов. Метка не зависит от призывов,
      // иллюзий и удалённых с поля сущностей.
      const final = session.getBattleSnapshot(PLAYER_OWNER);
      // Генералы, погибшие в миссии: окончательная гибель (0.18.0).
      const generalDeaths = (mission?.generals ?? []).filter((generalId) => {
        const general = final.entities.find((entity) => entity.configId === generalId && entity.owner === ENEMY_OWNER);
        return general?.dead === true;
      });
      const participants = deployment.map((fighterId, index) => {
        const entity = final.entities.find((candidate) =>
          candidate.owner === PLAYER_OWNER &&
          candidate.coverType === 0 &&
          candidate.rosterIndex === index,
        );
        if (entity) return { fighterId, survived: !entity.dead, hp: entity.hp };
        // Эвакуированный боец (разведка) выжил: здоровье на момент ухода
        // зафиксировано ядром в состоянии боя (0.13.0).
        const extracted = (final.extracted ?? []).find((entry) => entry.rosterIndex === index);
        if (extracted) return { fighterId, survived: true, hp: extracted.hp };
        return { fighterId, survived: false, hp: 0 };
      });
      session.finishCampaignMission(outcome, participants, generalDeaths);
      return;
    }
    session.finishMatch(outcome);
  };

  const playThen = (events: GameEvent[], after?: () => void): void => {
    setBusy(true);
    void (rendererRef.current?.play(events) ?? Promise.resolve()).finally(() => {
      setBusy(false);
      finishFromEvents(events);
      after?.();
    });
  };

  /** Отладочная автопобеда: мгновенно уничтожает всех противников и открывает итог победы. */
  const debugAutoWin = (): void => {
    if (paused || busy) return;
    const result = session.debugAutoWinBattle();
    if (!result.ok) return;
    setPreview(null);
    setAimId(null);
    setSkillTargetPos(null);
    setAction(null);
    playThen(result.events);
  };

  /** Единственный канал команд: поочерёдная игра — через транспорт (0.14.0/0.15.0). */
  const applyCommand = (command: Command): void => {
    if (isSpectator || isReplay) return;
    if (battleKind === "pvp") {
      session.sendPvpCommand(command);
      return;
    }
    if (isNetGuest) {
      session.sendNetCommand(command);
      return;
    }
    const result = session.applyBattleCommand(command);
    if (!result.ok) return;
    announce(result.events);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    setPreview(null);
    playThen(result.events);
  };

  const tryMove = (to: CellPos): void => {
    if (selectedId === null || paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    applyCommand({ type: "MOVE", actorId: selectedId, to });
  };

  const tryAttack = (targetId: number): void => {
    if (selectedId === null || !action || paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    const command: Command = action.type === "weapon"
      ? { type: "ATTACK", actorId: selectedId, targetId, weaponId: action.id }
      : { type: "USE_SKILL", actorId: selectedId, targetId, targetPos: skillTargetPos ?? undefined, skillId: action.id };
    applyCommand(command);
  };

  const useSelfSkill = (skillId: string): void => {
    if (selectedId === null || paused || busy || snapshot.activeOwner !== viewOwner) return;
    applyCommand({ type: "USE_SKILL", actorId: selectedId, skillId });
  };

  const tryPositionSkill = (pos: CellPos): void => {
    if (selectedId === null || action?.type !== "skill" || paused || busy) return;
    const same = skillTargetPos?.x === pos.x && skillTargetPos.y === pos.y && skillTargetPos.z === pos.z;
    if (!same) {
      setSkillTargetPos(pos);
      setPreview(null);
      return;
    }
    applyCommand({
      type: "USE_SKILL",
      actorId: selectedId,
      skillId: action.id,
      targetId: aimId ?? undefined,
      targetPos: pos,
    });
  };

  const runEnemyPhase = async (): Promise<void> => {
    setEnemyPhase(true);
    try {
      await sleep(430);
      for (let guard = 0; guard < 96; guard += 1) {
        const snap = session.getBattleSnapshot(PLAYER_OWNER);
        if (snap.activeOwner !== ENEMY_OWNER) break;
        if (session.getBattleOutcome() !== "ongoing") break;
        if (!kernel) break;
        const command = pickEnemyCommand(kernel);
        const applied = command
          ? session.applyBattleCommand(command)
          : session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        if (!applied.ok) {
          session.applyBattleCommand({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
          break;
        }
        await (rendererRef.current?.play(applied.events) ?? Promise.resolve());
        announce(applied.events);
        finishFromEvents(applied.events);
        if (!command) break;
        if (session.getBattleOutcome() !== "ongoing") break;
        await sleep(190);
      }
    } finally {
      setEnemyPhase(false);
    }
  };

  // Восстановление партии, сохранённой в ход Нави: алгоритм противника
  // продолжает ход с текущего состояния (иначе сторона осталась бы без хода).
  // В поочерёдной игре алгоритм не применяется — ход принадлежит человеку.
  useEffect(() => {
    if (battleKind === "pvp" || battleKind === "pvpNet") return;
    if (session.getBattleOutcome() !== "ongoing") return;
    if (session.getBattleSnapshot(PLAYER_OWNER).activeOwner !== ENEMY_OWNER) return;
    void runEnemyPhase();
    // Только при создании ядра (монтаж экрана, включая восстановление).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  const endTurn = (): void => {
    if (paused || busy) return;
    if (snapshot.activeOwner !== viewOwner) return;
    setPreview(null);
    setAimId(null);
    setLog(null);
    if (battleKind === "pvp") {
      session.sendPvpCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    if (isNetGuest) {
      session.sendNetCommand({ type: "END_TURN", playerId: String(viewOwner) });
      return;
    }
    const result = session.applyBattleCommand({ type: "END_TURN", playerId: String(viewOwner) });
    if (!result.ok) return;
    setBusy(true);
    void (async () => {
      try {
        await (rendererRef.current?.play(result.events) ?? Promise.resolve());
        finishFromEvents(result.events);
        if (session.getBattleOutcome() === "ongoing" && session.getBattleSnapshot(PLAYER_OWNER).activeOwner === ENEMY_OWNER) {
          await runEnemyPhase();
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  const onCell = (x: number, y: number): void => {
    if (paused || busy || snapshot.activeOwner !== viewOwner) return;
    const reach = byReach.get(cellKey(x, y));
    const targeting = action !== null;
    const selectedSkill = action?.type === "skill" ? skills[action.id] : undefined;
    const positionOnlySkill = selectedSkill?.effects.some((effect) => effect.type === "spawn");
    const allyTargeting = Boolean(selectedSkill && !positionOnlySkill && (selectedSkill.filter === "allies" || selectedSkill.filter === "all"));
    const entity = interactiveEntityAt(snapshot.entities, x, y, Boolean(reach) && !targeting);
    if (entity?.owner === viewOwner && entity.coverType === 0 && entity.maxAp > 0 && !allyTargeting) {
      setSelectedId(entity.id);
      setAction(null);
      setSkillTargetPos(null);
      setAimId(null);
      setPreview(null);
      return;
    }

    const automaticAttack = primaryAttackForEnemy(selected, entity, viewOwner, targeting);
    if (automaticAttack) {
      setAction(automaticAttack);
      setAimId(entity?.id ?? null);
      setPreview(null);
      return;
    }

    if (entity && selectedId !== null && targeting) {
      if (aimId === entity.id && hit?.available) {
        tryAttack(entity.id);
        return;
      }
      setAimId(entity.id);
      if (!selectedSkill?.effects.some((effect) => effect.type === "displace")) setSkillTargetPos(null);
      setPreview(null);
      return;
    }

    const needsPosition = selectedSkill?.effects.some((effect) => effect.type === "spawn" || effect.type === "displace");
    if (needsPosition && action?.type === "skill") {
      const tile = snapshot.grid.tiles.find((candidate) => candidate.x === x && candidate.y === y);
      if (tile) tryPositionSkill({ x, y, z: tile.z });
      return;
    }

    // В режиме перемещения проходимая клетка всегда означает движение.
    // Граневое укрытие в ней не перехватывает выбор как цель атаки.
    if (reach && !targeting) {
      const id = cellKey(x, y);
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (coarse && preview !== id) {
        setPreview(id);
        setAimId(null);
        return;
      }
      tryMove({ x, y, z: reach.z });
      return;
    }

    setPreview(null);
    setAimId(null);
  };

  const onHover = (x: number, y: number): void => {
    if (paused || busy) return;
    const id = cellKey(x, y);
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    if (byReach.has(id) && !window.matchMedia("(pointer: coarse)").matches) {
      setPreview(id);
    }
  };

  inputRef.current = { onCell, onHover };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = createFieldRenderer();
    renderer.setOnActivate((x, y) => inputRef.current.onCell(x, y));
    renderer.setOnHover((x, y) => inputRef.current.onHover(x, y));
    let gone = false;
    void renderer.mount(host).then(() => {
      if (gone) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setTick((value) => value + 1);
    });
    return () => {
      gone = true;
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  const aimBreakCell = useMemo(() => {
    if (!hit || !selected || !aimed) return null;
    // breakCell теперь вычисляется ядром в previewAttack (§7, §9.3).
    if (hit.breakCell) return hit.breakCell;
    return null;
  }, [hit, selected, aimed]);

  const hoverCell = useMemo(() => {
    if (skillTargetPos) return skillTargetPos;
    if (!preview) return null;
    const [xs, ys] = preview.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const tile = snapshot.grid.tiles.find((t) => t.x === x && t.y === y);
    return { x, y, z: tile?.z ?? 0 };
  }, [preview, skillTargetPos, snapshot.grid]);

  useEffect(() => {
    rendererRef.current?.update({
      snapshot,
      selectedId,
      aimId,
      reachable,
      path: previewPath,
      aimOk: Boolean(hit?.available),
      heightMod: hit?.heightMod ?? 0,
      debugMovement,
      visibleCells,
      exploredCells,
      aimBreakCell,
      hoverCell,
    });
  }, [snapshot, selectedId, aimId, reachable, previewPath, hit?.available, hit?.heightMod, paused, debugMovement, visibleCells, exploredCells, aimBreakCell, hoverCell]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        session.setPaused(!paused);
        return;
      }
      if (paused || busy) return;
      if (event.key === "Tab") {
        event.preventDefault();
        const living = snapshot.entities.filter(isOwn);
        if (living.length === 0) return;
        const withAp = living.filter((entity) => entity.ap > 0);
        const pool = withAp.length > 0 ? withAp : living;
        const index = pool.findIndex((entity) => entity.id === selectedId);
        const next = pool[(index + 1) % pool.length];
        if (next) {
          setSelectedId(next.id);
          setAction(null);
          setSkillTargetPos(null);
          setAimId(null);
        }
        return;
      }
      if (event.key === "9" && selectedId !== null && selected && selected.ap > 0 && snapshot.activeOwner === viewOwner) {
        applyCommand({ type: "DEFEND", actorId: selectedId });
        setAction(null);
        setSkillTargetPos(null);
        setAimId(null);
        setPreview(null);
        return;
      }
      if (event.key === "0" && selectedId !== null && selected && selected.ap > 0 && snapshot.activeOwner === viewOwner) {
        applyCommand({ type: "OVERWATCH", actorId: selectedId });
        setAction(null);
        setSkillTargetPos(null);
        setAimId(null);
        setPreview(null);
        return;
      }
      if (ACTION_SHORTCUTS.includes(event.key as (typeof ACTION_SHORTCUTS)[number]) && selected) {
        const index = Number(event.key) - 1;
        const chosen = selectableActions(selected)[index];
        if (!chosen) return;
        if (chosen.type === "skill") {
          const skill = skills[chosen.id];
          const cooldown = selected.skillCooldowns?.[chosen.id] ?? 0;
          const uses = selected.skillUses?.[chosen.id] ?? 0;
          if (cooldown > 0 || (skill?.maxUsesPerBattle !== undefined && uses >= skill.maxUsesPerBattle)) return;
        }
        if (chosen.type === "skill" && skills[chosen.id]?.category === "self") {
          useSelfSkill(chosen.id);
        } else {
          const active = action?.type === chosen.type && action.id === chosen.id;
          setAction(active ? null : chosen);
          setSkillTargetPos(null);
          setAimId(null);
          setPreview(null);
        }
        return;
      }
      const step = 28;
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") rendererRef.current?.pan(step, 0);
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") rendererRef.current?.pan(-step, 0);
      if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") rendererRef.current?.pan(0, step);
      if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") rendererRef.current?.pan(0, -step);
    };
    const onContext = (event: MouseEvent): void => {
      event.preventDefault();
      setAction(null);
      setSkillTargetPos(null);
      setAimId(null);
      setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
  }, [paused, busy, snapshot, selectedId, aimId, hit, action, skills, session, viewOwner]);

  const roster = snapshot.entities.filter((entity) =>
    (isSpectator ? (entity.owner === 1 || entity.owner === 2) : entity.owner === viewOwner) && entity.coverType === 0,
  );
  const sideKey = isSpectator
    ? "net.spectator"
    : battleKind === "pvp" || battleKind === "pvpNet"
      ? (viewOwner === 1 ? "pvp.side1" : "pvp.side2")
    : snapshot.activeOwner === ENEMY_OWNER
      ? "field.sideEnemy"
      : "field.sidePlayer";

  // Показывать портреты противников только если они в зоне видимости
  // (или уже мертвы и были видны). В поочерёдной игре — противники активной
  // стороны; у наблюдателя — все бойцы обеих сторон.
  const knownEnemies = snapshot.entities.filter((entity) => {
    if (entity.owner !== enemyOwner || entity.coverType !== 0) return false;
    if (isSpectator && entity.owner !== 1 && entity.owner !== 2) return false;
    const key = cellKey(entity.x, entity.y);
    return visibleCells.has(key) || (entity.dead && exploredCells.has(key));
  });

  return (
    <div className={`battle-screen${battleKind === "pvp" ? (viewOwner === 1 ? " is-pvp-side1" : " is-pvp-side2") : ""}`}>
      <div ref={hostRef} className="battle-stage" />
      <div className="battle-hud">
        {isReplay ? (
          <div className="replay-bar" role="status">
            <span className="replay-label">{t("replay.watching")}</span>
            <span className="replay-progress">
              <i style={{ width: `${replayJournal ? Math.min(100, (replayIndex / Math.max(1, replayJournal.commands.length)) * 100) : 0}%` }} />
            </span>
            <span className="muted">
              {replayIndex}/{replayJournal?.commands.length ?? 0}
            </span>
            {replayDone ? <span className="replay-done">{t("replay.done")}</span> : null}
          </div>
        ) : null}
        <header className="battle-top">
          <div className="top-controls">
            <button type="button" className="hud-btn" onClick={() => session.setPaused(true)}>
              {t("battle.pause")}
            </button>
            <button
              type="button"
              className={`hud-btn hud-icon-btn debug-toggle${debugMovement ? " is-on" : ""}`}
              onClick={() => setDebugMovement((value) => !value)}
              title={t(debugMovement ? "battle.debugMovementHint" : "battle.debugMovement")}
              aria-pressed={debugMovement}
              aria-label={t("battle.debugMovement")}
            >
              <DebugIcon />
            </button>
            <button
              type="button"
              className="hud-btn hud-icon-btn debug-win"
              onClick={() => debugAutoWin()}
              title={t("battle.debugAutoWinHint")}
              aria-label={t("battle.debugAutoWin")}
            >
              <AutoWinIcon />
            </button>
          </div>
          <div className="battle-objective">
            <p className="eyebrow">
              {battleKind === "campaign" ? (
                <>
                  <span className="mission-badge">{t("campaign.mission")}</span>
                  {activeMissionId ?? ""}
                </>
              ) : battleKind === "pvp" ? (
                t("menu.pvp")
              ) : (
                t("menu.quickMatch")
              )}
            </p>
            <p>
              {battleKind === "campaign" && mission
                ? t(`battle.objective.${mission.type}`)
                : t("battle.objectiveQuick")}
            </p>
            <p className="muted">
              {t("field.turn", { turn: snapshot.turnNumber })}
              {" · "}
              {t(sideKey)}
            </p>
            {snapshot.apple ? (
              <div className="apple-hud" aria-label={t("pvp.appleLabel")}>
                <span className="apple-hud-icon" aria-hidden="true">●</span>
                <span className="apple-hud-text">
                  {snapshot.apple.carrierId !== null
                    ? (() => {
                        const carrier = snapshot.entities.find((entity) => entity.id === snapshot.apple?.carrierId);
                        const side = carrier?.owner === 1 ? t("pvp.side1") : t("pvp.side2");
                        return t("pvp.appleCarrier", { side });
                      })()
                    : t("pvp.appleLying")}
                </span>
              </div>
            ) : null}
            {objectiveEntity ? (
              <div className="objective-hud" aria-label={t("campaign.objective")}>
                {unitPortrait(objectiveEntity.configId) ? (
                  <img
                    className={`objective-face${objectiveEntity.dead ? " is-dead" : ""}`}
                    src={unitPortrait(objectiveEntity.configId)}
                    alt=""
                    draggable={false}
                  />
                ) : null}
                <span className="objective-meta">
                  <span className="objective-name">{t(unitNameKey(objectiveEntity.configId))}</span>
                  <span className="objective-hp" aria-label={t("battle.hp", { current: objectiveEntity.hp, max: objectiveEntity.maxHp })}>
                    <i style={{ width: `${Math.max(0, Math.min(100, (objectiveEntity.hp / objectiveEntity.maxHp) * 100))}%` }} />
                  </span>
                </span>
              </div>
            ) : null}
            {knownEnemies.length > 0 ? (
              <div className="enemies-strip" aria-label={t("field.sideEnemy")}>
                {knownEnemies.map((entity) => {
                  const face = unitPortrait(entity.configId);
                  return face ? (
                    <img
                      key={entity.id}
                      className={`enemy-face${entity.dead ? " is-dead" : ""}`}
                      src={face}
                      alt={t(unitNameKey(entity.configId))}
                      title={t(unitNameKey(entity.configId))}
                      draggable={false}
                    />
                  ) : null;
                })}
              </div>
            ) : null}
          </div>
          {battleKind === "pvp" ? (
            <div className="pvp-sides-strip" aria-label={t("pvp.objective")}>
              <span className={`pvp-side-emblem is-side1${viewOwner === 1 ? " is-active" : ""}`} aria-hidden="true">
                1
              </span>
              <span className="pvp-side-emblem-sep" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M3.5 3.5 8 8M3.5 3.5l2.6-1 3 3-1 2.6L3.5 3.5Z" />
                  <path d="M16.5 16.5 12 12M16.5 16.5l-2.6 1-3-3 1-2.6 4.6 4.6Z" />
                </svg>
              </span>
              <span className={`pvp-side-emblem is-side2${viewOwner === 2 ? " is-active" : ""}`} aria-hidden="true">
                2
              </span>
            </div>
          ) : null}
          <div className="roster" aria-label={t("field.sidePlayer")}>
            {roster.map((entity) => {
              const face = unitPortrait(entity.configId);
              return (
                <button
                  key={entity.id}
                  type="button"
                  className={`roster-card${entity.id === selectedId ? " is-on" : ""}${entity.dead ? " is-dead" : ""}`}
                  onClick={() => {
                    if (entity.dead) return;
                    setSelectedId(entity.id);
                    setAction(null);
                    setSkillTargetPos(null);
                    setAimId(null);
                  }}
                >
                  {face ? <img className="roster-face" src={face} alt="" draggable={false} /> : null}
                  <span className="roster-meta">
                    <span className="name">{t(unitNameKey(entity.configId))}</span>
                    <span className="diamonds" aria-label={t("field.ap", { current: entity.ap, max: entity.maxAp })}>
                      {Array.from({ length: entity.maxAp }, (_, index) => (
                        <i key={index} className={index < entity.ap ? "diamond is-on" : "diamond"} />
                      ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="battle-mid">
          {saveNotice ? (
            <p className="save-toast" role="status" aria-live="polite">
              <span className="save-toast-mark" aria-hidden="true">✓</span>
              {t("battle.saved")}
            </p>
          ) : null}
          {log ? (
            <p className="battle-log" role="status">
              {log}
            </p>
          ) : null}
          {hit ? (
            <div className="aim-card">
              <div className="aim-header">
                <span className={`aim-chance${hit.available ? "" : " blocked"}`}>
                  {hit.available
                    ? hit.chance === undefined ? t("combat.available") : `${hit.chance}%`
                    : t("combat.unavailable")}
                </span>
                {hit.available && hit.dmgMin !== undefined && hit.dmgMax !== undefined ? (
                  <span className="aim-dmg">
                    {t("combat.dmg", { dmg: `${hit.dmgMin}-${hit.dmgMax}` })}
                  </span>
                ) : null}
                {hit.breakdown ? (
                  <button
                    type="button"
                    className="aim-copy-btn"
                    title={t("combat.copyBreakdown")}
                    onClick={() => {
                      const b = hit.breakdown!;
                      const lines = [
                        `═══ ${t("combat.bdTotal")}: ${b.finalChance}% ═══`,
                        `${t("combat.bdBaseAim")}: +${b.baseAim}`,
                        b.weaponMod !== 0 ? `${t("combat.bdWeaponMod")}: ${b.weaponMod > 0 ? "+" : ""}${b.weaponMod}` : null,
                        b.heightAim !== 0 ? `${t("combat.bdHeight")}: ${b.heightAim > 0 ? "+" : ""}${b.heightAim}` : null,
                        b.targetDefense > 0 ? `${t("combat.bdDefense")}: −${b.targetDefense}` : null,
                        b.stanceDefense > 0 ? `${t("combat.bdDefend")}: −${b.stanceDefense}` : null,
                        b.coverPenalty > 0 ? `${t("combat.bdCover")}: −${b.coverPenalty}` : null,
                        b.rangePenalty > 0 ? `${t("combat.bdRange")}: −${b.rangePenalty}` : null,
                        b.coverDetails.length > 0 ? "" : null,
                        b.coverDetails.length > 0 ? t("combat.bdObstacleList") : null,
                        ...b.coverDetails.map((d) => `  ${d.label}`),
                      ].filter(Boolean);
                      navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                ) : null}
              </div>
              {hit.breakdown ? (
                <div className="breakdown-detail">
                  <span className="bd-item pos">
                    {t("combat.bdBaseAim")}: +{hit.breakdown.baseAim}
                  </span>
                  {hit.breakdown.weaponMod !== 0 ? (
                    <span className={`bd-item${hit.breakdown.weaponMod > 0 ? " pos" : " neg"}`}>
                      {t("combat.bdWeaponMod")}: {hit.breakdown.weaponMod > 0 ? "+" : ""}{hit.breakdown.weaponMod}
                    </span>
                  ) : null}
                  {hit.breakdown.heightAim !== 0 ? (
                    <span className={`bd-item${hit.breakdown.heightAim > 0 ? " pos" : " neg"}`}>
                      {t("combat.bdHeight")}: {hit.breakdown.heightAim > 0 ? "+" : ""}{hit.breakdown.heightAim}
                    </span>
                  ) : null}
                  {hit.breakdown.targetDefense > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdDefense")}: −{hit.breakdown.targetDefense}
                    </span>
                  ) : null}
                  {hit.breakdown.stanceDefense > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdDefend")}: −{hit.breakdown.stanceDefense}
                    </span>
                  ) : null}
                  {hit.breakdown.coverPenalty > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdCover")}: −{hit.breakdown.coverPenalty}
                    </span>
                  ) : null}
                  {hit.breakdown.rangePenalty > 0 ? (
                    <span className="bd-item neg">
                      {t("combat.bdRange")}: −{hit.breakdown.rangePenalty}
                    </span>
                  ) : null}
                  {hit.breakdown.coverDetails.length > 0 ? (
                    <div className="bd-details">
                      <span className="bd-details-title">{t("combat.bdObstacleList")}</span>
                      {hit.breakdown.coverDetails.map((d, i) => (
                        <span key={i} className="bd-obs">
                          {d.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!hit.available && hit.reason === "NO_LOS" && hit.breakCell ? (
                <div className="bd-details">
                  <span className="bd-obs">
                    {t("combat.blocked.NO_LOS")}: ({hit.breakCell.x},{hit.breakCell.y}) z={hit.breakCell.z}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {isSpectator ? (
          <footer className="battle-bottom spectator-bar">
            <div className="spectator-note" role="status">
              <span className="spectator-eye" aria-hidden="true">◉</span>
              {t("net.spectator")}
              <span className="muted"> — {t("net.spectatorBody")}</span>
            </div>
          </footer>
        ) : (
        <footer className="battle-bottom">
          <div className="battle-selected">
            {selected ? (
              <div className="sel-row">
                {unitPortrait(selected.configId) ? (
                  <img className="sel-face" src={unitPortrait(selected.configId)} alt="" draggable={false} />
                ) : null}
                <div className="sel-info">
                  <p className="eyebrow">{t(unitNameKey(selected.configId))}</p>
                  <p>{t("battle.hp", { current: selected.hp, max: selected.maxHp })}</p>
                  <div className="hp-segs" aria-hidden="true">
                    {Array.from({ length: selected.maxHp }, (_, index) => (
                      <i key={index} className={index < selected.hp ? "on" : ""} />
                    ))}
                  </div>
                  <div className="diamonds" aria-label={t("field.ap", { current: selected.ap, max: selected.maxAp })}>
                    {Array.from({ length: selected.maxAp }, (_, index) => (
                      <span key={index} className={index < selected.ap ? "diamond is-on" : "diamond"} />
                    ))}
                  </div>
                  <div className="status-list" aria-label={t("battle.statuses")}>
                    {selected.poison ? <span className="status-chip poison">{t("status.poison", { turns: selected.poison.turnsLeft })}</span> : null}
                    {selected.panic ? <span className="status-chip panic">{t("status.panic")}</span> : null}
                    {selected.immobileTurns ? <span className="status-chip immobile">{t("status.immobile")}</span> : null}
                    {selected.hidden ? <span className="status-chip hidden">{t("status.hidden")}</span> : null}
                    {selected.flying ? <span className="status-chip flying">{t("status.flying")}</span> : null}
                    {selected.timedLife !== undefined ? <span className="status-chip timed">{t("status.timed", { turns: selected.timedLife })}</span> : null}
                    {selected.defending ? <span className="status-chip defending">{t("status.defending")}</span> : null}
                    {selected.overwatch ? <span className="status-chip overwatch">{t("status.overwatch")}</span> : null}
                  </div>
                </div>
              </div>
            ) : (
              <p>{t("battle.empty")}</p>
            )}
          </div>
          <div className="skill-row">
            {(selected?.weaponIds ?? (selected?.weaponId ? [selected.weaponId] : [])).map((weaponId, index) => (
              <button
                key={`weapon-${weaponId}`}
                type="button"
                className={`hud-btn skill-slot${action?.type === "weapon" && action.id === weaponId ? " is-active" : ""}`}
                aria-pressed={action?.type === "weapon" && action.id === weaponId}
                data-action-state={action?.type === "weapon" && action.id === weaponId ? "active" : "inactive"}
                disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== viewOwner}
                onClick={() => {
                  const active = action?.type === "weapon" && action.id === weaponId;
                  setAction(active ? null : { type: "weapon", id: weaponId });
                  setSkillTargetPos(null);
                  setAimId(null);
                  setPreview(null);
                }}
              >
                {ACTION_SHORTCUTS[index] ? <kbd>{ACTION_SHORTCUTS[index]}</kbd> : null}
                {t(`weapon.${weaponId}.name`)}
              </button>
            ))}
            {(selected?.skillIds ?? []).map((skillId) => {
              const skill = skills[skillId];
              const active = action?.type === "skill" && action.id === skillId;
              const shortcut = selected ? shortcutForAction(selected, "skill", skillId) : undefined;
              const cooldown = selected?.skillCooldowns?.[skillId] ?? 0;
              const uses = selected?.skillUses?.[skillId] ?? 0;
              const usesLeft = skill?.maxUsesPerBattle === undefined ? undefined : Math.max(0, skill.maxUsesPerBattle - uses);
              const exhausted = usesLeft === 0;
              return (
                <button
                  key={`skill-${skillId}`}
                  type="button"
                  className={`hud-btn skill-slot${active ? " is-active" : ""}${cooldown > 0 ? " is-cooldown" : ""}${exhausted ? " is-exhausted" : ""}`}
                  aria-pressed={active}
                  data-action-state={exhausted ? "exhausted" : cooldown > 0 ? "cooldown" : active ? "active" : "inactive"}
                  title={cooldown > 0 ? t("battle.cooldownHint", { turns: cooldown }) : exhausted ? t("battle.noUsesHint") : undefined}
                  disabled={!selected || selected.ap < (skill?.apCost ?? 1) || cooldown > 0 || exhausted || busy || snapshot.activeOwner !== viewOwner}
                  onClick={() => {
                    if (skill?.category === "self") useSelfSkill(skillId);
                    else {
                      setAction(active ? null : { type: "skill", id: skillId });
                      setSkillTargetPos(null);
                      setAimId(null);
                      setPreview(null);
                    }
                  }}
                >
                  {shortcut ? <kbd>{shortcut}</kbd> : null}
                  {t(`skill.${skillId}.name`)}
                  {cooldown > 0 ? <span className="skill-resource cooldown">{t("battle.cooldownShort", { turns: cooldown })}</span> : null}
                  {usesLeft !== undefined ? <span className="skill-resource uses">{t("battle.usesShort", { uses: usesLeft })}</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              className={`hud-btn skill-slot${selected?.defending ? " is-active" : ""}`}
              aria-pressed={Boolean(selected?.defending)}
              data-action-state={selected?.defending ? "active" : "inactive"}
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== viewOwner}
              title={t("battle.defendHint")}
              onClick={() => {
                if (selectedId === null) return;
                session.applyBattleCommand({ type: "DEFEND", actorId: selectedId });
                setAction(null);
                setSkillTargetPos(null);
                setAimId(null);
                setPreview(null);
              }}
            >
              <kbd>9</kbd>
              {t("battle.defend")}
            </button>
            <button
              type="button"
              className={`hud-btn skill-slot${selected?.overwatch ? " is-active" : ""}`}
              aria-pressed={Boolean(selected?.overwatch)}
              data-action-state={selected?.overwatch ? "active" : "inactive"}
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== viewOwner}
              title={t("battle.overwatchHint")}
              onClick={() => {
                if (selectedId === null) return;
                session.applyBattleCommand({ type: "OVERWATCH", actorId: selectedId });
                setAction(null);
                setSkillTargetPos(null);
                setAimId(null);
                setPreview(null);
              }}
            >
              <kbd>0</kbd>
              {t("battle.overwatch")}
            </button>
          </div>
          <button
            type="button"
            className="hud-btn hud-btn-primary"
            disabled={busy || snapshot.activeOwner !== viewOwner}
            onClick={() => endTurn()}
          >
            {t("field.endTurn")}
          </button>
        </footer>
        )}
      </div>

      {enemyPhase ? (
        <div className="phase-banner" role="status">
          {t("battle.enemyTurn")}
        </div>
      ) : null}

      {battleKind === "pvp" && !passReady ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="pass-title">
            <p className="eyebrow">{t("pvp.passHint")}</p>
            <h2 id="pass-title" className="pass-side-title">
              {viewOwner === 1 ? t("pvp.side1") : t("pvp.side2")}
            </h2>
            <p className="muted">{t("pvp.passBody")}</p>
            <button type="button" className="hud-btn hud-btn-primary pass-ready-btn" onClick={() => setPassReady(true)}>
              {t("pvp.ready")}
            </button>
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && !session.getNetSnapshot() ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-sync-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-sync-title" className="pass-side-title">{t("net.syncing")}</h2>
            <p className="muted">{t("net.syncingBody")}</p>
            <span className="net-sync-spinner" aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {battleKind === "pvpNet" && isNetGuest && session.getNetSnapshot() && snapshot.activeOwner !== viewOwner ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-wait-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-wait-title" className="pass-side-title">
              {t("net.opponentTurn")}
            </h2>
            <p className="muted">{t("net.waitBody")}</p>
          </div>
        </div>
      ) : null}

      {netDisconnected ? (
        <div className="pass-device-root" role="presentation">
          <div className="pass-device-card" role="dialog" aria-modal="true" aria-labelledby="net-lost-title">
            <p className="eyebrow">{t("net.waitHint")}</p>
            <h2 id="net-lost-title" className="pass-side-title">{t("net.connectionLost")}</h2>
            <p className="muted">
              {disconnectLeft > 0
                ? t("net.reconnectIn", { seconds: disconnectLeft })
                : t("net.reconnectExpired")}
            </p>
            <div className="net-lost-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // Сохранение повтора выполняется слоем приложения (persistRef).
                  session.finishReplayDraft(null);
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.saveReplay")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  session.setNetDisconnected(false);
                  session.goTo("menu");
                }}
              >
                {t("net.leaveRoom")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <h2 id="pause-title">{t("battle.pause")}</h2>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.setPaused(false)}>
              {t("battle.resume")}
            </button>
            {battleKind === "campaign" ? (
              <button type="button" className="hud-btn" onClick={() => session.leaveCampaignMission()}>
                {t("battle.toCampaignMap")}
              </button>
            ) : null}
            <button
              type="button"
              className="hud-btn"
              onClick={() => {
                // Выход в меню из боя кампании отменяет начатую миссию:
                // иначе автомат кампании останется с незакрытой миссией.
                if (battleKind === "campaign") session.leaveCampaignMission();
                session.goTo("menu");
              }}
            >
              {t("battle.toMenu")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

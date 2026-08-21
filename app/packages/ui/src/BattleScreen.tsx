import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  createQuickMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  pickEnemyCommand,
  weaponStatsFromRecord,
  type CellPos,
  type EntityState,
  type GameEvent,
  type HitPreview,
  type ReachableCell,
  type SkillStats,
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

function isOwn(entity: EntityState): boolean {
  return !entity.dead && entity.coverType === 0 && entity.owner === PLAYER_OWNER && entity.maxAp > 0;
}

function unitNameKey(configId: string): string {
  return `unit.${configId}.name`;
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
  const { paused, difficulty, matchSeed } = useSessionState();
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

  const kernel = useMemo(() => {
    const count =
      content.quickMatch.difficulties.find((item) => item.id === difficulty)?.enemyCount ??
      content.quickMatch.difficulties[0]?.enemyCount ??
      3;
    const initial = createQuickMatch({
      units: content.units,
      map: content.quickMatch.map,
      playerSlots: content.quickMatch.playerSlots,
      enemyPool: content.quickMatch.enemyPool,
      enemyCount: count,
      seed: matchSeed || 1,
    });
    const host = createTacticsKernel({ initial, weapons, skills, units: content.units });
    session.bindTacticsHost(host);
    return host;
  }, [content.quickMatch, content.units, difficulty, matchSeed, session, skills, weapons]);

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

  const snapshot = session.getBattleSnapshot(PLAYER_OWNER);

  const visibleCells = useMemo(() => session.getBattleVisible(PLAYER_OWNER), [kernel, snapshot.turnNumber, snapshot.entities]);
  const exploredCells = useMemo(() => session.getBattleExplored(PLAYER_OWNER), [kernel, snapshot.turnNumber, snapshot.entities]);

  useEffect(() => {
    const first = snapshot.entities.find(isOwn);
    setSelectedId(first?.id ?? null);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    setPreview(null);
  }, [snapshot.turnNumber]);

  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const aimed = snapshot.entities.find((entity) => entity.id === aimId);

  const reachable = useMemo(() => {
    if (selectedId === null || action !== null || paused || busy) return [] as ReachableCell[];
    return session.getBattleReachable(selectedId);
  }, [kernel, selectedId, action, snapshot.turnNumber, selected?.x, selected?.y, selected?.ap, paused, busy]);

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
    session.finishMatch(ended.winnerPlayerId === String(PLAYER_OWNER) ? "victory" : "defeat");
  };

  const playThen = (events: GameEvent[], after?: () => void): void => {
    setBusy(true);
    void (rendererRef.current?.play(events) ?? Promise.resolve()).finally(() => {
      setBusy(false);
      finishFromEvents(events);
      after?.();
    });
  };

  const tryMove = (to: CellPos): void => {
    if (selectedId === null || paused || busy) return;
    if (snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = session.applyBattleCommand({ type: "MOVE", actorId: selectedId, to });
    if (!result.ok) return;
    setPreview(null);
    setAimId(null);
    playThen(result.events);
  };

  const tryAttack = (targetId: number): void => {
    if (selectedId === null || !action || paused || busy) return;
    if (snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = action.type === "weapon"
      ? session.applyBattleCommand({ type: "ATTACK", actorId: selectedId, targetId, weaponId: action.id })
      : session.applyBattleCommand({ type: "USE_SKILL", actorId: selectedId, targetId, targetPos: skillTargetPos ?? undefined, skillId: action.id });
    if (!result.ok) return;
    announce(result.events);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    playThen(result.events);
  };

  const useSelfSkill = (skillId: string): void => {
    if (selectedId === null || paused || busy || snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = session.applyBattleCommand({ type: "USE_SKILL", actorId: selectedId, skillId });
    if (!result.ok) return;
    announce(result.events);
    setAimId(null);
    playThen(result.events);
  };

  const tryPositionSkill = (pos: CellPos): void => {
    if (selectedId === null || action?.type !== "skill" || paused || busy) return;
    const same = skillTargetPos?.x === pos.x && skillTargetPos.y === pos.y && skillTargetPos.z === pos.z;
    if (!same) {
      setSkillTargetPos(pos);
      setPreview(null);
      return;
    }
    const result = session.applyBattleCommand({
      type: "USE_SKILL",
      actorId: selectedId,
      skillId: action.id,
      targetId: aimId ?? undefined,
      targetPos: pos,
    });
    if (!result.ok) return;
    announce(result.events);
    setAction(null);
    setAimId(null);
    setSkillTargetPos(null);
    playThen(result.events);
  };

  const runEnemyPhase = async (): Promise<void> => {
    setEnemyPhase(true);
    try {
      await sleep(430);
      for (let guard = 0; guard < 96; guard += 1) {
        const snap = session.getBattleSnapshot(PLAYER_OWNER);
        if (snap.activeOwner !== ENEMY_OWNER) break;
        if (session.getBattleOutcome() !== "ongoing") break;
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

  const endTurn = (): void => {
    if (paused || busy) return;
    if (snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = session.applyBattleCommand({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    if (!result.ok) return;
    setPreview(null);
    setAimId(null);
    setLog(null);
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
    if (paused || busy || snapshot.activeOwner !== PLAYER_OWNER) return;
    const reach = byReach.get(cellKey(x, y));
    const targeting = action !== null;
    const selectedSkill = action?.type === "skill" ? skills[action.id] : undefined;
    const positionOnlySkill = selectedSkill?.effects.some((effect) => effect.type === "spawn");
    const allyTargeting = Boolean(selectedSkill && !positionOnlySkill && (selectedSkill.filter === "allies" || selectedSkill.filter === "all"));
    const entity = interactiveEntityAt(snapshot.entities, x, y, Boolean(reach) && !targeting);
    if (entity?.owner === PLAYER_OWNER && entity.coverType === 0 && entity.maxAp > 0 && !allyTargeting) {
      setSelectedId(entity.id);
      setAction(null);
      setSkillTargetPos(null);
      setAimId(null);
      setPreview(null);
      return;
    }

    const automaticAttack = primaryAttackForEnemy(selected, entity, PLAYER_OWNER, targeting);
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
      if (event.key === "9" && selectedId !== null && selected && selected.ap > 0) {
        session.applyBattleCommand({ type: "DEFEND", actorId: selectedId });
        setAction(null);
        setSkillTargetPos(null);
        setAimId(null);
        setPreview(null);
        return;
      }
      if (event.key === "0" && selectedId !== null && selected && selected.ap > 0) {
        session.applyBattleCommand({ type: "OVERWATCH", actorId: selectedId });
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
  }, [paused, busy, snapshot, selectedId, aimId, hit, action, skills, session]);

  const roster = snapshot.entities.filter((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0);
  const sideKey = snapshot.activeOwner === ENEMY_OWNER ? "field.sideEnemy" : "field.sidePlayer";

  // Показывать портреты врагов только если они в зоне видимости (или уже мертвы и были видны).
  const knownEnemies = snapshot.entities.filter((entity) => {
    if (entity.owner !== ENEMY_OWNER || entity.coverType !== 0) return false;
    const key = cellKey(entity.x, entity.y);
    return visibleCells.has(key) || (entity.dead && exploredCells.has(key));
  });

  return (
    <div className="battle-screen">
      <div ref={hostRef} className="battle-stage" />
      <div className="battle-hud">
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
          </div>
          <div className="battle-objective">
            <p className="eyebrow">{t("menu.quickMatch")}</p>
            <p>{t("battle.objectiveQuick")}</p>
            <p className="muted">
              {t("field.turn", { turn: snapshot.turnNumber })}
              {" · "}
              {t(sideKey)}
            </p>
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
                disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== PLAYER_OWNER}
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
                  disabled={!selected || selected.ap < (skill?.apCost ?? 1) || cooldown > 0 || exhausted || busy || snapshot.activeOwner !== PLAYER_OWNER}
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
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== PLAYER_OWNER}
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
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== PLAYER_OWNER}
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
            disabled={busy || snapshot.activeOwner !== PLAYER_OWNER}
            onClick={() => endTurn()}
          >
            {t("field.endTurn")}
          </button>
        </footer>
      </div>

      {enemyPhase ? (
        <div className="phase-banner" role="status">
          {t("battle.enemyTurn")}
        </div>
      ) : null}

      {paused ? (
        <div className="pause-root" role="presentation">
          <div className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <h2 id="pause-title">{t("battle.pause")}</h2>
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => session.setPaused(false)}>
              {t("battle.resume")}
            </button>
            <button type="button" className="hud-btn" onClick={() => session.goTo("menu")}>
              {t("battle.toMenu")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

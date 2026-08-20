import {
  ENEMY_OWNER,
  PLAYER_OWNER,
  createQuickMatch,
  createTacticsKernel,
  defaultTrainingWeapons,
  matchOutcome,
  pickEnemyCommand,
  weaponStatsFromRecord,
  type CellPos,
  type EntityState,
  type GameEvent,
  type HitPreview,
  type ReachableCell,
  type WeaponStats,
} from "@bylina/core";
import { createFieldRenderer, type FieldRenderer } from "@bylina/render";
import { useEffect, useMemo, useRef, useState } from "react";
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

  const kernel = useMemo(() => {
    const count =
      content.quickMatch.difficulties.find((item) => item.id === difficulty)?.enemyCount ??
      content.quickMatch.difficulties[0]?.enemyCount ??
      3;
    const initial = createQuickMatch({
      units: content.units,
      map: content.quickMatch.map,
      enemyPool: content.quickMatch.enemyPool,
      enemyCount: count,
      seed: matchSeed || 1,
    });
    return createTacticsKernel({
      initial,
      weapons,
      seed: matchSeed || 1,
    });
  }, [content.quickMatch, content.units, difficulty, matchSeed, weapons]);

  const [, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [aimId, setAimId] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enemyPhase, setEnemyPhase] = useState(false);

  useEffect(
    () =>
      kernel.subscribe(() => {
        setTick((value) => value + 1);
      }),
    [kernel],
  );

  const snapshot = kernel.getSnapshot();

  useEffect(() => {
    const first = snapshot.entities.find(isOwn);
    setSelectedId(first?.id ?? null);
    setAimId(null);
    setPreview(null);
  }, [snapshot.turnNumber]);

  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const aimed = snapshot.entities.find((entity) => entity.id === aimId);

  const reachable = useMemo(() => {
    if (selectedId === null || paused || busy) return [] as ReachableCell[];
    return kernel.getReachable(selectedId);
  }, [kernel, selectedId, snapshot.turnNumber, selected?.x, selected?.y, selected?.ap, paused, busy]);

  const byReach = useMemo(() => {
    const map = new Map<string, ReachableCell>();
    for (const cell of reachable) map.set(cellKey(cell.x, cell.y), cell);
    return map;
  }, [reachable]);

  const previewPath = useMemo(() => {
    if (!preview || selectedId === null) return [] as CellPos[];
    const [xs, ys] = preview.split(",");
    const path = kernel.getPath(selectedId, { x: Number(xs), y: Number(ys), z: 0 });
    return path?.path ?? [];
  }, [preview, selectedId, kernel, snapshot.turnNumber]);

  const hit: HitPreview | null = useMemo(() => {
    if (selectedId === null || aimId === null) return null;
    return kernel.getHitPreview(selectedId, aimId);
  }, [kernel, selectedId, aimId, selected?.x, selected?.y, selected?.ap, aimed?.x, aimed?.y, aimed?.hp]);

  const announce = (events: GameEvent[]): void => {
    const combat = events.find((event) => event.type === "COMBAT_RESOLVED");
    if (combat && combat.type === "COMBAT_RESOLVED") {
      if (combat.result === "MISS") setLog(t("combat.miss"));
      else if (combat.result === "CRIT") setLog(t("combat.crit", { dmg: combat.damageDealt }));
      else setLog(t("combat.hit", { dmg: combat.damageDealt }));
    }
    if (events.some((event) => event.type === "ENTITY_DIED")) setLog(t("combat.died"));
  };

  const concludeIfNeeded = (): boolean => {
    const outcome = matchOutcome(kernel.getSnapshot());
    if (outcome === "ongoing") return false;
    session.finishMatch(outcome);
    return true;
  };

  const playThen = (events: GameEvent[], after?: () => void): void => {
    setBusy(true);
    void (rendererRef.current?.play(events) ?? Promise.resolve()).finally(() => {
      setBusy(false);
      after?.();
    });
  };

  const tryMove = (to: CellPos): void => {
    if (selectedId === null || paused || busy) return;
    if (snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = kernel.apply({ type: "MOVE", actorId: selectedId, to });
    if (!result.ok) return;
    setPreview(null);
    setAimId(null);
    playThen(result.events);
  };

  const tryAttack = (targetId: number): void => {
    if (selectedId === null || paused || busy) return;
    if (snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = kernel.apply({ type: "ATTACK", actorId: selectedId, targetId });
    if (!result.ok) return;
    announce(result.events);
    setAimId(null);
    playThen(result.events, () => {
      concludeIfNeeded();
    });
  };

  /**
   * Ход Нави идёт по одному действию: решение ИИ → применение → ожидание
   * анимации. Камера и лог показывают, какой враг ходит, кого бьёт и когда
   * дружинник теряет здоровье.
   */
  const runEnemyPhase = async (): Promise<void> => {
    setEnemyPhase(true);
    try {
      await sleep(430);
      for (let guard = 0; guard < 96; guard += 1) {
        const snap = kernel.getSnapshot();
        if (snap.activeOwner !== ENEMY_OWNER) break;
        if (matchOutcome(snap) !== "ongoing") break;
        const command = pickEnemyCommand(kernel);
        const applied = command
          ? kernel.apply(command)
          : kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
        if (!applied.ok) {
          kernel.apply({ type: "END_TURN", playerId: String(ENEMY_OWNER) });
          break;
        }
        await (rendererRef.current?.play(applied.events) ?? Promise.resolve());
        announce(applied.events);
        if (!command) break;
        if (matchOutcome(kernel.getSnapshot()) !== "ongoing") break;
        await sleep(190);
      }
    } finally {
      setEnemyPhase(false);
    }
  };

  const endTurn = (): void => {
    if (paused || busy) return;
    if (snapshot.activeOwner !== PLAYER_OWNER) return;
    const result = kernel.apply({ type: "END_TURN", playerId: String(PLAYER_OWNER) });
    if (!result.ok) return;
    setPreview(null);
    setAimId(null);
    setLog(null);
    setBusy(true);
    void (async () => {
      try {
        await (rendererRef.current?.play(result.events) ?? Promise.resolve());
        if (kernel.getSnapshot().activeOwner === ENEMY_OWNER) {
          await runEnemyPhase();
        }
      } finally {
        setBusy(false);
        concludeIfNeeded();
      }
    })();
  };

  const onCell = (x: number, y: number): void => {
    if (paused || busy || snapshot.activeOwner !== PLAYER_OWNER) return;
    const occupant = snapshot.entities.find(
      (entity) => !entity.dead && entity.x === x && entity.y === y && entity.coverType === 0,
    );
    if (occupant && occupant.owner === PLAYER_OWNER && occupant.maxAp > 0) {
      setSelectedId(occupant.id);
      setAimId(null);
      setPreview(null);
      return;
    }
    if (occupant && selectedId !== null && occupant.owner !== PLAYER_OWNER) {
      if (aimId === occupant.id && hit?.available) {
        tryAttack(occupant.id);
        return;
      }
      setAimId(occupant.id);
      setPreview(null);
      return;
    }
    const reach = byReach.get(cellKey(x, y));
    if (!reach) {
      setPreview(null);
      setAimId(null);
      return;
    }
    const id = cellKey(x, y);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && preview !== id) {
      setPreview(id);
      setAimId(null);
      return;
    }
    tryMove({ x, y, z: reach.z });
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
    });
  }, [snapshot, selectedId, aimId, reachable, previewPath, hit?.available, hit?.heightMod, paused, debugMovement]);

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
          setAimId(null);
        }
        return;
      }
      if (event.key === "1" && aimId !== null && hit?.available) {
        tryAttack(aimId);
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
      setAimId(null);
      setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
  }, [paused, busy, snapshot, selectedId, aimId, hit, session]);

  const roster = snapshot.entities.filter((entity) => entity.owner === PLAYER_OWNER && entity.coverType === 0);
  const enemies = snapshot.entities.filter((entity) => entity.owner === ENEMY_OWNER && entity.coverType === 0);
  const weaponName = selected?.weaponId ? t(`weapon.${selected.weaponId}.name`) : "";
  const sideKey = snapshot.activeOwner === ENEMY_OWNER ? "field.sideEnemy" : "field.sidePlayer";

  return (
    <div className="battle-screen">
      <div ref={hostRef} className="battle-stage" />
      <div className="battle-hud">
        <header className="battle-top">
          <button type="button" className="hud-btn" onClick={() => session.setPaused(true)}>
            {t("battle.pause")}
          </button>
          <div className="battle-objective">
            <p className="eyebrow">{t("menu.quickMatch")}</p>
            <p>{t("battle.objectiveQuick")}</p>
            <p className="muted">
              {t("field.turn", { turn: snapshot.turnNumber })}
              {" · "}
              {t(sideKey)}
            </p>
            {enemies.length > 0 ? (
              <div className="enemies-strip" aria-label={t("field.sideEnemy")}>
                {enemies.map((entity) => {
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
            <p className="aim-card">
              {hit.available
                ? t("combat.preview", {
                    chance: hit.chance ?? 0,
                    dmg: `${hit.dmgMin}-${hit.dmgMax}`,
                    cover:
                      hit.cover === 2
                        ? t("combat.fullCover")
                        : hit.cover === 1
                          ? t("combat.halfCover")
                          : t("combat.noCover"),
                    height: hit.heightMod === 1 ? "+1" : hit.heightMod === -1 ? "−1" : "0",
                    flank: hit.flanked ? t("combat.flanked") : t("combat.notFlanked"),
                  })
                : t(`combat.blocked.${hit.reason ?? "ILLEGAL"}`)}
            </p>
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
                </div>
              </div>
            ) : (
              <p>{t("battle.empty")}</p>
            )}
          </div>
          <div className="skill-row">
            <button
              type="button"
              className="hud-btn skill-slot"
              disabled={!selected || selected.ap <= 0 || busy || snapshot.activeOwner !== PLAYER_OWNER}
              onClick={() => {
                if (aimId !== null && hit?.available) tryAttack(aimId);
              }}
            >
              <kbd>1</kbd>
              {weaponName || t("battle.weapon")}
            </button>
            <button
              type="button"
              className={`hud-btn debug-toggle${debugMovement ? " is-on" : ""}`}
              onClick={() => setDebugMovement((value) => !value)}
              title={debugMovement ? t("battle.debugMovementHint") : undefined}
              aria-pressed={debugMovement}
            >
              {t("battle.debugMovement")}
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

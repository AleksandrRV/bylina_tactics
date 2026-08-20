import {
  DEBUG_PLAYER_ID,
  type CellPos,
  type EntityState,
  type GameEvent,
  type HitPreview,
  type ReachableCell,
  type Tile,
} from "@bylina/core";
import { useEffect, useMemo, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import "./field.css";

const CELL = 52;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function Token({ kind }: { kind: "player" | "ally" | "enemy" | "cover" }) {
  if (kind === "cover") {
    return (
      <svg className="token" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="1" fill="#8b6a3a" />
        <path d="M4 12 L12 5 L20 12" fill="#6b4f2a" />
        <rect x="10" y="14" width="4" height="6" fill="#3a2a18" />
      </svg>
    );
  }
  const fill = kind === "player" ? "#e0b34a" : kind === "enemy" ? "#8bc34a" : "#9aa7b2";
  const ring = kind === "player" ? "#f3ecdc" : kind === "enemy" ? "#1b3a14" : "#5c6670";
  return (
    <svg className="token" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill={fill} stroke={ring} strokeWidth="2" />
    </svg>
  );
}

function occupantKind(entity: EntityState): "player" | "ally" | "enemy" | "cover" | null {
  if (entity.coverType > 0) return "cover";
  if (entity.dead) return null;
  if (entity.id === DEBUG_PLAYER_ID) return "player";
  if (entity.owner === 2) return "enemy";
  if (entity.obstacle) return "ally";
  return null;
}

function tileLookup(tiles: Tile[], _width: number, x: number, y: number): Tile | undefined {
  return tiles.find((tile) => tile.x === x && tile.y === y);
}

export function FieldScreen() {
  useI18nTick();
  const t = useT();
  const { session, tactics } = useServices();
  const [, setTick] = useState(0);
  const [log, setLog] = useState<string | null>(null);

  useEffect(
    () =>
      tactics.subscribe(() => {
        setTick((value) => value + 1);
      }),
    [tactics],
  );

  const snapshot = tactics.getSnapshot();
  const [selectedId, setSelectedId] = useState<number | null>(DEBUG_PLAYER_ID);
  const [aimId, setAimId] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const list = snapshot.entities.filter(
      (entity) => !entity.dead && entity.coverType === 0 && entity.owner === snapshot.activeOwner && entity.maxAp > 0,
    );
    setSelectedId((current) => (current !== null && list.some((entity) => entity.id === current) ? current : (list[0]?.id ?? null)));
    setAimId(null);
  }, [snapshot.activeOwner, snapshot.turnNumber]);

  const selected = snapshot.entities.find((entity) => entity.id === selectedId);
  const aimed = snapshot.entities.find((entity) => entity.id === aimId);

  const reachable = useMemo(() => {
    if (selectedId === null) return [];
    return tactics.getReachable(selectedId);
  }, [tactics, selectedId, snapshot.turnNumber, selected?.x, selected?.y, selected?.ap]);

  const byReach = useMemo(() => {
    const map = new Map<string, ReachableCell>();
    for (const cell of reachable) map.set(cellKey(cell.x, cell.y), cell);
    return map;
  }, [reachable]);

  const previewPath = useMemo(() => {
    if (!preview || selectedId === null) return new Set<string>();
    const [xs, ys] = preview.split(",");
    const path = tactics.getPath(selectedId, { x: Number(xs), y: Number(ys), z: 0 });
    return new Set((path?.path ?? []).map((cell) => cellKey(cell.x, cell.y)));
  }, [preview, selectedId, tactics, snapshot.turnNumber]);

  const hit: HitPreview | null = useMemo(() => {
    if (selectedId === null || aimId === null) return null;
    return tactics.getHitPreview(selectedId, aimId);
  }, [tactics, selectedId, aimId, selected?.x, selected?.y, selected?.ap, aimed?.x, aimed?.y, aimed?.hp]);

  const announce = (events: GameEvent[]): void => {
    const combat = events.find((event) => event.type === "COMBAT_RESOLVED");
    if (combat && combat.type === "COMBAT_RESOLVED") {
      if (combat.result === "MISS") setLog(t("combat.miss"));
      else if (combat.result === "CRIT") setLog(t("combat.crit", { dmg: combat.damageDealt }));
      else setLog(t("combat.hit", { dmg: combat.damageDealt }));
    }
    const death = events.find((event) => event.type === "ENTITY_DIED");
    if (death) setLog(t("combat.died"));
  };

  const tryMove = (to: CellPos): void => {
    if (selectedId === null) return;
    const result = tactics.apply({ type: "MOVE", actorId: selectedId, to });
    if (result.ok) {
      setPreview(null);
      setAimId(null);
    }
  };

  const tryAttack = (targetId: number): void => {
    if (selectedId === null) return;
    const result = tactics.apply({ type: "ATTACK", actorId: selectedId, targetId });
    if (result.ok) {
      announce(result.events);
      setAimId(null);
    }
  };

  const onCell = (x: number, y: number, z: number): void => {
    const occupant = snapshot.entities.find(
      (entity) => !entity.dead && entity.x === x && entity.y === y && entity.coverType === 0,
    );
    if (occupant && occupant.owner === snapshot.activeOwner && occupant.maxAp > 0) {
      setSelectedId(occupant.id);
      setAimId(null);
      setPreview(null);
      return;
    }
    if (occupant && selectedId !== null && occupant.owner !== snapshot.activeOwner) {
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
    tryMove({ x, y, z });
  };

  const rise = (z: number): number => z * 8;

  return (
    <div className="field-screen">
      <header className="field-bar">
        <button type="button" className="btn btn-ghost field-back" onClick={() => session.goTo("menu")}>
          {t("field.back")}
        </button>
        <div className="field-meta">
          <p className="eyebrow">{t("field.title")}</p>
          <p>
            {t("field.turn", { turn: snapshot.turnNumber })}
            {" · "}
            {snapshot.activeOwner === 1 ? t("field.sidePlayer") : t("field.sideEnemy")}
            {" · "}
            {t("field.ap", { current: selected?.ap ?? 0, max: selected?.maxAp ?? 2 })}
          </p>
        </div>
        <div className="ap-pips" aria-hidden="true">
          {Array.from({ length: selected?.maxAp ?? 2 }, (_, index) => (
            <span key={index} className={index < (selected?.ap ?? 0) ? "pip pip-on" : "pip"} />
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary field-end"
          onClick={() => tactics.apply({ type: "END_TURN", playerId: String(snapshot.activeOwner) })}
        >
          {t("field.endTurn")}
        </button>
      </header>

      {log ? (
        <p className="combat-log" role="status">
          {log}
        </p>
      ) : null}

      {hit ? (
        <p className="aim-panel">
          {hit.available
            ? t("combat.preview", {
                chance: hit.chance ?? 0,
                dmg: `${hit.dmgMin}-${hit.dmgMax}`,
                cover: hit.cover === 2 ? t("combat.fullCover") : hit.cover === 1 ? t("combat.halfCover") : t("combat.noCover"),
                height: hit.heightMod === 1 ? "+1" : hit.heightMod === -1 ? "−1" : "0",
                flank: hit.flanked ? t("combat.flanked") : t("combat.notFlanked"),
              })
            : t(`combat.blocked.${hit.reason ?? "ILLEGAL"}`)}
        </p>
      ) : null}

      <div className="field-stage">
        <div
          className="field-board"
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: `repeat(${snapshot.grid.width}, ${CELL}px)`,
            gridTemplateRows: `repeat(${snapshot.grid.height}, ${CELL}px)`,
            gap: 0,
            paddingTop: 20,
            paddingBottom: 20,
          }}
        >
          {selected && aimed ? (
            <svg className="aim-layer" width={snapshot.grid.width * CELL} height={snapshot.grid.height * CELL}>
              <line
                x1={(selected.x + 0.5) * CELL}
                y1={(selected.y + 0.5) * CELL}
                x2={(aimed.x + 0.5) * CELL}
                y2={(aimed.y + 0.5) * CELL}
                className={hit?.available ? "aim-ok" : "aim-bad"}
              />
            </svg>
          ) : null}
          {snapshot.grid.tiles.map((tile) => {
            const id = cellKey(tile.x, tile.y);
            const reach = byReach.get(id);
            const occupant = snapshot.entities.find(
              (entity) => !entity.dead && entity.x === tile.x && entity.y === tile.y,
            );
            const kind = occupant ? occupantKind(occupant) : null;
            const north = tileLookup(snapshot.grid.tiles, snapshot.grid.width, tile.x, tile.y - 1);
            const south = tileLookup(snapshot.grid.tiles, snapshot.grid.width, tile.x, tile.y + 1);
            const west = tileLookup(snapshot.grid.tiles, snapshot.grid.width, tile.x - 1, tile.y);
            const east = tileLookup(snapshot.grid.tiles, snapshot.grid.width, tile.x + 1, tile.y);
            const visualZ = tile.pit ? 0 : tile.z;
            const levelOf = (other: Tile | undefined): number | null => {
              if (!other) return null;
              return other.pit ? 0 : other.z;
            };
            const southLevel = levelOf(south);
            const dropSouth = southLevel === null ? visualZ : Math.max(0, visualZ - southLevel);
            const classes = [
              "tile",
              `tile-z${visualZ}`,
              tile.pit ? "tile-pit" : "",
              tile.blockLOS ? "tile-wall" : "",
              kind === "cover" ? "tile-cover" : "",
              reach ? `tile-reach-${reach.apCost}` : "",
              previewPath.has(id) ? "tile-path" : "",
              occupant && occupant.id === selectedId ? "tile-selected" : "",
              occupant && occupant.id === aimId ? "tile-aimed" : "",
              dropSouth > 0 ? "has-riser" : "",
              !tile.pit && north && (north.pit ? 0 : north.z) < tile.z ? "cliff-n" : "",
              dropSouth > 0 ? "cliff-s" : "",
              !tile.pit && west && (west.pit ? 0 : west.z) < tile.z ? "cliff-w" : "",
              !tile.pit && east && (east.pit ? 0 : east.z) < tile.z ? "cliff-e" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const label = tile.pit
              ? t("field.pit")
              : tile.blockLOS
                ? t("field.wall")
                : kind === "cover"
                  ? t("field.cover")
                  : t("field.height", { z: tile.z });

            return (
              <button
                key={id}
                type="button"
                className={classes}
                style={{
                  width: CELL,
                  height: CELL,
                  zIndex: tile.y * 10 + visualZ * 100,
                }}
                aria-label={`${tile.x}, ${tile.y}. ${label}`}
                onClick={() => onCell(tile.x, tile.y, tile.z)}
              >
                {dropSouth > 0 ? <span className="tile-riser" style={{ height: rise(dropSouth) }} /> : null}
                <span className="tile-face">
                  {tile.pit ? <span className="tile-hole" /> : null}
                  {tile.blockLOS ? <span className="tile-block" /> : null}
                  {kind ? <Token kind={kind} /> : null}
                  {occupant && occupant.coverType === 0 && !occupant.dead ? (
                    <span className="hp-bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, (occupant.hp / occupant.maxHp) * 100)}%` }} />
                    </span>
                  ) : null}
                  {reach ? <span className="tile-mp">{reach.mpCost}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <footer className="field-legend">
        <span>
          <i className="lg lg-z0" /> {t("field.legendLow")}
        </span>
        <span>
          <i className="lg lg-z1" /> {t("field.legendMid")}
        </span>
        <span>
          <i className="lg lg-z2" /> {t("field.legendHigh")}
        </span>
        <span>
          <i className="lg lg-pit" /> {t("field.legendPit")}
        </span>
        <span>
          <i className="lg lg-wall" /> {t("field.legendWall")}
        </span>
        <span>
          <i className="lg lg-cover" /> {t("field.legendCover")}
        </span>
        <span>
          <i className="lg lg-walk" /> {t("field.legendWalk")}
        </span>
        <span>
          <i className="lg lg-dash" /> {t("field.legendDash")}
        </span>
        <span>
          <i className="lg lg-enemy" /> {t("field.legendEnemy")}
        </span>
      </footer>
    </div>
  );
}

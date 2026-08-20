import { DEBUG_PLAYER_ID, type CellPos, type EntityState, type ReachableCell, type Tile } from "@bylina/core";
import { useEffect, useMemo, useState } from "react";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";
import "./field.css";

const CELL = 52;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function Token({ kind }: { kind: "player" | "ally" | "cover" }) {
  if (kind === "cover") {
    return (
      <svg className="token" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="1" fill="#8b6a3a" />
        <path d="M4 12 L12 5 L20 12" fill="#6b4f2a" />
        <rect x="10" y="14" width="4" height="6" fill="#3a2a18" />
      </svg>
    );
  }
  const fill = kind === "player" ? "#e0b34a" : "#9aa7b2";
  const ring = kind === "player" ? "#f3ecdc" : "#5c6670";
  return (
    <svg className="token" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill={fill} stroke={ring} strokeWidth="2" />
    </svg>
  );
}

function occupantKind(entity: EntityState): "player" | "ally" | "cover" | null {
  if (entity.coverType > 0) return "cover";
  if (entity.id === DEBUG_PLAYER_ID) return "player";
  if (entity.obstacle && !entity.dead) return "ally";
  return null;
}

function tileLookup(tiles: Tile[], width: number, x: number, y: number): Tile | undefined {
  return tiles.find((tile) => tile.x === x && tile.y === y);
}

export function FieldScreen() {
  useI18nTick();
  const t = useT();
  const { session, tactics } = useServices();
  const [, setTick] = useState(0);

  useEffect(() => tactics.subscribe(() => setTick((value) => value + 1)), [tactics]);

  const snapshot = tactics.getSnapshot();
  const player = snapshot.entities.find((entity) => entity.id === DEBUG_PLAYER_ID);
  const [selectedId, setSelectedId] = useState<number | null>(DEBUG_PLAYER_ID);
  const [preview, setPreview] = useState<string | null>(null);

  const reachable = useMemo(() => {
    if (selectedId === null) return [];
    return tactics.getReachable(selectedId);
  }, [tactics, selectedId, snapshot.turnNumber, player?.x, player?.y, player?.ap]);

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

  const tryMove = (to: CellPos): void => {
    if (selectedId === null) return;
    const result = tactics.apply({ type: "MOVE", actorId: selectedId, to });
    if (result.ok) setPreview(null);
  };

  const onCell = (x: number, y: number, z: number): void => {
    const occupant = snapshot.entities.find(
      (entity) => !entity.dead && entity.x === x && entity.y === y && entity.coverType === 0,
    );
    if (occupant && occupant.id === DEBUG_PLAYER_ID) {
      setSelectedId(occupant.id);
      setPreview(null);
      return;
    }
    const reach = byReach.get(cellKey(x, y));
    if (!reach) {
      setPreview(null);
      return;
    }
    const id = cellKey(x, y);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && preview !== id) {
      setPreview(id);
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
            {t("field.ap", { current: player?.ap ?? 0, max: player?.maxAp ?? 2 })}
          </p>
        </div>
        <div className="ap-pips" aria-hidden="true">
          {Array.from({ length: player?.maxAp ?? 2 }, (_, index) => (
            <span key={index} className={index < (player?.ap ?? 0) ? "pip pip-on" : "pip"} />
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

      <div className="field-stage">
        <div
          className="field-board"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${snapshot.grid.width}, ${CELL}px)`,
            gridTemplateRows: `repeat(${snapshot.grid.height}, ${CELL}px)`,
            gap: 0,
            paddingTop: 20,
            paddingBottom: 20,
          }}
        >
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
      </footer>
    </div>
  );
}

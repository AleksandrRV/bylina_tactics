import { makeGrid, tileAt } from "./grid.js";
import { findPath } from "./pathfinding.js";
import type { Rng } from "./rng.js";
import type { EntityState, Grid, Tile } from "./types.js";

export interface MapGenConfig {
  width: number;
  height: number;
  pitChance: number;
  coverDensity: number;
  heightMix: { z0: number; z1: number; z2: number };
}

export const QUICK_MATCH_MAP: MapGenConfig = {
  width: 12,
  height: 10,
  pitChance: 0.05,
  coverDensity: 0.07,
  heightMix: { z0: 0.15, z1: 0.7, z2: 0.15 },
};

export interface SpawnPoint {
  x: number;
  y: number;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function pickHeight(rng: Rng, mix: MapGenConfig["heightMix"]): 0 | 1 | 2 {
  const total = mix.z0 + mix.z1 + mix.z2;
  const roll = rng.nextInt(1, 1000) / 1000;
  const p0 = mix.z0 / total;
  const p1 = p0 + mix.z1 / total;
  if (roll < p0) return 0;
  if (roll < p1) return 1;
  return 2;
}

function probe(x: number, y: number, z: number): EntityState {
  return {
    id: -1,
    configId: "probe",
    owner: 1,
    x,
    y,
    z,
    dir: 0,
    ap: 2,
    maxAp: 2,
    mobility: 8,
    hp: 1,
    maxHp: 1,
    aim: 0,
    defense: 0,
    weaponId: "",
    obstacle: false,
    dead: false,
    flying: false,
    coverType: 0,
  };
}

function connected(grid: Grid, covers: readonly EntityState[], from: SpawnPoint, to: SpawnPoint): boolean {
  const start = tileAt(grid, from.x, from.y);
  const walker = probe(from.x, from.y, start?.z ?? 1);
  return findPath(grid, covers, walker, to.x, to.y) !== null;
}

function reservedSet(players: SpawnPoint[], enemies: SpawnPoint[]): Set<string> {
  const set = new Set<string>();
  for (const point of [...players, ...enemies]) set.add(key(point.x, point.y));
  return set;
}

export function playerSpawns(height: number): SpawnPoint[] {
  const mid = Math.floor(height / 2);
  const ys = [mid - 1, mid, mid + 1].map((y) => Math.max(1, Math.min(height - 2, y)));
  const unique = [...new Set(ys)];
  while (unique.length < 3) {
    const next = unique[unique.length - 1]! + 1;
    unique.push(Math.min(height - 2, next));
  }
  return unique.slice(0, 3).map((y) => ({ x: 1, y }));
}

export function enemySpawns(count: number, width: number, height: number): SpawnPoint[] {
  const band: SpawnPoint[] = [];
  for (let x = width - 3; x <= width - 2; x += 1) {
    for (let y = 1; y <= height - 2; y += 1) {
      band.push({ x, y });
    }
  }
  if (band.length === 0) return [{ x: width - 2, y: Math.floor(height / 2) }];
  const result: SpawnPoint[] = [];
  const used = new Set<string>();
  const n = Math.min(count, band.length);
  for (let i = 0; i < n; i += 1) {
    const index = Math.min(band.length - 1, Math.floor((i * band.length) / n));
    let point = band[index]!;
    let guard = 0;
    while (used.has(key(point.x, point.y)) && guard < band.length) {
      point = band[(index + guard + 1) % band.length]!;
      guard += 1;
    }
    used.add(key(point.x, point.y));
    result.push(point);
  }
  return result;
}

function smoothCliffs(tiles: Tile[], width: number, height: number): void {
  for (const tile of tiles) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = tiles[ny * width + nx];
      if (!other) continue;
      if (Math.abs(tile.z - other.z) !== 2) continue;
      if (tile.z === 2) tile.z = 1;
      if (other.z === 2) other.z = 1;
      if (tile.z === 0) tile.z = 1;
      if (other.z === 0) other.z = 1;
    }
  }
}

export function generateBattlefield(
  config: MapGenConfig,
  rng: Rng,
  players: SpawnPoint[],
  enemies: SpawnPoint[],
): { grid: Grid; covers: EntityState[] } {
  const reserved = reservedSet(players, enemies);

  const attempt = (): { grid: Grid; covers: EntityState[] } => {
    const grid = makeGrid(config.width, config.height, 1);
    for (const tile of grid.tiles) {
      tile.z = pickHeight(rng, config.heightMix);
    }
    smoothCliffs(grid.tiles, config.width, config.height);

    for (const tile of grid.tiles) {
      if (reserved.has(key(tile.x, tile.y))) continue;
      if (rng.nextInt(1, 1000) / 1000 < config.pitChance) tile.pit = true;
    }

    const wallBudget = Math.max(2, Math.floor((config.width * config.height) / 40));
    let walls = 0;
    let guard = 0;
    while (walls < wallBudget && guard < 200) {
      guard += 1;
      const x = rng.nextInt(2, config.width - 3);
      const y = rng.nextInt(1, config.height - 2);
      if (reserved.has(key(x, y))) continue;
      const tile = tileAt(grid, x, y);
      if (!tile || tile.pit || tile.blockLOS) continue;
      tile.blockLOS = true;
      walls += 1;
    }

    const covers: EntityState[] = [];
    const coverBudget = Math.max(1, Math.floor(config.width * config.height * config.coverDensity));
    guard = 0;
    while (covers.length < coverBudget && guard < 400) {
      guard += 1;
      const x = rng.nextInt(2, config.width - 3);
      const y = rng.nextInt(1, config.height - 2);
      if (reserved.has(key(x, y))) continue;
      const tile = tileAt(grid, x, y);
      if (!tile || tile.pit || tile.blockLOS) continue;
      if (covers.some((cover) => cover.x === x && cover.y === y)) continue;
      covers.push({
        id: 200 + covers.length,
        configId: "cover",
        owner: 0,
        x,
        y,
        z: tile.z,
        dir: 0,
        ap: 0,
        maxAp: 0,
        mobility: 0,
        hp: 2,
        maxHp: 2,
        aim: 0,
        defense: 0,
        weaponId: "",
        obstacle: true,
        dead: false,
        flying: false,
        coverType: rng.nextInt(1, 2) as 1 | 2,
      });
    }

    return { grid, covers };
  };

  for (let i = 0; i < 48; i += 1) {
    const generated = attempt();
    const spawnOk = [...players, ...enemies].every((point) => {
      const tile = tileAt(generated.grid, point.x, point.y);
      return tile && !tile.pit && !tile.blockLOS && !generated.covers.some((cover) => cover.x === point.x && cover.y === point.y);
    });
    if (!spawnOk) continue;
    const ok = players.every((from) => enemies.every((to) => connected(generated.grid, generated.covers, from, to)));
    if (ok) return generated;
  }

  const fallback = makeGrid(config.width, config.height, 1);
  return { grid: fallback, covers: [] };
}

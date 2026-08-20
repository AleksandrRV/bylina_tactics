import { makeGrid, tileAt } from "./grid.js";
import type { EntityState, MatchState } from "./types.js";

const PLAYER = 1;

function setZ(state: MatchState, x: number, y: number, z: number): void {
  const tile = tileAt(state.grid, x, y);
  if (tile) tile.z = z;
}

function setPit(state: MatchState, x: number, y: number): void {
  const tile = tileAt(state.grid, x, y);
  if (tile) tile.pit = true;
}

function setWall(state: MatchState, x: number, y: number): void {
  const tile = tileAt(state.grid, x, y);
  if (tile) tile.blockLOS = true;
}

/**
 * Фиксированная карта выпуска 0.2.0.
 * Содержит три яруса, ямы, глухую стену, союзника и укрытие.
 */
export function createDebugMatch(): MatchState {
  const grid = makeGrid(12, 8, 1);
  const state: MatchState = {
    turnNumber: 1,
    activeOwner: PLAYER,
    grid,
    entities: [],
  };

  for (let x = 0; x < 12; x += 1) {
    setZ(state, x, 6, 0);
    setZ(state, x, 7, 0);
  }
  for (let x = 8; x < 12; x += 1) {
    for (let y = 0; y < 3; y += 1) setZ(state, x, y, 2);
  }
  setZ(state, 7, 2, 0);

  setPit(state, 3, 3);
  setPit(state, 4, 3);
  setWall(state, 6, 1);
  setWall(state, 6, 2);
  setWall(state, 6, 3);

  const playerTile = tileAt(grid, 1, 6);
  const allyTile = tileAt(grid, 3, 6);
  const coverTile = tileAt(grid, 5, 5);

  const player: EntityState = {
    id: 1,
    configId: "debug_walker",
    owner: PLAYER,
    x: 1,
    y: 6,
    z: playerTile?.z ?? 0,
    dir: 0,
    ap: 2,
    maxAp: 2,
    mobility: 6,
    hp: 10,
    maxHp: 10,
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
  };

  const ally: EntityState = {
    id: 2,
    configId: "debug_ally",
    owner: PLAYER,
    x: 3,
    y: 6,
    z: allyTile?.z ?? 0,
    dir: 0,
    ap: 0,
    maxAp: 2,
    mobility: 6,
    hp: 8,
    maxHp: 8,
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 0,
  };

  const cover: EntityState = {
    id: 3,
    configId: "debug_cover",
    owner: 0,
    x: 5,
    y: 5,
    z: coverTile?.z ?? 1,
    dir: 0,
    ap: 0,
    maxAp: 0,
    mobility: 0,
    hp: 2,
    maxHp: 2,
    obstacle: true,
    dead: false,
    flying: false,
    coverType: 2,
  };

  state.entities.push(player, ally, cover);
  return state;
}

export const DEBUG_PLAYER_ID = 1;
export const DEBUG_ALLY_ID = 2;
export const DEBUG_COVER_ID = 3;
export const PLAYER_OWNER = PLAYER;

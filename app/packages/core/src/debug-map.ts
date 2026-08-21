import { makeGrid, tileAt } from "./grid.js";
import type { EntityState, MatchState } from "./types.js";
import { DEBUG_BOW } from "./weapons.js";

const PLAYER = 1;
const ENEMY = 2;

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

function unit(partial: EntityState): EntityState {
  return partial;
}

/**
 * Фиксированная карта выпуска 0.3.0.
 * Два стрелка разных сторон, укрытие у противника, стена на линии, три яруса.
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

  const playerTile = tileAt(grid, 2, 4);
  const allyTile = tileAt(grid, 1, 6);
  const coverTile = tileAt(grid, 9, 4);
  const enemyTile = tileAt(grid, 10, 4);

  state.entities.push(
    unit({
      id: 1,
      configId: "debug_shooter",
      owner: PLAYER,
      x: 2,
      y: 4,
      z: playerTile?.z ?? 0,
      dir: 0,
      ap: 2,
      maxAp: 2,
      mobility: 6,
      hp: 10,
      maxHp: 10,
      aim: 80,
      defense: 0,
      vision: 12,
      weaponId: DEBUG_BOW.id,
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
      movementSpent: 0,
    }),
    unit({
      id: 2,
      configId: "debug_ally",
      owner: PLAYER,
      x: 1,
      y: 6,
      z: allyTile?.z ?? 0,
      dir: 0,
      ap: 0,
      maxAp: 0,
      mobility: 6,
      hp: 8,
      maxHp: 8,
      aim: 60,
      defense: 0,
      vision: 12,
      weaponId: DEBUG_BOW.id,
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
      movementSpent: 0,
    }),
    unit({
      id: 3,
      configId: "debug_cover",
      owner: 0,
      x: 9,
      y: 4,
      z: coverTile?.z ?? 1,
      dir: 0,
      ap: 0,
      maxAp: 0,
      mobility: 0,
      hp: 2,
      maxHp: 2,
      aim: 0,
      defense: 0,
      vision: 0,
      weaponId: "",
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 2,
      overwatch: false,
      movementSpent: 0,
    }),
    unit({
      id: 4,
      configId: "debug_enemy",
      owner: ENEMY,
      x: 10,
      y: 4,
      z: enemyTile?.z ?? 1,
      dir: 2,
      ap: 2,
      maxAp: 2,
      mobility: 6,
      hp: 10,
      maxHp: 10,
      aim: 70,
      defense: 0,
      vision: 12,
      weaponId: DEBUG_BOW.id,
      obstacle: true,
      dead: false,
      flying: false,
      coverType: 0,
      overwatch: false,
      movementSpent: 0,
    }),
  );

  return state;
}

export const DEBUG_PLAYER_ID = 1;
export const DEBUG_ALLY_ID = 2;
export const DEBUG_COVER_ID = 3;
export const DEBUG_ENEMY_ID = 4;
export const PLAYER_OWNER = PLAYER;
export const ENEMY_OWNER = ENEMY;

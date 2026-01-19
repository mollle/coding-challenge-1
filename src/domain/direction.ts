import { Direction } from "./types";

export type Vector = { dx: number; dy: number };

/**
 * Direction vectors for the grid.
 * Coordinate system: moving north increases `y`, moving east increases `x`.
 */
const VECTORS: Record<Direction, Vector> = {
  north: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: -1 },
  west: { dx: -1, dy: 0 },
};

/** Maps a direction string to its movement vector. */
export function directionToVector(direction: Direction): Vector {
  return VECTORS[direction];
}
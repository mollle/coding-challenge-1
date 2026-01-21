import { Direction } from "./types";

/**
 * A 2D movement vector for grid navigation.
 * @property dx - Horizontal displacement (positive = east, negative = west)
 * @property dy - Vertical displacement (positive = north, negative = south)
 */
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

/**
 * Converts a cardinal direction to its corresponding movement vector.
 * @param direction - One of 'north', 'east', 'south', 'west'
 * @returns The movement vector for the given direction
 */
export function directionToVector(direction: Direction): Vector {
  return VECTORS[direction];
}
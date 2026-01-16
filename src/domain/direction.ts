import { Direction } from "./types";

export type Vector = { dx: number; dy: number };

const VECTORS: Record<Direction, Vector> = {
  north: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: -1 },
  west: { dx: -1, dy: 0 },
};

export function directionToVector(direction: Direction): Vector {
  return VECTORS[direction];
}
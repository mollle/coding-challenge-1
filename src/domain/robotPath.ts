import { directionToVector } from "./direction";
import { Command, Start } from "./types";

/**
 * Coordinate encoding constants.
 * Coordinates are in range [-100_000, 100_000] per task spec.
 * Using numeric keys instead of strings reduces memory ~4x and improves hash performance.
 */
const OFFSET = 100_000;
const MULTIPLIER = 2 * OFFSET + 1; // 200_001 — ensures no collision between (x1,y1) and (x2,y2)

/**
 * Encodes (x, y) into a unique integer for use as a Set key.
 * Formula: (y + OFFSET) * MULTIPLIER + (x + OFFSET)
 * Max value: 200_000 * 200_001 + 200_000 = 40_000_400_000 (safe integer)
 */
function encodePosition(x: number, y: number): number {
  return (y + OFFSET) * MULTIPLIER + (x + OFFSET);
}

/**
 * Decodes an encoded position back to (x, y). Useful for debugging.
 */
export function decodePosition(encoded: number): { x: number; y: number } {
  const yOffset = Math.floor(encoded / MULTIPLIER);
  const xOffset = encoded % MULTIPLIER;
  return { x: xOffset - OFFSET, y: yOffset - OFFSET };
}

/**
 * Counts the number of unique grid vertices cleaned by the robot.
 *
 * Uses a Set<number> with integer-encoded positions for memory efficiency
 * (~4x less memory than string keys).
 *
 * Semantics (per task specification):
 * - The robot cleans the start vertex.
 * - The robot cleans every intermediate vertex along each step (not only stop points).
 * - Uniqueness is by coordinate pair (x,y) on the integer grid.
 * - Inputs are assumed well-formed; no bounds checking or validation is performed.
 *
 * @param start - Initial position {x, y} on the grid
 * @param commands - Array of movement commands (direction + steps)
 * @returns Number of unique vertices visited (cleaned)
 */
export function countUniqueCleaned(start: Start, commands: Command[]): number {
  let x = start.x;
  let y = start.y;

  const visited = new Set<number>();
  visited.add(encodePosition(x, y));

  for (const command of commands) {
    const { dx, dy } = directionToVector(command.direction);

    for (let i = 0; i < command.steps; i += 1) {
      x += dx;
      y += dy;
      visited.add(encodePosition(x, y));
    }
  }

  return visited.size;
}
import { directionToVector } from "./direction";
import { Command, Start } from "./types";

/**
 * Counts the number of unique grid vertices cleaned by the robot.
 *
 * Semantics (per task specification):
 * - The robot cleans the start vertex.
 * - The robot cleans every intermediate vertex along each step (not only stop points).
 * - Uniqueness is by coordinate pair (x,y) on the integer grid.
 * - Inputs are assumed well-formed; no bounds checking or validation is performed.
 */
export function countUniqueCleaned(start: Start, commands: Command[]): number {
  let x = start.x;
  let y = start.y;

  const visited = new Set<string>();
  visited.add(`${x},${y}`);

  for (const command of commands) {
    const { dx, dy } = directionToVector(command.direction);

    for (let i = 0; i < command.steps; i += 1) {
      x += dx;
      y += dy;
      visited.add(`${x},${y}`);
    }
  }

  return visited.size;
}
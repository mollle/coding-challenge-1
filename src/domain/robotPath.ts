import { directionToVector } from "./direction";
import { Command, Start } from "./types";

/**
 * Counts the number of unique vertices cleaned by the robot.
 * Robot cleans every vertex it touches, including the start.
 *
 * Pure function: no shared state between calls.
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
import { directionToVector } from "./direction";
import { Command, Start } from "./types";


/** Represents an interval [start, end] on a line*/
interface Interval {
  start: number;
  end: number;
}

/** Horizontal segment on a y-coordinate*/
interface HorizontalSegment {
  yCoordinate: number;
  xStart: number;
  xEnd: number;
}

/** Vertical segment on a x-coordinate*/
interface VerticalSegment {
  xCoordinate: number;
  yStart: number;
  yEnd: number;
}

/** Result of converting commands to segments */
interface SegmentConversionResult {
  horizontalSegments: HorizontalSegment[];
  verticalSegments: VerticalSegment[];
}

/** Result of grouping and merging segments */
interface MergedSegmentsResult {
  mergedIntervalsByCoordinate: Map<number, Interval[]>;
  totalPoints: number;
}


/**
 * Counts the number of unique grid vertices cleaned by the robot with a segment-merging approach.
 *
 * Algorithm Overview:
 * 1. Convert path into horizontal segments (fixed y) and vertical segments (fixed x)
 * 2. For horizontals: group by y-coordinate, merge overlapping x-intervals, count points
 * 3. For verticals: group by x-coordinate, merge overlapping y-intervals, count points
 * 4. Find and subtract intersection points (counted in both horizontal and vertical)
 *
 * @param start - Initial position {x, y} on the grid
 * @param commands - Array of movement commands (direction + steps)
 * @returns Number of unique vertices visited (cleaned)
 */
export function countUniqueCleaned(start: Start, commands: Command[]): number {
  if (commands.length === 0) {
    return 1;
  }

  // Step 1: Convert movement commands into line segments
  const { horizontalSegments, verticalSegments } = convertCommandsToSegments(start, commands);

  // Step 2: Group horizontal segments by y-coordinate and merge overlapping x-intervals
  const { mergedIntervalsByCoordinate: mergedHorizontalIntervalsByY, totalPoints: totalHorizontalPoints } =
    groupAndMergeHorizontalSegments(horizontalSegments);

  // Step 3: Group vertical segments by x-coordinate and merge overlapping y-intervals
  const { mergedIntervalsByCoordinate: mergedVerticalIntervalsByX, totalPoints: totalVerticalPoints } =
    groupAndMergeVerticalSegments(verticalSegments);

  // Step 4: Count intersection points and subtract them from total count
  const intersectionCount = countIntersectionPoints(mergedHorizontalIntervalsByY, mergedVerticalIntervalsByX);

  // Final result: horizontal points + vertical points - double-counted intersections
  return totalHorizontalPoints + totalVerticalPoints - intersectionCount;
}


/**
 * Step 1: Convert movement commands into horizontal and vertical line segments.
 * 
 * @param start - Initial position {x, y} on the grid
 * @param commands - Array of movement commands (direction + steps)
 * @returns Object containing arrays of horizontal and vertical segments
 */
function convertCommandsToSegments(start: Start, commands: Command[]): SegmentConversionResult {
  const horizontalSegments: HorizontalSegment[] = [];
  const verticalSegments: VerticalSegment[] = [];

  let currentX = start.x;
  let currentY = start.y;

  for (const command of commands) {
    const { dx, dy } = directionToVector(command.direction);

    if (command.direction === "east" || command.direction === "west") {
      const destinationX = currentX + dx * command.steps;
      // min and max so that each segment is always stored left to right
      horizontalSegments.push({
        yCoordinate: currentY,
        xStart: Math.min(currentX, destinationX),
        xEnd: Math.max(currentX, destinationX),
      });
      currentX = destinationX;
    } else {
      const destinationY = currentY + dy * command.steps;
      // min and max so that each segment is always stored bottom to top
      verticalSegments.push({
        xCoordinate: currentX,
        yStart: Math.min(currentY, destinationY),
        yEnd: Math.max(currentY, destinationY),
      });
      currentY = destinationY;
    }
  }

  return { horizontalSegments, verticalSegments };
}

/**
 * Merges overlapping or adjacent intervals into non-overlapping intervals.
 * 
 * Example: [[0,5], [3,8], [10,12]] → [[0,8], [10,12]]
 * 
 * @param intervals - Array of intervals to merge
 * @returns Array of non-overlapping merged intervals
 */
function mergeOverlappingIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  // sort by start position, then by end position (sorting by end position only for better readability while debugging)
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  const mergedIntervals: Interval[] = [];
  let currentIntervalStart = intervals[0].start;
  let currentIntervalEnd = intervals[0].end;

  for (let index = 1; index < intervals.length; index++) {
    const nextInterval = intervals[index];

    // check if intervals overlap or are adjacent (e.g., [0,5] and [6,10] are adjacent)
    if (nextInterval.start <= currentIntervalEnd + 1) {
      // extend current interval to include the next one
      currentIntervalEnd = Math.max(currentIntervalEnd, nextInterval.end);
    } else {
      // gap found - save current interval and start a new one
      mergedIntervals.push({ start: currentIntervalStart, end: currentIntervalEnd });
      currentIntervalStart = nextInterval.start;
      currentIntervalEnd = nextInterval.end;
    }
  }
  // add last interval
  mergedIntervals.push({ start: currentIntervalStart, end: currentIntervalEnd });

  return mergedIntervals;
}

/**
 * Counts the total number of discrete points covered by merged intervals.
 * For interval [a,b], the number of points is (b - a + 1).
 */
function countPointsInIntervals(intervals: Interval[]): number {
  let totalPoints = 0;
  for (const interval of intervals) {
    totalPoints += interval.end - interval.start + 1;
  }
  return totalPoints;
}

/**
 * Step 2: Group horizontal segments by y-coordinate, merge overlapping x-intervals, and count points.
 * 
 * @param horizontalSegments - Array of horizontal segments
 * @returns Merged intervals grouped by y-coordinate and total point count
 */
function groupAndMergeHorizontalSegments(horizontalSegments: HorizontalSegment[]): MergedSegmentsResult {
  const horizontalSegmentsByY = new Map<number, Interval[]>();

  for (const segment of horizontalSegments) {
    if (!horizontalSegmentsByY.has(segment.yCoordinate)) {
      horizontalSegmentsByY.set(segment.yCoordinate, []);
    }
    horizontalSegmentsByY.get(segment.yCoordinate)!.push({
      start: segment.xStart,
      end: segment.xEnd,
    });
  }

  let totalPoints = 0;
  const mergedIntervalsByCoordinate = new Map<number, Interval[]>();

  for (const [yCoordinate, xIntervals] of horizontalSegmentsByY) {
    const mergedXIntervals = mergeOverlappingIntervals(xIntervals);
    mergedIntervalsByCoordinate.set(yCoordinate, mergedXIntervals);
    totalPoints += countPointsInIntervals(mergedXIntervals);
  }

  return { mergedIntervalsByCoordinate, totalPoints };
}

/**
 * Step 3: Group vertical segments by x-coordinate, merge overlapping y-intervals, and count points.
 * 
 * @param verticalSegments - Array of vertical segments
 * @returns Merged intervals grouped by x-coordinate and total point count
 */
function groupAndMergeVerticalSegments(verticalSegments: VerticalSegment[]): MergedSegmentsResult {
  const verticalSegmentsByX = new Map<number, Interval[]>();

  for (const segment of verticalSegments) {
    if (!verticalSegmentsByX.has(segment.xCoordinate)) {
      verticalSegmentsByX.set(segment.xCoordinate, []);
    }
    verticalSegmentsByX.get(segment.xCoordinate)!.push({
      start: segment.yStart,
      end: segment.yEnd,
    });
  }

  let totalPoints = 0;
  const mergedIntervalsByCoordinate = new Map<number, Interval[]>();

  for (const [xCoordinate, yIntervals] of verticalSegmentsByX) {
    const mergedYIntervals = mergeOverlappingIntervals(yIntervals);
    mergedIntervalsByCoordinate.set(xCoordinate, mergedYIntervals);
    totalPoints += countPointsInIntervals(mergedYIntervals);
  }

  return { mergedIntervalsByCoordinate, totalPoints };
}

/**
 * Binary search to find the first index where sorted array value >= target.
 * 
 * @param sortedArray - Sorted array of numbers
 * @param target - Target value to search for
 * @returns Index of first element >= target, or array length if none found
 */
function findFirstIndexGreaterOrEqual(sortedArray: number[], target: number): number {
  let low = 0;
  let high = sortedArray.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedArray[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Step 4: Count intersection points between horizontal and vertical segments.
 * 
 * @param mergedHorizontalIntervalsByY - Merged horizontal intervals grouped by y-coordinate
 * @param mergedVerticalIntervalsByX - Merged vertical intervals grouped by x-coordinate
 * @returns Number of intersection points
 */
function countIntersectionPoints(
  mergedHorizontalIntervalsByY: Map<number, Interval[]>,
  mergedVerticalIntervalsByX: Map<number, Interval[]>
): number {
  let intersectionCount = 0;

  // build sorted list of all y-coordinates that have horizontal segments for binary search
  const sortedYCoordinates = Array.from(mergedHorizontalIntervalsByY.keys()).sort((a, b) => a - b);

  // for each vertical line, find where it intersects horizontal lines
  for (const [verticalLineX, verticalYIntervals] of mergedVerticalIntervalsByX) {
    for (const verticalYInterval of verticalYIntervals) {
      // Find the first y-coordinate >= verticalYInterval.start
      const startIndex = findFirstIndexGreaterOrEqual(sortedYCoordinates, verticalYInterval.start);

      // check all y-coordinates within the vertical segments y-range
      for (
        let yIndex = startIndex;
        yIndex < sortedYCoordinates.length && sortedYCoordinates[yIndex] <= verticalYInterval.end;
        yIndex++
      ) {
        const horizontalLineY = sortedYCoordinates[yIndex];
        const horizontalXIntervals = mergedHorizontalIntervalsByY.get(horizontalLineY)!;

        // check if the vertical lines x-coordinate falls within any horizontal segment
        for (const horizontalXInterval of horizontalXIntervals) {
          if (verticalLineX >= horizontalXInterval.start && verticalLineX <= horizontalXInterval.end) {
            intersectionCount++;
            break; // only count each intersection point once
          }
        }
      }
    }
  }

  return intersectionCount;
}

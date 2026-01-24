import { countUniqueCleaned } from "../../src/domain/robotPath";
import { Command } from "../../src/domain/types";

describe("countUniqueCleaned", () => {
  it("returns 4 for the example from the spec", () => {
    const commands: Command[] = [
      { direction: "east", steps: 2 },
      { direction: "north", steps: 1 },
    ];

    const result = countUniqueCleaned({ x: 10, y: 22 }, commands);
    expect(result).toBe(4);
  });

  it("returns 1 when there are no commands (start position only)", () => {
    expect(countUniqueCleaned({ x: 0, y: 0 }, [])).toBe(1);
  });

  it("does not count overlapping positions twice", () => {
    const commands: Command[] = [
      { direction: "east", steps: 3 },
      { direction: "west", steps: 3 },
    ];

    expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(4);
  });

  it("handles negative coordinates", () => {
    const commands: Command[] = [
      { direction: "west", steps: 2 },
      { direction: "south", steps: 1 },
    ];

    expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(4);
  });

  it("handles movement in all 4 directions", () => {
    const commands: Command[] = [
      { direction: "north", steps: 1 },
      { direction: "east", steps: 1 },
      { direction: "south", steps: 1 },
      { direction: "west", steps: 1 },
    ];

    expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(4);
  });


  it("handles 10000 commands with 1 step each", () => {
    const commands: Command[] = Array.from({ length: 10_000 }, () => ({
      direction: "east",
      steps: 1,
    }));

    expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(10_001);
  });

  describe("boundary coordinates (±100_000)", () => {
    it("handles start at max positive coordinates", () => {
      expect(countUniqueCleaned({ x: 100_000, y: 100_000 }, [])).toBe(1);
    });

    it("handles start at max negative coordinates", () => {
      expect(countUniqueCleaned({ x: -100_000, y: -100_000 }, [])).toBe(1);
    });

    it("handles start at mixed extreme coordinates", () => {
      expect(countUniqueCleaned({ x: -100_000, y: 100_000 }, [])).toBe(1);
      expect(countUniqueCleaned({ x: 100_000, y: -100_000 }, [])).toBe(1);
    });

    it("handles movement near max positive boundary", () => {
      const commands: Command[] = [{ direction: "west", steps: 2 }];
      expect(countUniqueCleaned({ x: 100_000, y: 100_000 }, commands)).toBe(3);
    });

    it("handles movement near max negative boundary", () => {
      const commands: Command[] = [{ direction: "east", steps: 2 }];
      expect(countUniqueCleaned({ x: -100_000, y: -100_000 }, commands)).toBe(3);
    });
  });

  describe("intersection points (horizontal meets vertical)", () => {
    it("counts single intersection point correctly (L-shape)", () => {
      const commands: Command[] = [
        { direction: "east", steps: 3 },
        { direction: "north", steps: 2 },
      ];

      expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(6);
    });

    it("counts multiple intersection points in a cross pattern", () => {
      const commands: Command[] = [
        { direction: "east", steps: 4 },
        { direction: "west", steps: 2 },
        { direction: "north", steps: 2 },
        { direction: "south", steps: 4 },
      ];

      expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(9);
    });

    it("handles grid pattern with many intersections", () => {
      const commands: Command[] = [
        { direction: "north", steps: 2 },
        { direction: "south", steps: 4 },
        { direction: "north", steps: 2 },
        { direction: "east", steps: 2 },
        { direction: "west", steps: 4 },
      ];

      expect(countUniqueCleaned({ x: 0, y: 0 }, commands)).toBe(9);
    });
  });
});
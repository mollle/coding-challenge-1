import * as fs from "fs";
import * as path from "path";
import { countUniqueCleaned } from "../../src/domain/robotPath";

describe("robotPath performance tests", () => {
  it("extreme input from test file completes without crashing", () => {
    const testDataPath = path.join(__dirname, "../resources/robotcleanerpathheavy.json");
    const testData = JSON.parse(fs.readFileSync(testDataPath, "utf-8"));
    
    expect(() => {
      const result = countUniqueCleaned(testData.start, testData.commands);
      expect(result).toBeGreaterThan(0);
      expect(Number.isFinite(result)).toBe(true);
    }).not.toThrow();
  });
});

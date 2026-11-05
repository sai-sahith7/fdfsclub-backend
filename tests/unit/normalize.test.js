const { dedupeIgnoreCase } = require("../../utils/normalize");

describe("dedupeIgnoreCase", () => {
  test("collapses values that differ only by case", () => {
    expect(dedupeIgnoreCase(["Telugu", "TELUGU", "telugu"])).toEqual(["Telugu"]);
  });

  test("keeps genuinely different values", () => {
    expect(dedupeIgnoreCase(["Telugu", "Tamil", "Hindi"])).toEqual(["Telugu", "Tamil", "Hindi"]);
  });

  test("keeps the all-caps variant when it is the only cased form", () => {
    expect(dedupeIgnoreCase(["imax", "IMAX"])).toEqual(["IMAX"]);
  });

  test("prefers mixed case over shouting", () => {
    expect(dedupeIgnoreCase(["ENGLISH", "English"])).toEqual(["English"]);
  });

  test("preserves order of first appearance", () => {
    expect(dedupeIgnoreCase(["4DX", "2D", "4dx", "3D"])).toEqual(["4DX", "2D", "3D"]);
  });

  test("trims surrounding whitespace before comparing", () => {
    expect(dedupeIgnoreCase([" Hindi ", "hindi"])).toEqual(["Hindi"]);
  });

  test("drops blanks and nullish entries", () => {
    expect(dedupeIgnoreCase(["Hindi", "", null, undefined, "   "])).toEqual(["Hindi"]);
  });

  test("returns an empty array for missing input", () => {
    expect(dedupeIgnoreCase(null)).toEqual([]);
    expect(dedupeIgnoreCase(undefined)).toEqual([]);
    expect(dedupeIgnoreCase([])).toEqual([]);
  });

  test("every surviving option still matches its duplicates case-insensitively", () => {
    const deduped = dedupeIgnoreCase(["IMAX", "imax", "Imax 3D", "IMAX 3D"]);
    const original = ["IMAX", "imax", "Imax 3D", "IMAX 3D"];

    for (const value of original) {
      const stillMatchable = deduped.some((kept) => kept.toLowerCase() === value.toLowerCase());
      expect(stillMatchable).toBe(true);
    }
  });
});

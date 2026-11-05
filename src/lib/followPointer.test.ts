import { describe, expect, test } from "bun:test";
import { leanToward } from "./followPointer";

describe("leanToward", () => {
  test("a hand on the centre does not lean the light", () => {
    expect(leanToward(0, 44)).toBe(0);
  });

  test("half way at two button-widths, on either side", () => {
    expect(leanToward(88, 44)).toBe(0.5);
    expect(leanToward(-88, 44)).toBe(-0.5);
  });

  test("a hand across the screen leans it almost all the way, never past", () => {
    const far = leanToward(5000, 44);
    expect(far).toBeGreaterThan(0.95);
    expect(far).toBeLessThan(1);
  });
});

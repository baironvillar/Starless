import { describe, expect, test } from "bun:test";
import { compareVersions, isNewerThan } from "./semver";

describe("isNewerThan", () => {
  test("the release is newer than the beta that leads to it", () => {
    // The bug: 0.7.0-beta.5 read as [0, 7, 0, 5] and beat 0.7.0, so Settings
    // offered "Go back to 0.7.0" to someone moving forward.
    expect(isNewerThan("0.7.0", "0.7.0-beta.5")).toBe(true);
    expect(isNewerThan("0.7.0-beta.5", "0.7.0")).toBe(false);
  });

  test("a later beta is newer, and beta.10 beats beta.9", () => {
    expect(isNewerThan("0.7.0-beta.6", "0.7.0-beta.5")).toBe(true);
    expect(isNewerThan("0.7.0-beta.10", "0.7.0-beta.9")).toBe(true);
    expect(isNewerThan("0.7.0-beta.4", "0.7.0-beta.5")).toBe(false);
  });

  test("the number wins over the suffix", () => {
    expect(isNewerThan("0.7.1-beta.1", "0.7.0")).toBe(true);
    expect(isNewerThan("0.7.0", "0.7.1-beta.1")).toBe(false);
  });

  test("numbers compare as numbers", () => {
    expect(isNewerThan("1.10.0", "1.9.0")).toBe(true);
  });

  test("the same version is not newer than itself", () => {
    expect(isNewerThan("0.7.0", "0.7.0")).toBe(false);
    expect(compareVersions("0.7.0-beta.5", "0.7.0-beta.5")).toBe(0);
  });
});

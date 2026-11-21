/**
 * Which of two versions is newer, by semver and not by the digits in them.
 *
 * **`0.7.0-beta.5` is older than `0.7.0`.** The comparison this replaces split
 * on dots and read `0-beta` as `0`, so `0.7.0-beta.5` became `[0, 7, 0, 5]` and
 * `0.7.0` became `[0, 7, 0]`: the beta came out *newer* than the release it
 * leads to. The updater then called the public 0.7.0 "going back" from the beta
 * that was supposed to end in it, and the button said "Go back to 0.7.0" to
 * someone who was moving forward.
 *
 * A release has no suffix and wins over any prerelease of the same number;
 * prerelease identifiers compare one by one, numbers as numbers (`beta.10` is
 * newer than `beta.9`) and a number below a word.
 */
type Parsed = { core: number[]; pre: string[] };

function parse(version: string): Parsed {
  const [withoutBuild = ""] = version.trim().replace(/^v/i, "").split("+");
  const dash = withoutBuild.indexOf("-");
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const pre = dash === -1 ? "" : withoutBuild.slice(dash + 1);
  return {
    core: core.split(".").map((n) => Number.parseInt(n, 10) || 0),
    pre: pre === "" ? [] : pre.split("."),
  };
}

function comparePre(a: string[], b: string[]): number {
  // No suffix is the release itself, and it comes after every prerelease.
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number.parseInt(x, 10) - Number.parseInt(y, 10);
      if (diff !== 0) return diff;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return comparePre(left.pre, right.pre);
}

/** `1.10.0` is newer than `1.9.0`, which a string comparison gets backwards. */
export function isNewerThan(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

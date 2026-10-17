/**
 * Starless versioning.
 *
 * Single source of truth: `src-tauri/tauri.conf.json`. Tauri bundles that value
 * into the binary and `@tauri-apps/api/app`'s `getVersion()` reads it back at
 * runtime, so the app can never disagree with what was actually shipped.
 *
 * This script propagates a version into the two other manifests that also carry
 * one, and refuses to let them drift:
 *
 *   bun run version             current version, and whether all three agree
 *   bun run version:bump patch  bump patch | minor | major, everywhere
 *   bun run version:set 0.2.0   set an explicit version, everywhere
 *
 * Run `version` in CI. It exits non-zero when the manifests disagree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TAURI_CONF = join(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML = join(ROOT, "src-tauri", "Cargo.toml");
const PACKAGE_JSON = join(ROOT, "package.json");

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

type Version = { major: number; minor: number; patch: number };

function parse(raw: string, source: string): Version {
  const m = SEMVER.exec(raw.trim());
  if (!m) {
    throw new Error(`${source} holds "${raw}", which is not major.minor.patch.`);
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function format(v: Version): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function readTauri(): Version {
  return parse(JSON.parse(readFileSync(TAURI_CONF, "utf8")).version, "tauri.conf.json");
}

/**
 * Cargo.toml line endings are normalised to LF before any rewrite.
 *
 * An earlier version of this script used `/^\s*version\s*=\s*"[^"]+"/m`, and `\s`
 * matches newlines — so it happily ate the line break in front of `version` and
 * fused it onto the previous line, producing a file Cargo refuses to parse. The
 * pattern below is anchored to `^version` with no leading whitespace class and a
 * `.*$` that cannot cross a line, so it can only ever replace one whole line.
 */
function readCargo(): Version {
  // The [package] version, not a dependency's.
  const pkgBlock = readCargoText().split("[dependencies]")[0] ?? "";
  const m = /^\s*version\s*=\s*"([^"]+)"/m.exec(pkgBlock);
  if (!m) throw new Error("Cargo.toml has no [package] version.");
  return parse(m[1] ?? "", "Cargo.toml");
}

function readCargoText(): string {
  return readFileSync(CARGO_TOML, "utf8").replace(/\r\n/g, "\n");
}

function readPackage(): Version {
  return parse(JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version, "package.json");
}

function writeAll(next: string): void {
  const parsed = parse(next, "argument");
  const v = format(parsed);

  const conf = JSON.parse(readFileSync(TAURI_CONF, "utf8"));
  conf.version = v;
  writeFileSync(TAURI_CONF, `${JSON.stringify(conf, null, 2)}\n`, "utf8");

  const cargo = readCargoText();
  const [head, ...rest] = cargo.split("[dependencies]");
  const nextHead = head.replace(/^version\s*=.*$/m, `version = "${v}"`);
  const outCargo = `${nextHead}${[...rest].join("[dependencies]")}`;

  // Structural guard. Comparing the three version strings is not enough: they
  // can agree while the manifest is unusable. Rewriting must never change the
  // shape of the file, only the digits inside the version.
  if (cargo.split("\n").length !== outCargo.split("\n").length) {
    throw new Error(
      "Cargo.toml line count changed during rewrite — refusing to write a possibly corrupt manifest.",
    );
  }
  writeFileSync(CARGO_TOML, outCargo, "utf8");

  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  pkg.version = v;
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function report(): boolean {
  const conf = readTauri();
  const cargo = readCargo();
  const pkg = readPackage();
  const inSync = format(conf) === format(cargo) && format(conf) === format(pkg);

  console.log(`tauri.conf.json  ${format(conf)}`);
  console.log(`Cargo.toml       ${format(cargo)}`);
  console.log(`package.json     ${format(pkg)}`);
  console.log(inSync ? "\nIn sync." : "\nOUT OF SYNC — run bun run version:set <version>");

  return inSync;
}

function bump(level: "major" | "minor" | "patch"): void {
  const cur = readTauri();
  const next: Version =
    level === "major"
      ? { major: cur.major + 1, minor: 0, patch: 0 }
      : level === "minor"
        ? { major: cur.major, minor: cur.minor + 1, patch: 0 }
        : { major: cur.major, minor: cur.minor, patch: cur.patch + 1 };

  writeAll(format(next));
  console.log(`${format(cur)} -> ${format(next)}`);
}

const [cmd, arg] = process.argv.slice(2);

try {
  switch (cmd) {
    case undefined:
    case "get":
      process.exit(report() ? 0 : 1);
      break;
    case "bump":
      bump(arg as "major" | "minor" | "patch");
      break;
    case "set":
      if (!arg) throw new Error("set needs a version, e.g. bun run version:set 0.2.0");
      writeAll(arg);
      console.log(`-> ${arg}`);
      break;
    default:
      throw new Error(`Unknown command "${cmd}". Use get | bump | set.`);
  }
} catch (err) {
  console.error(`version: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

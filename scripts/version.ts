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
 * The `[package]` version, never a dependency's.
 *
 * The block is located rather than inferred from the first `version =` line, and
 * the lookup stops at the next section header.
 */
function readCargo(): Version {
  const m = /^version[ \t]*=[ \t]*"([^"]+)"/m.exec(cargoPackageBlock(readCargoText()));
  if (!m) throw new Error("Cargo.toml has no [package] version.");
  return parse(m[1] ?? "", "Cargo.toml");
}

/**
 * Replace the version inside `[package]` and touch nothing else.
 *
 * The obvious implementation splits the file on `[dependencies]` and joins the
 * pieces back. That does not work: `String.split` *removes* its separator, and
 * `join` puts it back only when there is more than one piece. This file has one
 * `[dependencies]`, so the header vanished — turning `tauri` into a build
 * dependency. The result still parses, still has three manifests agreeing on the
 * version, and does not compile: `cargo check` panicked inside `tauri-build` with
 * a message about a missing `cargo:dev`, which says nothing about a deleted
 * section header.
 *
 * So the shape of the file is the thing being edited: keep every section header,
 * in order, and fail loudly if one goes missing.
 */
function rewriteCargo(next: string): string {
  const text = readCargoText();
  const start = text.indexOf("[package]");
  if (start < 0) throw new Error("Cargo.toml has no [package] section.");

  const afterPackage = text.slice(start);
  const nextHeader = afterPackage.indexOf("\n[");
  if (nextHeader < 0) throw new Error("Cargo.toml has no section after [package].");

  const block = afterPackage.slice(0, nextHeader);
  const versionLine = /^version[ \t]*=[ \t]*"[^"]*"/m;
  if (!versionLine.test(block)) {
    throw new Error("Cargo.toml [package] has no version line to rewrite.");
  }
  const rewritten = block.replace(versionLine, `version = "${next}"`);

  const out = text.slice(0, start) + rewritten + afterPackage.slice(nextHeader);

  const headers = (s: string) =>
    s
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[") && line.endsWith("]"));
  const before = headers(text);
  const afterwards = headers(out);
  if (before.join("|") !== afterwards.join("|")) {
    throw new Error(
      `Cargo.toml section headers changed during rewrite:\n  ${before.join(" ")}\n  ${afterwards.join(" ")}`,
    );
  }

  return out;
}

/** Cargo.toml line endings are normalised to LF before any rewrite. */
function readCargoText(): string {
  return readFileSync(CARGO_TOML, "utf8").replace(/\r\n/g, "\n");
}

function readPackage(): Version {
  return parse(JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version, "package.json");
}

/** The text of the `[package]` block, section header included. */
function cargoPackageBlock(text: string): string {
  const start = text.indexOf("[package]");
  if (start < 0) return "";
  const afterPackage = text.slice(start);
  const nextHeader = afterPackage.indexOf("\n[");
  return nextHeader < 0 ? afterPackage : afterPackage.slice(0, nextHeader);
}

function writeAll(next: string): void {
  const parsed = parse(next, "argument");
  const v = format(parsed);

  // Both JSON manifests are edited as text, not re-serialised.
  //
  // `JSON.stringify(conf, null, 2)` is the obvious way to do this and it reformats
  // the whole file: arrays it kept inline come back exploded across lines, which is
  // not Biome's formatting. So every single bump broke `bun run lint`, and the fix
  // was to reformat by hand afterwards — twice now, including once on the very bump
  // that was supposed to be a release. Rewriting only the digits means a version
  // bump is a one-line diff and cannot touch anything else.
  writeFileSync(
    TAURI_CONF,
    replaceVersion(readFileSync(TAURI_CONF, "utf8"), v, "tauri.conf.json"),
    "utf8",
  );
  writeFileSync(
    PACKAGE_JSON,
    replaceVersion(readFileSync(PACKAGE_JSON, "utf8"), v, "package.json"),
    "utf8",
  );
  writeFileSync(CARGO_TOML, rewriteCargo(v), "utf8");
}

/** Replace the first `"version": "x.y.z"` and nothing else. */
function replaceVersion(text: string, v: string, source: string): string {
  const field = /("version"[ \t]*:[ \t]*)"[^"]+"/;
  // Testing the pattern rather than comparing the result, so setting the version
  // it already has is a no-op instead of an error. CI runs `version` on a tree
  // where nothing has moved.
  if (!field.test(text)) throw new Error(`${source} has no "version" field to rewrite.`);
  return text.replace(field, `$1"${v}"`);
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

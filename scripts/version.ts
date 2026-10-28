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
 *
 * **The bump asks before it writes.** `version:bump` is the one command that
 * decides what a person with the app installed downloads, so it is the one that
 * checks first and asks second: the repository has to be in order —the three
 * manifests agreeing, the branch being the one of that version, the tag free,
 * the notes written— and only then does it ask whether to go ahead. Without a
 * terminal it refuses to guess: `--yes` is the way to say "ya lo revisé".
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { changelogSection } from "./releases.ts";

const ROOT = join(import.meta.dir, "..");
const TAURI_CONF = join(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML = join(ROOT, "src-tauri", "Cargo.toml");
const CARGO_LOCK = join(ROOT, "src-tauri", "Cargo.lock");
const PACKAGE_JSON = join(ROOT, "package.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const CHANGELOG_TS = join(ROOT, "src", "lib", "changelog.ts");

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
  writeFileSync(CARGO_LOCK, rewriteCargoLock(v), "utf8");
}

/**
 * The version of this package inside `Cargo.lock`.
 *
 * **The lock file carries the version of the package it locks.** It is not a
 * manifest and nothing reads it to decide what the app is —but it is committed,
 * and `cargo` rewrites that line the first time it builds. A bump that leaves
 * it behind produces a tree that is dirty after the first build, and a diff
 * that nobody asked for in the middle of a release.
 *
 * The entry is found by name and not by position: the lock has one `[[package]]`
 * block per dependency and the one that matters is the one called `starless`.
 */
function rewriteCargoLock(next: string): string {
  const text = readFileSync(CARGO_LOCK, "utf8");
  const pattern = /(\[\[package\]\]\r?\nname = "starless"\r?\nversion = ")[^"]+(")/;
  if (!pattern.test(text)) {
    throw new Error('Cargo.lock has no [[package]] block named "starless".');
  }
  return text.replace(pattern, `$1${next}$2`);
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

/**
 * The three levels of a bump, and what each one means.
 *
 * **The script does not decide which one applies.** It can move the number, but
 * whether a change only fixes something, adds something, or breaks with what
 * came before is a statement about the product, not about the diff. The rule
 * is written in ROADMAP.md, and the numbers have to follow it.
 */
const LEVELS = {
  patch: "only fixes: it adds nothing and breaks nothing that already worked",
  minor: "adds something that did not exist before",
  major: "breaks with what came before",
} as const;

type Level = keyof typeof LEVELS;

function nextVersion(cur: Version, level: Level): Version {
  return level === "major"
    ? { major: cur.major + 1, minor: 0, patch: 0 }
    : level === "minor"
      ? { major: cur.major, minor: cur.minor + 1, patch: 0 }
      : { major: cur.major, minor: cur.minor, patch: cur.patch + 1 };
}

/**
 * Git, asked a question about the repository.
 *
 * The bump is the only thing in this script that looks at git: whether the
 * branch is the one of that version, whether the tag is free, whether the
 * manifests are clean. A question that cannot be answered is not a crash — it
 * answers "I don't know", and the caller decides what to do with that.
 */
function git(args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

/**
 * Whether the repository is ready for this bump.
 *
 * **Every one of these is a way the release goes out wrong, and all of them
 * are cheaper to catch here than in the app installed on somebody's machine.**
 * A bump on the wrong branch publishes a version nobody agreed to; a bump on
 * top of an existing tag publishes a second thing with the same number; a bump
 * without notes stops the release in the CI, after the tag is already pushed.
 */
function checkReady(next: string): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];

  const cur = readTauri();
  const cargo = readCargo();
  const pkg = readPackage();
  if (format(cur) !== format(cargo) || format(cur) !== format(pkg)) {
    problems.push(
      "the three manifests do not agree: " +
        `tauri.conf.json ${format(cur)}, Cargo.toml ${format(cargo)}, package.json ${format(pkg)}. ` +
        "Fix it with `bun run version:set` before bumping.",
    );
  }

  // **Only the files that carry the number are checked for dirt.** The
  // changelog is expected to have uncommitted changes: the notes of the version
  // being prepared travel in the same pull request as the bump.
  const dirty = git([
    "status",
    "--porcelain",
    "--",
    TAURI_CONF,
    CARGO_TOML,
    CARGO_LOCK,
    PACKAGE_JSON,
  ]);
  if (dirty.out) {
    problems.push(
      "there are uncommitted changes in the manifests. Commit them first, so the bump's diff is only the number.",
    );
  }

  const branch = git(["branch", "--show-current"]).out;
  const expected = `release/${next}`;
  if (branch !== expected) {
    problems.push(
      `the current branch is '${branch || "(none)"}' and the ${next} is bumped on '${expected}'.`,
    );
  }

  const tag = git(["tag", "-l", `v${next}`]).out;
  if (tag) {
    problems.push(`the tag v${next} already exists: that number was already published.`);
  }

  // **The notes are checked before the number moves, not after.** The release
  // workflow stops without them, and it stops after the tag is already pushed:
  // there is no way back from that except moving the tag.
  const markdown = readFileSync(CHANGELOG, "utf8");
  if (!changelogSection(markdown, next)) {
    problems.push(
      `CHANGELOG.md has no section \`## [${next}]\`: the release CI stops without the notes.`,
    );
  }

  // **The same notes live in two places, and the second one is the one the
  // user reads.** `CHANGELOG.md` is the body of the GitHub release; the app
  // shows its own copy inside Settings → Diagnostics, in the language the user
  // picked. A version that is in one and not in the other is a version that
  // half the people who read it never see.
  const inApp = readFileSync(CHANGELOG_TS, "utf8");
  if (!inApp.includes(`version: "${next}"`)) {
    problems.push(
      `src/lib/changelog.ts has no entry for ${next}: the app shows the notes of every version in Diagnostics, and this one would not show.`,
    );
  }

  const behind = git(["rev-list", "--count", "HEAD..origin/develop"]);
  if (behind.ok && Number(behind.out) > 0) {
    warnings.push(`origin/develop has ${behind.out} commit(s) this branch does not have.`);
  }

  return { problems, warnings };
}

/**
 * One question, one answer.
 *
 * **It reads the terminal, it does not read a file.** The point is that the
 * person running the bump is the one who decides, and a decision that comes
 * from a script that assumed is not one.
 *
 * **It answers even when nobody answers.** A pipe with nothing in it closes
 * without a line, and a script that waits forever for that line is a script
 * that hangs a CI job with no explanation. An empty answer is an answer.
 */
function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) {
        answered = true;
        resolve("");
      }
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Whether there is somebody there to answer. */
function interactive(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * The question, and what the answer means.
 *
 * **Three answers, not two.** An empty answer in a terminal is "no": that is
 * what pressing enter means. An empty answer with nothing behind it is nobody
 * answering, and that is a different thing —the script has to say so instead
 * of writing the version on a guess.
 */
async function confirm(question: string): Promise<"yes" | "no" | "unanswered"> {
  const answer = (await ask(`${question} [y/N] `)).toLowerCase();
  if (answer === "y" || answer === "s" || answer === "si" || answer === "yes") return "yes";
  if (answer === "") return interactive() ? "no" : "unanswered";
  return "no";
}

/**
 * The level, asked.
 *
 * **It asks because the number is a statement about the product.** The script
 * can move it, but it cannot know whether the change only fixes something or
 * breaks with what came before.
 */
async function chooseLevel(cur: Version): Promise<Level> {
  if (!interactive()) {
    throw new Error(
      "there is no terminal to ask on. Say the level: `bun run version:bump patch|minor|major`.",
    );
  }
  console.log(`The current version is ${format(cur)}. Which one comes out?`);
  for (const level of ["patch", "minor", "major"] as const) {
    console.log(`  ${level.padEnd(5)}  ${LEVELS[level]}`);
  }
  const answer = (await ask("patch | minor | major: ")).toLowerCase();
  if (!Object.hasOwn(LEVELS, answer)) {
    throw new Error(`'${answer}' is not a level. Use patch, minor or major.`);
  }
  return answer as Level;
}

/**
 * The bump, with everything that has to be true before it.
 */
async function bumpFlow(level: Level | undefined, yes: boolean): Promise<void> {
  const cur = readTauri();
  const chosen = level ?? (await chooseLevel(cur));
  const next = format(nextVersion(cur, chosen));

  const { problems, warnings } = checkReady(next);
  for (const warning of warnings) console.warn(`Careful: ${warning}`);
  if (problems.length > 0) {
    console.error("\nThe version is not ready to be bumped:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    process.exit(1);
  }

  console.log(`\n${format(cur)} -> ${next}`);
  console.log("These files change:");
  console.log("  src-tauri/tauri.conf.json");
  console.log("  src-tauri/Cargo.toml");
  console.log("  src-tauri/Cargo.lock");
  console.log("  package.json");
  console.log("");

  if (!yes) {
    const answer = await confirm(`Bump the version to ${next}?`);
    if (answer === "unanswered") {
      console.error(
        "There was nobody to answer. Run it from a terminal, or with `--yes` if you already checked.",
      );
      process.exit(1);
    }
    if (answer === "no") {
      console.log("Nothing was changed.");
      return;
    }
  }

  writeAll(next);
  console.log(`${format(cur)} -> ${next}`);
}

/**
 * An explicit version, also with a question.
 *
 * **It is lighter than the bump on purpose**: `version:set` is also the repair
 * tool for the three manifests drifting apart —the CI says so when that
 * happens— and the version it sets can be one that is already published. What
 * it does not do is decide a number: the number is right there in the argument.
 *
 * **It does not ask for a clean tree either.** A tree that needs repairing is
 * a tree with changes in the manifests: refusing to write there would leave
 * the repair with no way in. What it writes is the version line and nothing
 * else, so the other changes in those files survive.
 */
async function setFlow(version: string, yes: boolean): Promise<void> {
  const next = format(parse(version, "argument"));

  if (!yes) {
    const answer = await confirm(`Set the version to ${next}?`);
    if (answer === "unanswered") {
      console.error(
        "There was nobody to answer. Run it from a terminal, or with `--yes` if you already checked.",
      );
      process.exit(1);
    }
    if (answer === "no") {
      console.log("Nothing was changed.");
      return;
    }
  }

  writeAll(next);
  console.log(`-> ${next}`);
}

const argv = process.argv.slice(2);
// `--yes` is the way to say "I already checked" when there is no terminal to
// ask on. The environment variable is there for the same reason in a script.
const yes = argv.includes("--yes") || process.env.STARLESS_VERSION_YES === "1";
const [cmd, ...rest] = argv.filter((arg) => arg !== "--yes");

try {
  switch (cmd) {
    case undefined:
    case "get":
      process.exit(report() ? 0 : 1);
      break;
    case "bump": {
      const level = rest[0];
      if (level !== undefined && !Object.hasOwn(LEVELS, level)) {
        throw new Error(`'${level}' is not a level. Use patch, minor or major.`);
      }
      await bumpFlow(level as Level | undefined, yes);
      break;
    }
    case "set": {
      if (!rest[0]) throw new Error("set needs a version, e.g. bun run version:set 0.2.0");
      await setFlow(rest[0], yes);
      break;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Use get | bump | set.`);
  }
} catch (err) {
  console.error(`version: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

/**
 * The updater's three chores, in the order a release needs them.
 *
 *   bun run updater:key       generate the signing keypair (once, ever)
 *   bun run updater:pubkey    copy the public key into tauri.conf.json
 *   bun run updater:manifest  write latest.json from the last `tauri build`
 *
 * **The private key is never read, printed or uploaded by any of this.** Only the
 * `.pub` half is, and that half is public by definition — it is what lets an
 * installed copy tell a real update from something pretending to be one. The
 * private half stays in `.secrets/` (git-ignored) and, in a real release, only
 * ever exists inside CI as `TAURI_SIGNING_PRIVATE_KEY`.
 *
 * Why signing at all, when the installer is unsigned and SmartScreen complains
 * either way: SmartScreen's warning is about who built the file, and this
 * signature is about *who is answering the update URL*. Without it, anyone who
 * can intercept that request — a hostile network, a DNS answer, a compromised
 * mirror — gets to choose the next binary Starless installs on every machine.
 * That is a different threat from the one you accepted, and this one is free to
 * close.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withoutLocale } from "./releases.ts";

const ROOT = join(import.meta.dir, "..");
const CONF = join(ROOT, "src-tauri", "tauri.conf.json");
const SECRETS = join(ROOT, ".secrets");
const KEY = join(SECRETS, "starless-updater.key");
const PUB = `${KEY}.pub`;
const BUNDLE = join(ROOT, "src-tauri", "target", "release", "bundle");

/** Written into the config when a release is published. */
const PLACEHOLDER = "PENDIENTE: bun run updater:pubkey";

function fail(message: string): never {
  console.error(`updater: ${message}`);
  process.exit(1);
}

function tauri(...args: string[]) {
  const result = spawnSync("bunx", ["tauri", ...args], { stdio: "inherit" });
  if (result.status !== 0) fail(`tauri ${args[0]} falló`);
}

function generateKey(): void {
  if (existsSync(KEY)) {
    console.log(`.secrets/starless-updater.key ya existe. No se regenera: hacerlo`);
    console.log(`invalidaría las actualizaciones ya instaladas.`);
    console.log(`Para empezar de cero, bórralo y vuelve a ejecutar este comando.`);
    return;
  }

  // Interactive on purpose: the password never passes through this process, this
  // transcript or a log file. CI uses `TAURI_SIGNING_PRIVATE_KEY` instead.
  tauri("signer", "generate", "-w", KEY);

  console.log("");
  console.log("Llave generada. Ahora:");
  console.log("  1. bun run updater:pubkey     (copia la pública a tauri.conf.json)");
  console.log("  2. guarda .secrets/starless-updater.key fuera del repo y");
  console.log("     en el secreto TAURI_SIGNING_PRIVATE_KEY de tu CI.");
}

function injectPubkey(): void {
  if (!existsSync(PUB)) {
    fail("no existe .secrets/starless-updater.key.pub — ejecuta primero `bun run updater:key`");
  }

  const pubkey = readFileSync(PUB, "utf8").trim();
  if (!pubkey) fail("la llave pública está vacía");

  const conf = JSON.parse(readFileSync(CONF, "utf8"));
  const updater = conf.plugins?.updater;
  if (!updater) fail("tauri.conf.json no tiene plugins.updater");

  updater.pubkey = pubkey;
  writeFileSync(CONF, `${JSON.stringify(conf, null, 2)}\n`, "utf8");

  console.log(`pubkey escrita en src-tauri/tauri.conf.json (${pubkey.length} caracteres)`);
}

/** Every `*.sig` sitting next to a built artifact, which is one per platform. */
function signatureFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".sig"));
}

function buildManifest(): void {
  const conf = JSON.parse(readFileSync(CONF, "utf8"));
  const version: string = conf.version;
  const repo = process.env.STARLESS_REPO;

  if (!repo) {
    fail("define STARLESS_REPO con owner/repo, ej. $env:STARLESS_REPO = 'tu-usuario/starless'");
  }
  if (conf.plugins?.updater?.pubkey === PLACEHOLDER) {
    fail("la pubkey sigue sin configurar — ejecuta `bun run updater:pubkey`");
  }

  // Artifacts are uploaded to the release as `<tag>/<file>`, and the manifest has
  // to point at exactly where they end up. Guessing that URL wrong produces a
  // release that installs on nobody's machine and fails on everyone's.
  const tag = `v${version}`;
  const entries: Record<string, { signature: string; url: string }> = {};

  // The bundle is one MSI, so the manifest carries two keys for it: the generic
  // one —which is what the app asks for on the develop channel— and the one
  // with the installer type —which is what the plugin asks for when the
  // installed copy came from an MSI. Both point at the same file.
  const dir = join(BUNDLE, "msi");
  for (const sig of signatureFiles(dir)) {
    const bundled = sig.replace(/\.sig$/, "");
    // The file is uploaded under its clean name: the workflow renames it when
    // it uploads it, because the bundler names the MSI with the locale on it
    // and the locale is not something anybody wants to see in a download.
    const uploaded = withoutLocale(bundled) ?? bundled;
    const url = `https://github.com/${repo}/releases/download/${tag}/${uploaded}`;
    const signature = readFileSync(join(dir, sig), "utf8").trim();
    entries["windows-x86_64"] = { signature, url };
    entries["windows-x86_64-msi"] = { signature, url };
  }

  const platforms = Object.keys(entries);
  if (platforms.length === 0) {
    fail(
      "no hay artefactos de actualización. Corre `bun run app:build` con TAURI_SIGNING_PRIVATE_KEY primero.",
    );
  }

  const manifest = {
    version,
    notes: `https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: new Date().toISOString(),
    platforms: entries,
  };

  const out = join(ROOT, "latest.json");
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`latest.json escrito en ${out}`);
  console.log(`  versión  ${version}`);
  console.log(`  repo     ${repo}`);
  console.log(`  platforms ${platforms.join(", ")}`);
  console.log("");
  console.log("Sube a la release estos archivos:");
  for (const file of readdirSync(dir)) {
    if (/\.(zip|sig)$/.test(file))
      console.log(`  ${join("src-tauri/target/release/bundle", pathOf(dir), file)}`);
  }
  console.log("  latest.json");
}

function pathOf(dir: string): string {
  return dir.slice(BUNDLE.length + 1);
}

const [cmd] = process.argv.slice(2);

try {
  switch (cmd) {
    case "key":
      generateKey();
      break;
    case "pubkey":
      injectPubkey();
      break;
    case "manifest":
      buildManifest();
      break;
    default:
      console.error("Uso: updater <key | pubkey | manifest>");
      process.exit(1);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

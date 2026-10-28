/**
 * Una release, una forma.
 *
 * Una release son tres archivos y un párrafo:
 *
 *   Starless_<version>_x64.msi       el instalador
 *   Starless_<version>_x64.msi.sig   su firma
 *   latest.json                      el manifest que lee la app instalada
 *
 * y el cuerpo de la release —y las notas del manifest— son la sección del
 * changelog de esa versión. La regla está escrita una sola vez, acá, y la usan
 * el workflow de release y este script.
 *
 *   bun run releases:notes            el cuerpo de la versión del manifiesto
 *   bun run releases:check [tag]      qué no coincide. No cambia nada.
 *   bun run releases:sync  [tag]      lo arregla
 *
 * **Por qué el script y no la API a mano.** La API de GitHub renombra un asset
 * sin cambiar su id, y el manifest apunta al asset **por id**:
 * `https://api.github.com/repos/OWNER/REPO/releases/assets/1234`. Por eso el
 * nombre del archivo puede cambiar sin que el manifest quede apuntando a la
 * nada, y por eso la firma —que cubre el contenido del archivo, no su nombre—
 * sigue valiendo. Verificado en el código del plugin: la firma se verifica con
 * `allow_legacy`, que no compara el nombre del archivo con el del comentario.
 *
 * **Por qué el orden de las escrituras importa.** El manifest se arregla
 * *antes* de borrar los archivos que sobran: si se borraran primero, habría
 * una ventana en la que el manifest apunta a un asset que ya no existe, y la
 * app instalada vería un 404 —que el comprobador toma por "no hay nada
 * nuevo"—. Primero se renombra, después se reescribe el manifest, y al final
 * se borra lo que sobra.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const CONF_PATH = join(ROOT, "src-tauri", "tauri.conf.json");
const API = "https://api.github.com";

export const MANIFEST_NAME = "latest.json";

/** El instalador, con el nombre que tiene que tener. */
export function installerName(version: string): string {
  return `Starless_${version}_x64.msi`;
}

/** La firma del instalador. */
export function signatureName(version: string): string {
  return `${installerName(version)}.sig`;
}

/** Los tres archivos de una release. */
export function expectedAssets(version: string): string[] {
  return [MANIFEST_NAME, installerName(version), signatureName(version)];
}

/**
 * El nombre limpio de un instalador: sin el idioma.
 *
 * El bundler de Tauri localiza el MSI —el archivo sale como
 * `Starless_0.5.3_x64_en-US.msi`—, y el idioma no se puede sacar de la
 * configuración: el nombre lo arma el bundler. Lo que se puede es del archivo
 * que se sube, que es lo que hace el workflow.
 *
 * **Un nombre que ya está limpio se devuelve igual.** El archivo se renombra
 * una sola vez, así que el script tiene que reconocer el nombre nuevo: si lo
 * toma por uno con idioma encima, lo confunde con un archivo que sobra —y
 * borrar un instalador es exactamente lo que no puede pasar—.
 *
 * Lo que no es un instalador devuelve `null`: el `.exe` de NSIS y el
 * `latest.json` no se renombran, se borran.
 */
export function withoutLocale(name: string): string | null {
  const m = /^(.*)\.msi(\.sig)?$/.exec(name);
  if (!m) return null;
  const base = m[1];
  const locale = /_([a-z]{2}(-[A-Za-z]{2,4})?)$/.exec(base);
  return `${locale ? base.slice(0, locale.index) : base}.msi${m[2] ?? ""}`;
}

/**
 * La sección del changelog de una versión.
 *
 * La misma búsqueda que hacía el workflow, escrita una sola vez: un tag sin
 * notas es un error, no una release muda.
 */
export function changelogSection(markdown: string, version: string): string | null {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n.*?(?=^## \\[|^---\\s*$)`, "ms").exec(
    markdown,
  );
  return m ? m[0].trim() : null;
}

/**
 * Si el binario de una release se compiló en `develop`.
 *
 * **El canal se compila dentro del binario.** Una build de `develop` dice
 * "prerelease" aunque la release que la contiene se publique como pública, y
 * esa build instalada cree que está en la línea de desarrollo: busca la puerta
 * de vuelta a la línea pública y se encuentra a sí misma. El botón ofrece
 * "instalar la 0.5.4 pública" y el instalador es el mismo binario: el bucle no
 * termina nunca.
 *
 * **La pregunta es la misma que hace el paso `canal` del workflow:** ¿el commit
 * del tag llegó a `main`? Un tag que llegó es una build de `main`, y una build
 * de `main` es de la línea pública por definición.
 *
 * **El remoto primero, y `main` después.** En la CI el checkout trae todas las
 * ramas, y `origin/main` es la que está al día; en una máquina, `main` puede
 * estar más atrás que el remoto —y un remoto atrasado sólo puede hacer que
 * esta función no vea una contradicción, nunca que invente una.
 */
export function builtFromDevelop(tag: string): boolean {
  const commit = spawnSync("git", ["rev-list", "-n", "1", tag], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (commit.status !== 0) return false;
  const sha = (commit.stdout ?? "").trim();
  if (!sha) return false;

  for (const base of ["origin/main", "main"]) {
    const inBase = spawnSync("git", ["merge-base", "--is-ancestor", sha, base], { cwd: ROOT });
    // `status` 0 es "sí es antepasado": el tag llegó a la línea pública.
    if (inBase.status === 0) return false;
    if (inBase.stderr?.length) break; // la referencia no existe: se prueba la otra
  }
  return true;
}

/**
 * Si una release pública lleva dentro una build de `develop`.
 *
 * **Las dos cosas no pueden ser verdad a la vez, y cuando no lo son la app se
 * queda ofreciendo instalar la que ya tiene.** Se devuelve el motivo en texto,
 * o `null` si no hay contradicción.
 */
export function publicButBuiltAsPrerelease(
  release: { prerelease: boolean; draft: boolean },
  tag: string,
): string | null {
  if (release.draft || release.prerelease) return null;
  if (!builtFromDevelop(tag)) return null;
  return (
    "la release es pública pero su binario se compiló en develop: la app se cree en la línea " +
    "de desarrollo y va a ofrecer instalar la línea pública, que es el mismo binario"
  );
}

/**
 * Los finales de línea, iguales para todos.
 *
 * El changelog es de LF, pero una release guardada por la API puede tener CRLF
 * adentro —y el `notes` del manifest también—. Comparar los textos tal cual
 * daría una diferencia que no es una diferencia: el mismo texto, escrito con
 * otro final de línea.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/** La versión del manifiesto: la que Tauri embebe en el binario. */
export function manifestVersion(): string {
  return JSON.parse(readFileSync(CONF_PATH, "utf8")).version;
}

type Asset = { id: number; name: string; url: string; created_at: string };
type Release = {
  id: number;
  tag_name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  upload_url: string;
  assets: Asset[];
};

/**
 * El token.
 *
 * `GITHUB_TOKEN` o `GH_TOKEN` primero —en la CI el primero—, después la sesión
 * de `gh`, y al final la credencial que git ya usa para github.com. La tercera
 * es la misma que empuja al repo y ya está en el almacén de credenciales de la
 * máquina: no hay que crear ni pegar un token nuevo para arreglar una release.
 * El token nunca se imprime ni se escribe en ningún archivo.
 */
function token(): string {
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv?.trim()) return fromEnv.trim();

  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();

  const credential = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const password = credential.stdout
    ?.split(/\r?\n/)
    .find((line) => line.startsWith("password="))
    ?.slice("password=".length)
    .trim();
  if (password) return password;

  throw new Error(
    "no hay token: define GITHUB_TOKEN o GH_TOKEN, o haz `gh auth login` y vuelve a correrlo.",
  );
}

/** El repo, del remoto de git: el mismo del que sale la release. */
function repository(): string {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv) return fromEnv;

  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(result.stdout ?? "");
  if (!m?.[1]) throw new Error("no se pudo deducir el repo del remoto `origin`.");
  return m[1];
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // La API de GitHub rechaza con 403 toda petición sin `User-Agent`, y
      // `fetch` no lo manda solo.
      "User-Agent": "starless-releases",
      Authorization: `Bearer ${token()}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} → ${response.status} ${detail}`);
  }
  return response;
}

async function listReleases(repo: string): Promise<Release[]> {
  const response = await api(`/repos/${repo}/releases?per_page=100`);
  return (await response.json()) as Release[];
}

/**
 * El cuerpo de la release.
 *
 * **La etiqueta va siempre en el PATCH.** GitHub reescribe el `tag_name` de
 * un borrador cuando se lo actualiza sin mandarle la etiqueta: lo deja en
 * `untagged-<sha>` —con un sha que puede no existir ya en el repo, porque el
 * commit se reescribió después—. Publicar ese borrador después crea una
 * release con esa etiqueta de por medio, y `releases/latest` pasa a apuntar a
 * un tag que no es una versión. Mandarla siempre es lo que lo evita.
 */
async function setBody(repo: string, release: Release, body: string): Promise<void> {
  await api(`/repos/${repo}/releases/${release.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: release.tag_name, body }),
  });
}

async function renameAsset(repo: string, asset: Asset, name: string): Promise<void> {
  await api(`/repos/${repo}/releases/assets/${asset.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    // La etiqueta también: es lo que GitHub muestra en la página de la release
    // y lo que la action busca cuando vuelve a subir un archivo con el mismo
    // nombre. Si queda la vieja, la release muestra un nombre que ya no existe.
    body: JSON.stringify({ name, label: name }),
  });
}

async function deleteAsset(repo: string, asset: Asset): Promise<void> {
  await api(`/repos/${repo}/releases/assets/${asset.id}`, { method: "DELETE" });
}

async function downloadAsset(asset: Asset): Promise<Uint8Array> {
  const response = await fetch(asset.url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "starless-releases",
      Authorization: `Bearer ${token()}`,
    },
  });
  if (!response.ok) throw new Error(`bajar ${asset.name} → ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * La URL de subida de un archivo.
 *
 * **Los archivos no se suben a `api.github.com`.** Esa API contesta `404` a
 * una subida, y no es un permiso lo que falta: el host no atiende esa
 * operación. Los archivos van a `uploads.github.com`, y la URL sale de la
 * release misma —que la publica con la plantilla `{?name,label}`—, así que
 * el host no está escrito en dos lugares.
 */
function uploadEndpoint(release: Release, name: string): string {
  const base = release.upload_url.replace(/\{.*$/, "");
  const query = `name=${encodeURIComponent(name)}&label=${encodeURIComponent(name)}`;
  return `${base}?${query}`;
}

async function uploadAsset(release: Release, name: string, bytes: Uint8Array): Promise<void> {
  const response = await fetch(uploadEndpoint(release, name), {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "starless-releases",
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes as unknown as BodyInit,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`subir ${name} → ${response.status} ${detail}`);
  }
}

/**
 * Lo que hay que hacer con una release.
 *
 * El plan se arma entero antes de tocar nada: si el plan está mal, no se
 * escribió nada todavía.
 */
type Plan = {
  release: Release;
  version: string;
  /** La sección del changelog de esta versión: el texto que va en el cuerpo y en las notas. */
  section: string | null;
  /** El cuerpo nuevo, si es que hay que cambiarlo. */
  body: string | null;
  renames: { asset: Asset; name: string }[];
  removals: Asset[];
  /** El instalador y su firma, con el nombre que van a tener. */
  installer: Asset | null;
  signature: Asset | null;
  manifest: { asset: Asset | null; content: string } | null;
  notes: string[];
};

function planFor(release: Release, markdown: string): Plan {
  const version = release.tag_name.replace(/^v/, "");
  const notes: string[] = [];
  const body = changelogSection(markdown, version);

  if (!body) {
    notes.push(
      `el changelog no tiene una sección para ${version}: el cuerpo de la release no se toca`,
    );
  }

  // **Una release pública con un binario de `develop` adentro.** No se puede
  // arreglar desde acá —el binario ya está compilado—, pero se puede decir, y
  // decirlo es la diferencia entre un bucle que se entiende y uno que no.
  const contradiccion = publicButBuiltAsPrerelease(release, release.tag_name);
  if (contradiccion) notes.push(contradiccion);

  const renames: { asset: Asset; name: string }[] = [];
  const removals: Asset[] = [];
  let installer: Asset | null = null;
  let signature: Asset | null = null;

  for (const asset of release.assets) {
    if (asset.name === MANIFEST_NAME) continue;
    const clean = withoutLocale(asset.name);
    if (clean === installerName(version)) {
      renames.push({ asset, name: clean });
      installer = asset;
      continue;
    }
    if (clean === signatureName(version)) {
      renames.push({ asset, name: clean });
      signature = asset;
      continue;
    }
    removals.push(asset);
  }

  return {
    release,
    version,
    section: body,
    body: body && normalize(body) !== normalize(release.body ?? "") ? body : null,
    renames,
    removals,
    installer,
    signature,
    manifest: null,
    notes,
  };
}

/**
 * El manifest que la release debería tener.
 *
 * **El manifest se arma entero, no se parchea.** La forma de una release está
 * escrita una sola vez y acá: dos claves —la genérica y la del tipo de
 * instalador— apuntando al mismo MSI, con la firma de ese MSI. Un manifest
 * que se parchea queda con las claves que tuvo el release anterior, y una de
 * esas puede apuntar a un archivo que ya no está: eso es un 404 con forma de
 * actualización.
 *
 * El manifest **no se repara si la release no tiene instalador o no tiene
 * firma**: la firma no se puede inventar —la clave privada no está acá—, y la
 * 0.3.0 se publicó a mano, antes de que el workflow existiera. Esa release
 * no fue actualizable nunca y no lo va a ser.
 */
async function desiredManifest(
  repo: string,
  plan: Plan,
): Promise<{ asset: Asset | null; content: string } | null> {
  const { installer, signature, version } = plan;
  if (!installer || !signature) return null;

  const signatureText = new TextDecoder().decode(await downloadAsset(signature));
  const url = `${API}/repos/${repo}/releases/assets/${installer.id}`;

  const manifest = {
    version,
    notes: plan.section ?? "",
    // La fecha de la release. No decide si hay actualización —eso lo decide
    // el número de versión—, pero es lo que la app muestra como fecha.
    pub_date: plan.release.published_at ?? installer.created_at ?? new Date().toISOString(),
    platforms: {
      "windows-x86_64": { signature: signatureText, url },
      "windows-x86_64-msi": { signature: signatureText, url },
    },
  };

  const asset = plan.release.assets.find((a) => a.name === MANIFEST_NAME) ?? null;
  const content = `${JSON.stringify(manifest, null, 2)}\n`;

  // Se compara el manifest consigo mismo antes y después, no el texto: el
  // archivo que sube la CI no tiene salto de línea final, y comparar los
  // textos escribiría un manifest nuevo en cada pasada sin que nada hubiera
  // cambiado.
  if (asset) {
    const current = JSON.parse(new TextDecoder().decode(await downloadAsset(asset)));
    if (JSON.stringify(current) === JSON.stringify(manifest)) return null;
  }

  return { asset, content };
}

/**
 * Lo que hay de la release que no coincide con la forma.
 *
 * `estricto` es para la release que se está publicando: los tres archivos, sin
 * excusas. Para las viejas es más blando: la 0.3.0 se publicó a mano, antes de
 * que el workflow existiera, y no tiene manifest ni firma —y no se le pueden
 * inventar, porque la firma necesita la clave privada—. De esa se espera sólo
 * el instalador.
 */
async function checkRelease(
  release: Release,
  markdown: string,
  estricto: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  const version = release.tag_name.replace(/^v/, "");
  const body = changelogSection(markdown, version);

  if (!body) {
    problems.push(`el changelog no tiene una sección para ${version}`);
  } else if (normalize(body) !== normalize(release.body ?? "")) {
    problems.push("el cuerpo de la release no es la sección del changelog");
  }

  const names = release.assets.map((a) => a.name);
  const installer = release.assets.find((a) => a.name === installerName(version));
  const manifestAsset = release.assets.find((a) => a.name === MANIFEST_NAME);

  // **Una release pública con un binario de `develop` adentro.** No se puede
  // arreglar desde acá, pero se puede decir, y decirlo es la diferencia entre
  // un bucle que se entiende y uno que no.
  const contradiccion = publicButBuiltAsPrerelease(release, release.tag_name);
  if (contradiccion) problems.push(contradiccion);

  // La firma es lo que decide si la release tiene manifest: sin firma no hay
  // manifest que valga, y una release sin firma no fue actualizable nunca.
  const expected =
    estricto || names.includes(signatureName(version))
      ? expectedAssets(version)
      : [installerName(version)];

  for (const name of expected) {
    if (!names.includes(name)) problems.push(`falta ${name}`);
  }
  for (const name of names) {
    if (!expected.includes(name)) problems.push(`sobra ${name}`);
  }

  if (manifestAsset) {
    const manifest = JSON.parse(new TextDecoder().decode(await downloadAsset(manifestAsset))) as {
      notes?: string;
      platforms?: Record<string, { url: string; signature: string }>;
    };
    const ids = new Set(release.assets.map((a) => a.id));
    for (const [key, entry] of Object.entries(manifest.platforms ?? {})) {
      const id = Number(/\/releases\/assets\/(\d+)/.exec(entry.url)?.[1] ?? Number.NaN);
      if (!ids.has(id))
        problems.push(`la clave ${key} del manifest apunta a un asset que no existe`);
    }
    if (body && normalize(manifest.notes ?? "") !== normalize(body)) {
      problems.push("las notas del manifest no son la sección del changelog");
    }
    // Las dos claves: la genérica y la del tipo de instalador. El plugin
    // busca la segunda primero y la primera después, y si falta alguna de las
    // dos no encuentra nada.
    for (const key of ["windows-x86_64", "windows-x86_64-msi"]) {
      if (!manifest.platforms?.[key]) problems.push(`el manifest no tiene la clave ${key}`);
    }
    if (installer) {
      const urls = Object.values(manifest.platforms ?? {}).map((entry) => entry.url);
      if (!urls.some((url) => url.includes(`/releases/assets/${installer.id}`))) {
        problems.push("el manifest no apunta al instalador");
      }
    }
  }

  return problems;
}

async function syncRelease(repo: string, release: Release, markdown: string): Promise<Plan> {
  const plan = planFor(release, markdown);

  if (plan.body) {
    await setBody(repo, release, plan.body);
  }

  for (const { asset, name } of plan.renames) {
    await renameAsset(repo, asset, name);
  }

  const manifest = await desiredManifest(repo, plan);
  if (manifest) {
    // GitHub no deja dos archivos con el mismo nombre: el viejo se borra y el
    // nuevo se sube. Entre los dos hay un instante en que `latest.json` no
    // está: es el instante de una request, y el comprobador lo toma por
    // "no hay nada nuevo".
    if (manifest.asset) {
      await deleteAsset(repo, manifest.asset);
    }
    await uploadAsset(release, MANIFEST_NAME, new TextEncoder().encode(manifest.content));
    plan.manifest = manifest;
  }

  // **La red de seguridad: no se borra nada si la release no está completa.**
  //
  // Un archivo se borra sólo cuando la release tiene instalador y firma. Si
  // falta uno de los dos, la clasificación de los archivos no es de fiar —y
  // borrar más sólo empeora el lío—. Es la mitad del instalador que se va,
  // y contra eso no hay red: un archivo borrado de una release no se recupera.
  if (plan.removals.length > 0 && (!plan.installer || !plan.signature)) {
    plan.notes.push(
      "no se borra nada: la release no tiene instalador y firma, y sin los dos no se sabe qué es un archivo sobrante",
    );
    return plan;
  }

  for (const asset of plan.removals) {
    await deleteAsset(repo, asset);
  }

  return plan;
}

function printPlan(plan: Plan): void {
  const { release, version } = plan;
  console.log(`${release.tag_name} (${version})`);
  if (plan.body) console.log("  cuerpo      → la sección del changelog");
  for (const { asset, name } of plan.renames) {
    console.log(`  nombre      ${asset.name} → ${name}`);
  }
  if (plan.manifest) {
    console.log(
      plan.manifest.asset
        ? "  manifest    → se reescribe con las notas del changelog"
        : "  manifest    → se crea con las notas del changelog",
    );
  }
  for (const asset of plan.removals) console.log(`  se borra    ${asset.name}`);
  for (const note of plan.notes) console.log(`  nota        ${note}`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "notes": {
      const version = manifestVersion();
      const body = changelogSection(readFileSync(CHANGELOG_PATH, "utf8"), version);
      if (!body) {
        console.error(`CHANGELOG.md no tiene una sección para ${version}`);
        process.exit(1);
      }
      console.log(body);
      break;
    }

    case "check": {
      const repo = repository();
      const markdown = readFileSync(CHANGELOG_PATH, "utf8");
      const releases = await listReleases(repo);
      const wanted = rest[0];
      const targets = wanted
        ? releases.filter((r) => r.tag_name === wanted || r.tag_name === `v${wanted}`)
        : releases;

      if (wanted && targets.length === 0) throw new Error(`no hay una release ${wanted}.`);

      let broken = 0;
      for (const release of targets) {
        // Con un tag se chequea estricto: esa release se está publicando ahora
        // y tiene que tener los tres archivos. Sin tag se chequea blando, que
        // es para las viejas —la 0.3.0 no tiene manifest ni firma—.
        const problems = await checkRelease(release, markdown, Boolean(wanted));
        if (problems.length === 0) {
          console.log(`${release.tag_name} ✓`);
          continue;
        }
        broken++;
        console.log(`${release.tag_name} ✗`);
        for (const problem of problems) console.log(`  ${problem}`);
      }
      if (broken > 0) {
        console.error(`\n${broken} release(s) con diferencias.`);
        process.exit(1);
      }
      console.log("\nTodo en forma.");
      break;
    }

    case "sync": {
      const repo = repository();
      const markdown = readFileSync(CHANGELOG_PATH, "utf8");
      const releases = await listReleases(repo);
      const wanted = rest[0];
      const targets = wanted
        ? releases.filter((r) => r.tag_name === wanted || r.tag_name === `v${wanted}`)
        : releases;

      if (wanted && targets.length === 0) throw new Error(`no hay una release ${wanted}.`);

      // Una release que no se puede arreglar no impide arreglar las otras: el
      // `GITHUB_TOKEN` de la CI puede no tocar los archivos que subió otra
      // corrida, y eso no puede dejar a medias las que sí se pueden. Al final
      // se avisa cuántas quedaron sin arreglar y el proceso sale con error, así
      // que el que lo corre a mano se entera.
      let failed = 0;
      for (const release of targets) {
        try {
          const plan = await syncRelease(repo, release, markdown);
          printPlan(plan);
        } catch (err) {
          failed++;
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`${release.tag_name} ✗ no se pudo arreglar: ${reason}`);
        }
      }
      if (failed > 0) {
        console.error(`\n${failed} release(s) sin arreglar.`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error("Uso: releases <notes | check [tag] | sync [tag]>");
      process.exit(1);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(`releases: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * What a report is, as the relay accepts it.
 *
 * Pure functions only: no `fetch`, no storage. That is what lets `bun test`
 * check the rules without a Cloudflare account, and it keeps the part that
 * decides *what* is allowed apart from the part that talks to GitHub.
 */

export type Kind = "crash" | "bug" | "idea" | "other";

export type Report = {
  kind: Kind;
  title: string;
  body: string;
  version: string;
  /** Present only on a crash with a panic: the same panic gives the same value. */
  signature?: string;
};

/** GitHub refuses an issue body over 65 536 characters; the app already cuts at 60 000. */
export const BODY_LIMIT = 62_000;
export const TITLE_LIMIT = 200;
const VERSION_LIMIT = 80;
const KINDS: readonly Kind[] = ["crash", "bug", "idea", "other"];

/**
 * Read a request body into a report, or say why it is not one.
 *
 * Every field is checked here because the relay is public: anything can POST
 * to it, and the only thing standing between that and the issue tracker is
 * this function and the rate limit.
 */
export function parseReport(input: unknown): { report: Report } | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "not_an_object" };
  const raw = input as Record<string, unknown>;

  const kind = raw.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as Kind)) return { error: "bad_kind" };

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > TITLE_LIMIT) return { error: "bad_title" };

  const body = typeof raw.body === "string" ? raw.body : "";
  if (!body.trim()) return { error: "empty_body" };
  if (body.length > BODY_LIMIT) return { error: "body_too_long" };

  const version = typeof raw.version === "string" ? raw.version.trim() : "";
  if (!version || version.length > VERSION_LIMIT) return { error: "bad_version" };

  let signature: string | undefined;
  if (raw.signature !== undefined && raw.signature !== null) {
    // A signature is a short hex hash made by the app. Anything else would end
    // up as a storage key, so it is refused rather than cleaned.
    if (typeof raw.signature !== "string" || !/^[0-9a-f]{16}$/.test(raw.signature)) {
      return { error: "bad_signature" };
    }
    if (kind !== "crash") return { error: "signature_on_feedback" };
    signature = raw.signature;
  }

  return { report: { kind: kind as Kind, title, body, version, signature } };
}

/** The labels an issue gets. `feedback` groups everything a person wrote. */
export function labelsFor(kind: Kind): string[] {
  switch (kind) {
    case "crash":
      return ["crash"];
    case "bug":
      return ["feedback", "bug"];
    case "idea":
      return ["feedback", "idea"];
    case "other":
      return ["feedback"];
  }
}

/**
 * The body of the issue: what the app sent, plus a line saying where it came
 * from. The marker is how somebody reading the tracker tells a relayed report
 * from one a person typed on GitHub.
 */
export function issueBody(report: Report): string {
  const lines = [report.body.trimEnd(), "", "<!-- starless-relay -->"];
  if (report.signature) lines.push(`<!-- starless-signature: ${report.signature} -->`);
  return lines.join("\n");
}

/** The comment a repeated crash leaves on the issue it repeats. */
export function repeatComment(report: Report): string {
  return [
    `**Otra vez / Again** — \`${report.version}\``,
    "",
    "<details><summary>Reporte / Report</summary>",
    "",
    report.body.trimEnd(),
    "",
    "</details>",
  ].join("\n");
}

/** The storage key of a rate-limit window: one per address per hour. */
export function rateKey(address: string, now: Date): string {
  const hour = now.toISOString().slice(0, 13);
  return `rate:${address}:${hour}`;
}

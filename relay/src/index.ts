/**
 * The Starless report relay.
 *
 * **Why it exists.** A report has to end up as a GitHub issue, and creating an
 * issue takes a token. A token baked into the app can be pulled out of any
 * copy of it, and without one the app can only open GitHub in the browser —
 * which asks the person for a GitHub account most people do not have. This
 * Worker holds the token instead: the app sends the report here, already
 * scrubbed and only after the person pressed send, and the Worker files it.
 *
 * **What it adds on the way:**
 *
 * - A limit per address, because anything can POST to a public URL.
 * - One issue per crash. A crash comes with a signature —a hash of where it
 *   panicked and what it said— and a crash whose signature already has an open
 *   issue becomes a comment on it. Fifty people hitting the same panic is one
 *   issue with fifty comments, not fifty issues.
 *
 * It stores nothing about the reports themselves: the rate-limit counters and
 * the signature → issue map, both with an expiry.
 */

import { issueBody, labelsFor, parseReport, type Report, rateKey, repeatComment } from "./report";

/** The part of Cloudflare's KV the Worker uses, declared here to need no dependency. */
type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

type Env = {
  /** Fine-grained token: this repository only, `Issues: Read and write`. A secret. */
  GITHUB_TOKEN: string;
  /** `owner/name`. */
  REPO: string;
  REPORTS: KV;
  /** Reports per address per hour. */
  RATE_LIMIT?: string;
};

const SIGNATURE_TTL = 60 * 60 * 24 * 180;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/report") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await allow(env, address))) return json({ error: "rate_limited" }, 429);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: "not_json" }, 400);
    }
    const parsed = parseReport(input);
    if ("error" in parsed) return json({ error: parsed.error }, 400);

    try {
      return await file(env, parsed.report);
    } catch (error) {
      console.error("github failed", error);
      return json({ error: "github_failed" }, 502);
    }
  },
};

/** Count this request against its hour, and say whether it fits. */
async function allow(env: Env, address: string): Promise<boolean> {
  const limit = Number(env.RATE_LIMIT ?? "10");
  const key = rateKey(address, new Date());
  const used = Number((await env.REPORTS.get(key)) ?? "0");
  if (used >= limit) return false;
  // KV is eventually consistent, so two requests in the same second can both
  // read the old count. The limit is a brake on abuse, not an exact quota.
  await env.REPORTS.put(key, String(used + 1), { expirationTtl: 60 * 60 * 2 });
  return true;
}

async function file(env: Env, report: Report): Promise<Response> {
  if (report.signature) {
    const known = await env.REPORTS.get(`sig:${report.signature}`);
    if (known) {
      const issue = await github(env, "GET", `/issues/${known}`);
      if (issue.ok) {
        const data = (await issue.json()) as { state: string; html_url: string; number: number };
        // A closed issue was fixed. The same panic in a newer version is a
        // regression, and that deserves an issue of its own.
        if (data.state === "open") {
          const comment = await github(env, "POST", `/issues/${known}/comments`, {
            body: repeatComment(report),
          });
          if (comment.ok) {
            return json({ url: data.html_url, number: data.number, duplicate: true }, 200);
          }
        }
      }
    }
  }

  const payload = { title: report.title, body: issueBody(report), labels: labelsFor(report.kind) };
  let created = await github(env, "POST", "/issues", payload);
  // A label the repository does not have is a 422, and that would lose the
  // report. Filed without labels is better than not filed.
  if (created.status === 422) {
    created = await github(env, "POST", "/issues", { ...payload, labels: [] });
  }
  if (!created.ok) {
    throw new Error(`create issue: ${created.status} ${await created.text()}`);
  }
  const issue = (await created.json()) as { html_url: string; number: number };

  if (report.signature) {
    await env.REPORTS.put(`sig:${report.signature}`, String(issue.number), {
      expirationTtl: SIGNATURE_TTL,
    });
  }
  return json({ url: issue.html_url, number: issue.number, duplicate: false }, 201);
}

function github(env: Env, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub answers 403 to a request without one.
      "User-Agent": "starless-relay",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

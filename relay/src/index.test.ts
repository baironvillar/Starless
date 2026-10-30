import { afterEach, describe, expect, test } from "bun:test";
import worker, { type Env } from "./index";

/**
 * The Worker, end to end, without a Cloudflare account.
 *
 * **These are the tests that matter most: this is the code that files a
 * report.** A report that does not arrive is a crash nobody ever hears
 * about, and the app's answer to that is to open the browser —so the failure
 * looks like a slower app and not like a broken relay.
 *
 * Two things are faked: GitHub, which answers whatever the test says, and the
 * KV, which is a Map. Everything else —the routing, the rate limit, the
 * grouping of repeated crashes, the labels— is the real code.
 */

/** The real `fetch`, so every test can put it back. */
const realFetch = globalThis.fetch;

/** A KV that remembers, like the real one does between requests. */
function memoryKV() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      store.set(key, { value, ttl: options?.expirationTtl });
    },
  };
}

/** One call the Worker made to GitHub. */
type Call = {
  method: string;
  url: string;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
};

/**
 * GitHub, as the test wants it.
 *
 * The handler answers every call, and the calls are kept so a test can ask
 * what was actually asked for: the only way to know that the report carries
 * the labels it should, and that the token never travelled with it.
 */
function github(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const mock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? "GET",
      url: input.toString(),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      headers: Object.fromEntries(headers.entries()),
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, mock };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The environment the Worker runs in. The token is a fake one. */
function environment(overrides: Partial<Env> = {}, kv = memoryKV()): Env {
  return {
    GITHUB_TOKEN: "token-de-prueba",
    REPO: "owner/name",
    REPORTS: kv,
    ...overrides,
  };
}

/** A report as the app sends it. */
function post(body: unknown, address = "1.2.3.4"): Request {
  return new Request("https://relay.test/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": address },
    body: JSON.stringify(body),
  });
}

const crash = {
  kind: "crash",
  title: "Crash en 0.5.6",
  body: "## Panic\n\nalgo",
  version: "0.5.6",
  signature: "0123456789abcdef",
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("filing a report", () => {
  test("a crash opens an issue and says where it is", async () => {
    const { calls, mock } = github(() =>
      json({ html_url: "https://github.com/o/n/issues/7", number: 7 }, 201),
    );
    globalThis.fetch = mock;

    const response = await worker.fetch(post(crash), environment());
    const answer = (await response.json()) as { url: string; number: number; duplicate: boolean };

    expect(response.status).toBe(201);
    expect(answer).toEqual({
      url: "https://github.com/o/n/issues/7",
      number: 7,
      duplicate: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.github.com/repos/owner/name/issues");
    expect((calls[0].body as { labels: string[] }).labels).toEqual(["crash"]);
  });

  test("the issue says it came through the relay", async () => {
    const { calls, mock } = github(() => json({ html_url: "https://x/7", number: 7 }, 201));
    globalThis.fetch = mock;

    await worker.fetch(post(crash), environment());

    expect((calls[0].body as { body: string }).body).toContain("<!-- starless-relay -->");
  });

  test("the token stays in the relay and does not travel with the report", async () => {
    const { calls, mock } = github(() => json({ html_url: "https://x/7", number: 7 }, 201));
    globalThis.fetch = mock;

    await worker.fetch(post(crash), environment());

    // The relay is the one that talks to GitHub, and it is the only thing
    // that holds the token. If it ever ended up in the body of a report, the
    // report would be a public copy of the key that files issues.
    expect(JSON.stringify(calls[0].body)).not.toContain("token-de-prueba");
    // The header names are lowercase: `Headers` normalizes them.
    expect(calls[0].headers.authorization).toBe("Bearer token-de-prueba");
  });

  test("GitHub is asked with a User-Agent, because it answers 403 without one", async () => {
    const { calls, mock } = github(() => json({ html_url: "https://x/7", number: 7 }, 201));
    globalThis.fetch = mock;

    await worker.fetch(post(crash), environment());

    expect(calls[0].headers["user-agent"]).toBe("starless-relay");
  });

  test("a label the repository does not have does not lose the report", async () => {
    const { calls, mock } = github((_call) =>
      calls.length === 1
        ? json({ message: "Validation Failed" }, 422)
        : json({ html_url: "https://x/7", number: 7 }, 201),
    );
    globalThis.fetch = mock;

    const response = await worker.fetch(post(crash), environment());

    expect(response.status).toBe(201);
    // GitHub refuses the labels it does not have with a 422, and the report
    // goes in without them rather than not going in at all.
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { labels: string[] }).labels).toEqual([]);
  });

  test("a GitHub failure is a 502 and not a lost report", async () => {
    const { mock } = github(() => json({ message: "boom" }, 500));
    globalThis.fetch = mock;

    const response = await worker.fetch(post(crash), environment());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "github_failed" });
  });
});

describe("the same crash twice", () => {
  test("is one issue with two reports", async () => {
    const { calls, mock } = github((call) => {
      if (call.method === "GET") {
        return json({ state: "open", html_url: "https://x/7", number: 7 });
      }
      if (call.url.endsWith("/issues")) {
        return json({ html_url: "https://x/7", number: 7 }, 201);
      }
      return json({}, 201);
    });
    globalThis.fetch = mock;
    const env = environment();

    const first = await worker.fetch(post(crash), env);
    const second = await worker.fetch(post(crash), env);
    const answer = (await second.json()) as { number: number; duplicate: boolean };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(answer.duplicate).toBe(true);
    expect(answer.number).toBe(7);
    // One issue, one comment: fifty people hitting the same panic is one
    // issue with fifty comments, not fifty issues.
    expect(
      calls.filter((call) => call.url.endsWith("/issues") && call.method === "POST"),
    ).toHaveLength(1);
    expect(calls.some((call) => call.url.endsWith("/issues/7/comments"))).toBe(true);
  });

  test("opens a new issue when the old one was closed, because that is a regression", async () => {
    const { calls, mock } = github((call) => {
      if (call.method === "GET") {
        return json({ state: "closed", html_url: "https://x/7", number: 7 });
      }
      return json({ html_url: "https://x/8", number: 8 }, 201);
    });
    globalThis.fetch = mock;
    const env = environment();

    await worker.fetch(post(crash), env);
    const second = await worker.fetch(post(crash), env);
    const answer = (await second.json()) as { number: number; duplicate: boolean };

    expect(second.status).toBe(201);
    expect(answer.duplicate).toBe(false);
    expect(answer.number).toBe(8);
    expect(
      calls.filter((call) => call.url.endsWith("/issues") && call.method === "POST"),
    ).toHaveLength(2);
  });

  test("is remembered with an expiry, because a signature is not forever", async () => {
    const kv = memoryKV();
    const { mock } = github(() => json({ html_url: "https://x/7", number: 7 }, 201));
    globalThis.fetch = mock;

    await worker.fetch(post(crash), environment({}, kv));

    expect(kv.store.get("sig:0123456789abcdef")?.value).toBe("7");
    expect(kv.store.get("sig:0123456789abcdef")?.ttl).toBe(60 * 60 * 24 * 180);
  });
});

describe("the rate limit", () => {
  test("stops the reports of one address", async () => {
    const { mock } = github(() => json({ html_url: "https://x/7", number: 7 }, 201));
    globalThis.fetch = mock;
    const env = environment({ RATE_LIMIT: "2" });

    expect((await worker.fetch(post(crash), env)).status).toBe(201);
    expect((await worker.fetch(post(crash), env)).status).toBe(201);

    const third = await worker.fetch(post(crash), env);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: "rate_limited" });
  });

  test("counts each address on its own", async () => {
    const { mock } = github(() => json({ html_url: "https://x/7", number: 7 }, 201));
    globalThis.fetch = mock;
    const env = environment({ RATE_LIMIT: "1" });

    expect((await worker.fetch(post(crash, "1.1.1.1"), env)).status).toBe(201);
    expect((await worker.fetch(post(crash, "2.2.2.2"), env)).status).toBe(201);
    expect((await worker.fetch(post(crash, "1.1.1.1"), env)).status).toBe(429);
  });
});

describe("what the relay refuses", () => {
  test("a path that is not the report one", async () => {
    const response = await worker.fetch(
      new Request("https://relay.test/otro", { method: "POST", body: "{}" }),
      environment(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("a method that is not POST", async () => {
    const response = await worker.fetch(new Request("https://relay.test/report"), environment());

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
  });

  test("a body that is not JSON", async () => {
    const response = await worker.fetch(
      new Request("https://relay.test/report", { method: "POST", body: "no soy json" }),
      environment(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "not_json" });
  });

  test("a report it will not file", async () => {
    const response = await worker.fetch(post({ ...crash, kind: "spam" }), environment());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad_kind" });
  });
});

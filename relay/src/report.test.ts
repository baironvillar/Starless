import { describe, expect, test } from "bun:test";
import { BODY_LIMIT, issueBody, labelsFor, parseReport, rateKey } from "./report";

const valid = {
  kind: "crash",
  title: "Crash en 0.5.6: panic en src/playback.rs:12",
  body: "## Panic\n\nalgo",
  version: "0.5.6",
  signature: "0123456789abcdef",
};

describe("parseReport", () => {
  test("a well-formed crash passes", () => {
    const parsed = parseReport(valid);
    expect("report" in parsed && parsed.report.signature).toBe("0123456789abcdef");
  });

  test("an unknown kind is refused", () => {
    expect(parseReport({ ...valid, kind: "spam" })).toEqual({ error: "bad_kind" });
  });

  test("an empty body is refused", () => {
    expect(parseReport({ ...valid, body: "   " })).toEqual({ error: "empty_body" });
  });

  test("a body past the limit is refused", () => {
    expect(parseReport({ ...valid, body: "x".repeat(BODY_LIMIT + 1) })).toEqual({
      error: "body_too_long",
    });
  });

  test("a signature that is not a short hex hash is refused", () => {
    expect(parseReport({ ...valid, signature: "../../etc" })).toEqual({ error: "bad_signature" });
  });

  test("feedback cannot carry a signature, so it can never be merged into a crash", () => {
    expect(parseReport({ ...valid, kind: "idea" })).toEqual({ error: "signature_on_feedback" });
  });

  test("feedback without a signature passes", () => {
    const { signature: _, ...idea } = valid;
    expect("report" in parseReport({ ...idea, kind: "idea" })).toBe(true);
  });
});

test("every kind has its labels", () => {
  expect(labelsFor("crash")).toEqual(["crash"]);
  expect(labelsFor("bug")).toEqual(["feedback", "bug"]);
  expect(labelsFor("idea")).toEqual(["feedback", "idea"]);
  expect(labelsFor("other")).toEqual(["feedback"]);
});

test("the issue body says it came through the relay, and carries the signature", () => {
  const parsed = parseReport(valid);
  if (!("report" in parsed)) throw new Error("expected a report");
  const body = issueBody(parsed.report);
  expect(body).toContain("<!-- starless-relay -->");
  expect(body).toContain("<!-- starless-signature: 0123456789abcdef -->");
});

test("the rate window is one hour per address", () => {
  const at = new Date("2026-10-29T14:59:59Z");
  expect(rateKey("1.2.3.4", at)).toBe("rate:1.2.3.4:2026-10-29T14");
  expect(rateKey("1.2.3.4", new Date("2026-10-29T15:00:00Z"))).toBe("rate:1.2.3.4:2026-10-29T15");
});

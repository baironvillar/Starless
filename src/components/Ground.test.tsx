import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EFFECTS_DEFAULT, type Effects } from "../lib/spotify";
import { EdgeFade } from "./Ground";

// The glow reads `window`, which a server render does not have.
const effect: Effects = { ...EFFECTS_DEFAULT, glow: "off" };

function strip(url: string | null) {
  return renderToStaticMarkup(
    <EdgeFade
      below
      barPresent
      left={112}
      right={36}
      url={url}
      background={{ url, dim: 40, blur: 0 }}
      effect={effect}
    />,
  );
}

/**
 * The content's bottom fade is a copy of the ground painted over the list. It only
 * hides the list if the copy is opaque, and `Ground` on its own is not: without a
 * picture it is the bloom alone, translucent. This broke without anyone touching
 * the fade, because it only shows with no picture and the surfaces frosted.
 */
describe("the content's edge fade", () => {
  for (const url of [null, "https://example.test/picture.jpg"]) {
    test(`stands on an opaque floor (${url ? "with" : "without"} a picture)`, () => {
      const html = strip(url);
      expect(html).toMatch(/data-edge-floor=""[^>]*class="[^"]*\bbg-ground\b/);
    });
  }

  test("is as wide as the content column, not the window", () => {
    const html = strip(null);
    expect(html).toContain("left:112px");
    expect(html).toContain("right:36px");
  });
});

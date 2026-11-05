import { useEffect, useState } from "react";

/**
 * The colour a cover lends the play button: the average of its most colourful
 * quarter. A plain average of a cover is mud — a red sleeve with a black frame
 * averages to brown — so the pixels are ranked by how much colour they carry
 * (the spread between their strongest and weakest channel) and only the top
 * of the ranking is mixed. Near-black pixels are left out: they are the frame
 * and the shadows, not the cover's colour. A cover with no colour at all comes
 * out as its own grey, which is the honest answer.
 */
export function tintOf(pixels: ArrayLike<number>): string {
  const all: [number, number, number, number][] = [];
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    if (max < 40) continue;
    all.push([r, g, b, max - Math.min(r, g, b)]);
  }
  if (all.length === 0) return "#15151b";
  all.sort((a, b) => b[3] - a[3]);
  const top = all.slice(0, Math.max(1, Math.ceil(all.length / 4)));
  const mean = [0, 1, 2].map((c) => Math.round(top.reduce((sum, p) => sum + p[c], 0) / top.length));
  return `#${mean.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The playing cover's tint, or null while there is none to give.
 *
 * The cover is read through a 24px canvas, which needs the image host to allow
 * it: the cover CDN answers `Access-Control-Allow-Origin: *`, and a host that
 * does not taints the canvas, `getImageData` throws, and the button falls back
 * to the accent. The last tint stays while the next cover loads, so a change of
 * song is one colour fading into the next and not a flash of the fallback.
 */
export function useCoverTint(url: string | undefined, enabled: boolean): string | null {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !url) {
      setTint(null);
      return;
    }
    let live = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 24, 24);
        if (live) setTint(tintOf(context.getImageData(0, 0, 24, 24).data));
      } catch {
        if (live) setTint(null);
      }
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url, enabled]);
  return tint;
}

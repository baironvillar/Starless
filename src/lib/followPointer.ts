/**
 * Where the mouse is, seen from each glass play button, as `--mx` from -1 (far
 * to its left) to 1 (far to its right): the glass look leans its light toward
 * the hand wherever the hand is, like the landing's download key does under it.
 *
 * One listener for the whole window and not one per button, because the hand
 * is followed when it is not over the button too. It writes on the buttons
 * themselves and not on the root, so a move restyles those few elements and
 * not every glass surface that reads the root. Once per frame at most: a mouse
 * reports far more often than the screen paints.
 *
 * The CSS decides whether it shows (`--follow`, off with motion off), so this
 * runs regardless and the other looks simply do not read `--mx`.
 */
export function followPointer(): () => void {
  let frame = 0;
  let x = 0;
  const paint = () => {
    frame = 0;
    for (const key of document.querySelectorAll<HTMLElement>('.play-key[data-style="glass"]')) {
      const box = key.getBoundingClientRect();
      if (box.width === 0) continue;
      key.style.setProperty(
        "--mx",
        leanToward(x - (box.left + box.width / 2), box.width).toFixed(3),
      );
    }
  };
  const onMove = (event: PointerEvent) => {
    x = event.clientX;
    if (!frame) frame = requestAnimationFrame(paint);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    window.removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}

/**
 * How far the light leans for a hand `dx` pixels from the button's centre. It
 * saturates instead of clamping: half way at two button-widths, and never quite
 * all the way, so a mouse across the screen still moves it a little and the
 * light never sticks at the edge.
 */
export function leanToward(dx: number, width: number): number {
  const reach = width * 2;
  return dx / (Math.abs(dx) + reach);
}

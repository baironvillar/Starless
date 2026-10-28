/**
 * Copy to the clipboard, and say whether it worked.
 *
 * **The async path first, the old one as the fallback.** WebView2 refuses
 * `navigator.clipboard` outside a secure context, and the textarea dance is the
 * only thing left when it does. It is deprecated everywhere else and still the
 * thing that works here, which is a fact about this runtime rather than a
 * preference.
 *
 * Returns a boolean instead of throwing because the caller has to *show* the
 * difference: a copy that silently failed leaves the user pasting whatever was
 * on the clipboard before and wondering what happened.
 *
 * **It lives here and not inside a menu.** Two menus copy links —the one of a
 * song and the one of a playlist— and the fallback dance is twenty lines that
 * have to be right every time. Copied in two places, it is right in one of them.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      // Off-screen rather than `display: none`: a hidden element cannot be
      // selected, and nothing gets copied.
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand("copy");
      document.body.removeChild(area);
      return done;
    } catch {
      return false;
    }
  }
}

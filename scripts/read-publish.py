"""Read the last published player state from the log.

**This reads the log; it is not part of the app.** The log stores the body of
the PUT the way Rust prints it --a byte literal with escapes-- and the URIs and
the uids of the tracks that come next are read from there. It is the only way to
see whether the queue of the app reached the state that is published.

Usage: `python scripts/read-publish.py [how many]`
"""

import ast
import re
import sys

LOG = r"C:\Users\bairo\AppData\Local\Starless\starless.log"
LINEA = re.compile(r"se public", re.IGNORECASE)
URI = re.compile(rb"spotify:track:[A-Za-z0-9]+")
UID = re.compile(rb"\x12([0-9a-f]{16})")


def cuerpo_de(linea: str) -> bytes:
    """El literal de bytes del `PUT`, tal como Rust lo imprimió."""
    inicio = linea.find("(b")
    fin = linea.rfind(")")
    if inicio < 0 or fin < 0:
        return b""
    return ast.literal_eval(linea[inicio + 1 : fin + 1])


def main() -> None:
    cuantos = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    with open(LOG, "r", encoding="utf-8", errors="replace") as archivo:
        lineas = [linea for linea in archivo if LINEA.search(linea)]
    for linea in lineas[-cuantos:]:
        cuerpo = cuerpo_de(linea)
        if not cuerpo:
            print("no body found")
            continue
        uris = [m.group(0).decode() for m in URI.finditer(cuerpo)]
        uids = [m.group(1).decode() for m in UID.finditer(cuerpo)]
        print(f"--- {linea[1:20]} / {len(cuerpo)} bytes")
        print(f"    tracks: {len(uris)} / uids: {len(uids)}")
        for uri in uris[:12]:
            print(f"      {uri}")
        if uris:
            print(f"    last: {uris[-1]}")
        if uids:
            print(f"    first uid: {uids[0]} / last: {uids[-1]}")


if __name__ == "__main__":
    main()

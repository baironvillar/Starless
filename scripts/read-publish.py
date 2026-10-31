"""Read the published player state from the log.

**This reads the log; it is not part of the app.** The log keeps the answer of
the PUT that publishes the player state, and that answer is a `Cluster`: the
service's own view of the device, with the queue it built out of what the app
published. The URI and the uid of every song are read from there.

It is the only way to see what the other side of the jam is going to see: the
phone reads the same cluster, and if the song is not there with its uid, the
phone does not have it.

Usage: `python scripts/read-publish.py [how many]`
"""

import ast
import os
import re
import sys

LOG = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Starless", "starless.log"
)
PUBLICADA = re.compile(r"se public")
LITERAL = re.compile(r"\((b\"(?:[^\"\\]|\\.)*\")\)")


def cuerpo_de(linea: str) -> bytes:
    """El literal de bytes del `PUT`, tal como Rust lo imprimio."""
    encontrado = LITERAL.search(linea)
    if not encontrado:
        return b""
    try:
        return ast.literal_eval(encontrado.group(1))
    except (SyntaxError, ValueError):
        return b""


def varint(datos: bytes, pos: int) -> tuple[int, int]:
    """Un varint de protobuf: el numero y donde termina."""
    valor = 0
    turno = 0
    while pos < len(datos):
        byte = datos[pos]
        valor |= (byte & 0x7F) << turno
        pos += 1
        if not byte & 0x80:
            return valor, pos
        turno += 7
    return valor, pos


def campos(datos: bytes) -> list[tuple[int, int, object]]:
    """Los campos de un mensaje: (numero, tipo, valor)."""
    salida: list[tuple[int, int, object]] = []
    pos = 0
    while pos < len(datos):
        clave, pos = varint(datos, pos)
        numero, tipo = clave >> 3, clave & 0x07
        if tipo == 0:
            valor, pos = varint(datos, pos)
        elif tipo == 1:
            valor, pos = datos[pos : pos + 8], pos + 8
        elif tipo == 2:
            largo, pos = varint(datos, pos)
            valor, pos = datos[pos : pos + largo], pos + largo
        elif tipo == 5:
            valor, pos = datos[pos : pos + 4], pos + 4
        else:
            break
        salida.append((numero, tipo, valor))
    return salida


def texto(valor: object) -> str:
    if isinstance(valor, bytes):
        return valor.decode("utf-8", "replace")
    return str(valor)


def pistas(mensaje: bytes) -> list[tuple[str, str]]:
    """Las pistas de un mensaje de estado: (uri, uid)."""
    salida = []
    for numero, tipo, valor in campos(mensaje):
        if numero in (7, 19, 20) and tipo == 2 and isinstance(valor, bytes):
            uri = ""
            uid = ""
            for sub, tipo2, valor2 in campos(valor):
                if sub == 1 and tipo2 == 2:
                    uri = texto(valor2)
                elif sub == 2 and tipo2 == 2:
                    uid = texto(valor2)
            salida.append((uri, uid))
    return salida


URI = re.compile(rb"spotify:track:([A-Za-z0-9]{22})")
UID = re.compile(rb"\x12(?:\x10|\x28)([0-9a-f]{16}|[0-9a-f]{40})")


def pistas(cuerpo: bytes) -> list[tuple[str, str]]:
    """Las pistas que aparecen en el cuerpo, con su uid si lo tienen."""
    salida = []
    for encontrado in URI.finditer(cuerpo):
        uri = encontrado.group(1).decode()
        cola = cuerpo[encontrado.end() : encontrado.end() + 90]
        uid = UID.search(cola)
        salida.append((uri, uid.group(1).decode() if uid else ""))
    return salida


def cluster(datos: bytes) -> None:
    """Imprime el `Cluster` que contesta el `PUT`."""
    for numero, tipo, valor in campos(datos):
        if numero == 2 and tipo == 2:
            print(f"    device activo: {texto(valor)}")
    todas = pistas(datos)
    if not todas:
        print("    la cola del servicio no tiene ninguna pista")
        return
    primera = todas[0][0]
    print(f"    la cola del servicio tiene {len(todas)} pistas")
    for uri, uid in todas[:10]:
        marca = " (la que suena)" if uri == primera else ""
        print(f"      {uri}  uid {uid or '(vacio)'}{marca}")


def main() -> None:
    cuantos = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    ruta = sys.argv[2] if len(sys.argv) > 2 else LOG
    with open(ruta, "r", encoding="utf-8", errors="replace") as archivo:
        lineas = [linea for linea in archivo if PUBLICADA.search(linea)]
    for linea in lineas[-cuantos:]:
        cuerpo = cuerpo_de(linea)
        print(f"--- {linea[1:24]} / {len(cuerpo)} bytes")
        if not cuerpo:
            print("    no se pudo leer el cuerpo")
            continue
        cluster(cuerpo)


if __name__ == "__main__":
    main()

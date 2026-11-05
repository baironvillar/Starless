/**
 * Vuelca un `.proto` embebido en un binario.
 *
 * **Por qué existe.** Spotify no publica el protocolo, pero el cliente de
 * escritorio lo lleva dentro: el `.dll` de Windows tiene embebidos los
 * descriptores de protobuf de los servicios que usa, y cada uno empieza con el
 * nombre del archivo. Los textos completos de los `.proto` no están —lo que hay
 * son los **descriptores compilados**, que es lo mismo con otra forma— y
 * DescriptorProto se puede volver a escribir como `.proto`.
 *
 * Lo que se necesita para el jam: los mensajes de `social_connect_v2.proto`,
 * que son los que describen la sesión, sus participantes y la cola. Sin el
 * descriptor, los nombres de campo del DLL son sólo strings sueltos y el
 * protocolo se adivina; con el descriptor, el protocolo se lee.
 *
 * Uso:
 *   bun scripts/proto-dump.ts <binario> <nombre.proto> [...]
 *
 * El nombre va tal cual aparece en el binario: `social_connect_v2.proto`.
 */

const [binaryPath, ...protoNames] = process.argv.slice(2);

if (!binaryPath || protoNames.length === 0) {
  console.error("uso: bun scripts/proto-dump.ts <binario> <nombre.proto> [...]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Un lector de protobuf, sólo lo justo para DescriptorProto
// ---------------------------------------------------------------------------

/** Un campo de protobuf, ya decodificado según su tipo de cable. */
type Field = { number: number; wire: number; value: number | bigint | Buffer };

/** Lee un varint en el buffer desde `at`. */
function readVarint(bytes: Buffer, at: number): { value: bigint; next: number } | null {
  let value = 0n;
  let shift = 0n;
  let cursor = at;

  while (cursor < bytes.length) {
    const byte = bytes[cursor++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7n;
    if (shift > 63n) return null;
  }

  return null;
}

/** Decodifica un mensaje de protobuf en la lista de sus campos. */
function decodeFields(bytes: Buffer): Field[] {
  const fields: Field[] = [];
  let cursor = 0;

  while (cursor < bytes.length) {
    const tag = readVarint(bytes, cursor);
    if (!tag) break;

    const number = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    cursor = tag.next;

    if (number === 0) break;

    if (wire === 0) {
      const value = readVarint(bytes, cursor);
      if (!value) break;
      fields.push({ number, wire, value: value.value });
      cursor = value.next;
    } else if (wire === 1) {
      if (cursor + 8 > bytes.length) break;
      fields.push({
        number,
        wire,
        value: BigInt(`0x${bytes.subarray(cursor, cursor + 8).toString("hex")}`),
      });
      cursor += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, cursor);
      if (!length) break;
      const start = length.next;
      const end = start + Number(length.value);
      if (end > bytes.length) break;
      fields.push({ number, wire, value: bytes.subarray(start, end) });
      cursor = end;
    } else if (wire === 5) {
      if (cursor + 4 > bytes.length) break;
      fields.push({
        number,
        wire,
        value: BigInt(`0x${bytes.subarray(cursor, cursor + 4).toString("hex")}`),
      });
      cursor += 4;
    } else {
      // Los grupos (wire 3 y 4) no aparecen en un descriptor compilado.
      break;
    }
  }

  return fields;
}

/** El texto de un campo de tipo `string` o `bytes`. */
function asText(field: Field | undefined): string {
  if (field?.wire !== 2) return "";
  return (field.value as Buffer).toString("utf8");
}

/** El número de un campo entero. */
function asNumber(field: Field | undefined): number {
  if (!field) return 0;
  if (field.wire === 0) return Number(field.value as bigint);
  if (field.wire === 2) return Number((field.value as Buffer).readBigUInt64BE(0));
  return 0;
}

/** Todos los campos con ese número. */
function all(fields: Field[], number: number): Field[] {
  return fields.filter((field) => field.number === number);
}

/** El primer campo con ese número. */
function first(fields: Field[], number: number): Field | undefined {
  return fields.find((field) => field.number === number);
}

/**
 * Dónde termina un mensaje.
 *
 * `ParseFromString` de Python acepta basura después del mensaje, así que un
 * error de parseo no dice dónde estaba el fin. Recorrer los campos del
 * primero al último y quedarse con el final del último es lo que corta el
 * descriptor en su borde exacto.
 */
function extentOf(bytes: Buffer, start: number): number {
  let cursor = start;

  while (cursor < bytes.length) {
    const tag = readVarint(bytes, cursor);
    if (!tag) break;

    const wire = Number(tag.value & 7n);
    const number = Number(tag.value >> 3n);
    cursor = tag.next;

    if (number === 0) break;

    if (wire === 0) {
      const value = readVarint(bytes, cursor);
      if (!value) break;
      cursor = value.next;
    } else if (wire === 1) {
      cursor += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, cursor);
      if (!length) break;
      cursor = length.next + Number(length.value);
    } else if (wire === 5) {
      cursor += 4;
    } else {
      break;
    }
  }

  return cursor;
}

// ---------------------------------------------------------------------------
// El descriptor, y su vuelta a `.proto`
// ---------------------------------------------------------------------------

const TYPES: Record<number, string> = {
  1: "double",
  2: "float",
  3: "int64",
  4: "uint64",
  5: "int32",
  6: "fixed64",
  7: "fixed32",
  8: "bool",
  9: "string",
  10: "group",
  11: "message",
  12: "bytes",
  13: "uint32",
  14: "enum",
  15: "sfixed32",
  16: "sfixed64",
  17: "sint32",
  18: "sint64",
};

const LABELS: Record<number, string> = { 1: "optional", 2: "required", 3: "repeated" };

/** Un mensaje del descriptor. */
function renderMessage(fields: Field[], indent: string): string {
  const name = asText(first(fields, 1));
  const lines: string[] = [`${indent}message ${name} {`];

  for (const nested of all(fields, 3)) {
    lines.push(renderMessage(decodeFields(nested.value as Buffer), `${indent}  `));
  }

  for (const enumField of all(fields, 4)) {
    lines.push(renderEnum(decodeFields(enumField.value as Buffer), `${indent}  `));
  }

  for (const oneof of all(fields, 8)) {
    const oneofName = asText(first(decodeFields(oneof.value as Buffer), 1));
    lines.push(`${indent}  oneof ${oneofName} {}`);
  }

  for (const field of all(fields, 2)) {
    const parts = decodeFields(field.value as Buffer);
    const fieldName = asText(first(parts, 1));
    const number = asNumber(first(parts, 3));
    const label = LABELS[asNumber(first(parts, 4))] ?? "optional";
    const type = TYPES[asNumber(first(parts, 5))] ?? "unknown";
    const typeName = asText(first(parts, 6));
    const resolved = type === "message" || type === "enum" ? typeName.replace(/^\./, "") : type;

    lines.push(`${indent}  ${label} ${resolved} ${fieldName} = ${number};`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Una enumeración del descriptor. */
function renderEnum(fields: Field[], indent: string): string {
  const name = asText(first(fields, 1));
  const lines: string[] = [`${indent}enum ${name} {`];

  for (const value of all(fields, 2)) {
    const parts = decodeFields(value.value as Buffer);
    lines.push(`${indent}  ${asText(first(parts, 1))} = ${asNumber(first(parts, 2))};`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** Un servicio del descriptor. */
function renderService(fields: Field[], indent: string): string {
  const name = asText(first(fields, 1));
  const lines: string[] = [`${indent}service ${name} {`];

  for (const method of all(fields, 2)) {
    const parts = decodeFields(method.value as Buffer);
    lines.push(
      `${indent}  rpc ${asText(first(parts, 1))}(${asText(first(parts, 2)).replace(/^\./, "")}) returns (${asText(first(parts, 3)).replace(/^\./, "")});`,
    );
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

/** El descriptor entero, escrito como `.proto`. */
function renderFile(fields: Field[]): string {
  const lines: string[] = ['syntax = "proto3";', ""];
  const packageName = asText(first(fields, 2));

  if (packageName) lines.push(`package ${packageName};`);

  const dependencies = all(fields, 3).map((field) => asText(field));
  if (dependencies.length > 0) {
    lines.push("");
    for (const dependency of dependencies) lines.push(`import "${dependency}";`);
  }

  for (const enumField of all(fields, 5)) {
    lines.push("");
    lines.push(renderEnum(decodeFields(enumField.value as Buffer), ""));
  }

  for (const message of all(fields, 4)) {
    lines.push("");
    lines.push(renderMessage(decodeFields(message.value as Buffer), ""));
  }

  for (const service of all(fields, 6)) {
    lines.push("");
    lines.push(renderService(decodeFields(service.value as Buffer), ""));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// El volcado
// ---------------------------------------------------------------------------

const bytes = await Bun.file(binaryPath).arrayBuffer();
const buffer = Buffer.from(bytes);

for (const protoName of protoNames) {
  const needle = Buffer.from(protoName, "utf8");

  // El nombre de un `.proto` aparece **muchas** veces en el binario: una en
  // cada descriptor que lo importa, y una en el descriptor del archivo. La
  // del descriptor es la única que está precedida por el tag del campo 1 —el
  // nombre es el primer campo del `FileDescriptorProto`—, así que se prueban
  // todas las apariciones y se corta con la que da.
  let dumped = false;

  for (let at = buffer.indexOf(needle); at !== -1; at = buffer.indexOf(needle, at + 1)) {
    const start = at - 2;
    if (start < 0 || buffer[start] !== 0x0a) continue;

    const end = extentOf(buffer, start);
    const descriptor = decodeFields(buffer.subarray(start, end));
    const name = asText(first(descriptor, 1));

    // El descriptor de otro archivo puede tener este nombre como dependencia.
    if (name !== protoName) continue;

    console.log(`// ${protoName} · ${end - start} bytes · descriptor embebido en ${binaryPath}`);
    console.log(renderFile(descriptor));
    console.log();
    dumped = true;
    break;
  }

  if (!dumped) {
    console.error(`${protoName}: el nombre aparece en ${binaryPath}, pero no como un descriptor`);
  }
}

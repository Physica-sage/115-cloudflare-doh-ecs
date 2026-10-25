import { toArrayBuffer, writeU16, writeU32 } from "../src/binary";

export function encodeName(name: string): Uint8Array {
  const labels = name.split(".");
  let length = 1;
  for (const label of labels) length += 1 + label.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const label of labels) {
    output[offset] = label.length;
    offset += 1;
    for (let i = 0; i < label.length; i += 1) {
      output[offset + i] = label.charCodeAt(i);
    }
    offset += label.length;
  }
  output[offset] = 0;
  return output;
}

export function makeQuery(
  name = "www.qq.com",
  type = 1,
  options?: {
    id?: number;
    optOptions?: Uint8Array;
    udpSize?: number;
    optTtl?: number;
  }
): Uint8Array {
  const qname = encodeName(name);
  const optOptions = options?.optOptions;
  const optLength = optOptions === undefined ? 0 : 11 + optOptions.length;
  const output = new Uint8Array(12 + qname.length + 4 + optLength);
  writeU16(output, 0, options?.id ?? 0x1234);
  writeU16(output, 2, 0x0110);
  writeU16(output, 4, 1);
  writeU16(output, 10, optOptions === undefined ? 0 : 1);
  let offset = 12;
  output.set(qname, offset);
  offset += qname.length;
  writeU16(output, offset, type);
  writeU16(output, offset + 2, 1);
  offset += 4;
  if (optOptions !== undefined) {
    output[offset] = 0;
    writeU16(output, offset + 1, 41);
    writeU16(output, offset + 3, options?.udpSize ?? 1232);
    writeU32(output, offset + 5, options?.optTtl ?? 0);
    writeU16(output, offset + 9, optOptions.length);
    output.set(optOptions, offset + 11);
  }
  return output;
}

export function makeResponseFromQuery(query: Uint8Array): Uint8Array {
  const output = query.slice();
  output[2] = (output[2] ?? 0) | 0x80;
  output[3] = (output[3] ?? 0) | 0x80;
  return output;
}

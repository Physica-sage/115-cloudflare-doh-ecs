import { concatBytes, readU16, readU32, writeU16, writeU32 } from "../src/binary";
import { parseDnsMessage, parseName } from "../src/dns";

export interface TestRecord {
  type: number;
  ttl: number;
  data: Uint8Array;
  section?: "answer" | "authority" | "additional";
}

export function responseWithRecords(query: Uint8Array, records: TestRecord[], rcode = 0): Uint8Array {
  const info = parseDnsMessage(query);
  const header = query.slice(0, info.question.endOffset);
  writeU16(header, 2, 0x81a0 | rcode);
  const sections = ["answer", "authority", "additional"] as const;
  const bodies: Uint8Array[] = [];
  for (let section = 0; section < sections.length; section += 1) {
    const selected = records.filter((r) => (r.section ?? "answer") === sections[section]);
    writeU16(header, 6 + section * 2, selected.length);
    for (const r of selected) {
      const owner = r.type === 41 ? Uint8Array.of(0) : Uint8Array.of(0xc0, 0x0c);
      const body = new Uint8Array(owner.length + 10 + r.data.length);
      body.set(owner);
      writeU16(body, owner.length, r.type);
      writeU16(body, owner.length + 2, r.type === 41 ? 1232 : 1);
      writeU32(body, owner.length + 4, r.ttl);
      writeU16(body, owner.length + 8, r.data.length);
      body.set(r.data, owner.length + 10);
      bodies.push(body);
    }
  }
  return concatBytes([header, ...bodies]);
}

export function recordsIn(message: Uint8Array): Array<{
  type: number; ttl: number; data: Uint8Array
}> {
  const info = parseDnsMessage(message);
  let offset = info.question.endOffset;
  const records = [];
  for (let i = 0; i < info.answerCount + info.authorityCount + info.additionalCount; i += 1) {
    const start = parseName(message, offset).nextOffset;
    const length = readU16(message, start + 8);
    offset = start + 10 + length;
    records.push({
      type: readU16(message, start),
      ttl: readU32(message, start + 4),
      data: message.slice(start + 10, offset)
    });
  }
  return records;
}

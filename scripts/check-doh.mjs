#!/usr/bin/env node
// Standard DoH wire-format probe. No external dependencies.
import { randomInt } from "node:crypto";

const [endpoint, domain = "example.com", typeName = "A"] = process.argv.slice(2);
const types = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SVCB: 64, HTTPS: 65 };
if (!endpoint || !types[typeName.toUpperCase()]) {
  console.error("Usage: node scripts/check-doh.mjs <DoH URL> [domain] [A|AAAA|TXT|CNAME|NS|MX|SOA|HTTPS]");
  process.exit(2);
}
const labels = domain.replace(/\.$/, "").split(".");
if (labels.some((s) => s.length < 1 || Buffer.byteLength(s) > 63)) throw new Error("Invalid DNS name");
const header = Buffer.alloc(12);
const id = randomInt(65536);
header.writeUInt16BE(id);
header.writeUInt16BE(0x0100, 2);
header.writeUInt16BE(1, 4);
const question = Buffer.concat([
  ...labels.map((s) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])),
  Buffer.from([0, 0, types[typeName.toUpperCase()], 0, 1])
]);
const query = Buffer.concat([header, question]);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/dns-message", accept: "application/dns-message" },
  body: query,
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error("DoH HTTP " + response.status);
if (!response.headers.get("content-type")?.startsWith("application/dns-message")) {
  throw new Error("Expected application/dns-message");
}
const body = Buffer.from(await response.arrayBuffer());
if (body.length < 12 || body.readUInt16BE(0) !== id || !(body.readUInt16BE(2) & 0x8000)) {
  throw new Error("Invalid DNS response");
}
function nameAt(start) {
  const labels = [];
  let p = start, end = null;
  const seen = new Set();
  for (let steps = 0; steps < 128; steps++) {
    if (p >= body.length || seen.has(p)) throw new Error("Invalid DNS name pointer");
    seen.add(p);
    const length = body[p++];
    if ((length & 0xc0) === 0xc0) {
      if (p >= body.length) throw new Error("Truncated DNS pointer");
      end ??= p + 1;
      p = ((length & 0x3f) << 8) | body[p];
      continue;
    }
    if ((length & 0xc0) !== 0) throw new Error("Invalid DNS label");
    if (!length) return { name: labels.join(".") + ".", end: end ?? p };
    if (p + length > body.length) throw new Error("Truncated DNS label");
    labels.push(body.toString("utf8", p, p + length));
    p += length;
  }
  throw new Error("Too many DNS pointers");
}
const flags = body.readUInt16BE(2);
const output = {
  domain, type: typeName.toUpperCase(), http: response.status, rcode: flags & 15,
  cacheControl: response.headers.get("cache-control"), records: [], ecs: []
};
let offset = 12;
for (let i = 0; i < body.readUInt16BE(4); i++) offset = nameAt(offset).end + 4;
for (let section = 0; section < 3; section++) {
  const count = body.readUInt16BE(6 + section * 2);
  for (let i = 0; i < count; i++) {
    const name = nameAt(offset);
    const start = name.end;
    if (start + 10 > body.length) throw new Error("Truncated DNS record");
    const type = body.readUInt16BE(start);
    const ttl = body.readUInt32BE(start + 4);
    const length = body.readUInt16BE(start + 8);
    const dataStart = start + 10, dataEnd = dataStart + length;
    if (dataEnd > body.length) throw new Error("Truncated DNS RDATA");
    const data = body.subarray(dataStart, dataEnd);
    offset = dataEnd;
    if (type === 41) {
      for (let p = dataStart; p < dataEnd;) {
        if (p + 4 > dataEnd) throw new Error("Truncated EDNS option");
        const code = body.readUInt16BE(p), size = body.readUInt16BE(p + 2);
        p += 4;
        if (p + size > dataEnd) throw new Error("Invalid EDNS option size");
        if (code === 8 && size >= 4) output.ecs.push({
          family: body.readUInt16BE(p), sourcePrefix: body[p + 2], scopePrefix: body[p + 3],
          networkBytes: [...body.subarray(p + 4, p + size)]
        });
        p += size;
      }
      continue;
    }
    let value = data.toString("hex");
    if (type === 1 && length === 4) value = [...data].join(".");
    if (type === 28 && length === 16) value = Array.from({ length: 8 }, (_, n) => data.readUInt16BE(n * 2).toString(16)).join(":");
    if ([2, 5, 12].includes(type)) value = nameAt(dataStart).name;
    if (type === 15 && length >= 3) value = data.readUInt16BE(0) + " " + nameAt(dataStart + 2).name;
    if (type === 16) {
      const texts = [];
      for (let p = 0; p < data.length;) {
        const size = data[p++];
        if (p + size > data.length) throw new Error("Truncated TXT");
        texts.push(data.toString("utf8", p, p + size));
        p += size;
      }
      value = texts;
    }
    output.records.push({ section: ["answer", "authority", "additional"][section], name: name.name,
      type: Object.entries(types).find(([, n]) => n === type)?.[0] ?? type, ttl, value });
  }
}
console.log(JSON.stringify(output, null, 2));
if (output.rcode !== 0) process.exitCode = 1;

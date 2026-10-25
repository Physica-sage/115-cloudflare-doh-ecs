import { concatBytes, readU16, readU32, writeU32 } from "../src/binary";
import { capResponseTtl } from "../src/dns";
import { encodeName, makeQuery } from "./helpers";
import { recordsIn, responseWithRecords } from "./ttl-helpers";

describe("downstream DNS TTL policy", () => {
  it("caps positive A answers, preserves addresses, and does not mutate the upstream packet", () => {
    const answer = responseWithRecords(makeQuery(), [
      { type: 1, ttl: 300, data: Uint8Array.of(6, 6, 6, 6) }
    ]);
    const original = answer.slice();
    const limited = capResponseTtl(answer, 5);
    expect(recordsIn(limited)).toEqual([{ type: 1, ttl: 5, data: Uint8Array.of(6, 6, 6, 6) }]);
    expect(answer).toEqual(original);
    expect(readU16(limited, 2)).toBe(readU16(answer, 2));
  });

  it("caps CNAME, AAAA, DNSSEC headers and additional records without modifying RDATA or OPT", () => {
    const signature = new Uint8Array(24);
    writeU32(signature, 4, 3600); // RRSIG Original TTL is signed data, not a cache header.
    const ecs = Uint8Array.of(0, 8, 0, 7, 0, 1, 24, 0, 8, 8, 4);
    const rr = [
      { type: 5, ttl: 300, data: encodeName("target.example") },
      { type: 28, ttl: 120, data: new Uint8Array(16).fill(1) },
      { type: 46, ttl: 600, data: signature },
      { type: 2, ttl: 1, data: encodeName("ns.example"), section: "authority" as const },
      { type: 1, ttl: 0, data: Uint8Array.of(1, 2, 3, 4), section: "additional" as const },
      { type: 41, ttl: 0x01008000, data: ecs, section: "additional" as const }
    ];
    const result = recordsIn(capResponseTtl(responseWithRecords(makeQuery(), rr), 5));
    expect(result.map((r) => r.ttl)).toEqual([5, 5, 5, 1, 0, 0x01008000]);
    expect(result.map((r) => r.data)).toEqual(rr.map((r) => r.data));
    expect(readU32(result[2]!.data, 4)).toBe(3600);
  });

  it.each([0, 5])("caps NXDOMAIN SOA TTL and SOA.MINIMUM to %i", (max) => {
    const fields = new Uint8Array(20);
    [123, 3600, 600, 86400, 900].forEach((v, i) => writeU32(fields, i * 4, v));
    const soa = concatBytes([encodeName("ns.example"), encodeName("admin.example"), fields]);
    const query = makeQuery("missing.example");
    const response = responseWithRecords(query, [{ type: 6, ttl: 300, data: soa, section: "authority" }], 3);
    const result = capResponseTtl(response, max);
    const record = recordsIn(result)[0]!;
    expect(readU16(result, 2) & 15).toBe(3);
    expect(record.ttl).toBe(max);
    expect(readU32(record.data, record.data.length - 4)).toBe(max);
    expect(record.data.slice(0, -4)).toEqual(soa.slice(0, -4));
  });

  it("sets real record TTLs to zero without erasing OPT flags", () => {
    const response = responseWithRecords(makeQuery(), [
      { type: 1, ttl: 300, data: Uint8Array.of(7, 7, 7, 7) },
      { type: 41, ttl: 0x8000, data: new Uint8Array(), section: "additional" }
    ]);
    expect(recordsIn(capResponseTtl(response, 0)).map((r) => r.ttl)).toEqual([0, 0x8000]);
  });

  it("preserves all upstream TTLs when explicitly requested", () => {
    const response = responseWithRecords(makeQuery(), [
      { type: 1, ttl: 300, data: Uint8Array.of(6, 6, 6, 6) }
    ]);
    expect(capResponseTtl(response, null)).toEqual(response);
  });

  it("rejects a malformed SOA instead of overwriting adjacent bytes", () => {
    const response = responseWithRecords(makeQuery(), [
      { type: 6, ttl: 300, data: Uint8Array.of(0, 0, 0), section: "authority" }
    ]);
    expect(() => capResponseTtl(response, 5)).toThrow();
  });
});

import { readU16, toArrayBuffer } from "../src/binary";
import { parseDnsMessage } from "../src/dns";
import { handleRequest } from "../src/index";
import { makeQuery } from "./helpers";
import { recordsIn, responseWithRecords } from "./ttl-helpers";

describe("proxy exit geography and TTL end to end", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  function request(ip: string, extra: Record<string, string> = {}): Request {
    return new Request("https://worker.example/doh", {
      method: "POST",
      headers: { "content-type": "application/dns-message", "cf-connecting-ip": ip, ...extra },
      body: toArrayBuffer(makeQuery("dynamic.example"))
    });
  }

  function installUpstream(): { queries: Uint8Array[]; calls: RequestInit[] } {
    const queries: Uint8Array[] = [];
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
      const query = new Uint8Array(init.body as ArrayBuffer);
      queries.push(query);
      calls.push(init);
      return new Response(toArrayBuffer(responseWithRecords(query, [
        { type: 1, ttl: 300, data: Uint8Array.of(6, 6, 6, queries.length) }
      ])), { headers: { "content-type": "application/dns-message" } });
    }));
    return { queries, calls };
  }

  function ecsData(query: Uint8Array): number[] {
    const opt = parseDnsMessage(query).opt!;
    return Array.from(query.slice(opt.rdataStart, opt.rdataEnd));
  }

  it("takes the actual connection IP instead of an arbitrary XFF address", async () => {
    const env = {};
    const { queries } = installUpstream();
    const response = await handleRequest(request("8.8.4.123", { "x-forwarded-for": "1.1.1.1" }), env);
    expect(ecsData(queries[0]!)).toEqual([0, 8, 0, 7, 0, 1, 24, 0, 8, 8, 4]);
    expect(recordsIn(new Uint8Array(await response.arrayBuffer()))[0]!.ttl).toBe(5);
  });

  it("supports an explicitly trusted forwarding proxy", async () => {
    const env = {};
    const { queries } = installUpstream();
    await handleRequest(request("8.8.4.123", { "x-forwarded-for": "1.1.1.123" }), {
      ...env, TRUST_X_FORWARDED_FOR: "true"
    });
    expect(ecsData(queries[0]!)).toEqual([0, 8, 0, 7, 0, 1, 24, 0, 1, 1, 1]);
  });

  it("uses the original IPv6 address if Cloudflare Pseudo IPv4 obscures it", async () => {
    const env = {};
    const { queries } = installUpstream();
    await handleRequest(request("240.1.2.3", { "cf-connecting-ipv6": "2001:4860:4860::8888" }), env);
    expect(ecsData(queries[0]!)).toEqual([0, 8, 0, 11, 0, 2, 56, 0, 0x20, 1, 0x48, 0x60, 0x48, 0x60, 0]);
  });

  it("does not reuse an answer or ECS subnet across different proxy exits", async () => {
    const env = {};
    const { queries, calls } = installUpstream();
    const first = await handleRequest(request("8.8.4.123"), env);
    const second = await handleRequest(request("1.1.1.123"), env);
    expect(queries).toHaveLength(2);
    expect(ecsData(queries[0]!)).not.toEqual(ecsData(queries[1]!));
    expect(recordsIn(new Uint8Array(await first.arrayBuffer()))[0]!.data).toEqual(Uint8Array.of(6, 6, 6, 1));
    expect(recordsIn(new Uint8Array(await second.arrayBuffer()))[0]!.data).toEqual(Uint8Array.of(6, 6, 6, 2));
    expect(calls.map((c) => c.cache)).toEqual(["no-store", "no-store"]);
    expect(second.headers.get("cache-control")).toBe("no-store");
  });

  it.each([["0", 0], ["upstream", 300]] as const)("applies configured TTL mode %s to an actual DNS answer", async (mode, ttl) => {
    const env = {};
    installUpstream();
    const response = await handleRequest(request("8.8.4.123"), { ...env, DNS_TTL_MAX: mode });
    expect(recordsIn(new Uint8Array(await response.arrayBuffer()))[0]!.ttl).toBe(ttl);
  });

  it("does not trust XFF if there is no valid connection address", async () => {
    const env = {};
    const { queries } = installUpstream();
    await handleRequest(request("127.0.0.1", { "x-forwarded-for": "8.8.8.8" }), env);
    expect(parseDnsMessage(queries[0]!).opt).toBeNull();
  });

  it("replaces an incoming ECS option with the connection subnet", async () => {
    const env = {};
    const { queries } = installUpstream();
    const query = makeQuery("dynamic.example", 1, {
      optOptions: Uint8Array.of(0, 8, 0, 7, 0, 1, 24, 0, 1, 1, 1)
    });
    await handleRequest(new Request("https://worker.example/doh", {
      method: "POST",
      headers: { "content-type": "application/dns-message", "cf-connecting-ip": "8.8.4.123" },
      body: toArrayBuffer(query)
    }), env);
    expect(ecsData(queries[0]!)).toEqual([0, 8, 0, 7, 0, 1, 24, 0, 8, 8, 4]);
  });

  it("fails over when a response has malformed SOA data", async () => {
    const env = {};
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
      count++;
      const query = new Uint8Array(init.body as ArrayBuffer);
      const answer = count === 1
        ? [{ type: 6, ttl: 300, data: Uint8Array.of(0, 0, 0), section: "authority" as const }]
        : [{ type: 1, ttl: 300, data: Uint8Array.of(7, 7, 7, 7) }];
      return new Response(toArrayBuffer(responseWithRecords(query, answer)), {
        headers: { "content-type": "application/dns-message" }
      });
    }));
    const response = await handleRequest(request("8.8.4.123"), env);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(count).toBe(2);
    expect(readU16(bytes, 2) & 15).toBe(0);
    expect(recordsIn(bytes)[0]!.ttl).toBe(5);
  });
});

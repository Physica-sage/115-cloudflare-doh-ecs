import { readConfig } from "../src/config";

describe("worker configuration", () => {
  const base = () => ({});

  it("uses safe defaults and accepts valid overrides", () => {
    expect(readConfig(base())).toMatchObject({
      path: "/doh",
      dnsTtlMax: 5,
      trustXForwardedFor: false,
      globalUrls: [
        "https://dns.google/dns-query",
        "https://8.8.4.4/dns-query"
      ]
    });
    expect(
      readConfig({
        ...base(),
        DOH_PATH: "/private-doh",
        GLOBAL_DOH_URL: "https://resolver.example/dns-query",
        GLOBAL_FALLBACK_DOH_URL: "https://backup.example/dns-query"
      })
    ).toMatchObject({
      path: "/private-doh",
      globalUrls: [
        "https://resolver.example/dns-query",
        "https://backup.example/dns-query"
      ]
    });
  });

  it.each([
    ["0", 0], ["60", 60], ["86400", 86400], ["upstream", null]
  ] as const)("accepts TTL policy %s", (value, expected) => {
    expect(readConfig({ ...base(), DNS_TTL_MAX: value }).dnsTtlMax).toBe(expected);
  });

  it("allows forwarded addresses only when explicitly enabled", () => {
    expect(readConfig({ ...base(), TRUST_X_FORWARDED_FOR: "true" }).trustXForwardedFor).toBe(true);
  });

  it.each([
    { DNS_TTL_MAX: "-1" },
    { DNS_TTL_MAX: "1.5" },
    { DNS_TTL_MAX: "86401" },
    { DNS_TTL_MAX: "" },
    { DNS_TTL_MAX: "NaN" },
    { TRUST_X_FORWARDED_FOR: "yes" },
    { DOH_PATH: "dns-query" },
    { DOH_PATH: "//evil" },
    { GLOBAL_DOH_URL: "http://8.8.8.8/dns-query" },
    { GLOBAL_DOH_URL: "https://user:pass@example.com/dns-query" },
    { GLOBAL_DOH_URL: "https://127.0.0.1/dns-query" },
    { GLOBAL_DOH_URL: "https://[::1]/dns-query" },
    { GLOBAL_DOH_URL: "https://example.com/dns-query?target=x" },
    { GLOBAL_FALLBACK_DOH_URL: "https://127.0.0.1/dns-query" }
  ])("rejects unsafe config %#", (override) => {
    expect(() => readConfig({ ...base(), ...override })).toThrow();
  });
});

import { isGlobalUnicast, parseIp } from "./ip";
import type { Env } from "./types";

const DEFAULT_GLOBAL = "https://dns.google/dns-query";
const DEFAULT_GLOBAL_FALLBACK = "https://8.8.4.4/dns-query";
const DEFAULT_PATH = "/doh";

export interface WorkerConfig {
  path: string;
  dnsTtlMax: number | null;
  trustXForwardedFor: boolean;
  globalUrls: readonly [string, string];
}


function validatePath(value: string | undefined): string {
  const path = value ?? DEFAULT_PATH;
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    path.length > 256
  ) {
    throw new Error("invalid_doh_path");
  }
  return path;
}

function validateUpstream(value: string | undefined, fallback: string): string {
  let url: URL;
  try {
    url = new URL(value ?? fallback);
  } catch {
    throw new Error("invalid_upstream_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.search !== ""
  ) {
    throw new Error("invalid_upstream_url");
  }

  let hostname = url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  const literal = parseIp(hostname);
  if (literal !== null && !isGlobalUnicast(literal)) {
    throw new Error("private_upstream_literal");
  }
  return url.toString();
}

function parseTtlMax(value: string | undefined): number | null {
  const text = value ?? "5";
  if (text === "upstream") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error("invalid_dns_ttl_max");
  const ttl = Number(text);
  if (!Number.isSafeInteger(ttl) || ttl > 86400) throw new Error("invalid_dns_ttl_max");
  return ttl;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("invalid_trust_x_forwarded_for");
}

export function readConfig(env: Env): WorkerConfig {
  return {
    path: validatePath(env.DOH_PATH),
    dnsTtlMax: parseTtlMax(env.DNS_TTL_MAX),
    trustXForwardedFor: parseBoolean(env.TRUST_X_FORWARDED_FOR),
    globalUrls: [
      validateUpstream(env.GLOBAL_DOH_URL, DEFAULT_GLOBAL),
      validateUpstream(env.GLOBAL_FALLBACK_DOH_URL, DEFAULT_GLOBAL_FALLBACK)
    ]
  };
}

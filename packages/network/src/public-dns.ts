import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { pinnedHttpsRequest } from "./outbound.js";

export class PublicAddressError extends Error {
  constructor(readonly forbidden: boolean, message: string) { super(message); }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blocked.addSubnet(address, prefix, "ipv6");

/** Conservative global-unicast policy; mapped IPv4, NAT64 and transition ranges are refused. */
export function isPublicMetadataAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

const fakeIp = new BlockList();
fakeIp.addSubnet("198.18.0.0", 15, "ipv4");
// Fake-IP proxies also publish IPv4-translated AAAA records (RFC 6145).
fakeIp.addSubnet("::ffff:0:c612:0", 111, "ipv6");
export function isFakeMetadataAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && fakeIp.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Only bootstrap the fixed DNS provider, never the untrusted metadata host. */
async function publicDns(host: string, type: "A" | "AAAA", signal: AbortSignal, proxyUrl = "", provider: "cloudflare" | "google" = "cloudflare"): Promise<{ address: string; family: number }[]> {
  const url = new URL(provider === "cloudflare" ? "https://cloudflare-dns.com/dns-query" : "https://dns.google/resolve");
  url.search = new URLSearchParams({ name: host, type }).toString();
  return new Promise((resolve, reject) => {
    const req = pinnedHttpsRequest(url, provider === "cloudflare" ? "1.1.1.1" : "8.8.8.8", signal,
      { accept: "application/dns-json", "accept-encoding": "identity" }, res => {
      const contentType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (res.statusCode !== 200 || !["application/dns-json", ...(provider === "google" ? ["application/json"] : [])].includes(contentType)
        || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") || Number(res.headers["content-length"]) > 16 * 1024) {
        reject(new Error("Public DNS response rejected")); res.destroy(); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024) { reject(new Error("Public DNS response exceeds limit")); res.destroy(); }
        else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("Public DNS response aborted")));
      res.on("end", () => {
        try {
          const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
          const queryType = type === "A" ? 1 : 28;
          const question = data?.Question;
          if (data?.Status !== 0 || data.TC === true || !Array.isArray(question) || question.length !== 1
            || typeof question[0]?.name !== "string" || question[0].name.replace(/\.$/, "").toLowerCase() !== host.toLowerCase()
            || question[0].type !== queryType || (data.Answer !== undefined && (!Array.isArray(data.Answer) || data.Answer.length > 64))) {
            throw new Error("Public DNS question or response is invalid");
          }
          const addresses: { address: string; family: number }[] = [];
          for (const answer of data.Answer ?? []) {
            if (answer?.type !== 1 && answer?.type !== 28) continue; // CNAME, not a connection destination.
            const family = answer.type === 1 ? 4 : 6;
            if (typeof answer.data !== "string" || isIP(answer.data) !== family || !isPublicMetadataAddress(answer.data)) {
              throw new PublicAddressError(true, "Public DNS returned a nonpublic address");
            }
            addresses.push({ address: answer.data, family });
          }
          resolve(addresses);
        } catch (error) { reject(error); }
      });
    }, proxyUrl);
    req.on("error", reject); req.end();
  });
}

export async function metadataAddresses(host: string, resolver: Resolver, signal: AbortSignal, proxyUrl = ""): Promise<{ address: string; family: number }[]> {
  const family = isIP(host);
  // A proxy mode never depends on local DNS/Fake-IP for an untrusted target.
  if (proxyUrl && !family) {
    for (const provider of ["cloudflare", "google"] as const) {
      signal.throwIfAborted();
      const controller = new AbortController();
      const bounded = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(4500)]);
      try {
        const addresses = (await Promise.all([publicDns(host, "A", bounded, proxyUrl, provider), publicDns(host, "AAAA", bounded, proxyUrl, provider)])).flat();
        if (!addresses.length) throw new PublicAddressError(false, "Verified public DNS lookup through the outbound proxy returned no addresses");
        return addresses;
      } catch (error) {
        if (error instanceof PublicAddressError && error.forbidden) throw error;
      } finally { controller.abort(); }
    }
    signal.throwIfAborted();
    throw new PublicAddressError(false, "Verified public DNS lookup through the outbound proxy failed; check the proxy and HTTPS access to Cloudflare DNS / Google DNS");
  }
  let addresses = family ? [{ address: host, family }] : (await Promise.allSettled([
    resolver.resolve4(host), resolver.resolve6(host),
  ])).flatMap((result, index) => result.status === "fulfilled" ? result.value.map(address => ({ address, family: index === 0 ? 4 : 6 })) : []);
  signal.throwIfAborted();
  if (!addresses.length) throw new PublicAddressError(false, "CIMD metadata DNS lookup failed; check the desktop application's network/DNS settings");
  if (addresses.every(({ address }) => isPublicMetadataAddress(address))) return addresses;
  // A private/mixed-private DNS answer is still refused, never sent to DoH.
  if (family || !addresses.some(({ address }) => isFakeMetadataAddress(address))
    || addresses.some(({ address }) => !isPublicMetadataAddress(address) && !isFakeMetadataAddress(address))) {
    throw new PublicAddressError(true, "CIMD DNS must resolve exclusively to public addresses; private or reserved targets are refused");
  }
  try {
    addresses = (await Promise.all([publicDns(host, "A", signal), publicDns(host, "AAAA", signal)])).flat();
    if (!addresses.length) throw new Error("No public DNS answers");
    return addresses;
  } catch {
    throw new PublicAddressError(false, "CIMD DNS returned proxy fake-IP addresses and verified public DNS lookup failed; allow HTTPS to cloudflare-dns.com (1.1.1.1) or exclude the metadata domain from fake-IP DNS");
  }
}

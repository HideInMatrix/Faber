import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { metadataAddresses, isPublicMetadataAddress, PublicAddressError, pinnedHttpsRequest, parseOutboundProxy } from "@micromatrix/network";
export { isPublicMetadataAddress, isFakeMetadataAddress } from "@micromatrix/network";
function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || /[\s\\#]/.test(value) || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value)) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export interface CimdClient {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method: "none";
}

const MAX_BYTES = 5 * 1024;
const MAX_CACHE = 100;
const MAX_CONCURRENT = 8;
export class CimdDiscoveryError extends Error {
  constructor(readonly status: 400 | 503, readonly oauthError: "invalid_client_metadata" | "temporarily_unavailable", message: string) {
    super(message);
    this.name = "CimdDiscoveryError";
  }
}

export function metadataUrl(clientId: string): URL {
  const url = new URL(clientId);
  const rawPath = /^https:\/\/[^/?#]+(\/[^?#]*)/i.exec(clientId)?.[1];
  if (clientId.length > 2048 || /[\s\\#?]/.test(clientId) || /^https:\/\/[^/?#]*@/i.test(clientId)
    || !rawPath || /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(rawPath)
    || url.protocol !== "https:" || !url.hostname || url.search
    || url.pathname === "/" || url.username || url.password || url.hash || url.port) {
    throw new Error("CIMD requires a public HTTPS URL with a path, without credentials, fragment or nonstandard port");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || (isIP(host) && !isPublicMetadataAddress(host))) throw new Error("CIMD metadata must not use a private or reserved address");
  return url;
}

export function parseCimdClient(clientId: string, value: unknown): CimdClient {
  metadataUrl(clientId);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CIMD document");
  const document = value as Record<string, unknown>;
  const redirects = document.redirect_uris;
  const methods = document.token_endpoint_auth_methods_supported;
  // The plural CIMD field is used by ChatGPT during the MCP transition. Only
  // negotiate explicitly published 'none'; never claim to verify private_key_jwt.
  if (document.client_id !== clientId || typeof document.client_name !== "string"
    || !document.client_name.trim() || document.client_name.length > 128
    || /[\u0000-\u001f\u007f]/.test(document.client_name)
    || !Array.isArray(redirects) || !redirects.length || redirects.length > 32
    || !redirects.every(uri => typeof uri === "string" && uri.length <= 2048 && validRedirectUri(uri))
    || document.client_secret !== undefined || document.client_secret_expires_at !== undefined
    || (typeof document.token_endpoint_auth_method === "string" && document.token_endpoint_auth_method.startsWith("client_secret"))
    || (methods !== undefined && (!Array.isArray(methods) || !methods.every(method => typeof method === "string") || !methods.includes("none")))
    || (methods === undefined && (document.token_endpoint_auth_method ?? "none") !== "none")) {
    throw new Error("CIMD identity, redirect URIs or public-client authentication is invalid");
  }
  if (Array.isArray(methods) && methods.some(method => method.startsWith("client_secret"))) throw new Error("CIMD cannot publish shared-secret authentication");
  if (document.jwks !== undefined) {
    const keys = (document.jwks as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys) || keys.some(key => !key || typeof key !== "object"
      || ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some(field => Object.hasOwn(key, field)))) {
      throw new Error("CIMD must not contain private key material");
    }
  }
  for (const [field, expected, fallback] of [["grant_types", "authorization_code", ["authorization_code"]], ["response_types", "code", ["code"]]] as const) {
    const values = document[field] ?? fallback;
    if (!Array.isArray(values) || !values.every(item => typeof item === "string") || !values.includes(expected)) throw new Error(`Invalid CIMD ${field}`);
  }
  return { client_id: clientId, client_name: document.client_name, redirect_uris: [...redirects], token_endpoint_auth_method: "none" };
}

function cacheLifetime(headers: Readonly<Record<string, string | string[] | undefined>>): number {
  const control = String(headers["cache-control"] ?? "");
  if (/(?:^|,)\s*(?:no-store|no-cache)\b/i.test(control) || headers.vary) return 0;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(control)?.[1];
  const expires = Date.parse(String(headers.expires ?? ""));
  const lifetime = maxAge === undefined ? (Number.isFinite(expires) ? Math.max(0, (expires - Date.now()) / 1000) : 60) : Number(maxAge);
  const rawAge = Number(headers.age ?? 0);
  return Math.max(0, Math.min(300, lifetime - (Number.isFinite(rawAge) ? Math.max(0, rawAge) : lifetime))) * 1000;
}

async function fetchDocument(clientId: string, proxyUrl: string): Promise<{ client: CimdClient; lifetime: number }> {
  const url = metadataUrl(clientId);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const signal = AbortSignal.timeout(10_000);
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const addresses = await metadataAddresses(host, resolver, signal, proxyUrl);
    const pinned = addresses[0]!;
    return await new Promise((resolve, reject) => {
      // Keep the original Host/SNI and certificate verification, pin the public
      // address and use only the explicitly configured proxy. Never redirects.
      const req = pinnedHttpsRequest(url, pinned.address, signal,
        { accept: "application/json", "accept-encoding": "identity" }, res => {
        const contentType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (res.statusCode !== 200) {
          const temporary = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429 || (res.statusCode ?? 0) >= 500;
          reject(new CimdDiscoveryError(temporary ? 503 : 400, temporary ? "temporarily_unavailable" : "invalid_client_metadata",
            `CIMD metadata HTTPS endpoint returned HTTP ${res.statusCode ?? "unknown"}; redirects are not followed`));
          res.destroy(); return;
        }
        if (!/^application\/(?:json|[a-z0-9.+-]+\+json)$/.test(contentType)
          || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")
          || Number(res.headers["content-length"]) > MAX_BYTES) {
          reject(new Error("CIMD metadata response rejected")); res.destroy(); return;
        }
        let size = 0; const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) { reject(new Error("CIMD metadata exceeds 5 KB")); res.destroy(); }
          else chunks.push(chunk);
        });
        res.on("error", () => reject(new CimdDiscoveryError(503, "temporarily_unavailable", "CIMD metadata HTTPS response was interrupted")));
        res.on("aborted", () => reject(new CimdDiscoveryError(503, "temporarily_unavailable", "CIMD metadata HTTPS response was interrupted")));
        res.on("end", () => {
          try { resolve({ client: parseCimdClient(clientId, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))), lifetime: cacheLifetime(res.headers) }); }
          catch (error) { reject(error); }
        });
      }, proxyUrl);
      req.on("error", reject); req.end();
    });
  } catch (error) {
    if (error instanceof CimdDiscoveryError) throw error;
    if (error instanceof PublicAddressError) throw new CimdDiscoveryError(error.forbidden ? 400 : 503,
      error.forbidden ? "invalid_client_metadata" : "temporarily_unavailable", error.message);
    if (signal.aborted || (error && typeof error === "object" && "code" in error)) {
      throw new CimdDiscoveryError(503, "temporarily_unavailable", proxyUrl
        ? "CIMD metadata outbound proxy connection failed or timed out; check the HTTP proxy address, proxy routing and TLS certificates"
        : "CIMD metadata HTTPS connection failed or timed out; check network connectivity and TLS certificates");
    }
    throw error;
  } finally { signal.removeEventListener("abort", cancel); }
}

/** Bounded in-memory client discovery cache. No disk registry or stale fallback. */
export class CimdClientResolver {
  readonly #proxyUrl: string;
  constructor(proxyUrl = "") { this.#proxyUrl = parseOutboundProxy(proxyUrl); }
  readonly #cache = new Map<string, { client: CimdClient; expires: number }>();
  readonly #pending = new Map<string, Promise<CimdClient>>();
  #window = 0;
  #requests = 0;
  async resolve(clientId: string): Promise<CimdClient> {
    metadataUrl(clientId);
    const now = Date.now();
    const cached = this.#cache.get(clientId);
    if (cached && cached.expires > now) return cached.client;
    this.#cache.delete(clientId);
    const pending = this.#pending.get(clientId);
    if (pending) return pending;
    if (now - this.#window >= 60_000) { this.#window = now; this.#requests = 0; }
    if (this.#pending.size >= MAX_CONCURRENT || this.#requests >= 60) throw new Error("CIMD discovery limit reached; retry later");
    this.#requests++;
    const promise = fetchDocument(clientId, this.#proxyUrl).then(({ client, lifetime }) => {
      if (lifetime > 0) {
        for (const [id, record] of this.#cache) if (record.expires <= Date.now()) this.#cache.delete(id);
        if (this.#cache.size >= MAX_CACHE) this.#cache.delete(this.#cache.keys().next().value!);
        this.#cache.set(clientId, { client, expires: Date.now() + lifetime });
      }
      return client;
    }).finally(() => { this.#pending.delete(clientId); });
    this.#pending.set(clientId, promise);
    return promise;
  }
}

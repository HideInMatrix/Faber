import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { Agent, request, type RequestOptions } from "node:https";
import { connect as tlsConnect, checkServerIdentity, type TLSSocket } from "node:tls";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";

/** Explicit, trusted HTTP proxy configuration. Never read global proxy variables. */
export function parseOutboundProxy(value: unknown): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid outbound HTTP proxy URL");
  const text = value.trim();
  if (!text) return "";
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("Use an HTTP proxy URL such as http://127.0.0.1:7890"); }
  if (url.protocol !== "http:" || !url.hostname || url.username || url.password || url.pathname !== "/"
    || url.search || url.hash || /[\s\\]/.test(text) || text.includes("@")) {
    throw new Error("Outbound proxy must be an HTTP URL without credentials, path, query or fragment");
  }
  return url.origin;
}

/** One request owns one agent/CONNECT/TLS lifetime. Destination DNS is already validated. */
class ConnectAgent extends Agent {
  constructor(readonly proxy: URL, readonly destination: string, readonly hostname: string, readonly signal: AbortSignal) {
    super({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0 });
  }
  override createConnection(_options: RequestOptions, callback?: (error: Error | null, stream: Duplex) => void): undefined {
    let settled = false;
    let pending: ClientRequest | undefined;
    let transport: Duplex | undefined;
    const abort = () => finish(this.signal.reason instanceof Error ? this.signal.reason : new Error("Outbound proxy request cancelled"));
    const timer = setTimeout(() => finish(Object.assign(new Error("Outbound proxy connection timed out"), { code: "ETIMEDOUT" })), 10_000);
    const finish = (error?: Error, socket?: TLSSocket) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.signal.removeEventListener("abort", abort);
      if (error) { pending?.destroy(); transport?.destroy(); }
      callback?.(error ?? null, socket!);
    };
    if (this.signal.aborted) { abort(); return; }
    this.signal.addEventListener("abort", abort, { once: true });
    const authority = `${isIP(this.destination) === 6 ? `[${this.destination}]` : this.destination}:443`;
    pending = httpRequest({ hostname: this.proxy.hostname.replace(/^\[|\]$/g, ""), port: this.proxy.port || 80,
      method: "CONNECT", path: authority, headers: { host: authority }, agent: false, maxHeaderSize: 8192 });
    pending.once("error", error => finish(error));
    pending.once("connect", (response, socket, head) => {
      transport = socket;
      if (settled) { socket.destroy(); return; }
      if (response.statusCode !== 200 || head.length) {
        finish(Object.assign(new Error(`Outbound proxy CONNECT rejected (HTTP ${response.statusCode ?? "unknown"})`), { code: "EPROXY" })); return;
      }
      const secure = tlsConnect({ socket, servername: isIP(this.hostname) ? "" : this.hostname,
        rejectUnauthorized: true, ALPNProtocols: ["http/1.1"],
        checkServerIdentity: (_server, certificate) => checkServerIdentity(this.hostname, certificate) });
      transport = secure;
      secure.once("error", error => finish(error));
      secure.once("secureConnect", () => finish(undefined, secure));
    });
    pending.end();
  }
}

/** Caller must enforce URL policy, public destination, response size and deadline. */
export function pinnedHttpsRequest(url: URL, address: string, signal: AbortSignal,
  headers: Readonly<Record<string, string>>, onResponse: (response: IncomingMessage) => void, proxyUrl = ""): ClientRequest {
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || !isIP(address)) throw new Error("Pinned HTTPS destination is invalid");
  const proxy = parseOutboundProxy(proxyUrl);
  const agent = proxy ? new ConnectAgent(new URL(proxy), address, url.hostname.replace(/^\[|\]$/g, ""), signal) : undefined;
  const req = request(url, { method: "GET", agent: agent ?? false, signal, maxHeaderSize: 8192, headers,
    lookup: (_host, options, callback) => {
      const family = isIP(address);
      if (options.all) callback(null, [{ address, family }]); else callback(null, address, family);
    },
  }, response => {
    response.once("close", () => agent?.destroy());
    onResponse(response);
  });
  req.once("error", () => agent?.destroy());
  return req;
}

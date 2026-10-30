import { assertExecutable, ManagedProcess } from "./process.js";
import {
  providerResult,
  type CloudflareProviderOptions,
  type CloudflareTunnelProtocol,
  type NetworkProvider,
  type NetworkProviderContext,
  type NetworkProviderResult,
} from "./types.js";

const QUICK_TUNNEL_URL = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export function parseCloudflareProtocol(value: string | undefined): CloudflareTunnelProtocol {
  const protocol = value || "auto";
  if (protocol !== "auto" && protocol !== "http2" && protocol !== "quic") {
    throw new Error(`Unsupported Cloudflare Tunnel protocol: ${protocol}; use auto, http2 or quic`);
  }
  return protocol;
}

export class CloudflareNetworkProvider implements NetworkProvider {
  readonly key = "cloudflare";
  readonly #options: CloudflareProviderOptions;
  readonly #protocol: CloudflareTunnelProtocol;
  #process: ManagedProcess | undefined;

  constructor(options: CloudflareProviderOptions) {
    if (Boolean(options.publicUrl) !== Boolean(options.tunnelToken)) {
      throw new Error("Cloudflare 配置不完整：固定公网域名和 Tunnel Token 必须同时填写；使用快速隧道时请同时留空。");
    }
    this.#options = options;
    this.#protocol = parseCloudflareProtocol(options.protocol);
  }

  async preflight(): Promise<void> {
    await assertExecutable(this.#options.executable);
  }

  async start(context: NetworkProviderContext): Promise<NetworkProviderResult> {
    context.signal?.throwIfAborted();
    this.#process = new ManagedProcess(context.logger);
    if (this.#options.publicUrl && this.#options.tunnelToken) {
      this.#process.start(
        this.#options.executable,
        ["--no-autoupdate", "tunnel", "--protocol", this.#protocol, "run", "--token", this.#options.tunnelToken],
        "cloudflared",
      );
      await this.#waitForConnection(context.signal);
      this.#process.monitorUnexpectedExit(context.onUnexpectedExit);
      return providerResult(this.key, this.#options.publicUrl, "Cloudflare Named Tunnel");
    }

    this.#process.start(
      this.#options.executable,
      ["--no-autoupdate", "tunnel", "--protocol", this.#protocol, "--url", context.localBaseUrl],
      "cloudflared",
    );
    const line = await this.#waitForOutput(
      (candidate) => QUICK_TUNNEL_URL.test(candidate),
      "Cloudflare Quick Tunnel URL",
      context.signal,
    );
    const publicUrl = line.match(QUICK_TUNNEL_URL)?.[0];
    if (!publicUrl) throw new Error("cloudflared output did not contain a tunnel URL");
    await this.#waitForConnection(context.signal);
    this.#process.monitorUnexpectedExit(context.onUnexpectedExit);
    return providerResult(this.key, publicUrl, "Cloudflare Quick Tunnel");
  }

  async #waitForConnection(signal?: AbortSignal): Promise<void> {
    await this.#waitForOutput(line => line.toLowerCase().includes("registered tunnel connection"), "Cloudflare tunnel connection", signal);
  }

  async #waitForOutput(predicate: (line: string) => boolean, description: string, signal?: AbortSignal): Promise<string> {
    const managed = this.#process!;
    try {
      return await managed.waitFor(predicate, 60_000, description, signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      // Report only a fixed diagnostic, never raw log lines/tokens. Keep the
      // actual timeout/exit as cause. A URL is not evidence of connection.
      throw cloudflareConnectionError(managed.recentOutput(), error, this.#protocol, description === "Cloudflare Quick Tunnel URL" ? "address" : "edge");
    }
  }

  async stop(force = false): Promise<void> {
    await this.#process?.stop(force);
    this.#process = undefined;
  }
}

/** Known upstream diagnostics, not raw stderr or token-bearing command args. */
export function cloudflareConnectionError(lines: readonly string[], cause: unknown, protocol: CloudflareTunnelProtocol = "auto", phase: "address" | "edge" = "edge"): Error {
  const output = lines.join("\n");
  const summary = (transport: "TCP" | "UDP") => {
    const relevant = lines.filter(line => line.includes(`${transport} Connectivity`));
    return { pass: relevant.some(line => /status=pass\b|\bPASS\b/.test(line)), fail: relevant.some(line => /status=fail\b|\bFAIL\b/.test(line)) };
  };
  const tcp = summary("TCP"), udp = summary("UDP");
  const mode = protocol === "http2" ? "HTTP/2，TCP 7844" : protocol === "quic" ? "QUIC，UDP 7844" : "自动，QUIC / HTTP/2，UDP / TCP 7844";
  const prefix = phase === "address" ? "Cloudflare 快速隧道地址获取失败" : `Cloudflare 隧道建连失败（${mode}）`;
  const finish = (detail: string) => new Error(`${prefix}：${detail}\n尚未进入公网服务探活。请到“运行日志”查看 cloudflared 的错误记录。`, { cause });
  if (phase === "edge" && /invalid tunnel (?:token|secret)|tunnel token is not valid|unauthorized|authentication failed|failed to (?:decode|unmarshal).*token/i.test(output)) {
    return finish("cloudflared 报告凭据认证失败。请重新核对 Cloudflare 控制台提供的 Tunnel Token，并确认公网域名绑定到同一条隧道。");
  }
  const fakeIp = /(?:ip=|on |address[^\n]*)(?:198\.(?:18|19)\.)/.test(output);
  if (fakeIp) return finish("检测到 Cloudflare 边缘地址为 198.18.0.0/15 Fake-IP。请在代理软件中检查 region1.v2.argotunnel.com、region2.v2.argotunnel.com 的真实 DNS 解析与分流规则，再重试。");
  if (/x509:|certificate verify failed|certificate signed by unknown authority|certificate has expired/i.test(output)) {
    return finish("TLS 证书验证失败。请检查系统时间、证书信任以及代理或安全软件的 HTTPS 检查设置。");
  }
  if (/(?:lookup .*:|DNS (?:lookup|resolution)).*(?:no such host|timeout|failed|refused)/i.test(output)) {
    return finish("Cloudflare 域名 DNS 解析失败。请检查系统 DNS 和代理软件的 DNS 规则，结合运行日志确认失败的是 API 域名还是隧道节点域名。");
  }
  if (phase === "address") return finish("未能从 Cloudflare API 获取临时公网地址。请检查本机到 Cloudflare API 的 HTTPS 网络路径及代理/TUN 分流规则，必要时稍后重试。");
  let detail = /TLS handshake.*EOF/i.test(output) ? "到 Cloudflare 边缘节点的 TLS 握手被提前关闭。" : "cloudflared 未能完成连接注册，可能已退出或等待连接超时。";
  if (tcp.fail && !tcp.pass && (protocol === "http2" || protocol === "auto")) detail += "\n预检查报告 TCP 7844 不可达。";
  if (udp.fail && !udp.pass && (protocol === "quic" || protocol === "auto")) detail += "\n预检查报告 UDP 7844 不可达。";
  if (protocol !== "quic" && udp.pass) detail += "\nQUIC 至少一组预检查通过，可将隧道传输协议改为自动或 QUIC 后重试；预检查通过不保证隧道一定能建立。";
  else if (protocol !== "http2" && tcp.pass) detail += "\nHTTP/2 至少一组预检查通过，可将隧道传输协议改为 HTTP/2 后重试。";
  detail += "\n请检查网络防火墙，以及代理软件对 cloudflared、region1.v2.argotunnel.com 和 region2.v2.argotunnel.com 的分流规则。开启 TUN 时，连接路径由其路由规则决定；仅设置系统 HTTP 代理不保证 cloudflared 会使用该代理。";
  return finish(detail);
}

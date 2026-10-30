import { setTimeout as delay } from "node:timers/promises";

export class PublicRouteError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "PublicRouteError"; }
}

/** Cancellation must settle our waiter even if DNS/fetch/body I/O does not
 * acknowledge abort after a suspend/resume. The losing operation retains a
 * rejection handler, so a late failure cannot become an unhandled rejection. */
async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }), cancelled]);
  } finally { signal.removeEventListener("abort", onAbort); }
}

/** An owned service nonce, not just HTTP 200 or a printed URL. No credentials
 * are sent. Redirects and unbounded bodies are refused. */
export async function probePublicService(base: string, instanceId: string, signal?: AbortSignal): Promise<void> {
  try {
    const abort = AbortSignal.timeout(10000);
    const bounded = signal ? AbortSignal.any([signal, abort]) : abort;
    await abortable(async () => {
      const response = await fetch(`${base}/healthz`, { redirect: "error", headers: { "ngrok-skip-browser-warning": "1" }, signal: bounded });
      // Cancel unread bodies without awaiting cancellation-insensitive I/O.
      const cancelBody = () => { void response.body?.cancel().catch(() => {}); };
      if (bounded.aborted) { cancelBody(); bounded.throwIfAborted(); }
      if (!response.ok) { cancelBody(); throw new PublicRouteError("http_error", `Public health returned HTTP ${response.status}`); }
      if (!response.headers.get("content-type")?.includes("application/json")) { cancelBody(); throw new PublicRouteError("unexpected_content_type", "Public route did not return service health JSON"); }
      let size = 0; const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (reader) {
        const cancelReader = () => { void reader.cancel().catch(() => {}); };
        bounded.addEventListener("abort", cancelReader, { once: true });
        try {
          while (true) {
            bounded.throwIfAborted();
            const { done, value } = await reader.read();
            bounded.throwIfAborted();
            if (done) break;
            size += value.length;
            if (size > 16384) throw new PublicRouteError("response_too_large", "Public health response exceeded limit");
            chunks.push(value);
          }
        } finally {
          bounded.removeEventListener("abort", cancelReader);
          cancelReader();
          reader.releaseLock();
        }
      }
      let health: unknown;
      try { health = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new PublicRouteError("invalid_json", "Public health returned invalid JSON"); }
      if (!health || typeof health !== "object" || Reflect.get(health, "ok") !== true || Reflect.get(health, "instance_id") !== instanceId) throw new PublicRouteError("instance_mismatch", "Public route reaches a different service instance");
    }, bounded);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof PublicRouteError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new PublicRouteError("timeout", "Public health check timed out after 10 seconds");
    const cause = error instanceof Error ? error.cause as { code?: unknown } | undefined : undefined;
    const code = typeof cause?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(cause.code) ? ` (${cause.code})` : "";
    throw new PublicRouteError("network_error", `Public health connection failed${code}`);
  }
}
export async function waitForPublicService(base: string, instanceId: string, signal: AbortSignal, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let lastError: unknown;
  do {
    try { await probePublicService(base, instanceId, bounded); return; }
    catch (error) {
      if (signal.aborted) throw signal.reason;
      // A final deadline must not hide an earlier instance/HTTP/JSON error.
      if (error instanceof PublicRouteError || lastError === undefined) lastError = error;
      if (bounded.aborted) break;
    }
    try { await delay(500, undefined, { signal: bounded }); }
    catch { if (signal.aborted) throw signal.reason; break; }
  } while (Date.now() < deadline);
  const code = lastError instanceof PublicRouteError ? lastError.code : "timeout";
  const details: Readonly<Record<string, string>> = {
    instance_mismatch: "公网域名指向其他服务实例。请检查隧道转发目标、公网域名绑定，以及是否仍有旧 Faber 实例运行。",
    http_error: "公网地址返回了异常 HTTP 状态。请检查隧道的源站地址与端口是否指向当前本地 MCP 服务，并查看隧道日志。",
    unexpected_content_type: "公网地址返回的不是服务健康检查 JSON，可能是错误页、登录页或其他网站。请检查域名绑定、访问策略和转发目标。",
    invalid_json: "公网地址返回了无效的健康检查数据。请检查域名、反向代理及隧道转发目标。",
    response_too_large: "公网地址返回的内容超过健康检查限制。请检查是否转发到了错误页面或其他服务。",
    network_error: "本机无法连接公网健康检查地址。请检查该域名的 DNS、网络防火墙和代理/TUN 分流规则。",
    timeout: "在启动等待期限内未能完成公网健康检查。请检查域名解析、隧道转发目标和本机到公网域名的网络路径。",
  };
  const observed = lastError instanceof PublicRouteError ? `\n检测结果：${lastError.message}` : "";
  throw new Error(`隧道已连接，但公网服务验证失败：${details[code] ?? details.network_error}${observed}\n请到“运行日志”查看公网验证记录。`, { cause: lastError });
}
/** Serial probes, no overlap while running. Stop cancels the monitor without
 * waiting indefinitely for cancellation-insensitive network I/O to finish. */
export interface NetworkHealthMonitorOptions {
  readonly keepRunningOnFailure?: boolean;
  readonly onProbeResult?: (result: { ok: boolean; failures: number; error?: Error }) => void;
}
export class NetworkHealthMonitor {
  #controller = new AbortController();
  #work: Promise<void> | undefined;
  constructor(readonly probe: (signal: AbortSignal) => Promise<void>, readonly failed: (error: Error) => void, readonly intervalMs = 30000, readonly options: NetworkHealthMonitorOptions = {}) {}
  start(): void {
    if (this.#work) throw new Error("Health monitor already started");
    this.#work = this.#run();
  }
  async #run(): Promise<void> {
    let failures = 0;
    try {
      while (!this.#controller.signal.aborted) {
        await delay(this.intervalMs, undefined, { signal: this.#controller.signal, ref: false });
        try {
          await abortable(() => this.probe(this.#controller.signal), this.#controller.signal);
          if (this.#controller.signal.aborted) return;
          failures = 0; this.options.onProbeResult?.({ ok: true, failures });
        } catch (error) {
          if (this.#controller.signal.aborted) return;
          failures++;
          const failure = error instanceof Error ? error : new Error("Public health check failed");
          this.options.onProbeResult?.({ ok: false, failures, error: failure });
          if (failures === 3) {
            this.failed(new Error(`Public MCP route failed three consecutive health checks: ${failure.message}`));
            if (!this.options.keepRunningOnFailure) return;
          }
        }
      }
    } catch { /* owned cancellation */ }
  }
  async stop(): Promise<void> { this.#controller.abort(); await this.#work; }
}

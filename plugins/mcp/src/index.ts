import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { ExternalMcpError, type McpConnectionConfig } from "@micromatrix/plugin-kit";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { CallToolResultSchema, ToolListChangedNotificationSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { OwnedStdioTransport } from "./stdio.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export { McpAuthStore } from "./auth.js";

function resolveHeader(value: string, values: Readonly<Record<string, string>> = {}): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = (Object.hasOwn(values, name) ? values[name] : undefined) ?? (Object.hasOwn(process.env, name) ? process.env[name] : undefined);
    if (!resolved) throw new Error(`Missing service environment variable: ${name}`);
    if (/[\r\n]/.test(resolved)) throw new Error(`Invalid header environment variable: ${name}`);
    return resolved;
  });
}

export function mcpHeaders(config: McpConnectionConfig, values: Readonly<Record<string, string>> = {}): Record<string, string> {
  const headers = Object.fromEntries(Object.entries(config.headers).map(([name, value]) => [name, resolveHeader(value, values)]));
  if (config.auth === "bearer" || config.auth === "api_key") {
    const reference = config.credentialRef ?? "MCP_TOKEN";
    const value = resolveHeader("${" + reference + "}", values);
    const header = config.auth === "bearer" ? "Authorization" : config.apiKeyHeader ?? "X-API-Key";
    if (Object.keys(headers).some(name => name.toLowerCase() === header.toLowerCase())) throw new Error("Authentication Header is duplicated");
    headers[header] = config.auth === "bearer" ? `Bearer ${value}` : value;
  }
  return headers;
}

export function mcpConnectionError(error: unknown, stage: string, config: McpConnectionConfig): Error {
  // Do not expose arbitrary response bodies, URLs or echoed credentials in diagnostics.
  const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
  const message = error instanceof Error ? error.message : String(error);
  let detail = "检查服务地址、网络及可执行程序。";
  if (/requires OAuth login/.test(message)) return new Error(`MCP ${config.id} · OAuth 未授权，请先点击授权登录。`,{cause:error});
  if (/^MCP (server returned duplicate tool names|server exceeds|discovery exceeded|server repeated)/.test(message)) return new Error(`MCP ${config.id} · ${stage}失败：${message}`,{cause:error});
  if (/401|403|unauthorized|forbidden/i.test(`${code} ${message}`)) detail = config.auth === "oauth"
    ? "OAuth 授权未被接受，请检查授权状态、客户端配置和服务端返回的限制。"
    : "服务未接受当前认证。请检查自己的密钥；若服务要求 OAuth，请改用浏览器授权。";
  else if (/404|405|406|415|content.type|text\/event-stream|protocol/i.test(message)) detail = "检查 MCP 路径和传输选项：Streamable HTTP 与旧版 SSE 不可混用。";
  else if (/timeout|timed out|abort/i.test(message)) detail = "连接或工具发现超时，请检查服务网络和运行状态。";
  else if (/Missing service environment|credential|Header/i.test(message)) detail = "认证配置缺失或格式错误，请填写密钥、环境变量或正确的 Header。";
  // Only application-owned diagnostics are retained; the original error stays local as cause.
  return new Error(`MCP ${config.id} · ${stage}失败：${detail}`, { cause: error });
}

/** Owned by one Pi extension session; never created while merely saving config. */
export class McpConnection {
  readonly client = new Client({ name: "micromatrix-pi-extension", version: "0.1.0" });
  readonly config: McpConnectionConfig;
  readonly options: McpOptions;
  #tools: readonly Tool[] = [];
  #refresh: Promise<readonly Tool[]> | undefined;
  #closing = false;
  #refreshAgain = false;
  #transport: OwnedStdioTransport | StreamableHTTPClientTransport | SSEClientTransport | undefined;
  #connected = false;
  get connected(): boolean { return this.#connected && !this.#closing; }
  constructor(config: McpConnectionConfig, options: McpOptions = {}) {
    this.config = config; this.options = options;
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      if (this.#refresh) { this.#refreshAgain = true; return; }
      try { await this.refresh(); } catch { /* refresh fails closed and reports status */ }
    });
  }

  async connect(workspace: string): Promise<readonly Tool[]> {
    this.options.signal?.throwIfAborted();
    const signal = this.options.signal ? AbortSignal.any([AbortSignal.timeout(30_000), this.options.signal]) : AbortSignal.timeout(30_000);
    const config = this.config;
    this.options.onStatus?.("connecting", "");
    try {
      const env = getDefaultEnvironment();
      for (const [target, source] of Object.entries(config.envRefs)) {
        const value = (this.options.values && Object.hasOwn(this.options.values, source) ? this.options.values[source] : undefined) ?? (Object.hasOwn(process.env, source) ? process.env[source] : undefined);
        if (value === undefined) throw new Error(`Missing service environment variable: ${source}`);
        Object.defineProperty(env, target, { value, enumerable: true, configurable: true, writable: true });
      }
      const requestInit = { headers: mcpHeaders(config, this.options.values) };
      const transportOptions = { ...optionsAuth(this.options), requestInit };
      const transport = config.transport === "stdio"
        ? new OwnedStdioTransport(config.command, config.args, env, workspace)
        : config.transport === "sse" ? new SSEClientTransport(new URL(config.url), transportOptions)
        : new StreamableHTTPClientTransport(new URL(config.url), {
          ...optionsAuth(this.options),
          ...(this.options.signal && this.options.fetch ? { fetch: (input, init) => this.options.fetch!(input, {
            ...init, signal: init?.signal ? AbortSignal.any([init.signal, this.options.signal!]) : this.options.signal!,
          }) } : {}),
          requestInit,
        });
      this.#transport = transport;
      this.client.onclose = () => {
        this.#connected = false;
        if (!this.#closing) {
          const reason = this.#transport instanceof OwnedStdioTransport ? this.#transport.closeReason : "";
          this.options.onStatus?.("disconnected", reason || "MCP 连接已关闭。"); this.options.onTools?.([]);
        }
      };
      // SDK 1.30 has a sessionId optional-property declaration mismatch under
      // exactOptionalPropertyTypes; both concrete classes implement Transport.
      await this.client.connect(transport as Transport, { timeout: 15_000, signal });
      this.#connected = true;
      this.options.onStatus?.("connected", "");
      return await this.refresh();
    } catch (error) {
      const stage = this.#connected ? "工具发现" : "连接";
      const reason = this.#transport instanceof OwnedStdioTransport ? this.#transport.closeReason : "";
      await this.close();
      const failure = reason ? new Error(`MCP ${config.id} · ${reason}`, {cause:error}) : mcpConnectionError(signal.aborted ? signal.reason : error, stage, config);
      this.options.onStatus?.("error",failure.message); throw failure;
    }
  }

  refresh(): Promise<readonly Tool[]> {
    if (!this.#connected || this.#closing) return Promise.reject(new Error("MCP connection is not active"));
    if (this.#refresh) return this.#refresh;
    const work = this.#discover().catch(error => {
      if (!this.#closing) {
        this.#tools = []; this.options.onTools?.([]);
        this.options.onStatus?.("error", "MCP tool discovery failed; old tools revoked. Refresh or reconnect");
      }
      throw error;
    }); this.#refresh = work;
    void work.finally(() => {
      if (this.#refresh === work) this.#refresh = undefined;
      if (this.#refreshAgain && !this.#closing) { this.#refreshAgain = false; void this.refresh().catch(() => this.options.onStatus?.("error", "MCP tool discovery failed")); }
    }).catch(() => {});
    return work;
  }
  async #discover(): Promise<readonly Tool[]> {
    const deadline = Date.now() + 30_000, signal = AbortSignal.timeout(30_000);
    const tools: Tool[] = [], cursors = new Set<string>(); let cursor: string | undefined;
    do {
      if (Date.now() >= deadline || cursors.size >= 32) throw new Error("MCP discovery exceeded its time or pagination limit");
      const result = await this.client.listTools(cursor ? { cursor } : {}, { timeout: Math.min(15_000, deadline - Date.now()), signal });
      tools.push(...result.tools);
      if (tools.length > 500) throw new Error("MCP server exceeds the 500-tool limit");
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("MCP server repeated its pagination cursor");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (this.#closing || !this.#connected) throw new Error("MCP closed during discovery");
    if (new Set(tools.map(tool => tool.name)).size !== tools.length) throw new Error("MCP server returned duplicate tool names");
    if (JSON.stringify(tools) !== JSON.stringify(this.#tools)) { this.#tools = tools; this.options.onTools?.(tools); }
    this.options.onStatus?.("connected", "");
    return tools;
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    if (!this.#connected) throw new Error(`MCP ${this.config.id} disconnected; stop and start Runtime to reconnect`);
    if (!this.#tools.some(tool => tool.name === name)) throw new Error("MCP tool removed or discovery failed; refresh the tool list");
    const result = CallToolResultSchema.parse(await this.client.callTool({ name, arguments: args }, CallToolResultSchema,
      { timeout: 60_000, ...(signal ? { signal } : {}) }));
    // Diagnostics must never mask the exact upstream error/image result.
    try { this.options.onResult?.(name, result); } catch { /* non-authoritative observer */ }
    return result;
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#connected = false;
    await this.client.close().catch(() => undefined);
    await this.#transport?.close().catch(() => undefined);
    this.#transport = undefined;
  }
}

export interface McpOptions {
  signal?: AbortSignal;
  values?: Readonly<Record<string, string>>;
  authProvider?: OAuthClientProvider;
  fetch?: typeof fetch;
  onTools?: (tools: readonly Tool[]) => void;
  onStatus?: (status: string, message: string) => void;
  onResult?: (name: string, result: CallToolResult) => void;
}
function optionsAuth(options: McpOptions) {
  return { ...(options.authProvider ? { authProvider: options.authProvider } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) };
}
export interface McpExtensionController { refresh(): Promise<readonly Tool[]>; close(): Promise<void> }

/** One Runtime-owned session. Reconnects discovery only, never replays tool calls. */
export class McpSession implements McpExtensionController {
  #connection: McpConnection | undefined;
  #opening: Promise<readonly Tool[]> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #abort = new AbortController();
  #closed = false;
  #started = false;
  #attempt = 0;
  #connectedAt = 0;
  constructor(readonly config: McpConnectionConfig, readonly options: McpOptions, readonly workspace: string) {}
  start(): Promise<readonly Tool[]> { return this.#open(); }
  #open(): Promise<readonly Tool[]> {
    if (this.#closed) return Promise.reject(new Error("MCP session closed"));
    if (this.#opening) return this.#opening;
    const work = (async () => {
      const previous = this.#connection; this.#connection = undefined;
      await previous?.close(); this.#abort.signal.throwIfAborted();
      let established=false;
      const candidate = new McpConnection(this.config, { ...this.options,
        signal: this.options.signal ? AbortSignal.any([this.options.signal,this.#abort.signal]) : this.#abort.signal,
        onTools: tools => { if (!this.#closed && this.#connection === candidate) this.options.onTools?.(tools); },
        onStatus: (status,message) => {
          if (this.#closed || this.#connection !== candidate) return;
          this.options.onStatus?.(status,message);
          if (status === "disconnected" && established && this.#started) {
            if (Date.now()-this.#connectedAt >= 60_000) this.#attempt=0;
            this.#schedule(message);
          }
        },
      });
      this.#connection=candidate;
      try {
        const tools=await candidate.connect(this.workspace);
        if (this.#closed || !candidate.connected) throw new Error("MCP disconnected during initialization");
        this.#connectedAt=Date.now(); this.#started=true; established=true;
        return tools;
      } catch (error) { await candidate.close(); throw error; }
    })();
    this.#opening=work;
    void work.finally(() => { if (this.#opening === work) this.#opening=undefined; }).catch(() => {});
    return work;
  }
  #schedule(reason: string): void {
    if (this.#closed || this.#timer || this.options.signal?.aborted || this.config.id === "computer_use") return;
    if (this.#attempt >= 5) { this.options.onStatus?.("disconnected",`${reason} 已停止自动重连；点击“重新连接”重试。`); return; }
    const attempt=++this.#attempt, delay=1000 * 2 ** (attempt-1);
    this.options.onStatus?.("reconnecting",`${reason} ${delay/1000} 秒后重新连接（${attempt}/5）。`);
    this.#timer=setTimeout(() => {
      this.#timer=undefined;
      void this.#open().catch(error => {
        if (!this.#closed) this.#schedule(error instanceof Error ? error.message : "MCP 重连失败。");
      });
    },delay);
    this.#timer.unref();
  }
  async refresh(): Promise<readonly Tool[]> {
    if (this.#closed) throw new Error("MCP session closed");
    clearTimeout(this.#timer); this.#timer=undefined; this.#attempt=0;
    return this.#connection?.connected ? this.#connection.refresh() : this.#open();
  }
  call(name: string, args: Record<string,unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    if (this.#closed || !this.#connection?.connected) return Promise.reject(new Error(`MCP ${this.config.id} 已断开，正在恢复连接；请等待连接恢复后重新发起操作。`));
    return this.#connection.call(name,args,signal);
  }
  async close(): Promise<void> {
    this.#closed=true; clearTimeout(this.#timer); this.#timer=undefined; this.#abort.abort();
    await this.#connection?.close();
    await this.#opening?.catch(() => {});
  }
}
export function createMcpExtension(config: McpConnectionConfig, options: McpOptions = {},
  onCatalog?: (names: readonly string[]) => void, attach?: (controller: McpExtensionController) => void): ExtensionFactory {
  return (pi) => {
    let connection: McpSession | undefined;
    const register = (tools: readonly Tool[]) => {
      for (const tool of tools) {
        pi.registerTool({
          name: tool.name, label: `${config.name}: ${tool.title ?? tool.name}`,
          description: `[External MCP: ${config.name}] ${tool.description ?? tool.name}`,
          parameters: tool.inputSchema as AgentTool["parameters"],
          async execute(_id, params, signal) {
            const result = await connection!.call(tool.name, params as Record<string, unknown>, signal);
            // Pi expects failures to throw. MCP adapter retains the exact upstream result.
            if (result.isError) throw new ExternalMcpError(result);
            return {
              content: result.content.flatMap((part) => part.type === "text" || part.type === "image" ? [part] : [{ type: "text" as const, text: JSON.stringify(part) }]),
              details: { externalMcpResult: result },
            };
          },
        });
      }
      onCatalog?.(tools.map(tool => tool.name));
    };
    pi.on("session_start", async (_event, ctx) => {
      connection = new McpSession(config, { ...options, onTools: tools => { register(tools); options.onTools?.(tools); } },ctx.cwd);
      attach?.(connection);
      try { await connection.start(); }
      catch (error) { options.onStatus?.("error", error instanceof Error ? error.message : "MCP connection failed"); throw error; }
    });
    pi.on("session_shutdown", async () => { await connection?.close(); connection = undefined; });
  };
}

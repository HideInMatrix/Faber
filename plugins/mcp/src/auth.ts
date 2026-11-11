import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, type Server } from "node:http";
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientInformationSchema, OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { parseMcpConnection, type McpConnectionConfig } from "@micromatrix/plugin-kit";

interface Credentials { values: Record<string, string>; oauth?: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirect: string; identity?: string; discovery?: OAuthDiscoveryState } }
interface Login { abort: AbortController; previous?: Credentials["oauth"]; key: string; identity: string; server: Server; timer: ReturnType<typeof setTimeout>; state: string; status: "pending" | "authorized" | "failed" | "cancelled"; message: string }
function key(config: McpConnectionConfig): string {
  return createHash("sha256").update(JSON.stringify([config.id, config.transport, config.url, config.command, config.args])).digest("hex");
}
function identityKey(config: McpConnectionConfig): string {
  return JSON.stringify([config.auth, config.clientMetadataUrl, config.oauthRedirectUri, config.oauthClientId,
    config.oauthClientSecretRef, config.oauthScopes, config.oauthTokenAuthMethod ?? "auto"]);
}
function matchesIdentity(config: McpConnectionConfig, oauth: Credentials["oauth"]): boolean {
  if (config.auth !== "oauth" || !oauth) return false;
  if (oauth.identity) return oauth.identity === identityKey(config);
  // Preserve existing issuer-bound CIMD sessions from the former configuration.
  return Boolean(config.clientMetadataUrl) && oauth.client?.client_id === config.clientMetadataUrl && oauth.redirect === config.oauthRedirectUri;
}
function oauthConfiguration(config: McpConnectionConfig): { redirect: URL } {
  const parsed = parseMcpConnection(config);
  if (parsed.transport === "stdio" || parsed.auth !== "oauth") throw new Error("OAuth requires a remote MCP connection");
  if (parsed.clientMetadataUrl && !parsed.oauthClientId && !parsed.oauthRedirectUri) throw new Error("CIMD requires the exact callback registered in your client metadata document");
  return { redirect: new URL(parsed.oauthRedirectUri ?? "http://127.0.0.1:0/oauth/callback") };
}
function discoveryIssuer(discovery: OAuthDiscoveryState): string {
  const issuer = String(discovery.authorizationServerUrl ?? "");
  if (!boundIssuer(issuer)) throw new Error("OAuth discovery did not return a valid issuer");
  const metadata = discovery.authorizationServerMetadata;
  if (metadata?.issuer && !sameIssuer(metadata.issuer, issuer)) throw new Error("OAuth discovery issuer does not match its metadata");
  for (const endpoint of [metadata?.authorization_endpoint, metadata?.token_endpoint, metadata?.registration_endpoint]) if (endpoint) safeUrl(endpoint);
  if (!metadata?.code_challenge_methods_supported?.includes("S256")) throw new Error("Authorization server must support S256 PKCE");
  return issuer;
}
function oauthFailure(error: unknown, stage: string, secrets: readonly string[]): Error {
  let detail = error instanceof Error ? error.message : "OAuth request failed";
  for (const secret of secrets.filter(Boolean).sort((a,b) => b.length-a.length)) detail = detail.split(secret).join("[redacted]");
  detail = detail.replace(/((?:access_token|refresh_token|client_secret|code_verifier|authorization_code)[\s"'=:]+)[^\s,;"}]+/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"<>]+/g, raw => { try { const u=new URL(raw); return u.origin+u.pathname; } catch { return "[URL]"; } }).slice(0, 500);
  return new Error(`OAuth ${stage}失败：${detail}`, { cause: error });
}
function safeUrl(value: string | URL): URL {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new Error("OAuth requires HTTPS or loopback HTTP");
  return url;
}
function boundIssuer(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try { const url=safeUrl(value); return !url.search && !url.hash; } catch { return false; }
}
function sameIssuer(a: string, b: string): boolean {
  // Match the SDK's parsed-URL/trailing-slash comparison, not just the host.
  const x=safeUrl(a).href, y=safeUrl(b).href;
  return x===y || x.replace(/\/$/,"")===y.replace(/\/$/,"");
}
/** Local-only credential store. Never included in snapshots or the public MCP. */
export class McpAuthStore {
  #records: Record<string, Credentials> = {};
  #logins = new Map<string, Login>();
  #preparing = new Map<string, AbortController>();
  #disposed = false;
  constructor(readonly path: string, private remember: boolean) {
    if (remember) {
      let migratedOAuth = false;
      try {
        if (statSync(path).size > 2_000_000) throw new Error("Credential file too large");
        const value: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 32) throw new Error("Invalid credential store");
        for (const [id, item] of Object.entries(value)) {
          if (!/^[a-f0-9]{64}$/.test(id) || !item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid credential record");
          const record = item as Credentials;
          if (!record.values || typeof record.values !== "object" || Array.isArray(record.values) || Object.keys(record.values).length > 100) throw new Error("Invalid credential values");
          for (const [name, secret] of Object.entries(record.values)) if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || typeof secret !== "string" || !secret || secret.length > 16384 || secret.includes("\0")) throw new Error("Invalid credential value");
          if (record.oauth) {
            safeUrl(record.oauth.redirect);
            const tokens = record.oauth.tokens ? OAuthTokensSchema.parse(record.oauth.tokens) : undefined;
            if (record.oauth.client) {
              const client = OAuthClientInformationSchema.parse(record.oauth.client);
              // Do not bind legacy credentials to whatever issuer a remote MCP
              // advertises on first use. Re-login once; keep header secrets.
              if ((!record.oauth.identity && (!/^https:\/\//i.test(client.client_id) || client.client_secret)) || !boundIssuer(client.issuer)
                || (tokens && (!boundIssuer(tokens.issuer) || !sameIssuer(client.issuer,tokens.issuer)))) { delete record.oauth; migratedOAuth = true; }
              else { record.oauth.client = {...record.oauth.client, ...client}; if (tokens) record.oauth.tokens = {...record.oauth.tokens, ...tokens}; }
            }
            else { delete record.oauth; migratedOAuth = true; }
            // Re-discover on startup, rather than trusting persisted endpoint metadata.
            if (record.oauth) delete record.oauth.discovery;
          }
          this.#records[id] = record;
        }
        if (migratedOAuth) this.#persist();
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot load local MCP credentials"); }
    } else rmSync(path, { force: true });
  }
  #record(config: McpConnectionConfig): Credentials {
    const id = key(config);
    if (!this.#records[id] && Object.keys(this.#records).length >= 32) throw new Error("Too many MCP credential records");
    return this.#records[id] ??= { values: {} };
  }
  values(config: McpConnectionConfig): Readonly<Record<string, string>> { return this.#records[key(config)]?.values ?? {}; }
  summary(config: McpConnectionConfig) {
    const record = this.#records[key(config)]; const login = this.#logins.get(config.id);
    const matching = login?.key === key(config) && login.identity === identityKey(config);
    return { keys: Object.keys(record?.values ?? {}), oauth: matching ? login.status : matchesIdentity(config, record?.oauth) && record?.oauth?.tokens ? "authorized" : "logged_out",
      message: matching ? login.message : "" };
  }
  update(config: McpConnectionConfig, updates: unknown): void {
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new Error("Credentials must be an object");
    const entries = Object.entries(updates);
    if (entries.length > 100) throw new Error("Too many credential variables");
    const record = this.#record(config); const values = Object.fromEntries(Object.entries(record.values));
    for (const [name, value] of entries) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || (value !== null && (typeof value !== "string" || !value || value.length > 16384 || value.includes("\0")))) throw new Error("Invalid credential variable or value");
      if (value === null) delete values[name]; else Object.defineProperty(values, name, { value, enumerable: true, configurable: true, writable: true });
    }
    this.#replace(config, { ...record, values });
  }
  setRemember(value: boolean): void { const previous = this.remember; this.remember = value; try { this.#persist(); } catch (error) { this.remember = previous; throw error; } }
  #persist(): void {
    const document = JSON.stringify(this.#records);
    if (Buffer.byteLength(document) > 2_000_000) throw new Error("MCP credential store exceeds 2 MB");
    if (!this.remember) { rmSync(this.path, { force: true }); return; }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try { writeFileSync(temporary, document, { mode: 0o600 }); renameSync(temporary, this.path); }
    finally { rmSync(temporary, { force: true }); }
  }
  #replace(config: McpConnectionConfig, record: Credentials): void {
    const id = key(config), previous = this.#records[id];
    if (!previous && Object.keys(this.#records).length >= 32) throw new Error("Too many MCP credential records");
    this.#records[id] = record;
    try { this.#persist(); } catch (error) { if (previous) this.#records[id] = previous; else delete this.#records[id]; throw error; }
  }
  prune(configs: readonly McpConnectionConfig[]): void {
    for (const [id, login] of this.#logins) if (!configs.some(config => key(config) === login.key && config.id === id && identityKey(config) === login.identity)) {
      this.cancel(id); this.#logins.delete(id);
    }
    const keep = new Set(configs.map(key)); const previous = this.#records;
    this.#records = Object.fromEntries(Object.entries(previous).filter(([id]) => keep.has(id)));
    for (const config of configs) {
      const id = key(config), record = this.#records[id];
      if (record?.oauth && !matchesIdentity(config, record.oauth)) this.#records[id] = { values: record.values };
    }
    try { this.#persist(); } catch (error) { this.#records = previous; throw error; }
  }
  provider(config: McpConnectionConfig, interactive?: { redirect: string; state: string; redirectTo: (url: URL) => void }, values?: Readonly<Record<string,string>>): OAuthClientProvider {
    oauthConfiguration(config);
    let verifier = "";
    const record = () => this.#records[key(config)] ?? { values: {} };
    const get = () => matchesIdentity(config, record().oauth) ? record().oauth : undefined;
    const assertActive = () => {
      if (this.#disposed || (interactive && (this.#logins.get(config.id)?.state !== interactive.state || this.#logins.get(config.id)?.status !== "pending"))) throw new Error("OAuth attempt cancelled");
    };
    const update = (part: Partial<NonNullable<Credentials["oauth"]>>) => {
      assertActive();
      this.#replace(config, { ...record(), oauth: { redirect: interactive?.redirect ?? get()?.redirect ?? config.oauthRedirectUri ?? "",
        ...get(), identity: identityKey(config), ...part } });
    };
    const clientSecret = () => config.oauthClientSecretRef ? (values ?? record().values)[config.oauthClientSecretRef] ?? process.env[config.oauthClientSecretRef] : undefined;
    const method = (metadata?: OAuthDiscoveryState["authorizationServerMetadata"], hasSecret = Boolean(clientSecret() || (!config.oauthClientId && get()?.client?.client_secret))) => {
      const supported = metadata?.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
      const explicit = config.oauthTokenAuthMethod ?? "auto";
      if (explicit !== "auto") {
        if (!supported.includes(explicit)) throw new Error(`Server does not support ${explicit}`);
        if (explicit !== "none" && !hasSecret && (config.oauthClientId || get()?.client || (config.clientMetadataUrl && metadata?.client_id_metadata_document_supported))) throw new Error("OAuth Client Secret is required");
        return explicit;
      }
      const hint=get()?.client && Reflect.get(get()!.client!,"token_endpoint_auth_method");
      if (typeof hint === "string" && ["none","client_secret_basic","client_secret_post"].includes(hint) && supported.includes(hint) && (hint === "none" || hasSecret)) return hint as "none"|"client_secret_basic"|"client_secret_post";
      if (hasSecret && supported.includes("client_secret_basic")) return "client_secret_basic";
      if (hasSecret && supported.includes("client_secret_post")) return "client_secret_post";
      if (supported.includes("none")) return "none";
      // DCR may issue a per-installation secret, so request its advertised method.
      if (!config.oauthClientId && !(config.clientMetadataUrl && metadata?.client_id_metadata_document_supported)) {
        if (supported.includes("client_secret_basic")) return "client_secret_basic";
        if (supported.includes("client_secret_post")) return "client_secret_post";
        throw new Error("Server requires an unsupported OAuth client authentication method");
      }
      throw new Error("Authorization server requires a Client Secret; configure a registered client or use permitted dynamic registration");
    };
    const provider: OAuthClientProvider = {
      get redirectUrl() { return interactive?.redirect ?? get()?.redirect ?? config.oauthRedirectUri; },
      ...(config.clientMetadataUrl ? { clientMetadataUrl: config.clientMetadataUrl } : {}),
      get clientMetadata() { return { client_name: "Faber", redirect_uris: [String(this.redirectUrl)], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        ...(config.oauthScopes ? {scope: config.oauthScopes} : {}), token_endpoint_auth_method: method(get()?.discovery?.authorizationServerMetadata) }; },
      state: () => interactive?.state ?? "",
      clientInformation: () => {
        if (!interactive && (!get()?.tokens || !get()?.client)) throw new Error(`MCP ${config.id} requires OAuth login; use the Login button`);
        const discovery = get()?.discovery;
        if (config.oauthClientId && discovery) {
          const issuer = discoveryIssuer(discovery), secret = clientSecret();
          const client = { client_id: config.oauthClientId, issuer, token_endpoint_auth_method: method(discovery.authorizationServerMetadata), ...(secret ? {client_secret: secret} : {}) };
          update({client}); return client;
        }
        return get()?.client;
      },
      saveClientInformation: client => {
        if (!boundIssuer(client.issuer)) throw new Error("OAuth client must retain issuer binding");
        const previous = get()?.client?.issuer;
        if (previous && !sameIssuer(previous,client.issuer)) throw new Error("Authorization server changed; logout and authorize again");
        if (config.oauthClientId && client.client_id !== config.oauthClientId) throw new Error("OAuth registered Client ID changed");
        if (get()?.discovery?.authorizationServerMetadata?.client_id_metadata_document_supported && config.clientMetadataUrl && !config.oauthClientId
          && (client.client_id !== config.clientMetadataUrl || client.client_secret)) throw new Error("CIMD client identity mismatch");
        update({client: {...client}});
      },
      tokens: () => get()?.tokens,
      saveTokens: tokens => {
        const issuer = get()?.client?.issuer;
        if (!boundIssuer(tokens.issuer) || !boundIssuer(issuer) || !sameIssuer(issuer,tokens.issuer)) throw new Error("OAuth tokens must retain matching issuer binding");
        update({tokens: {...tokens}});
      },
      redirectToAuthorization: url => {
        safeUrl(url);
        if (!interactive) throw new Error(`MCP ${config.id} requires OAuth login; use the Login button`);
        interactive.redirectTo(url);
      },
      saveCodeVerifier: value => { assertActive(); verifier = value; },
      codeVerifier: () => { if (!verifier) throw new Error("OAuth PKCE verifier missing"); return verifier; },
      saveDiscoveryState: discovery => {
        const issuer = discoveryIssuer(discovery), previous = get()?.client?.issuer ?? get()?.tokens?.issuer;
        if (previous && !sameIssuer(previous,issuer)) throw new Error("Authorization server changed; logout and authorize again");
        if (!config.oauthClientId && !(config.clientMetadataUrl && discovery.authorizationServerMetadata?.client_id_metadata_document_supported)
          && !discovery.authorizationServerMetadata?.registration_endpoint) throw new Error("Server has no usable CIMD or dynamic registration; enter a registered Client ID");
        update({discovery});
      },
      discoveryState: () => get()?.discovery,
      addClientAuthentication: (headers, params, _url, metadata) => {
        const client = get()?.client;
        if (!client) throw new Error("OAuth client information missing");
        const secret = config.oauthClientId ? clientSecret() : client.client_secret;
        const selected = method(metadata,Boolean(secret));
        if (selected === "none") { params.set("client_id", client.client_id); return; }
        if (!secret) throw new Error("OAuth Client Secret is required");
        if (selected === "client_secret_basic") {
          const encode = (value: string) => new URLSearchParams({v:value}).toString().slice(2);
          headers.set("Authorization", `Basic ${Buffer.from(`${encode(client.client_id)}:${encode(secret)}`).toString("base64")}`);
        } else { params.set("client_id",client.client_id); params.set("client_secret",secret); }
      },
      invalidateCredentials: scope => {
        assertActive();
        const oauth = {...get(), redirect: get()?.redirect ?? "", identity: identityKey(config)};
        if (scope === "all" || scope === "client") delete oauth.client;
        if (scope === "all" || scope === "tokens") delete oauth.tokens;
        if (scope === "all" || scope === "discovery") delete oauth.discovery;
        if (scope === "all" || scope === "verifier") verifier = "";
        this.#replace(config, {...record(),oauth});
      },
    };
    return provider;
  }
  #secrets(config: McpConnectionConfig): string[] {
    const record=this.#records[key(config)];
    return [...Object.values(record?.values ?? {}), record?.oauth?.client?.client_secret ?? "", record?.oauth?.tokens?.access_token ?? "", record?.oauth?.tokens?.refresh_token ?? ""];
  }
  readValues(config: McpConnectionConfig): Record<string,string> { return {...this.values(config)}; }
  adoptSession(config: McpConnectionConfig, source: McpAuthStore): void {
    const oauth=source.#records[key(config)]?.oauth;
    if (matchesIdentity(config,oauth) && oauth?.tokens) this.#replace(config,{...this.#record(config),oauth:structuredClone(oauth)});
  }
  temporaryValues(config: McpConnectionConfig, updates: unknown): Record<string,string> {
    if (!updates || typeof updates !== "object" || Array.isArray(updates) || Object.keys(updates).length > 100) throw new Error("Invalid credential updates");
    const values = {...this.values(config)};
    for (const [name,value] of Object.entries(updates)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || (value !== null && (typeof value !== "string" || !value || value.length > 16384 || value.includes("\0")))) throw new Error("Invalid credential variable or value");
      if (value === null) delete values[name]; else Object.defineProperty(values,name,{value,enumerable:true,configurable:true,writable:true});
    }
    return values;
  }
  async withUpdates<T>(config: McpConnectionConfig, updates: unknown, action: () => Promise<T>): Promise<T> {
    const previous=structuredClone(this.#records);
    try { this.update(config,updates); return await action(); }
    catch (error) { this.#records=previous; try { this.#persist(); } catch { throw new Error("Save failed and credential rollback could not be persisted; retry saving",{cause:error}); } throw error; }
  }
  readonly fetchOAuth: typeof fetch = async (input, init) => {
    safeUrl(input instanceof Request ? input.url : input);
    const timeout = AbortSignal.timeout(15_000);
    return fetch(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  readonly fetchMcp: typeof fetch = async (input, init) => {
    safeUrl(input instanceof Request ? input.url : input);
    if (init?.method === "GET") {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
      try { return await fetch(input, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal }); }
      finally { clearTimeout(timer); } // GET is a long-lived notification stream, not a 15s body.
    }
    const timeout = AbortSignal.timeout(60_000);
    return fetch(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  cancelPending(): void {
    for (const id of this.#preparing.keys()) this.cancel(id);
    for (const [id, login] of this.#logins) if (login.status === "pending") this.cancel(id);
  }
  async begin(config: McpConnectionConfig): Promise<{ url: string }> {
    const identity = oauthConfiguration(config);
    this.cancel(config.id);
    const state = randomBytes(32).toString("base64url");
    const abort = new AbortController();
    this.#preparing.set(config.id,abort);
    const fetchLogin: typeof fetch = (input,init) => this.fetchOAuth(input,{...init,signal:init?.signal ? AbortSignal.any([init.signal,abort.signal]) : abort.signal});
    let provider: OAuthClientProvider;
    let exchanging = false;
    let expectedIssuer: string | undefined;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      if (request.method !== "GET" || url.pathname !== identity.redirect.pathname || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state || exchanging) { response.writeHead(400).end("Invalid OAuth callback"); return; }
      const login = this.#logins.get(config.id)!;
      if (url.searchParams.has("error") || url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code")
        || (expectedIssuer && (url.searchParams.getAll("iss").length !== 1 || url.searchParams.get("iss") !== expectedIssuer))) {
        this.cancel(config.id, false); login.status = "failed"; login.message = "OAuth 回调失败：服务拒绝授权、缺少授权码或发行者不匹配。";
        response.writeHead(400).end(login.message); clearTimeout(login.timer); server.close(); return;
      }
      exchanging = true;
      void auth(provider, { serverUrl: config.url, authorizationCode: url.searchParams.get("code")!, fetchFn: fetchLogin }).then(result => {
        if (result !== "AUTHORIZED") throw new Error("OAuth exchange incomplete");
        login.status = "authorized"; login.message = ""; delete login.previous; response.end("授权完成，可以关闭此页面并返回 Faber。");
      }).catch(error => { const message=oauthFailure(error,"Token 交换",[...this.#secrets(config),url.searchParams.get("code") ?? ""]).message; const pending=login.status === "pending"; this.cancel(config.id, false); if (pending) { login.status = "failed"; login.message = message; } response.writeHead(400).end(message); })
        .finally(() => { clearTimeout(login.timer); server.close(); });
    });
    server.requestTimeout = 15_000; server.headersTimeout = 15_000; server.maxConnections = 8;
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(Number(identity.redirect.port), "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    } catch (error) { if (this.#preparing.get(config.id) === abort) this.#preparing.delete(config.id); server.close(); throw new Error("OAuth 回调监听失败：请检查本机回调端口是否已被占用。",{cause:error}); }
    if (abort.signal.aborted || this.#disposed) { server.closeAllConnections(); server.close(); throw new Error("OAuth 授权已取消。"); }
    this.#preparing.delete(config.id);
    const address = server.address(); if (!address || typeof address === "string") throw new Error("OAuth callback listener unavailable");
    const callback = new URL(identity.redirect); callback.port = String(address.port);
    const redirect = callback.href;
    const previous = matchesIdentity(config, this.#record(config).oauth) ? this.#record(config).oauth : undefined;
    const login: Login = { abort, ...(previous ? { previous } : {}), key: key(config), identity: identityKey(config), state, server, status: "pending", message: "", timer: setTimeout(() => this.cancel(config.id), 180_000) };
    login.timer.unref(); this.#logins.set(config.id, login);
    // Reauthorize the same URL identity. Keep old successful credentials until
    // login succeeds, so closing a browser doesn't log out.
    let authorizationUrl = "";
    try {
      this.#replace(config, { ...this.#record(config), oauth: { redirect, identity: identityKey(config), ...(previous?.client ? {client: previous.client} : {}) } });
      provider = this.provider(config, { redirect, state, redirectTo: url => { authorizationUrl = url.href; } });
      const result = await auth(provider, { serverUrl: config.url, fetchFn: fetchLogin });
      if (result !== "REDIRECT" || !authorizationUrl) throw new Error("OAuth login did not return an authorization URL");
      const discovery = await provider.discoveryState?.();
      if (discovery?.authorizationServerMetadata && Reflect.get(discovery.authorizationServerMetadata, "authorization_response_iss_parameter_supported") === true) {
        const issuer = discovery.authorizationServerMetadata.issuer;
        if (typeof issuer !== "string" || !issuer) throw new Error("OAuth discovery lacks issuer");
        expectedIssuer = issuer;
      }
      return { url: authorizationUrl };
    } catch (error) {
      const failure=oauthFailure(error,"发现/注册",this.#secrets(config));
      const pending=login.status === "pending";
      this.cancel(config.id);
      if (pending) { login.status="failed"; login.message=failure.message; }
      throw failure;
    }
  }
  cancel(id: string, disconnect = true): void {
    this.#preparing.get(id)?.abort(); this.#preparing.delete(id);
    const login = this.#logins.get(id); if (!login) return;
    login.abort.abort(new DOMException("OAuth cancelled","AbortError"));
    clearTimeout(login.timer); login.server.close(); if (disconnect) login.server.closeAllConnections();
    if (login.status === "pending") {
      const record = this.#records[login.key];
      if (record) {
        const candidate = { values: record.values, ...(login.previous ? { oauth: login.previous } : {}) };
        this.#records[login.key] = candidate;
        try { this.#persist(); }
        catch { login.status = "failed"; login.message = "OAuth cancelled; could not persist restored credentials"; delete login.previous; return; }
      }
      delete login.previous;
      login.status = "cancelled"; login.message = "Authorization cancelled or timed out";
    }
  }
  logout(config: McpConnectionConfig): void { this.cancel(config.id); this.#logins.delete(config.id); this.#replace(config, { values: this.#record(config).values }); }
  close(): void { this.#disposed = true; for (const id of this.#preparing.keys()) this.cancel(id); for (const id of this.#logins.keys()) this.cancel(id); this.#logins.clear(); }
}

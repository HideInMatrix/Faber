/** Configuration, not an execution engine. Implementations belong to Pi extensions. */
export interface McpConnectionConfig {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly startup?: "on_start" | "on_demand";
  readonly description?: string;
  readonly transport: "stdio" | "http" | "sse";
  readonly auth?: "none" | "bearer" | "api_key" | "oauth";
  readonly credentialRef?: string;
  readonly apiKeyHeader?: string;
  readonly oauthClientId?: string;
  readonly oauthClientSecretRef?: string;
  readonly oauthScopes?: string;
  readonly oauthTokenAuthMethod?: "auto" | "none" | "client_secret_basic" | "client_secret_post";
  /** Optional client-owned HTTPS CIMD document. */
  readonly clientMetadataUrl?: string;
  /** Optional fixed loopback callback; required when using a hosted CIMD document. */
  readonly oauthRedirectUri?: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly url: string;
  /** Target environment variable -> source variable in the service environment. */
  readonly envRefs: Readonly<Record<string, string>>;
  /** Ordinary values or ${ENV_VAR} references; credentials use separate local storage. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface SkillSourceConfig {
  readonly id: string;
  readonly path: string;
  readonly enabled: boolean;
}

export interface ExtensionConfiguration {
  readonly mcp: readonly McpConnectionConfig[];
  readonly skills: readonly SkillSourceConfig[];
}

export const EMPTY_EXTENSIONS: ExtensionConfiguration = Object.freeze({ mcp: [], skills: [] });

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extension configuration must be an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function id(value: unknown, skill = false): string {
  const result = text(value, skill ? "Skill source ID (max 64 characters)" : "extension ID", skill ? 64 : 24);
  // Source IDs are configuration labels, not SKILL.md frontmatter names.
  // Retain underscore compatibility with existing imported sources.
  if (!(skill ? /^[a-z][a-z0-9_-]{0,63}$/ : /^[a-z][a-z0-9_]{0,23}$/).test(result)) throw new Error(skill
    ? "Skill source ID must start with a lowercase letter and use lowercase letters, digits, hyphens or underscores (max 64)"
    : "Extension ID must start with a lowercase letter (max 24); MCP IDs use letters, digits and underscores");
  return result;
}

function enabled(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") throw new Error("enabled must be a boolean");
  return value;
}

export function parseMcpConnection(value: unknown): McpConnectionConfig {
  const input = object(value);
  if (input.transport !== "stdio" && input.transport !== "http" && input.transport !== "sse") throw new Error("MCP transport must be stdio, http or sse");
  const transport = input.transport;
  const startup = input.startup ?? "on_start";
  if (startup !== "on_start" && startup !== "on_demand") throw new Error("Invalid MCP startup mode");
  const description = input.description ? text(input.description,"MCP description",2048) : undefined;
  const auth = input.auth ?? "none";
  if (!["none", "bearer", "api_key", "oauth"].includes(String(auth))) throw new Error("Invalid MCP auth mode");
  if (auth !== "none" && transport === "stdio") throw new Error("stdio credentials must use environment variables");
  const reference = (value: unknown, fallback: string) => {
    const name = value === undefined ? fallback : text(value, "credential reference", 128);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new Error("Invalid credential reference");
    return name;
  };
  const credentialRef = auth === "bearer" || auth === "api_key" ? reference(input.credentialRef, "MCP_TOKEN") : undefined;
  const apiKeyHeader = auth === "api_key" ? text(input.apiKeyHeader ?? "X-API-Key", "API Key Header", 128) : undefined;
  if (apiKeyHeader && (!/^[A-Za-z0-9-]+$/.test(apiKeyHeader) || /^(host|cookie|set-cookie|content-length|connection|accept|content-type)$/i.test(apiKeyHeader))) throw new Error("Invalid API Key Header");
  const oauthClientId = auth === "oauth" && input.oauthClientId ? text(input.oauthClientId, "OAuth Client ID", 2048) : undefined;
  const oauthClientSecretRef = auth === "oauth" && input.oauthClientSecretRef ? reference(input.oauthClientSecretRef, "OAUTH_CLIENT_SECRET") : undefined;
  const oauthScopes = auth === "oauth" && input.oauthScopes ? text(input.oauthScopes, "OAuth scopes", 2048) : undefined;
  const oauthTokenAuthMethod = auth === "oauth" ? input.oauthTokenAuthMethod ?? "auto" : undefined;
  if (oauthTokenAuthMethod && !["auto", "none", "client_secret_basic", "client_secret_post"].includes(String(oauthTokenAuthMethod))) throw new Error("Invalid OAuth token authentication method");
  // Older configs remain editable. CIMD requires an exact callback at login;
  // pre-registered clients and DCR can use an automatically allocated port.
  const clientMetadataUrl = auth === "oauth" && input.clientMetadataUrl ? text(input.clientMetadataUrl, "CIMD document URL", 2048) : "";
  const oauthRedirectUri = auth === "oauth" && input.oauthRedirectUri ? text(input.oauthRedirectUri, "OAuth callback URL", 2048) : "";
  if (clientMetadataUrl) {
    const parsed = new URL(clientMetadataUrl);
    if (!/^https:\/\//i.test(clientMetadataUrl) || /[\s\\?#]/.test(clientMetadataUrl) || /^https:\/\/[^/?#]*@/i.test(clientMetadataUrl)
      || /\/(?:\.|%2e){1,2}(?:\/|$)/i.test(/^https:\/\/[^/?#]+(\/[^?#]*)/i.exec(clientMetadataUrl)?.[1] ?? "")
      || parsed.protocol !== "https:" || parsed.pathname === "/" || parsed.username || parsed.password || parsed.port) throw new Error("CIMD document must be a public HTTPS URL with a non-root path and no query, fragment or credentials");
  }
  if (oauthRedirectUri) {
    const parsed = new URL(oauthRedirectUri);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port || Number(parsed.port) < 1024
      || /[\s\\?#]/.test(oauthRedirectUri) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname === "/" || parsed.href !== oauthRedirectUri) {
      throw new Error("CIMD callback must be an exact http://127.0.0.1:PORT/path URL with a port >= 1024");
    }
  }
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.length > 100 || !args.every((item) => typeof item === "string" && item.length <= 4096 && !item.includes("\0"))) throw new Error("Invalid MCP arguments");
  const envRefs = Object.fromEntries(Object.entries(object(transport === "stdio" ? input.envRefs ?? {} : {})).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("MCP envRefs must map variable names to variable names, not secret values");
    return [key, value];
  }));
  const headers = Object.fromEntries(Object.entries(object(transport !== "stdio" ? input.headers ?? {} : {})).map(([key, value]) => {
    if (!/^[A-Za-z0-9-]+$/.test(key) || typeof value !== "string" || value.length > 4096 || /[\r\n]/.test(value)
      || /^(host|cookie|set-cookie|content-length|connection)$/i.test(key)) throw new Error("Invalid MCP Header name or value");
    return [key, value];
  }));
  if (Object.keys(envRefs).length > 100 || Object.keys(headers).length > 32) throw new Error("Too many MCP environment references or headers");
  if (new Set(Object.keys(headers).map(name => name.toLowerCase())).size !== Object.keys(headers).length) throw new Error("Duplicate MCP Header names");
  const authHeader = auth === "oauth" || auth === "bearer" ? "authorization" : apiKeyHeader?.toLowerCase();
  if (authHeader && Object.keys(headers).some(key => key.toLowerCase() === authHeader)) throw new Error("Authentication Header must not be duplicated in extra Headers");
  const command = transport === "stdio" ? text(input.command, "MCP executable") : "";
  const url = transport !== "stdio" ? text(input.url, "MCP URL") : "";
  if (url) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error("MCP URL must not contain credentials, query parameters or a fragment");
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) throw new Error("MCP requires HTTPS, except for loopback HTTP");
  }
  return { id: id(input.id), name: text(input.name ?? input.id, "MCP name", 128), enabled: enabled(input.enabled), startup, ...(description ? {description} : {}), transport,
    ...(auth !== "none" ? { auth: auth as NonNullable<McpConnectionConfig["auth"]> } : {}),
    ...(credentialRef ? { credentialRef } : {}), ...(apiKeyHeader ? { apiKeyHeader } : {}),
    ...(auth === "oauth" ? { ...(clientMetadataUrl ? { clientMetadataUrl } : {}), ...(oauthRedirectUri ? { oauthRedirectUri } : {}),
      ...(oauthClientId ? { oauthClientId } : {}), ...(oauthClientSecretRef ? { oauthClientSecretRef } : {}), ...(oauthScopes ? { oauthScopes } : {}),
      oauthTokenAuthMethod: oauthTokenAuthMethod as NonNullable<McpConnectionConfig["oauthTokenAuthMethod"]> } : {}),
    command, args: transport === "stdio" ? [...args] : [], url, envRefs, headers };
}

export function parseExtensions(value: unknown): ExtensionConfiguration {
  if (value === undefined) return { mcp: [], skills: [] };
  const input = object(value);
  const mcp = input.mcp ?? [];
  const skills = input.skills ?? [];
  if (!Array.isArray(mcp) || mcp.length > 32 || !Array.isArray(skills) || skills.length > 100) throw new Error("Too many MCP connections or skill sources");
  const connections = mcp.map(parseMcpConnection);
  const sources = skills.map((value) => {
    const item = object(value);
    return { id: id(item.id, true), path: text(item.path, "Skill path"), enabled: enabled(item.enabled) };
  });
  for (const entries of [connections, sources]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("Duplicate extension configuration ID");
  }
  return { mcp: connections, skills: sources };
}

export { ConsolePluginLogger } from "./logger.js";
export { PluginRegistry } from "./registry.js";
export * from "./resources.js";
export { ExternalMcpError } from "./tool-error.js";
export type {
  BodyPlugin,
  LoadedBodyPlugin,
  LogLevel,
  PluginContext,
  PluginLogger,
} from "./types.js";

export { resolveMcpInvocation } from "./mcp-invocation.js";

export const PROJECT_MEMORY = {
  owner: "project-memory",
  search: "faber_memory_search",
  save: "faber_memory_save",
} as const;

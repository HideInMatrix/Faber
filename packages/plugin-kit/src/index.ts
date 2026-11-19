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
  record: "faber_memory_record",
  save: "faber_memory_save",
} as const;

export const PROJECT_MEMORY_INSTRUCTIONS =
  `Before relying on prior project work, proactively call ${PROJECT_MEMORY.search} with relevant keywords. ` +
  `When the user confirms a reusable project decision, convention, or handoff, proactively call ${PROJECT_MEMORY.record} before your next reply even if the user did not ask you to remember it. ` +
  `If the user corrects an existing note, search for it and use ${PROJECT_MEMORY.save} with its exact title. Save only a short summary, omitting transcripts, credentials, sensitive personal data, and speculation. ` +
  `Confirm a save to the user only after the tool succeeds. Follow current user instructions, including requests to skip project memory.`;

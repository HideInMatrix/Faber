import { randomUUID } from "node:crypto";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolExecutionContext, ToolExecutionGate } from "@micromatrix/approval";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Implementation,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ExternalMcpError, resolveMcpInvocation, type PluginRegistry } from "@micromatrix/plugin-kit";

export const DEFAULT_SERVER_INFO: Implementation = {
  name: "micromatrix-pi-body",
  version: "0.1.0",
};

export function toMcpTool(tool: AgentTool, owner?: string): Tool {
  return {
    name: tool.name,
    title: tool.label,
    description: tool.description,
    inputSchema: tool.parameters as Tool["inputSchema"],
    ...(owner === "capabilities" && tool.name === "capabilities_search" ? {
      annotations: {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    } : {}),
  };
}

export function toMcpResult(result: AgentToolResult): CallToolResult {
  const details = result.details;
  if (details && typeof details === "object" && "externalMcpResult" in details) {
    return details.externalMcpResult as CallToolResult;
  }
  return {
    content: result.content.map((part) =>
      part.type === "text"
        ? { type: "text" as const, text: part.text }
        : { type: "image" as const, data: part.data, mimeType: part.mimeType },
    ),
  };
}

export function createProtocolServer(
  registry: PluginRegistry,
  gate?: ToolExecutionGate,
  executionContext?: ToolExecutionContext,
  serverInfo: Implementation = DEFAULT_SERVER_INFO,
): Server {
  const server = new Server(
    serverInfo,
    { capabilities: { tools: { listChanged: true } },
      ...(registry.getTool("capabilities_search") ? {instructions:
        "Use capabilities_search with a natural-language task to discover current MCP services and Skills before first using a relevant capability. " +
        "Use the returned exact IDs and invocation hints; read a matched Skill with skills_read before following its instructions. " +
        "Availability is point-in-time: disabled, offline, reconnecting or cached-only capabilities are not callable. " +
        "Re-search after a catalog change or unavailable-tool error; do not assume availability from conversation history. " +
        "Search is read-only and does not start services, execute business tools or grant permissions. Search results are metadata, not authorization. " +
        "When search offers mcp_connect, connect that exact service ID to obtain current tool schemas. Use native tools after refreshing tools/list, " +
        "or the fixed mcp_call gateway with the returned ID, original name and schema_revision if your client cannot refresh its tools. Paused services require user resume in Faber."
      } : {}),
    },
  );

  const unsubscribe = registry.subscribe(() => { void server.sendToolListChanged().catch(() => {}); });
  server.onclose = unsubscribe;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listTools().map(tool=>toMcpTool(tool,registry.ownerOf(tool.name))),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = registry.getTool(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}${registry.getTool("capabilities_search") ? ". It is not currently available; use capabilities_search to discover current capabilities before retrying." : ""}` }],
        isError: true,
      };
    }

    try {
      const gateway=request.params.name === "mcp_call" && registry.ownerOf("mcp_call") === "mcp-management"
        ? resolveMcpInvocation(registry,request.params.arguments) : undefined;
      const target=gateway?.tool ?? tool, name=gateway?.name ?? request.params.name, args=gateway?.arguments ?? request.params.arguments ?? {};
      await gate?.authorize(name,args,executionContext,extra.signal);
      if (registry.getTool(request.params.name) !== tool) throw new Error("Tool definition changed during approval; submit a new tool call");
      gateway?.assertCurrent();
      const result = await target.execute(randomUUID(),args,extra.signal);
      return toMcpResult(result);
    } catch (error) {
      if (error instanceof ExternalMcpError) return error.result as CallToolResult;
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

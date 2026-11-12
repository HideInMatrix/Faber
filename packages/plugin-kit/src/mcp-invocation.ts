import {createHash} from "node:crypto";
import type {PluginRegistry} from "./registry.js";

/** Resolve the fixed compatibility gateway to one current, service-owned tool. */
export function resolveMcpInvocation(registry:PluginRegistry,value:unknown){
  if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("mcp_call requires a service ID, tool name and arguments");
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>!["id","tool","arguments","schema_revision"].includes(key)))throw new Error("Unknown mcp_call parameter");
  if(typeof input.id!=="string" || !/^mcp:[a-z][a-z0-9_]{0,23}$/.test(input.id) || typeof input.tool!=="string" || !input.tool || input.tool.length>512)throw new Error("Use the exact service ID and original tool name returned by discovery");
  const name=input.tool,id=input.id.slice(4),args=input.arguments ?? {};
  if(!args || typeof args!=="object" || Array.isArray(args))throw new Error("Tool arguments must be an object");
  const tool=registry.getTool(name);
  if(!tool || registry.ownerOf(name)!==`mcp:${id}`)throw new Error("Tool is not currently available from this service; use capabilities_search and mcp_connect before retrying");
  const revision=createHash("sha256").update(JSON.stringify(tool.parameters)).digest("hex");
  if(input.schema_revision!==revision)throw new Error("Tool definition changed; use mcp_connect to retrieve the current schema before retrying");
  return {name,tool,arguments:args as Record<string,unknown>,serviceId:id,
    assertCurrent(){if(registry.getTool(name)!==tool || registry.ownerOf(name)!==`mcp:${id}`)throw new Error("Tool definition changed during approval; rediscover before retrying");}};
}

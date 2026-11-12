import type {AgentTool} from "@earendil-works/pi-agent-core";
import type {BodyPlugin} from "@micromatrix/plugin-kit";

interface McpManagement {
  connect(id:string):Promise<unknown>;
  disconnect(id:string):Promise<unknown>;
  call(value:unknown,signal?:AbortSignal):ReturnType<AgentTool["execute"]>;
}
function serviceId(value:unknown):string {
  if(!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(key=>key!=="id"))throw new Error("Expected the exact MCP capability ID returned by capabilities_search");
  const id=Reflect.get(value,"id");
  if(typeof id!=="string" || !/^mcp:[a-z][a-z0-9_]{0,23}$/.test(id))throw new Error("Use the exact mcp:service ID returned by capabilities_search");
  return id.slice(4);
}
export function createMcpManagementPlugin(management:McpManagement):BodyPlugin {
  const parameters={type:"object",properties:{id:{type:"string",pattern:"^mcp:[a-z][a-z0-9_]{0,23}$",description:"Exact capability ID from capabilities_search, including mcp:."}},required:["id"],additionalProperties:false} as AgentTool["parameters"];
  const lifecycle=(name:string,description:string,action:(id:string)=>Promise<unknown>):AgentTool=>({name,label:name,description,parameters,
    async execute(_callId,value,signal){signal?.throwIfAborted();const result=await action(serviceId(value));signal?.throwIfAborted();return {content:[{type:"text",text:JSON.stringify(result)}],details:{}};}});
  return {id:"mcp-management",displayName:"MCP lifecycle",createTools:()=>[
    lifecycle("mcp_connect","Connect one enabled MCP service discovered by capabilities_search. Returns current original tool names, full input schemas and schema revisions. Reuses an existing connection; concurrent requests share initialization. Never executes business tools, enables disabled services or resumes a user-paused service. Use a native tool after tools/list refresh, or mcp_call when the client cannot refresh its tools.",id=>management.connect(id)),
    lifecycle("mcp_disconnect","Pause one MCP service when the user requests it. Revokes its tools, cancels reconnects and keeps searchable metadata. Only the user can resume it in Faber. Does not disable its saved configuration.",id=>management.disconnect(id)),
    {name:"mcp_call",label:"Call a connected MCP tool",description:"Compatibility gateway for clients that cannot refresh tools/list. First discover with capabilities_search and connect using mcp_connect. Pass the exact service ID, original tool name, schema_revision and arguments returned there. Executes only a currently connected service-owned tool using its normal argument validation and actual target approval. Does not connect or replay failed calls.",
      parameters:{type:"object",properties:{id:{type:"string",pattern:"^mcp:[a-z][a-z0-9_]{0,23}$"},tool:{type:"string",minLength:1,maxLength:512},arguments:{type:"object",additionalProperties:true},schema_revision:{type:"string",pattern:"^[a-f0-9]{64}$"}},required:["id","tool","arguments","schema_revision"],additionalProperties:false} as AgentTool["parameters"],
      execute:(_id,value,signal)=>management.call(value,signal)},
  ]};
}

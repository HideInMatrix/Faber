import { createHash } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { BodyPlugin } from "@micromatrix/plugin-kit";

export interface CapabilityTool {
  readonly name: string;
  readonly description: string;
  readonly schema_revision: string;
}
export interface CapabilityEntry {
  readonly id: string;
  readonly kind: "mcp" | "skill";
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly available: boolean;
  readonly metadata_source: "live" | "cached" | "configuration" | "loaded";
  readonly source_id: string;
  readonly identity_revision: string;
  readonly tools: readonly CapabilityTool[];
  readonly discovered_at: number;
  readonly startup?: "on_start"|"on_demand";
  readonly can_connect?: boolean;
}
export interface CapabilitySearchResult {
  readonly query: string;
  readonly kind: "all" | "mcp" | "skill";
  readonly revision: string;
  readonly checked_at: string;
  readonly total: number;
  readonly has_more: boolean;
  readonly next_cursor: string | null;
  readonly results: readonly ReturnType<typeof publicEntry>[];
}

const normalize = (text: string) => text.replace(/([a-z])([A-Z])/g,"$1 $2").normalize("NFKC").toLocaleLowerCase("en");
const segmenter = new Intl.Segmenter("zh", {granularity:"word"});
const STOP = new Set(["a","an","the","i","me","my","to","for","of","with","and","or","can","could","please","want","need","tool","tools","mcp","skill","skills",
  "请","请问","帮","帮我","我","我们","想","想要","需要","一下","一个","一些","有什么","哪些","什么","有没有","可以","能够","能","的","地","得","了","在","中","里面","里","并","和","与","及","用","使用","工具","能力","服务","本地","提供","进行","相关","支持","通过","把"]);
const ACTIONS = new Set(["read","get","fetch","find","search","list","show","查看","查询","读取","获取","找","搜索","看看","列出","write","create","edit","update","export","download","analyze","analyse","生成","创建","编写","修改","编辑","更新","导出","下载","分析","读","写"]);
// Local vocabulary expansion, not embeddings or an external model call.
const ALIASES: readonly (readonly string[])[] = [
  ["figma","framelink"], ["lanhu","蓝湖"], ["github","git","仓库","代码库"],
  ["design","设计","设计稿","设计图"], ["layout","布局","排版","版式"],
  ["image","images","图片","图像","切图","配图","图"], ["screenshot","截图","截屏"],
  ["browser","浏览器","网页","网站"], ["page","pages","页面"], ["computer","desktop","电脑","桌面"],
  ["document","documents","doc","文档"], ["pdf","文档转pdf"],
  ["spreadsheet","excel","表格","电子表格","表"], ["slides","presentation","ppt","幻灯片","演示文稿"],
  ["database","数据库"], ["crm","客户管理"], ["admissions","enrollment","招生"],
  ["student","students","学生"], ["customer","customers","客户"],
  ["write","create","生成","创建","编写"], ["edit","update","修改","编辑","更新"],
  ["export","导出"], ["download","下载"], ["read","get","fetch","读取","获取","查看","读"],
];
function terms(query: string): string[] {
  const normalized=normalize(query).replace(/[_\-./:]+/g," ");
  const words=[...segmenter.segment(normalized)].filter(part=>part.isWordLike).map(part=>part.segment).filter(word=>!STOP.has(word));
  // ICU may split compounds such as 读取/页面 into single characters.
  const phrases=ALIASES.flat().filter(word=>word.length>1 && /\p{Script=Han}/u.test(word) && normalized.includes(word));
  const useful=[...phrases,...words].filter(word=>!/^\p{Script=Han}$/u.test(word) || ["图","表","读","写"].includes(word));
  return [...new Set(useful.length ? useful : words)].slice(0,32);
}
function contains(text: string, word: string): boolean {
  if (!/^[a-z0-9]+$/.test(word)) return text.includes(word);
  return new RegExp(`(^|[^a-z0-9])${word}(?:s|es)?([^a-z0-9]|$)`).test(text);
}
function alternatives(word: string): readonly string[] {
  const stem=/^[a-z]{5,}s$/.test(word) && !word.endsWith("ss") ? word.slice(0,-1) : word;
  return ALIASES.find(group=>group.includes(word) || group.includes(stem)) ?? [word,stem];
}
function score(words: readonly string[], name: string, description: string): { score: number; matched: string[] } {
  const title=normalize(name).replace(/[_\-./:]+/g," "), body=normalize(description).replace(/[_\-./:]+/g," ");
  const matched: string[]=[]; let weight=0;
  for (const word of words) {
    const directTitle=contains(title,word), directBody=contains(body,word);
    const aliasTitle=!directTitle && alternatives(word).some(alias=>contains(title,alias));
    const aliasBody=!directBody && alternatives(word).some(alias=>contains(body,alias));
    if (directTitle || directBody || aliasTitle || aliasBody) {
      matched.push(word);
      weight+=(directTitle ? 12 : aliasTitle ? 8 : directBody ? 5 : 3) * (ACTIONS.has(word) ? 0.2 : 1);
    }
  }
  return {score:weight,matched};
}
function parseQuery(value: unknown): { query: string; kind: "all" | "mcp" | "skill"; limit: number; cursor: string | undefined } {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("capabilities_search expects an object with a natural-language query");
  const input=value as Record<string,unknown>;
  if (Object.keys(input).some(key=>!["query","kind","limit","cursor"].includes(key))) throw new Error("Unknown capabilities_search parameter");
  const query=input.query ?? "", kind=input.kind ?? "all", limit=input.limit ?? 10;
  if (typeof query!=="string" || query.length>512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(query)) throw new Error("query must be natural-language text of at most 512 characters");
  if (kind!=="all" && kind!=="mcp" && kind!=="skill") throw new Error("kind must be all, mcp or skill");
  if (typeof limit!=="number" || !Number.isInteger(limit) || limit<1 || limit>25) throw new Error("limit must be an integer from 1 to 25");
  if (input.cursor!==undefined && (typeof input.cursor!=="string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(input.cursor))) throw new Error("Invalid search cursor; repeat capabilities_search without a cursor");
  return {query:query.trim(),kind,limit,cursor:input.cursor as string | undefined};
}
function publicEntry(entry: CapabilityEntry, words: readonly string[], matched: readonly string[]) {
  const summaries=entry.tools.map(tool=>({tool,weight:score(words,tool.name,tool.description).score}))
    .sort((a,b)=>b.weight-a.weight || a.tool.name.localeCompare(b.tool.name,"en")).slice(0,5)
    .map(({tool})=>({id:`${entry.id}/tool:${encodeURIComponent(tool.name)}`,name:tool.name,description:tool.description,schema_revision:tool.schema_revision,
      ...(entry.available ? {invocation:{tool_name:tool.name},gateway:{tool_name:"mcp_call",arguments:{id:entry.id,tool:tool.name,schema_revision:tool.schema_revision},requires_arguments:true}} : {})}));
  const nextStep=entry.available ? entry.kind==="skill" ? "read_skill" : summaries.length ? "call_registered_tool" : "no_tools"
    : entry.can_connect ? "connect_mcp" : entry.status==="paused" ? "resume_in_faber" : entry.status==="disabled" ? "enable_in_faber" : entry.status==="requires_auth" ? "authorize_in_faber" : "check_connection_in_faber";
  return {id:entry.id,kind:entry.kind,name:entry.name,description:entry.description,status:entry.status,available:entry.available,
    metadata_source:entry.metadata_source,source_id:entry.source_id,...(entry.kind==="mcp" ? {startup:entry.startup,can_connect:entry.can_connect ?? false} : {}),discovered_at:entry.discovered_at,matched_terms:matched,
    tool_count:entry.tools.length,tools:summaries,next_step:nextStep,
    ...(entry.available && entry.kind==="mcp" && entry.can_connect ? {definition_source:{tool_name:"mcp_connect",arguments:{id:entry.id},description:"Reuses the live connection and returns current full input schemas for mcp_call."}} : {}),
    ...(!entry.available && entry.can_connect ? {invocation:{tool_name:"mcp_connect",arguments:{id:entry.id}}} : {}),
    ...(entry.kind==="skill" && entry.available ? {invocation:{tool_name:"skills_read",arguments:{id:entry.source_id}}} : {})};
}
export function searchCapabilities(entries: readonly CapabilityEntry[], value: unknown): CapabilitySearchResult {
  const {query,kind,limit,cursor}=parseQuery(value), words=terms(query);
  const anchors=words.filter(word=>!ACTIONS.has(word));
  const ranked=entries.filter(entry=>kind==="all" || entry.kind===kind).map(entry=>{
    const match=score(words,`${entry.name} ${entry.source_id}`,entry.description+" "+entry.tools.map(tool=>`${tool.name} ${tool.description}`).join(" "));
    const meaningful=!anchors.length || match.matched.some(word=>anchors.includes(word));
    return {entry,...match,meaningful};
  }).filter(item=>!words.length || item.score>0 && item.meaningful)
    .sort((a,b)=>b.score-a.score || Number(b.entry.available)-Number(a.entry.available) || a.entry.id.localeCompare(b.entry.id,"en"));
  // Query time never changes the catalog revision; state/definitions do.
  const canonical=[...entries].sort((a,b)=>a.id.localeCompare(b.id,"en"));
  const revision=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  const search=createHash("sha256").update(JSON.stringify([query,kind])).digest("hex");
  let offset=0;
  if (cursor) {
    let state: unknown;
    try { state=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")); } catch { throw new Error("Invalid search cursor; repeat capabilities_search without a cursor"); }
    if (!state || typeof state!=="object" || Array.isArray(state)) throw new Error("Invalid search cursor");
    const fields=state as Record<string,unknown>;
    if (fields.revision!==revision) throw new Error("Capability catalog changed; repeat capabilities_search without a cursor");
    if (fields.search!==search || typeof fields.offset!=="number" || !Number.isSafeInteger(fields.offset) || fields.offset<0 || fields.offset>ranked.length) throw new Error("Search cursor does not match this query");
    offset=fields.offset;
  }
  const end=offset+limit, hasMore=ranked.length>end;
  return {query,kind,revision,checked_at:new Date().toISOString(),total:ranked.length,has_more:hasMore,
    next_cursor:hasMore ? Buffer.from(JSON.stringify({revision,search,offset:end})).toString("base64url") : null,
    results:ranked.slice(offset,end).map(({entry,matched})=>publicEntry(entry,words,matched))};
}
export function createCapabilitiesPlugin(catalog: ()=>readonly CapabilityEntry[]): BodyPlugin {
  return {id:"capabilities",displayName:"Capability discovery",createTools:()=>[{
    name:"capabilities_search",label:"Search MCP and Skills",
    description:"Discover Faber capabilities using a natural-language task, e.g. '读取 Figma 设计稿并导出图片' or 'find a skill for Excel analysis'. Searches configured MCP services and loaded model-invocable Skills together by default. Empty query browses the catalog. Returns exact IDs, descriptions, current availability, catalog revision and precise next steps. Search never starts a service, runs a business tool, or grants permissions. Re-search when a tool becomes unavailable; cached/offline tools are not callable. When a result offers mcp_connect, connect that exact service ID first; user-paused or disabled services must be resumed/enabled in Faber. Read a matched Skill using the returned skills_read arguments before following it.",
    parameters:{type:"object",properties:{query:{type:"string",maxLength:512,description:"Natural-language task or keywords; omit or leave empty to browse. No ID required."},
      kind:{type:"string",enum:["all","mcp","skill"],default:"all",description:"Search both MCP and Skills by default."},limit:{type:"integer",minimum:1,maximum:25,default:10},
      cursor:{type:"string",maxLength:1024,description:"Use next_cursor to continue the same query; start over if the catalog revision changes."}},additionalProperties:false} as AgentTool["parameters"],
    async execute(_id,params,signal){signal?.throwIfAborted();const result=searchCapabilities(catalog(),params);
      return {content:[{type:"text",text:JSON.stringify(result)}],details:{capabilitiesSearch:result}};},
  }]};
}

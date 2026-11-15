import {mkdirSync,readFileSync,statSync,writeFileSync,renameSync,rmSync} from "node:fs";
import {dirname} from "node:path";
import type {CapabilityTool} from "./capabilities.js";

export interface McpCatalogRecord {readonly identity:string;readonly tools:readonly CapabilityTool[];readonly discoveredAt:number}
const LIMIT=2*1024*1024;
function record(value:unknown):McpCatalogRecord{
  if(!value || typeof value!=="object")throw new Error("Invalid catalog record");
  const data=value as Record<string,unknown>;
  if(typeof data.identity!=="string" || !/^[a-f0-9]{64}$/.test(data.identity) || typeof data.discoveredAt!=="number" || !Number.isFinite(data.discoveredAt) || data.discoveredAt<0 || !Array.isArray(data.tools) || data.tools.length>500)throw new Error("Invalid catalog record");
  const tools:CapabilityTool[]=data.tools.map((value:unknown)=>{
    if(!value || typeof value!=="object")throw new Error("Invalid catalog tool");
    const tool=value as Record<string,unknown>;
    if(typeof tool.name!=="string" || !tool.name || tool.name.length>512 || /[\0\r\n]/.test(tool.name) || typeof tool.description!=="string" || tool.description.length>1024 || typeof tool.schema_revision!=="string" || !/^[a-f0-9]{64}$/.test(tool.schema_revision))throw new Error("Invalid catalog tool");
    return {name:tool.name,description:tool.description,schema_revision:tool.schema_revision};
  });
  return {identity:data.identity,discoveredAt:data.discoveredAt,tools};
}
/** Whitelisted metadata only. A cache failure must never break a connection. */
export class McpCatalogStore{
  readonly #records=new Map<string,McpCatalogRecord>();
  constructor(readonly path:string,readonly warning:(message:string)=>void){
    try{
      const info=statSync(path);if(!info.isFile() || info.size>LIMIT)throw new Error("Invalid cache size");
      const document:unknown=JSON.parse(readFileSync(path,"utf8"));
      if(!document || typeof document!=="object" || Reflect.get(document,"version")!==1)throw new Error("Invalid cache version");
      const services:unknown=Reflect.get(document,"services");
      if(!services || typeof services!=="object" || Array.isArray(services) || Object.keys(services).length>33)throw new Error("Invalid cache services");
      for(const [id,value]of Object.entries(services)){
        if(!/^[a-z][a-z0-9_]{0,23}$/.test(id))throw new Error("Invalid cache ID");
        this.#records.set(id,record(value));
      }
    }catch(error){this.#records.clear();if((error as NodeJS.ErrnoException).code!=="ENOENT")warning("MCP 目录缓存不可读或已失效，将在下次连接或测试后重新生成。");}
  }
  get(id:string):McpCatalogRecord|undefined{return this.#records.get(id);}
  set(id:string,value:McpCatalogRecord):void{
    try{this.#records.set(id,record(value));this.#persist(id);}
    catch{this.warning("MCP 目录缓存未能保存；当前连接不受影响，重启后可能需要重新测试服务。");}
  }
  prune(identities:ReadonlyMap<string,string>):void{
    let changed=false;
    for(const [id,value]of this.#records)if(id!=="computer_use" && identities.get(id)!==value.identity){this.#records.delete(id);changed=true;}
    if(changed)try{this.#persist();}catch{this.warning("MCP 目录缓存清理未能保存。");}
  }
  #persist(current?:string):void{
    const serialize=()=>JSON.stringify({version:1,services:Object.fromEntries(this.#records)});
    let document=serialize();
    while(this.#records.size>33 || Buffer.byteLength(document)>LIMIT){
      const oldest=[...this.#records].filter(([id])=>id!==current).sort((a,b)=>a[1].discoveredAt-b[1].discoveredAt)[0];
      if(!oldest)throw new Error("Catalog exceeds limit");
      this.#records.delete(oldest[0]);document=serialize();
    }
    mkdirSync(dirname(this.path),{recursive:true,mode:0o700});const temporary=`${this.path}.${process.pid}.tmp`;
    try{writeFileSync(temporary,document,{mode:0o600});renameSync(temporary,this.path);}finally{rmSync(temporary,{force:true});}
  }
}

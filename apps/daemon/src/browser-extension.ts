import type { BrowserExtensionStatus } from "@micromatrix/control-plane";
import { dirname,join,basename } from 'node:path';
import { homedir } from 'node:os';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { browserExtensionStatus,prepareBrowserExtension,browserExtensionId,startBrowserExtensionNativeHost } from '@hideinmatrix/computer-use';
import { computerUseBrowserDataDirectory } from './computer-use-browser.js';
export type ExtensionBrowser='chrome'|'msedge';
export function extensionBrowser(value:unknown):ExtensionBrowser {if(value!=='chrome'&&value!=='msedge')throw new Error('请选择 Chrome 或 Edge');return value;}
function assetsDirectory(){
 if(!isSea())return join(dirname(createRequire(import.meta.url).resolve('@hideinmatrix/computer-use/package.json')),'assets/browser-extension');
 const directory=dirname(process.execPath);
 return join(basename(directory)==='MacOS'?join(directory,'../Resources'):basename(directory)==='binaries'?join(directory,'../resources'):directory,'automation/faber-browser-extension');
}
function nativeArgs(directory:string){
 if(isSea())return process.platform==='win32'?[]:['--browser-extension-dir',directory];
 const source=fileURLToPath(import.meta.url),entry=source.endsWith('.cjs')?source:join(dirname(source),source.endsWith('.ts')?'main.ts':'main.js');
 return [...(entry.endsWith('.ts')?['--import',createRequire(import.meta.url).resolve('tsx')]:[]),entry,'--browser-extension-dir',directory];
}
export async function getBrowserExtensionStatus(workspace:string,browser:ExtensionBrowser):Promise<BrowserExtensionStatus>{
 const directory=computerUseBrowserDataDirectory(workspace),extensionDirectory=join(directory,'browser-extension');
 return {...await browserExtensionStatus(directory,browser),prepared:existsSync(join(extensionDirectory,'manifest.json')),extensionDirectory,extensionId:browserExtensionId,extensionsPage:browser==='chrome'?'chrome://extensions':'edge://extensions'};
}
export async function prepareHostedBrowserExtension(workspace:string,browser:ExtensionBrowser):Promise<BrowserExtensionStatus>{
 const directory=computerUseBrowserDataDirectory(workspace);
 await prepareBrowserExtension({directory,browser,assetsDirectory:assetsDirectory(),executable:process.execPath,args:nativeArgs(directory)});
 return getBrowserExtensionStatus(workspace,browser);
}
export async function runHostedBrowserExtension(){
 // Native messaging is a separate entry point: no workspace/config/Tunnel load.
 const index=process.argv.indexOf('--browser-extension-dir');
 const directory=index<0?process.platform==='darwin'?join(homedir(),'Library/Application Support/Faber/computer-use'):join(process.env.LOCALAPPDATA||join(homedir(),'AppData/Local'),'Faber/computer-use'):process.argv[index+1];
 if(!directory)throw new Error('Missing native browser bridge directory');
 const origin=process.argv.find(arg=>arg.startsWith('chrome-extension://'))??'';
 const host=await startBrowserExtensionNativeHost({directory,extensionId:browserExtensionId,origin,input:process.stdin,output:process.stdout});
 const stop=()=>{void host.close().finally(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

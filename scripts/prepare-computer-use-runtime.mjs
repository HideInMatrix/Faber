import {existsSync,mkdirSync,rmSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {assertComputerUsePackage,computerUseRdpFile} from './distribution-privacy.mjs'

// Windows resources are installed beside the helper executable, not in an
// unrelated automation directory. Accept only the reviewed package runtime.
export function prepareComputerUseRuntime(packageRoot,directory){
  assertComputerUsePackage(packageRoot)
  rmSync(directory,{recursive:true,force:true});mkdirSync(directory,{recursive:true})
  const source=path.join(packageRoot,computerUseRdpFile),files=[]
  if(existsSync(source)){copyFileSync(source,path.join(directory,'computer-use-rdp.dll'));files.push('computer-use-rdp.dll')}
  const version=JSON.parse(readFileSync(path.join(packageRoot,'package.json'),'utf8')).version
  writeFileSync(path.join(directory,'COMPUTER_USE_RUNTIME.json'),JSON.stringify({component_version:version,files})+'\n')
  return files
}

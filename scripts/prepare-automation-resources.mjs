import { computerUseRequire } from './computer-use-package.mjs'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { filesIn, isDebugFile, isSourceFile, stripSourceMaps, assertDistributionTree } from './distribution-privacy.mjs'

// Playwright includes reviewed static JS/assets, NOT a browser or user profile.
// Lazy-load from installed resources because the Node SEA has no node_modules.
export function prepareAutomationResources(root=process.cwd()) {
  const require=computerUseRequire
  const source=path.dirname(require.resolve('playwright-core/package.json'))
  const manifest=JSON.parse(readFileSync(path.join(source,'package.json'),'utf8'))
  if(manifest.version!=='1.63.0') throw Error('Unexpected Playwright runtime version; review resource binding before packaging')
  const destination=path.join(root,'apps/desktop/resources/automation/playwright-core')
  rmSync(destination,{recursive:true,force:true});mkdirSync(path.dirname(destination),{recursive:true})
  cpSync(source,destination,{recursive:true,dereference:true,filter: file => !isDebugFile(file) && !isSourceFile(file)})
  for (const file of filesIn(destination)) {
    if (!/\.(?:js|mjs|cjs|css)$/.test(file)) continue
    const absolute = path.join(destination, file)
    const text = readFileSync(absolute, 'utf8')
    const clean = stripSourceMaps(text)
    if (clean !== text) writeFileSync(absolute, clean)
  }
  assertDistributionTree(destination)
  return destination
}

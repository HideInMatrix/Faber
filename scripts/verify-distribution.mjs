import { assertDistributionTree } from './distribution-privacy.mjs'
import { computerUsePackageRoot } from './computer-use-package.mjs'
for (const directory of process.argv.slice(2)) assertDistributionTree(directory)
console.log(`PASS compiled-only Computer Use package and ${process.argv.length - 2} distribution trees (${computerUsePackageRoot})`)

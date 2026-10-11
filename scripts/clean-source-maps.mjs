import { cleanGeneratedMaps } from './distribution-privacy.mjs'
console.log(`Removed ${cleanGeneratedMaps(process.cwd())} stale generated source maps`)

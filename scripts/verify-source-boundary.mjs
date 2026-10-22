import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
const root = process.cwd()
assert(!existsSync(`${root}/packages/computer-use`), 'Private source workspace/bridge must not remain')
const daemon = JSON.parse(readFileSync(`${root}/apps/daemon/package.json`))
assert.equal(daemon.dependencies['@hideinmatrix/computer-use'], '0.4.0')
assert(!daemon.dependencies['@ouvren/computer-use'])
const lock = JSON.parse(readFileSync(`${root}/package-lock.json`))
assert(!lock.packages['packages/computer-use'])
assert(!Object.keys(lock.packages).some(name => name.endsWith('node_modules/@ouvren/computer-use')))
const entry = lock.packages['node_modules/@hideinmatrix/computer-use']
assert(entry && !entry.link && entry.version === '0.4.0', 'Lockfile must pin an installed registry package')
assert.equal(new URL(entry.resolved).origin, 'https://npm.pkg.github.com')
assert(!new URL(entry.resolved).username && !new URL(entry.resolved).password, 'Never store registry credentials in lockfile')
assert.match(entry.integrity, /^sha512-/)
assert.equal(readFileSync(`${root}/.npmrc`, 'utf8').trim(), '@hideinmatrix:registry=https://npm.pkg.github.com')
for (const file of ['tsconfig.json', 'apps/daemon/tsconfig.json']) {
  const config = JSON.parse(readFileSync(`${root}/${file}`))
  assert(!config.references.some(ref => ref.path.endsWith('packages/computer-use')))
}
const compiler = JSON.parse(readFileSync(`${root}/tsconfig.base.json`)).compilerOptions
assert.equal(compiler.sourceMap, false)
assert.equal(compiler.declarationMap, false)
console.log('PASS source boundary: no private workspace, registry-only pin, no credentials, no TS maps')

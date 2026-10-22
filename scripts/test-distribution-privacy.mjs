import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertComputerUsePackage, assertDistributionTree, cleanGeneratedMaps, stripSourceMaps, hasSourceMap } from './distribution-privacy.mjs'
function fixture(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'mm-privacy-'))
  const put = (file, text = '') => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text) }
  try { fn(root, put) } finally { rmSync(root, { recursive: true, force: true }) }
}
function packageFixture(root, put) {
  put('package.json', JSON.stringify({ name: '@hideinmatrix/computer-use', version: '0.4.0', repository: {url:'git+https://github.com/HideInMatrix/computer-use.git'}, exports: {'.':{import:'./dist/index.js',types:'./dist/index.d.ts'}, './package.json':'./package.json'} }))
  for (const f of ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'assets/macos/Info.plist', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'third_party/asil/LICENSE', 'third_party/asil/DATA_LICENSE', 'third_party/asil/NOTICE', 'third_party/automation/QUICKJS_LICENSE', 'third_party/automation/PLAYWRIGHT_LICENSE',
    'binaries/aarch64-apple-darwin/development/micromatrix Computer Use Dev.app/Contents/MacOS/micromatrix-computer',
    'binaries/x86_64-apple-darwin/development/micromatrix Computer Use Dev.app/Contents/MacOS/micromatrix-computer',
    'binaries/x86_64-pc-windows-msvc/development/micromatrix-computer-x86_64-pc-windows-msvc.exe']) put(f)
}
test('compiled package permits declarations, licenses and three native helpers', () => fixture((root, put) => {
  packageFixture(root, put); assert.equal(assertComputerUsePackage(root), 15)
}))
for (const file of ['src/runtime.ts', 'native/macos.swift', 'native/windows.cs', 'dist/index.js.map', 'dist/index.d.ts.map', 'debug/helper.pdb', '.npmrc']) {
  test(`compiled package rejects ${file}`, () => fixture((root, put) => {
    packageFixture(root, put); put(file); assert.throws(() => assertComputerUsePackage(root), /refused/)
  }))
}
test('compiled package rejects lifecycle scripts', () => fixture((root, put) => {
  packageFixture(root, put)
  const pkg=JSON.parse(readFileSync(path.join(root,'package.json')));pkg.scripts={postinstall:'false'}
  put('package.json',JSON.stringify(pkg));assert.throws(()=>assertComputerUsePackage(root),/manifest/)
}))
test('compiled package rejects missing architecture', () => fixture((root, put) => {
  packageFixture(root, put);rmSync(path.join(root,'binaries/x86_64-pc-windows-msvc/development/micromatrix-computer-x86_64-pc-windows-msvc.exe'))
  assert.throws(()=>assertComputerUsePackage(root),/missing/)
}))
test('file and inline source maps are refused; cleaning preserves executable JS', () => {
  for (const ref of ['//# sourceMappingURL=x.js.map', '//@ sourceMappingURL=x.js.map', '/*# sourceMappingURL=data:application/json;base64,e30= */']) {
    const code=`console.log('runtime');\n${ref}\n`;assert(hasSourceMap(code));assert(!hasSourceMap(stripSourceMaps(code)));assert.match(stripSourceMaps(code),/console.log/)
  }
})
test('distribution audit catches JS references, TS declarations and native symbols', () => {
  for (const [file, text] of [['runtime.js','//# sourceMappingURL=data:application/json;base64,e30='],['index.d.ts',''],['helper.dSYM/Contents/Resources/DWARF/helper',''],['helper.pdb',''],['.env','']]) {
    fixture((root, put)=>{put(file,text);assert.throws(()=>assertDistributionTree(root),/distribution/)})
  }
})
test('generated cleanup stays out of dependencies and private projects', () => fixture((root, put) => {
  for (const group of ['apps','plugins','packages']) mkdirSync(path.join(root,group))
  put('apps/web/dist/index.js', "export const value=1;\n//# sourceMappingURL=index.js.map")
  put('apps/web/dist/index.js.map','{"sourcesContent":["private"]}')
  put('packages/public/dist/index.d.ts.map','{}')
  put('node_modules/@hideinmatrix/computer-use/dist/index.js.map','do not modify installed packages')
  assert.equal(cleanGeneratedMaps(root),2)
  assert(!existsSync(path.join(root,'apps/web/dist/index.js.map')))
  assert(!hasSourceMap(readFileSync(path.join(root,'apps/web/dist/index.js'),'utf8')))
  assert(existsSync(path.join(root,'node_modules/@hideinmatrix/computer-use/dist/index.js.map')))
}))
test('distribution symlinks are refused instead of copying outside the tree', () => fixture((root, put)=>{
  put('original.js');symlinkSync('original.js',path.join(root,'linked.js'));assert.throws(()=>assertDistributionTree(root),/symlink/)
}))

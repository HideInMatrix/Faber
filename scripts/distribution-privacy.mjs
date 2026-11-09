import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const hasSourceMap = text => /^\s*\/\/[@#]\s*sourceMappingURL\s*=/m.test(text)
  || /\/\*[@#]\s*sourceMappingURL\s*=/.test(text)
export const stripSourceMaps = text => text
  .replace(/^\s*\/\/[@#]\s*sourceMappingURL\s*=.*(?:\r?\n|$)/gm, '')
  .replace(/\/\*[@#]\s*sourceMappingURL\s*=[\s\S]*?\*\//g, '')
export const isDebugFile = name => /\.(?:map|pdb|tsbuildinfo)$/i.test(name)
  || /\.dSYM(?:\/|$)/i.test(name)
export const isSourceFile = name => /\.(?:ts|tsx|swift|cs)$/i.test(name)

export function filesIn(directory, prefix = '') {
  return readdirSync(path.join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`Distribution symlink refused: ${file}`)
    return entry.isDirectory() ? filesIn(directory, file) : [file]
  })
}

const notices = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third_party/asil/LICENSE',
  'third_party/asil/DATA_LICENSE', 'third_party/asil/NOTICE',
  'third_party/automation/QUICKJS_LICENSE', 'third_party/automation/PLAYWRIGHT_LICENSE']
export const computerUseRdpFile = 'binaries/x86_64-pc-windows-msvc/development/computer-use-rdp.dll'
export const computerUseRdpNotices = ['third_party/rdp/FreeRDP-LICENSE', 'third_party/rdp/OpenSSL-LICENSE', 'third_party/rdp/zlib-LICENSE']
const macPrefix = 'binaries/(?:aarch64|x86_64)-apple-darwin/development/micromatrix Computer Use Dev\\.app/Contents/'
const macFile = new RegExp(`^${macPrefix}(?:MacOS/micromatrix-computer|Info\\.plist|Resources/icon\\.icns|_CodeSignature/CodeResources)$`)
export function assertComputerUsePackage(directory) {
  const files = filesIn(directory)
  const required = ['package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'assets/macos/Info.plist', ...notices,
    ...['manifest.json','worker.js','popup.js','popup.html','popup.css'].map(file=>'assets/browser-extension/'+file),
    ...['aarch64', 'x86_64'].map(arch => `binaries/${arch}-apple-darwin/development/micromatrix Computer Use Dev.app/Contents/MacOS/micromatrix-computer`),
    'binaries/x86_64-pc-windows-msvc/development/micromatrix-computer-x86_64-pc-windows-msvc.exe']
  const hasRdp = files.includes(computerUseRdpFile) || computerUseRdpNotices.some(file => files.includes(file))
  if (hasRdp) required.push(computerUseRdpFile, ...computerUseRdpNotices)
  for (const file of required) if (!files.includes(file)) throw new Error(`Computer Use package missing: ${file}`)
  const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (pkg.name !== '@hideinmatrix/computer-use' || pkg.version !== '0.9.0'
    || pkg.repository?.url !== 'git+https://github.com/HideInMatrix/computer-use.git'
    || pkg.scripts || pkg.devDependencies
    || Object.keys(pkg.exports ?? {}).sort().join('|') !== '.|./package.json') {
    throw new Error('Unexpected compiled-only Computer Use package manifest')
  }
  if (hasRdp) {
    const bytes=readFileSync(path.join(directory,computerUseRdpFile)),pe=bytes.length>=64?bytes.readUInt32LE(60):-1
    if(bytes.toString('ascii',0,2)!=='MZ'||pe<64||pe+26>bytes.length||bytes.readUInt32LE(pe)!==0x4550||bytes.readUInt16LE(pe+4)!==0x8664||bytes.readUInt16LE(pe+24)!==0x20b||(bytes.readUInt16LE(pe+22)&0x2000)===0)throw new Error('Computer Use RDP runtime must be a Windows x64 DLL')
  }
  for (const file of files) {
    const allowed = /^dist\/(?:[\w-]+\/)*[\w-]+(?:\.js|\.d\.ts)$/.test(file)
      || ['package.json', 'README.md', 'assets/macos/Info.plist', 'assets/macos/icon.icns', ...notices].includes(file)
      || /^assets\/browser-extension\/(manifest\.json|worker\.js|popup\.js|popup\.html|popup\.css)$/.test(file)
      || file === computerUseRdpFile || computerUseRdpNotices.includes(file)
      || macFile.test(file)
      || file === 'binaries/x86_64-pc-windows-msvc/development/micromatrix-computer-x86_64-pc-windows-msvc.exe'
    if (!allowed) throw new Error(`Source/debug/unexpected file refused: ${file}`)
    if (/\.(?:js|d\.ts)$/.test(file) && hasSourceMap(readFileSync(path.join(directory, file), 'utf8'))) {
      throw new Error(`Source map reference refused: ${file}`)
    }
  }
  return files.length
}

// Distribution resources contain runtime JS, not TypeScript declarations/maps.
// LICENSE/NOTICE files are retained. Signed native bundles are checked, not mutated.
export function assertDistributionTree(directory) {
  for (const file of filesIn(directory)) {
    if (isDebugFile(file) || isSourceFile(file) || /(?:^|\/)\.(?:git|env)(?:[./]|$)/.test(file)) {
      throw new Error(`Source/debug/secret file in distribution: ${file}`)
    }
    if (/\.(?:js|cjs|mjs|html|css)$/.test(file) && hasSourceMap(readFileSync(path.join(directory, file), 'utf8'))) {
      throw new Error(`Source map reference in distribution: ${file}`)
    }
  }
}

// Only touch generated Workbench outputs. Never traverse node_modules, the
// independent Computer Use project, signed apps, or Cargo caches.
export function cleanGeneratedMaps(root) {
  const outputs = [path.join(root, 'dist')]
  for (const group of ['apps', 'packages', 'plugins']) {
    for (const entry of readdirSync(path.join(root, group), { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        for (const output of ['dist', 'dist-types']) outputs.push(path.join(root, group, entry.name, output))
      }
    }
  }
  let removed = 0
  for (const directory of outputs) {
    if (!existsSync(directory)) continue
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Generated output must not be a symlink')
    for (const file of filesIn(directory)) {
      const absolute = path.join(directory, file)
      if (/\.map$/i.test(file)) { rmSync(absolute); removed++ }
      else if (/\.(?:js|cjs|mjs|d\.ts|css)$/.test(file)) {
        const text = readFileSync(absolute, 'utf8')
        const clean = stripSourceMaps(text)
        if (clean !== text) writeFileSync(absolute, clean)
      }
    }
  }
  return removed
}

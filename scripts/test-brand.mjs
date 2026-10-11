import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { canReplaceLegacyBrandRelease, replaceLegacyBrandRelease } from './replace-legacy-brand-release.mjs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const config = JSON.parse(read('apps/desktop/tauri.conf.json'))

test('Faber branding retains installed application and MSI identities', () => {
  assert.equal(config.productName, 'Faber')
  assert.equal(config.app.windows[0].title, 'Faber')
  assert.equal(config.identifier, 'org.micromatrix.pi-mcp')
  assert.equal(config.bundle.windows.wix.upgradeCode, '973493ad-2108-569d-b07f-7206f8f35dc6')
  assert.equal(config.version, JSON.parse(read('package.json')).version)
  for (const file of ['apps/web/index.html', 'apps/web/src/components/AppSidebar.vue', 'apps/web/src/components/AboutView.vue',
    'apps/daemon/src/main.ts', 'apps/daemon/src/runtime.ts', 'plugins/mcp/src/auth.ts', 'packages/oauth/src/local-oauth.ts']) {
    assert.match(read(file), /Faber/, file)
    assert.doesNotMatch(read(file), /micromatrix agent|MicroMatrix Pi MCP/, file)
  }
})

test('macOS helper wrapper paths agree without changing the private package or signing identifier', () => {
  const files = JSON.parse(read('apps/desktop/tauri.macos.conf.json')).bundle.macOS.files
  assert.equal(files['Helpers/Faber Computer Use.app'], 'binaries/Faber Computer Use.app')
  for (const file of ['apps/daemon/src/computer-use-host.ts', 'apps/desktop/src/computer_use_settings.rs',
    'scripts/prepare-computer-use.mjs', 'scripts/package-artifacts.mjs', 'scripts/verify-macos-signing.mjs']) {
    assert.match(read(file), /Faber Computer Use\.app/, file)
    assert.doesNotMatch(read(file), /micromatrix Computer Use\.app/, file)
  }
  assert.match(read('scripts/prepare-computer-use.mjs'), /org\.micromatrix\.computer-use/)
  assert.match(read('scripts/computer-use-package.mjs'), /micromatrix Computer Use Dev\.app/)
})

const legacy = { tagName: 'v1.0.0', name: 'micromatrix agent v1.0.0', isDraft: false }
test('replacement is restricted to the explicitly superseded legacy-brand release', () => {
  assert(canReplaceLegacyBrandRelease('v1.0.0', 'Faber', legacy))
  for (const [tag, product, release] of [
    ['v1.0.1', 'Faber', legacy], ['v1.0.0', 'Other', legacy],
    ['v1.0.0', 'Faber', { ...legacy, name: 'Faber v1.0.0' }],
    ['v1.0.0', 'Faber', { ...legacy, tagName: 'v0.5.0' }],
    ['v1.0.0', 'Faber', { ...legacy, isDraft: true }],
  ]) assert(!canReplaceLegacyBrandRelease(tag, product, release))
})

test('replacement deletes only the old release and assets, never the Git tag', () => {
  const calls = []
  const result = replaceLegacyBrandRelease({ RELEASE_TAG: 'v1.0.0', GITHUB_REPOSITORY: 'HideInMatrix/micromatrix-workbench' }, (file, args, options) => {
    calls.push([file, args])
    if (args[0] === 'api') {
      assert.deepEqual(args, ['api', 'repos/HideInMatrix/micromatrix-workbench/releases/tags/v1.0.0', '--jq', '{tag_name, name, draft}'])
      assert.equal(options.maxBuffer, 64 * 1024)
      assert.equal(options.timeout, 30_000)
      return JSON.stringify({ tag_name: legacy.tagName, name: legacy.name, draft: legacy.isDraft })
    }
    return ''
  })
  assert.equal(result, true)
  assert.deepEqual(calls[1], ['gh', ['release', 'delete', 'v1.0.0', '--repo', 'HideInMatrix/micromatrix-workbench', '--yes']])
})

test('replacement preserves Faber releases and fails closed on API errors', () => {
  const env = { RELEASE_TAG: 'v1.0.0', GITHUB_REPOSITORY: 'HideInMatrix/micromatrix-workbench' }
  for (const release of [{ tag_name: 'v1.0.0', name: 'Faber v1.0.0', draft: false }, { tag_name: 'v1.0.0', name: legacy.name, draft: true }]) {
    assert.equal(replaceLegacyBrandRelease(env, (file, args) => {
      assert.equal(args[0], 'api')
      return JSON.stringify(release)
    }), false)
  }
  assert.throws(() => replaceLegacyBrandRelease(env, () => { throw new Error('HTTP 403') }), /403/)
  assert.throws(() => replaceLegacyBrandRelease({ ...env, GITHUB_REPOSITORY: 'Other/repo' }, () => assert.fail()), /restricted/)
})

test('only an explicit HTTP 404 permits a missing release; all other failures stop deletion', () => {
  const env = { RELEASE_TAG: 'v1.0.0', GITHUB_REPOSITORY: 'HideInMatrix/micromatrix-workbench' }
  const missing = Object.assign(new Error('not found'), { status: 1, stderr: 'gh: Not Found (HTTP 404)\n' })
  assert.equal(replaceLegacyBrandRelease(env, () => { throw missing }), false)
  for (const details of [
    { status: 1, stderr: 'gh: Forbidden (HTTP 403)' },
    { status: 1, stderr: 'gh: Internal Server Error (HTTP 500)' },
    { code: 'ENOBUFS', signal: 'SIGTERM', stderr: 'gh: Not Found (HTTP 404)' },
    { code: 'ETIMEDOUT', stderr: '' },
  ]) {
    const failure = Object.assign(new Error('API failed'), details)
    assert.throws(() => replaceLegacyBrandRelease(env, () => { throw failure }), error => error === failure)
  }
  assert.throws(() => replaceLegacyBrandRelease(env, () => 'invalid JSON'), SyntaxError)
})

test('large history reproduces ENOBUFS but the targeted filtered request stays bounded', () => {
  assert.throws(() => execFileSync(process.execPath, ['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))']),
    error => error.code === 'ENOBUFS')
  const env = { RELEASE_TAG: 'v1.0.0', GITHUB_REPOSITORY: 'HideInMatrix/micromatrix-workbench' }
  assert.equal(replaceLegacyBrandRelease(env, (file, args, options) => {
    assert.equal(args[0], 'api')
    assert(!args.includes('--paginate'))
    assert.match(args[1], /\/releases\/tags\/v1\.0\.0$/)
    assert.equal(args[3], '{tag_name, name, draft}')
    return execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify({tag_name:"v1.0.0",name:"Faber v1.0.0",draft:false}))'], options)
  }), false)
})

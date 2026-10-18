import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, access, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { BrowserAdapter } from '@hideinmatrix/computer-use'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(join(root, '.local'), { recursive: true })
const temporary = await mkdtemp(join(root, '.local/computer-browser-test-'))
after(() => rm(temporary, { recursive: true, force: true }))
async function load(file, name) {
  const output = join(temporary, `${name}.mjs`)
  await build({ entryPoints: [join(root, file)], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
  return import(pathToFileURL(output).href)
}
const { parseComputerUseBrowser: parse, computerUseBrowserDataDirectory: dataDirectory } = await load('apps/daemon/src/computer-use-browser.ts', 'browser')
const { builtinComputerUseConfiguration, computerUseConnection } = await load('apps/daemon/src/builtin-computer-use.ts', 'builtin')
const endpoint = 'ws://127.0.0.1:9222/devtools/browser/test'
const attach = { endpoint, allowedOrigins: ['https://example.com'] }
const managed = { mode: 'managed', allowedOrigins: ['https://example.com'] }

test('Legacy attach configuration and bare origins remain compatible without broadening scope', () => {
  assert.deepEqual(parse(attach), { endpoint, allowedOrigins: ['https://example.com/'] })
  assert.deepEqual(parse({ ...attach, mode: 'attach', allowedOrigins: [' https://example.com ', 'https://example.com/'] }),
    { endpoint, mode: 'attach', allowedOrigins: ['https://example.com/'] })
  for (const origin of ['https://example.com/path', 'https://user:pass@example.com', 'https://example.com/?x=1', 'https://example.com/#x', 'file:///tmp', 'https://example.com/..']) {
    assert.throws(() => parse({ ...attach, allowedOrigins: [origin] }), origin)
  }
  for (const value of [null, [], {}, { ...attach, allowedOrigins: [] }, { ...attach, allowedOrigins: Array(33).fill('https://example.com') }]) assert.throws(() => parse(value))
  for (const url of ['ws://example.com:9222/devtools/browser/test', 'http://127.0.0.1:9222', endpoint + '?secret=1']) assert.throws(() => parse({ ...attach, endpoint: url }))
})

test('Managed configuration defaults are explicit and reject model-supplied filesystem/launch parameters', () => {
  assert.deepEqual(parse(managed), { ...managed, allowedOrigins: ['https://example.com/'], channel: 'chromium', profile: 'default' })
  assert.equal(parse({ ...managed, channel: 'chrome', profile: 'work-1', startUrl: 'https://example.com/login' }).startUrl, 'https://example.com/login')
  for (const profile of ['../personal', '/tmp/profile', 'UPPER', 'a'.repeat(65), '']) assert.throws(() => parse({ ...managed, profile }))
  for (const extra of [{ userDataDir: '/personal' }, { executablePath: '/tmp/chrome' }, { args: ['--no-sandbox'] }, { endpoint }, { channel: 'safari' }, { startUrl: 'https://unapproved.example/' }]) assert.throws(() => parse({ ...managed, ...extra }))
})

test('Host chooses dedicated app data outside the workspace on all platforms without creating it', async () => {
  const home = join(temporary, 'home'), workspace = join(home, 'projects/work')
  assert.equal(dataDirectory(workspace, 'darwin', {}, home), join(home, 'Library/Application Support/Faber/computer-use'))
  assert.equal(dataDirectory(workspace, 'win32', { LOCALAPPDATA: join(home, 'local') }, home), join(home, 'local/Faber/computer-use'))
  assert.equal(dataDirectory(workspace, 'linux', { XDG_DATA_HOME: join(home, 'data') }, home), join(home, 'data/faber/computer-use'))
  assert.equal(dataDirectory(workspace, 'linux', {}, home), join(home, '.local/share/faber/computer-use'))
  await assert.rejects(access(home))
  assert.throws(() => dataDirectory(home, 'darwin', {}, home), /Workspace/)
  assert.throws(() => dataDirectory(workspace, 'linux', { XDG_DATA_HOME: workspace }, home), /Workspace/)
})

test('Workspace and app-data symlink aliases cannot move private profiles inside editable roots', async () => {
  const home = join(temporary, 'real-home'), alias = join(temporary, 'home-alias')
  await mkdir(home)
  await symlink(home, alias, 'junction')
  assert.throws(() => dataDirectory(alias, 'darwin', {}, home), /Workspace/)
  const workspace = join(home, 'projects')
  await mkdir(workspace)
  const dataAlias = join(temporary, 'data-alias')
  await symlink(workspace, dataAlias, 'junction')
  assert.throws(() => dataDirectory(workspace, 'linux', { XDG_DATA_HOME: dataAlias }, home), /Workspace/)
})

test('Saved configuration and stdio forwarding preserve both modes, with no adapter launch', () => {
  for (const browser of [attach, managed]) {
    const result = builtinComputerUseConfiguration({ enabled: true, allowActions: true, browser }, { skills: [], mcp: [] })
    assert.deepEqual(result.configuration.browser, parse(browser))
    const connection = computerUseConnection(temporary, true, true, result.configuration)
    const index = connection.args.indexOf('--browser-configuration')
    assert.ok(index >= 0)
    assert.deepEqual(JSON.parse(connection.args[index + 1]), parse(browser))
  }
})

test('Constructing, querying capabilities and broad discovery never launches a managed browser or creates profiles', async () => {
  const folder = join(temporary, 'never-created')
  let launches = 0
  const adapter = new BrowserAdapter(parse({ ...managed, channel: 'chrome' }), {
    dataDirectory: folder,
    engine() { launches++; throw new Error('Unexpected browser launch') },
  })
  assert.ok(adapter.capabilities())
  assert.ok(adapter.describe())
  await adapter.targets({ explicit: false })
  await adapter.close()
  assert.equal(launches, 0)
  await assert.rejects(access(folder))
})

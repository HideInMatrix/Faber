import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parse, compileScript } from '@vue/compiler-sfc'
import { effectScope } from 'vue'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(join(root, '.local'), { recursive: true })
const temporary = await mkdtemp(join(root, '.local/computer-browser-ui-'))
after(() => rm(temporary, { recursive: true, force: true }))
const entry = join(root, 'apps/web/src/components/services/ComputerUseSettings.vue')
const output = join(temporary, 'component.mjs')
await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: { '@': join(root, 'apps/web/src') }, plugins: [{ name: 'test-component-boundaries', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, async args => {
      if (args.path !== entry) return { contents: 'export default {}', loader: 'js' }
      const { descriptor } = parse(await readFile(entry, 'utf8'))
      return { contents: compileScript(descriptor, { id: 'computer-browser-test' }).content, loader: 'ts', resolveDir: dirname(entry) }
    })
    builder.onResolve({ filter: /^vue$/ }, args => args.namespace === 'test-vue' ? { path: 'vue', external: true } : { path: 'vue', namespace: 'test-vue' })
    builder.onLoad({ filter: /.*/, namespace: 'test-vue' }, () => ({ contents: "export * from 'vue'; export const onMounted = () => {};", resolveDir: root }))
    builder.onResolve({ filter: /api\/desktop$/ }, () => ({ path: 'desktop', namespace: 'test-api' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-api' }, () => ({ contents: 'export const desktopApi = new Proxy({}, { get: (_, key) => globalThis.__computerBrowserTest.api[key] });' }))
    builder.onResolve({ filter: /composables\/useAppUpdater$/ }, () => ({ path: 'updater', namespace: 'test-updater' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-updater' }, () => ({ contents: "import { ref } from 'vue'; export const updateInstallationLocked = ref(false);", resolveDir: root }))
    builder.onResolve({ filter: /^vue-sonner$/ }, () => ({ path: 'toast', namespace: 'test-toast' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-toast' }, () => ({ contents: 'export const toast = { success: text => globalThis.__computerBrowserTest.messages.push(text), error: text => globalThis.__computerBrowserTest.errors.push(text) };' }))
  } }] })
const component = (await import(pathToFileURL(output).href)).default
function fixture(t, browser = null, props = {}) {
  const calls = [], messages = [], errors = []
  const status = { browser, enabled: true, running: false, supported: true, available: true, allowActions: true, platform: 'macos' }
  const api = {
    computerUseStatus: async () => status,
    configureComputerUseBrowser: async value => { calls.push(value); status.browser = value; return { ...status } },
  }
  globalThis.__computerBrowserTest = { api, messages, errors }
  const scope = effectScope()
  const vm = scope.run(() => component.setup(props, { expose() {}, emit() {} }))
  t.after(() => { scope.stop(); delete globalThis.__computerBrowserTest })
  return { vm, calls, errors, status }
}

test('Unconfigured browser defaults to installed Chrome managed mode; reading does not save or launch', async t => {
  const { vm, calls } = fixture(t)
  await vm.refresh()
  assert.equal(vm.browserMode.value, 'managed')
  assert.equal(vm.browserChannel.value, 'chrome')
  assert.equal(vm.browserProfile.value, 'default')
  assert.deepEqual(calls, [])
})

test('Old endpoint-only configuration loads as attach; dirty drafts survive status refresh', async t => {
  const { vm } = fixture(t, { endpoint: 'ws://127.0.0.1:9222/devtools/browser/test', allowedOrigins: ['https://example.com/'] })
  await vm.refresh()
  assert.equal(vm.browserMode.value, 'attach')
  assert.match(vm.browserEndpoint.value, /9222/)
  vm.browserDirty.value = true
  vm.browserMode.value = 'managed'
  vm.browserProfile.value = 'draft'
  await vm.refresh()
  assert.equal(vm.browserMode.value, 'managed')
  assert.equal(vm.browserProfile.value, 'draft')
})

test('Saving managed browser sends only supported settings; clearing removes the channel', async t => {
  const { vm, calls, errors } = fixture(t)
  await vm.refresh()
  vm.browserOrigins.value = 'https://example.com\nhttps://example.com\n'
  vm.browserProfile.value = ' work '
  vm.browserStartUrl.value = ' https://example.com/login '
  vm.browserEndpoint.value = 'stale ignored endpoint'
  vm.browserDirty.value = true
  await vm.saveBrowser()
  assert.deepEqual(calls, [{ mode: 'managed', channel: 'chrome', profile: 'work', allowedOrigins: ['https://example.com'], startUrl: 'https://example.com/login' }])
  assert.equal(vm.browserDirty.value, false)
  assert.deepEqual(errors, [])
  await vm.saveBrowser(true)
  assert.equal(calls[1], null)
})

test('Attach mode still saves an endpoint and never leaks managed fields', async t => {
  const { vm, calls } = fixture(t)
  await vm.refresh()
  vm.browserMode.value = 'attach'
  vm.browserEndpoint.value = ' ws://127.0.0.1:9222/devtools/browser/test '
  vm.browserOrigins.value = 'https://example.com'
  await vm.saveBrowser()
  assert.deepEqual(calls[0], { mode: 'attach', endpoint: 'ws://127.0.0.1:9222/devtools/browser/test', allowedOrigins: ['https://example.com'] })
})

test('Empty allowlist, locked UI and running runtime cannot save configuration', async t => {
  const { vm, calls, errors, status } = fixture(t)
  await vm.refresh()
  await vm.saveBrowser()
  assert.equal(errors.length, 1)
  assert.deepEqual(calls, [])
  vm.browserOrigins.value = 'https://example.com'
  status.running = true
  await vm.refresh()
  await vm.saveBrowser()
  await vm.saveBrowser(true)
  assert.deepEqual(calls, [])
})

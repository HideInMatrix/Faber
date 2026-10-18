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
const temporary = await mkdtemp(join(root, '.local/skill-import-ui-'))
after(() => rm(temporary, { recursive: true, force: true }))
const entry = join(root, 'apps/web/src/components/services/PiExtensionManager.vue')
const output = join(temporary, 'component.mjs')
await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external',
  alias: { '@': join(root, 'apps/web/src') }, plugins: [{ name: 'test-component-boundaries', setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, async args => {
      if (args.path !== entry) return { contents: 'export default {}', loader: 'js' }
      const { descriptor } = parse(await readFile(entry, 'utf8'))
      return { contents: compileScript(descriptor, { id: 'skill-import-test' }).content, loader: 'ts', resolveDir: dirname(entry) }
    })
    builder.onResolve({ filter: /^vue$/ }, args => args.namespace === 'test-vue' ? { path: 'vue', external: true } : { path: 'vue', namespace: 'test-vue' })
    builder.onLoad({ filter: /.*/, namespace: 'test-vue' }, () => ({ contents: "export * from 'vue'; export const onMounted = () => {};", resolveDir: root }))
    builder.onResolve({ filter: /api\/desktop$/ }, () => ({ path: 'desktop', namespace: 'test-api' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-api' }, () => ({ contents: 'export const desktopApi = new Proxy({}, { get: (_, key) => globalThis.__skillImportTest.api[key] });' }))
    builder.onResolve({ filter: /^vue-sonner$/ }, () => ({ path: 'toast', namespace: 'test-toast' }))
    builder.onLoad({ filter: /.*/, namespace: 'test-toast' }, () => ({ contents: 'export const toast = { success: text => globalThis.__skillImportTest.messages.push(text), error: text => globalThis.__skillImportTest.errors.push(text) };' }))
  } }] })
const component = (await import(pathToFileURL(output).href)).default
function fixture(t, existing = []) {
  const calls = [], messages = [], errors = []
  const preview = { path: '/canonical/skills', candidates: [
    { id: 'one', name: 'document-one', description: 'First', path: '/canonical/skills/one/SKILL.md', status: 'new', warnings: [] },
    { id: 'two', name: 'document-two', description: 'Second', path: '/canonical/skills/two/SKILL.md', status: 'new', warnings: [] },
    { id: 'already', name: 'already', description: '', path: '/canonical/skills/already/SKILL.md', status: 'existing', warnings: [] },
    { id: 'conflict', name: 'document-one', description: '', path: '/canonical/skills/conflict/SKILL.md', status: 'conflict', warnings: [] },
  ], diagnostics: [] }
  const api = {
    piExtensions: async () => ({ configuration: { skills: existing, mcp: [] }, running: false, host_active: false, loaded_skills: [] }),
    previewPiSkillImport: async (...args) => { calls.push(['scan', ...args]); return preview },
    importPiSkills: async (...args) => { calls.push(['import', ...args]); return args[1].length },
    createPiSkill: async (...args) => { calls.push(['create', ...args]) },
  }
  globalThis.__skillImportTest = { api, messages, errors }
  const scope = effectScope()
  const vm = scope.run(() => component.setup({}, { expose() {}, emit() {} }))
  t.after(() => { scope.stop(); delete globalThis.__skillImportTest })
  return { vm, calls, messages, errors, preview, api }
}

test('Import opens without manual ID; scanning previews only and selects eligible documents', async t => {
  const { vm, calls, preview } = fixture(t)
  await vm.refresh()
  vm.openSkillImport()
  vm.skillPath.value = '/chosen/skills'
  await vm.scanSkills()
  assert.equal(vm.skillId.value, '')
  assert.deepEqual(calls, [['scan', '/chosen/skills', undefined]])
  assert.deepEqual(vm.selectedSkills.value, preview.candidates.slice(0, 2).map(item => item.path))
  assert.equal(vm.form.value, 'skill')
})

test('Editing the directory invalidates a stale scan and prevents accidental batch writes', async t => {
  const { vm, calls, errors } = fixture(t)
  await vm.refresh()
  vm.skillPath.value = '/chosen/skills'
  await vm.scanSkills()
  vm.skillPath.value = '/different/skills'
  assert.equal(vm.skillPreview.value, null)
  assert.deepEqual(vm.selectedSkills.value, [])
  await vm.saveSkill()
  assert.equal(calls.filter(call => call[0] === 'import').length, 0)
  assert.equal(errors.length, 1)
})

test('Confirm imports only the selected files using the canonical scanned root', async t => {
  const { vm, calls, preview, errors } = fixture(t)
  await vm.refresh()
  vm.skillPath.value = '/chosen/skills'
  await vm.scanSkills()
  vm.selectedSkills.value = [preview.candidates[1].path]
  await vm.saveSkill()
  assert.deepEqual(calls[1], ['import', preview.path, [preview.candidates[1].path], undefined])
  assert.equal(vm.form.value, '')
  assert.deepEqual(errors, [])
})

test('Legacy split passes the replacement ID, and cancelling never saves it', async t => {
  const legacy = { id: 'legacy', path: '/chosen/skills', enabled: false }
  const { vm, calls } = fixture(t, [legacy])
  await vm.refresh()
  vm.openSkillImport(legacy)
  await new Promise(setImmediate)
  assert.deepEqual(calls, [['scan', legacy.path, legacy.id]])
  assert.equal(vm.replacingSkillSource.value, legacy.id)
  vm.form.value = ''
  assert.equal(calls.filter(call => call[0] === 'import').length, 0)
  vm.openSkillImport()
  assert.equal(vm.replacingSkillSource.value, undefined)
  assert.equal(vm.skillPreview.value, null)
})

test('Selection respects remaining source capacity, while manual Skill creation still works', async t => {
  const { vm, calls } = fixture(t, Array.from({ length: 99 }, (_, index) => ({ id: `source-${index}`, path: '/old', enabled: true })))
  await vm.refresh()
  vm.skillPath.value = '/chosen/skills'
  await vm.scanSkills()
  assert.equal(vm.selectedSkills.value.length, 1)
  vm.skillMode.value = 'create'
  assert.equal(vm.skillPreview.value, null)
  vm.skillId.value = ' my-skill '
  vm.skillDescription.value = 'Description'
  vm.skillInstructions.value = 'Instructions'
  await vm.saveSkill()
  assert.deepEqual(calls[1], ['create', 'my-skill', 'Description', 'Instructions'])
})

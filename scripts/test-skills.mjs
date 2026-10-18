import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(join(root, '.local'), { recursive: true })
const temporary = await mkdtemp(join(root, '.local/skills-test-'))
after(() => rm(temporary, { recursive: true, force: true }))
async function load(file, name) {
  const output = join(temporary, `${name}.mjs`)
  await build({ entryPoints: [join(root, file)], outfile: output, bundle: true,
    platform: 'node', format: 'esm', packages: 'external' })
  return import(pathToFileURL(output).href)
}
const { parseExtensions } = await load('packages/plugin-kit/src/resources.ts', 'resources')
const { validateSkillSource, createSkillFile, discoverSkillFiles, inspectSkillSources,
  readSkillDocument, editSkillDocument, createSkillsExtension, loadedSkills, previewSkillImport, planSkillImport } =
  await load('plugins/skills/src/index.ts', 'skills')
const { PiBodyHost } = await load('packages/pi-body/src/host.ts', 'host')
const { DesktopCommandRouter } = await load('packages/control-plane/src/commands.ts', 'commands')

async function fixture(name, definitions) {
  const folder = join(temporary, name)
  for (const [relative, content] of Object.entries(definitions)) {
    const file = join(folder, relative)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, content)
  }
  return folder
}
function document(name, description = 'A test skill') {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nTest instructions.\n`
}
function source(path) { return [{ id: 'local-skills', path, enabled: true }] }

test('Skill source IDs accept baoyu names and 64 characters without relaxing MCP IDs', () => {
  for (const id of ['baoyu-article-illustrator', 'baoyu-danger-x-to-markdown', 'a'.repeat(64), 'legacy_source']) {
    assert.equal(parseExtensions({ skills: [{ id, path: temporary }] }).skills[0].id, id)
  }
  for (const id of ['', 'a'.repeat(65), '-bad', 'Bad', 'a:b', '../bad']) {
    assert.throws(() => parseExtensions({ skills: [{ id, path: temporary }] }))
  }
  assert.throws(() => parseExtensions({ mcp: [{ id: 'baoyu-article-illustrator', transport: 'stdio', command: 'node' }] }))
  assert.throws(() => parseExtensions({ skills: [{ id: 'same', path: temporary }, { id: 'same', path: temporary }] }))
})

test('Creating long Skill names preserves strict names and does not overwrite originals', async () => {
  for (const id of ['baoyu-article-illustrator', 'a'.repeat(64)]) {
    const file = await createSkillFile(join(temporary, 'created'), id, 'Example', 'Instructions')
    await validateSkillSource(file, root)
    assert.match(await readFile(file, 'utf8'), new RegExp(`name: ${id}`))
    await assert.rejects(createSkillFile(join(temporary, 'created'), id, 'Example', 'Replacement'), /EEXIST/)
  }
  for (const id of ['a'.repeat(65), 'bad:name', '../escape', 'bad--name', 'bad-', 'bad_name']) {
    await assert.rejects(createSkillFile(temporary, id, 'Example', 'Instructions'), /Invalid Skill name/)
  }
})

test('A root directory imports all nested skills while retaining path-specific compatibility warnings', async () => {
  const folder = await fixture('collection', {
    'baoyu-article-illustrator/SKILL.md': document('baoyu-article-illustrator'),
    'nested/second/SKILL.md': document('second'),
    'react-components/SKILL.md': document('react:components'),
  })
  await validateSkillSource(folder, root)
  const result = inspectSkillSources(source(folder), root)
  assert.deepEqual(result.skills.map(skill => skill.name).sort(), ['baoyu-article-illustrator', 'react:components', 'second'])
  assert.equal(result.diagnostics.length, 1)
  assert.match(result.diagnostics[0].path, /react-components\/SKILL.md$/)
  assert.equal(result.diagnostics[0].type, 'warning')
  assert.match(await readFile(join(folder, 'react-components/SKILL.md'), 'utf8'), /name: react:components/)
  const original = await readSkillDocument(source(folder), root, 'baoyu-article-illustrator')
  await editSkillDocument(source(folder), root, original.id, original.document + '\nUpdated instructions.\n', original.revision)
  await assert.rejects(editSkillDocument(source(folder), root, original.id, original.document, original.revision), /changed since/)
})

test('Unreadable/invalid children do not hide healthy siblings, but an empty source still fails with its path', async () => {
  const folder = await fixture('partial', {
    'valid/SKILL.md': document('valid'),
    'missing-description/SKILL.md': '---\nname: missing-description\n---\nInstructions',
  })
  await validateSkillSource(folder, root)
  assert.deepEqual(discoverSkillFiles(source(folder), root).map(skill => skill.name), ['valid'])
  assert.match(inspectSkillSources(source(folder), root).diagnostics[0].path, /missing-description/)
  await assert.rejects(validateSkillSource(join(folder, 'missing-description'), root), /missing-description.*description is required/)
  await assert.rejects(validateSkillSource('relative/path', root), /absolute/)
})

test('Duplicate names remain blocking, while overlapping references to the same file are deduplicated', async () => {
  const folder = await fixture('collision', { 'first/SKILL.md': document('same'), 'second/SKILL.md': document('same') })
  await assert.rejects(validateSkillSource(folder, root), /collision/)
  assert.throws(() => discoverSkillFiles(source(folder), root), /SKILL.md.*collision/)
  const single = join(folder, 'first')
  assert.equal(discoverSkillFiles([...source(single), { id: 'overlap', path: join(single, 'SKILL.md'), enabled: true }], root).length, 1)
  assert.equal(discoverSkillFiles([{ id: 'off', path: folder, enabled: false }], root, true).length, 0)
})

test('Runtime host loads a directory with warnings instead of failing at a later loading stage', async () => {
  const folder = await fixture('runtime', {
    'baoyu-article-illustrator/SKILL.md': document('baoyu-article-illustrator'),
    'react-components/SKILL.md': document('react:components'),
  })
  const logs = []
  const host = await PiBodyHost.create({ workspace: temporary, logger: { log: (...args) => logs.push(args) } }, temporary, [],
    loader => ({ name: 'skills', factory: createSkillsExtension(source(folder), loader) }))
  try {
    assert.deepEqual(loadedSkills(host.loader).map(skill => skill.name).sort(), ['baoyu-article-illustrator', 'react:components'])
    assert.ok(logs.some(([level, , fields]) => level === 'warn' && fields.path.endsWith('react-components/SKILL.md')))
  } finally { await host.close() }
})

test('Batch discovery generates independent folder-based IDs without changing document names or files', async () => {
  const folder = await fixture('batch', {
    'baoyu-article-illustrator/SKILL.md': document('actual-name'),
    'react-components/SKILL.md': document('react:components'),
    'nested/second/SKILL.md': document('second'),
  })
  const preview = await previewSkillImport(folder, root, [])
  assert.equal(preview.candidates.length, 3)
  assert.equal(preview.candidates[0].id, 'baoyu-article-illustrator')
  assert.equal(preview.candidates[0].name, 'actual-name')
  assert.ok(preview.candidates.every(item => item.status === 'new' && item.path.endsWith('/SKILL.md')))
  const next = await planSkillImport(folder, preview.candidates.map(item => item.path), root, [])
  assert.equal(next.length, 3)
  parseExtensions({ skills: next })
  assert.equal(discoverSkillFiles(next, root).length, 3)
  assert.equal(discoverSkillFiles(next.map((item, index) => ({ ...item, enabled: index !== 1 })), root, true).length, 2)
  assert.equal(discoverSkillFiles(next.slice(1), root).length, 2)
  assert.equal(await readFile(join(folder, 'baoyu-article-illustrator/SKILL.md'), 'utf8'), document('actual-name'))
})

test('Folder IDs are deterministic, bounded and disambiguated, including long/non-ASCII/digit names', async () => {
  const long = 'a'.repeat(80)
  const folder = await fixture('ids', {
    'a/shared/SKILL.md': document('one'), 'b/shared/SKILL.md': document('two'),
    [`${long}/SKILL.md`]: document('three'), '123/SKILL.md': document('four'),
    '中文/SKILL.md': document('five'),
  })
  const existing = [{ id: 'shared', path: join(temporary, 'absent'), enabled: false }]
  const preview = await previewSkillImport(folder, root, existing)
  assert.deepEqual(preview, await previewSkillImport(folder, root, existing))
  assert.ok(preview.candidates.some(item => item.id === 'shared-2'))
  assert.ok(preview.candidates.some(item => item.id === 'shared-3'))
  for (const candidate of preview.candidates) {
    assert.ok(candidate.id.length <= 64)
    parseExtensions({ skills: [{ id: candidate.id, path: candidate.path }] })
  }
})

test('Reimports and symlink aliases do not duplicate or re-enable already configured Skills', async () => {
  const folder = await fixture('repeat', { 'one/SKILL.md': document('one'), 'two/SKILL.md': document('two') })
  const first = await previewSkillImport(folder, root, [])
  const existing = [{ id: 'one', path: first.candidates[0].path, enabled: false }]
  await symlink(join(folder, 'one'), join(folder, 'alias'))
  const preview = await previewSkillImport(folder, root, existing)
  assert.equal(preview.candidates.length, 2)
  assert.equal(preview.candidates.filter(item => item.status === 'existing').length, 1)
  const next = await planSkillImport(folder, preview.candidates.filter(item => item.status === 'new').map(item => item.path), root, existing)
  assert.deepEqual(next[0], existing[0])
  assert.equal(next.length, 2)
  await assert.rejects(planSkillImport(folder, [first.candidates[0].path], root, existing), /already configured/)
})

test('Name collisions are visible and blocked; malformed children remain warnings with file paths', async () => {
  const folder = await fixture('batch-collision', {
    'first/SKILL.md': document('same'), 'second/SKILL.md': document('same'),
    'invalid/SKILL.md': '---\nname: invalid\n---\nMissing description',
  })
  const preview = await previewSkillImport(folder, root, [])
  assert.deepEqual(preview.candidates.map(item => item.status), ['new', 'conflict'])
  assert.match(preview.diagnostics[0].path, /invalid\/SKILL.md$/)
  const conflict = preview.candidates.find(item => item.status === 'conflict')
  await assert.rejects(planSkillImport(folder, [conflict.path], root, []), /name conflict/)
  const winner = preview.candidates.find(item => item.status === 'new')
  const next = await planSkillImport(folder, [winner.path], root, [])
  assert.equal(next.length, 1)
})

test('Splitting a legacy directory is explicit, replaces just that reference and preserves its disabled state', async () => {
  const folder = await fixture('legacy', { 'one/SKILL.md': document('one'), 'two/SKILL.md': document('two') })
  const other = await fixture('other', { 'SKILL.md': document('other') })
  const existing = [{ id: 'legacy', path: folder, enabled: false }, { id: 'other', path: other, enabled: true }]
  assert.ok((await previewSkillImport(folder, root, existing)).candidates.every(item => item.status === 'existing'))
  const preview = await previewSkillImport(folder, root, existing, 'legacy')
  assert.ok(preview.candidates.every(item => item.status === 'new'))
  const next = await planSkillImport(folder, [preview.candidates[0].path], root, existing, 'legacy')
  assert.deepEqual(next[0], existing[1])
  assert.equal(next.length, 2)
  assert.equal(next[1].enabled, false)
  assert.equal(existing[0].id, 'legacy', 'Preview/plan must not mutate saved configuration')
  await assert.rejects(planSkillImport(other, [preview.candidates[0].path], root, existing, 'legacy'), /source changed/)
})

test('Commit rescans reject stale/forged selections and capacity errors without mutating existing settings', async () => {
  const folder = await fixture('stale', { 'one/SKILL.md': document('one') })
  const preview = await previewSkillImport(folder, root, [])
  const file = preview.candidates[0].path
  for (const selection of [[], [file, file], ['/tmp/not-scanned/SKILL.md']]) {
    await assert.rejects(planSkillImport(folder, selection, root, []))
  }
  const full = Array.from({ length: 100 }, (_, index) => ({ id: `existing-${index}`, path: join(temporary, `missing-${index}`), enabled: false }))
  await assert.rejects(planSkillImport(folder, [file], root, full), /max 100/)
  assert.equal(full.length, 100)
  const another = await fixture('new-conflict', { 'SKILL.md': document('one') })
  await assert.rejects(planSkillImport(folder, [file], root, source(another)), /name conflict/)
  await unlink(file)
  await assert.rejects(planSkillImport(folder, [file], root, []), /scan again/)
})

test('Single Skill paths import one file, and adding new documents never expands an existing reference', async () => {
  const folder = await fixture('single', { 'SKILL.md': document('single') })
  const preview = await previewSkillImport(join(folder, 'SKILL.md'), root, [])
  const next = await planSkillImport(folder, preview.candidates.map(item => item.path), root, [])
  await mkdir(join(folder, 'later'), { recursive: true })
  await writeFile(join(folder, 'later/SKILL.md'), document('later'))
  assert.deepEqual(discoverSkillFiles(next, root).map(item => item.name), ['single'])
})

test('Desktop API routes scan and atomic import payloads, rejects malformed selections and never starts Runtime', async () => {
  const calls = []
  const router = new DesktopCommandRouter({ runtime: {
    snapshot: () => ({ configuredPublicUrl: '', networkOptions: {} }),
    previewSkillImport: async (...args) => { calls.push(['preview', ...args]); return { candidates: [] } },
    importSkills: async (...args) => { calls.push(['import', ...args]); return args[1].length },
    start: () => assert.fail('Import must not start Runtime'),
  } })
  const request = (method, args) => router.dispatch(JSON.parse(JSON.stringify({ method, args })))
  await request('preview_pi_skill_import', [' /absolute/skills '])
  assert.deepEqual(calls[0], ['preview', '/absolute/skills', undefined])
  const files = ['/absolute/skills/one/SKILL.md']
  assert.equal(await request('import_pi_skills', ['/absolute/skills', files]), 1)
  assert.deepEqual(calls[1], ['import', '/absolute/skills', files, undefined])
  await request('import_pi_skills', ['/absolute/skills', files, 'legacy'])
  assert.deepEqual(calls[2], ['import', '/absolute/skills', files, 'legacy'])
  for (const args of [[null, files], ['/skills', []], ['/skills', [1]], ['/skills', files, 42]]) {
    await assert.rejects(request('import_pi_skills', args))
  }
  assert.equal(calls.length, 3)
})

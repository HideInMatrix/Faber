import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { computed, ref } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'
import ts from 'typescript-sfc'

const root = fileURLToPath(new URL('../', import.meta.url))
mkdirSync(path.join(root, '.local'), { recursive: true })
const temp = mkdtempSync(path.join(root, '.local/i18n-test-'))
after(() => rmSync(temp, { recursive: true, force: true }))
async function load(file) {
  const output = path.join(temp, path.basename(file, '.ts') + '.mjs')
  const result = await build({ entryPoints: [path.join(root, file)], bundle: true, write: false,
    platform: 'node', format: 'esm', external: ['vue'] })
  writeFileSync(output, result.outputFiles[0].text)
  return import(pathToFileURL(output).href)
}
const { englishMessages, translate, readLocale, LOCALE_STORAGE_KEY } = await load('apps/web/src/lib/i18n.ts')
const { locale, t, setLocale, initializeLocale, dateLocale } = await load('apps/web/src/composables/useLocale.ts')

function browserFixture(run, stored) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document
  const values = new Map(stored ? [[LOCALE_STORAGE_KEY, stored]] : [])
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }
  globalThis.document = { documentElement: { lang: '' } }
  try { run(values) }
  finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument
    locale.value = 'zh-CN'
  }
}

test('Fresh installations and invalid stored values default to Chinese, not the system language', () => {
  assert.equal(readLocale(), 'zh-CN')
  for (const value of [null, '', 'fr', '<script>', 'EN']) assert.equal(readLocale({ getItem: () => value }), 'zh-CN')
  assert.equal(readLocale({ getItem: () => 'en' }), 'en')
  assert.equal(readLocale({ getItem: () => { throw new Error('storage unavailable') } }), 'zh-CN')
})

test('Language changes are reactive, persistent, reversible and update document/date locales', () => browserFixture(values => {
  initializeLocale()
  const label = computed(() => t('运行日志'))
  assert.equal(label.value, '运行日志')
  assert.equal(globalThis.document.documentElement.lang, 'zh-CN')
  assert.equal(setLocale('en'), true)
  assert.equal(label.value, 'Runtime logs')
  assert.equal(dateLocale.value, 'en-US')
  assert.equal(values.get(LOCALE_STORAGE_KEY), 'en')
  assert.equal(globalThis.document.documentElement.lang, 'en')
  initializeLocale()
  assert.equal(locale.value, 'en')
  assert.equal(setLocale('zh-CN'), true)
  assert.equal(label.value, '运行日志')
  assert.equal(dateLocale.value, 'zh-CN')
  assert.equal(setLocale('fr'), false)
  assert.equal(values.get(LOCALE_STORAGE_KEY), 'zh-CN')
}))

test('Persisted English is restored before rendering', () => browserFixture(() => {
  initializeLocale()
  assert.equal(locale.value, 'en')
  assert.equal(t('关于'), 'About')
  assert.equal(globalThis.document.documentElement.lang, 'en')
}, 'en'))

test('Unavailable WebView storage keeps a working in-memory language choice', () => browserFixture(() => {
  Object.defineProperty(globalThis.window, 'localStorage', { get() { throw new Error('blocked') } })
  initializeLocale()
  assert.equal(locale.value, 'zh-CN')
  assert.doesNotThrow(() => setLocale('en'))
  assert.equal(t('启动'), 'Start')
}))

test('Switching language does not mutate unsaved forms, credentials, approval mode or Runtime state', () => browserFixture(() => {
  const draft = ref({ name: '我的服务', workspace: '/private/user-work', oauth_password: '测试秘密',
    permission_mode: 'safe', running: true, options: { tunnel_token: '测试令牌', protocol: 'http2' } })
  const before = JSON.stringify(draft.value)
  setLocale('en'); setLocale('zh-CN')
  assert.equal(JSON.stringify(draft.value), before)
  const implementation = readFileSync(path.join(root, 'apps/web/src/composables/useLocale.ts'), 'utf8')
  assert.doesNotMatch(implementation, /desktopApi|fetch\(|invoke\(|location\.reload/)
}))

test('Interpolation preserves user text and unknown diagnostics without translating or evaluating them', () => {
  assert.equal(translate('连接成功，发现 {value0} 个工具；测试连接已关闭。', 'en', { value0: 3 }),
    'Connected: 3 tools found. The test connection has been closed.')
  assert.equal(translate('启用 {name}', 'en', { name: '保存{value0}<b>' }), 'Enable 保存{value0}<b>')
  for (const value of ['constructor', '__proto__', '任意服务错误：E123', '[日志] Runtime 已停止。'])
    assert.equal(translate(value, 'en'), value)
})

test('All English messages are complete and retain the same interpolation parameters', () => {
  const fields = text => [...new Set([...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]))].sort()
  for (const [chinese, english] of Object.entries(englishMessages)) {
    assert(english.trim(), chinese)
    assert.doesNotMatch(english, /\p{Script=Han}/u, chinese)
    assert.deepEqual(fields(english), fields(chinese), chinese)
  }
})

test('UI source messages, permission labels and network provider descriptions have English translations', () => {
  const scan = content => {
    const source = ts.createSourceFile('messages.ts', content, ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isStringLiteral(node) && /\p{Script=Han}/u.test(node.text)) assert(Object.hasOwn(englishMessages, node.text), node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
  for (const file of walk(path.join(root, 'apps/web/src'))) {
    if (file.includes('/ui/') || file.endsWith('/lib/i18n.ts')) continue
    const content = readFileSync(file, 'utf8')
    if (file.endsWith('.vue')) {
      const { descriptor } = parse(content)
      if (descriptor.scriptSetup) scan(descriptor.scriptSetup.content)
      if (descriptor.template) {
        const visit = node => {
          if (node.type === 2 && /\p{Script=Han}/u.test(node.content)) assert.equal(node.content.trim(), '中文', file)
          if (node.type === 5) scan(node.content.content)
          for (const prop of node.props ?? []) {
            if (prop.type === 6 && prop.value) assert.doesNotMatch(prop.value.content, /\p{Script=Han}/u, file)
            if (prop.type === 7 && prop.exp) scan(prop.exp.content)
          }
          for (const child of node.children ?? []) visit(child)
        }
        visit(baseParse(descriptor.template.content))
      }
    } else if (file.endsWith('.ts')) scan(content)
  }
  scan(readFileSync(path.join(root, 'packages/control-plane/src/commands.ts'), 'utf8'))
})

test('Chinese and English README links are reciprocal, and explain the language selector', () => {
  const chinese = readFileSync(path.join(root, 'README.md'), 'utf8')
  const english = readFileSync(path.join(root, 'README.en.md'), 'utf8')
  assert.match(chinese, /\[English\]\(README\.en\.md\)/)
  assert.match(english, /\[简体中文\]\(README\.md\)/)
  assert.match(chinese, /界面语言/)
  assert.match(english, /defaults to Chinese/)
  assert.match(english, /English.*language dropdown/)
  assert.doesNotMatch(english, /GitHub Packages|private package/i)
})

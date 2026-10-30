import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runtimeStatus } from '../apps/web/src/lib/runtime-status.ts'
const source = file => readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8')

test('Runtime status distinguishes transitions, network warnings, failures and recovery in priority order', () => {
  const idle = { ready: true, lifecycleAction: null, running: false }
  const cases = [
    [{}, 'idle', '已停止'],
    [{ ready: false }, 'busy', '加载中'],
    [{ ready: false, initializationError: 'Unavailable' }, 'error', '加载失败'],
    [{ lifecycleAction: 'start' }, 'busy', '启动中…'],
    [{ lifecycleAction: 'start', exitReason: 'Old failure' }, 'busy', '启动中…'],
    [{ lifecycleAction: 'stop', running: true, networkWarning: 'Unreachable' }, 'warning', '停止中…'],
    [{ lifecycleAction: 'stop', running: false }, 'warning', '停止中…'],
    [{ running: true }, 'running', '运行中'],
    [{ running: true, networkWarning: 'Unreachable' }, 'warning', '运行中 · 公网异常'],
    [{ exitReason: 'Start failed' }, 'error', '运行异常'],
    [{ running: true, exitReason: 'Old failure' }, 'running', '运行中'],
  ]
  for (const [state, tone, label] of cases) assert.deepEqual(runtimeStatus({ ...idle, ...state }), { tone, label })
  const css = source('styles.css')
  for (const tone of ['idle', 'busy', 'running', 'warning', 'error']) assert(css.includes(`.status-${tone} {`), tone)
  assert.match(source('components/RuntimeView.vue'), /t\(status\.label\)/)
})

test('Runtime separates configuration, connection and access without removing editable fields or lifecycle guards', () => {
  const editor = source('components/services/RuntimeEditor.vue')
  for (const id of ['runtime-basic-title', 'runtime-network-title', 'runtime-access-title']) assert.match(editor, new RegExp(`aria-labelledby="${id}"`))
  for (const binding of ['draft.name', 'draft.port', 'draft.host', 'draft.workspace', 'draft.network.public_url', 'draft.network.provider', 'draft.remember_secrets']) assert(editor.includes(binding), binding)
  assert.match(editor, /:disabled="busy \|\| lifecycleBusy \|\| locked"/)
  assert.match(editor, /:disabled="busy \|\| lifecycleAction === 'stop'"/)
  assert.match(editor, /emit\('toggleRunning'\)/)
  assert.match(editor, /emit\('copyUrl', runtimeUrl\)/)
  assert.match(editor, /v-if="runtimeUrl" class="connection-url"/)
  assert.match(editor, /:disabled="!runtimeUrl"/)
  assert.match(editor, /:span="hasProtocolOption \? '1' : '2'"/)
  assert.match(editor, /:span="field.key === 'protocol' \? '1' : field.span"/)
  assert.match(editor, /draft\.value\.network\.secret_actions\[key\] = clearing \? 'unchanged' : 'clear'/)
  assert.match(editor, /draft\.value\.oauth_password_action = clearing \? 'unchanged' : 'clear'/)
})

test('Navigation preserves route access, active state, language selection and collapse persistence', () => {
  const sidebar = source('components/AppSidebar.vue')
  for (const route of ['runtime', 'plugins', 'logs', 'about']) assert(sidebar.includes(`router.push({ name: '${route}' })`))
  assert.match(sidebar, /:aria-current=/)
  assert.match(sidebar, /app-sidebar-collapsed/)
  assert.match(sidebar, /id="app-language"/)
  assert.match(sidebar, /:aria-expanded="!collapsed"/)
})

test('Approval remains an explicit decision with an inert background and trapped keyboard focus', () => {
  const app = source('App.vue')
  assert.match(app, /<FocusScope as-child :trapped="true" :loop="true">/)
  assert.match(app, /:inert="Boolean\(activePermissionRequest\)"/)
  assert.match(app, /role="dialog"/)
  assert.match(app, /aria-modal="true"/)
  for (const decision of ['deny', 'once', 'session']) assert(app.includes(`respondPermission('${decision}')`))
  assert.doesNotMatch(app.split('<template>')[0], /respondPermission\(/)
  assert.match(app, /href="#main-content"/)
  assert.match(app, /id="main-content" tabindex="-1"/)
})

test('Theme tokens cover both schemes and layouts have narrow-screen and reduced-motion fallbacks', () => {
  const css = source('styles.css')
  const light = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'))
  const dark = css.slice(css.indexOf('.dark {'), css.indexOf('* {'))
  for (const token of ['background', 'foreground', 'card', 'primary', 'primary-foreground', 'muted-foreground', 'border', 'input', 'ring']) {
    assert(light.includes(`--${token}:`), `light ${token}`)
    assert(dark.includes(`--${token}:`), `dark ${token}`)
  }
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /\.app-main \{[^}]*overflow: auto/)
  assert.match(css, /min-width: 360px/)
  assert.match(css, /grid-template-areas: "connection connection" "basic access" "network access"/)
  assert.match(css, /grid-template-areas: "connection" "basic" "network" "access"/)
  assert.doesNotMatch(css, /display: contents/)
})

test('Log text remains selectable and escaped, and empty state does not fabricate output', () => {
  const panel = source('components/LogPanel.vue')
  assert.match(panel, /v-if="logs.length"/)
  assert.match(panel, /\{\{ item.message \}\}/)
  assert.match(panel, /v-else class="log-empty"/)
  assert.doesNotMatch(panel, /v-html/)
  assert.match(source('styles.css'), /user-select: text/)
})

test('Connection URL spans both columns, wraps without truncation and retains exact-copy binding', () => {
  const css = source('styles.css')
  const address = css.match(/\.connection-address \{([^}]+)\}/)[1]
  const url = css.match(/\.connection-url \{([^}]+)\}/)[1]
  assert.match(address, /grid-column: 1 \/ -1/)
  assert.match(address, /min-width: 0/)
  assert.match(url, /white-space: pre-wrap/)
  assert.match(url, /overflow-wrap: anywhere/)
  assert.doesNotMatch(url, /text-overflow:|line-clamp|(?:^|[; ])(?:max-)?height:|overflow: hidden/)
  const editor = source('components/services/RuntimeEditor.vue')
  assert.match(editor, /class="connection-address"/)
  assert.match(editor, /\{\{ runtimeUrl \}\}/)
  assert.match(editor, /emit\('copyUrl', runtimeUrl\)/)
})

test('Secondary pages use explicit layout groups without remounting drafts or changing update decisions', () => {
  const plugins = source('components/PluginHomeView.vue')
  const extensions = source('components/services/PiExtensionManager.vue')
  assert.match(plugins, /class="plugins-overview"/)
  assert.match(plugins, /ref="computerUse"/)
  assert.match(plugins, /ref="extensions"/)
  assert.doesNotMatch(plugins, /<(?:ComputerUseSettings|PiExtensionManager)[^>]*:key=/)
  for (const id of ['mcp-services-title', 'skills-title']) assert(extensions.includes(`aria-labelledby="${id}"`))
  assert.match(extensions, /'is-editing': form !== ''/)
  assert.match(source('components/services/PiSkillEditor.vue'), /<details class="settings-panel skill-documents">/)
  const logs = source('components/LogView.vue')
  assert.doesNotMatch(logs, /class="page-description"/)
  const about = source('components/AboutView.vue')
  for (const group of ['about-layout', 'about-identity', 'about-controls', 'about-update', 'about-download']) assert(about.includes(group))
  for (const event of ['check', 'install', 'restart', 'savePrefix']) assert(about.includes(`$emit('${event}')`))
  assert.match(about, /busy \|\| update.phase === 'installed'/)
  assert.match(about, /update\.phase === 'installed'/)
  const css = source('styles.css')
  assert.match(css, /\.extension-sections\.is-editing \{ grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /\.logs-page \{[^}]*height: calc\(100dvh - 80px\)/)
})

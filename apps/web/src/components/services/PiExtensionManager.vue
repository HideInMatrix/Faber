<script setup lang="ts">
import { t } from '../../composables/useLocale'

import { onMounted, ref, computed, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import PiSkillEditor from './PiSkillEditor.vue'
import { desktopApi } from '../../api/desktop'
import type { PiExtensionConfigurationDto, PiExtensionsDto, PiMcpConnectionDto, PiSkillImportPreviewDto, PiSkillSourceDto } from '../../types'

const emit = defineEmits<{ changed: [] }>()
const state = ref<PiExtensionsDto | null>(null)
const busy = ref(false)
const form = ref<'mcp' | 'skill' | ''>('')
const mcp = ref(newConnection())
const argsText = ref('[]')
const envText = ref('{}')
const headersText = ref('{}')
const skillId = ref('')
const skillPath = ref('')
const skillDescription = ref('')
const skillInstructions = ref('')
const skillMode = ref<'import' | 'create'>('import')
const skillPreview = ref<PiSkillImportPreviewDto | null>(null)
const selectedSkills = ref<string[]>([])
const replacingSkillSource = ref<string | undefined>(undefined)
const newSkillCandidates = computed(() => skillPreview.value?.candidates.filter(item => item.status === 'new') ?? [])
const skillImportCapacity = computed(() => Math.max(0, 100 - (state.value?.configuration.skills.length ?? 0) + (replacingSkillSource.value ? 1 : 0)))
watch([skillPath, skillMode], () => { skillPreview.value = null; selectedSkills.value = [] }, { flush: 'sync' })
const editingId = ref('')
const credentials = ref<Record<string, string | null>>(Object.create(null))
const credentialKeys = computed(() => {
  try {
    const references = mcp.value.transport === 'stdio' ? Object.values(JSON.parse(envText.value)) : Object.values(JSON.parse(headersText.value)).flatMap(value => [...String(value).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]))
    return [...new Set(references)].filter((name): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
  } catch { return [] }
})
const configuredKeys = computed(() => state.value?.mcp_status?.[mcp.value.id]?.keys ?? [])
function credentialUpdates() { return Object.fromEntries(Object.entries(credentials.value).filter(([, value]) => value === null || Boolean(value))) }
async function refreshTools(id: string) { await action(async () => { await desktopApi.refreshPiMcp(id); toast.success(t("工具目录已刷新")) }) }
async function logout(id: string) { await action(async () => { await desktopApi.logoutPiMcp(id) }) }
async function cancelLogin(id: string) { await action(async () => { await desktopApi.cancelPiMcpLogin(id) }) }
async function oauth(id: string) {
  await action(async () => {
    const result = await desktopApi.loginPiMcp(id)
    try { await desktopApi.openAuthorizationUrl(result.url) }
    catch (error) { await desktopApi.cancelPiMcpLogin(id); throw error }
    toast.success(t("请在浏览器完成授权；授权完成后点击 Runtime 启动。"))
  })
}
const fieldClass = 'extension-input mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50'

function newConnection(): PiMcpConnectionDto {
  return { id: '', name: '', enabled: true, transport: 'stdio', command: '', args: [], url: '', envRefs: {}, headers: {}, auth: 'none' }
}
async function refresh() {
  state.value = await desktopApi.piExtensions()
}
async function action(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  try { await work(); await refresh(); emit('changed') }
  catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  finally { busy.value = false }
}
async function save(configuration: PiExtensionConfigurationDto) {
  await desktopApi.configurePiExtensions(configuration)
  toast.success(t("Pi 扩展配置已保存；点击 Runtime 启动后加载。"))
}
function editConnection(connection?: PiMcpConnectionDto) {
  mcp.value = connection ? { auth: 'none', ...connection, args: [...connection.args], envRefs: { ...connection.envRefs }, headers: { ...connection.headers } } : newConnection()
  if ((connection?.id ?? '') !== editingId.value) credentials.value = Object.create(null)
  editingId.value = connection?.id ?? ''
  argsText.value = JSON.stringify(mcp.value.args, null, 2)
  envText.value = JSON.stringify(mcp.value.envRefs, null, 2)
  headersText.value = JSON.stringify(mcp.value.headers, null, 2)
  form.value = 'mcp'
}
function connectionDraft(): PiMcpConnectionDto {
  const stdio = mcp.value.transport === 'stdio'
  return { ...mcp.value, args: stdio ? JSON.parse(argsText.value) : [], envRefs: stdio ? JSON.parse(envText.value) : {}, headers: stdio ? {} : JSON.parse(headersText.value) }
}
async function saveMcp() {
  await action(async () => {
    const configuration = state.value!.configuration
    const connection = connectionDraft()
    if (connection.id === 'computer_use') throw new Error(t("Computer Use 已内置，请使用上方开关，不要添加重复服务。"))
    if (configuration.mcp.some(item => item.id === connection.id && item.id !== editingId.value)) throw new Error(t("MCP ID 已存在"))
    await save({ ...configuration, mcp: [...configuration.mcp.filter(item => item.id !== editingId.value), connection] })
    const updates = credentialUpdates()
    if (Object.keys(updates).length) await desktopApi.setPiMcpCredentials(connection.id, updates)
    editingId.value = connection.id
    // Keep entered secrets in this editor after saving, never blank them.
  })
}
async function testMcp() {
  await action(async () => {
    const draft = connectionDraft()
    if (Object.keys(credentialUpdates()).length) {
      if (!editingId.value) throw new Error(t("填入本地密钥后请先保存，再测试连接。"))
      await desktopApi.setPiMcpCredentials(editingId.value, credentialUpdates())
    }
    const result = await desktopApi.testPiMcp(draft)
    toast.success(t("连接成功，发现 {value0} 个工具；测试连接已关闭。", { value0: result.tools.length }))
  })
}
async function saveSkill() {
  await action(async () => {
    const id = skillId.value.trim()
    if (skillMode.value === 'create') await desktopApi.createPiSkill(id, skillDescription.value, skillInstructions.value)
    else {
      if (!skillPreview.value || !selectedSkills.value.length) throw new Error(t("请先扫描目录并选择要添加的 Skill。"))
      const count = await desktopApi.importPiSkills(skillPreview.value.path, selectedSkills.value, replacingSkillSource.value)
      toast.success(t("已添加 {value0} 个独立 Skill 配置；下次启动 Runtime 加载。", { value0: count }))
    }
    if (skillMode.value === 'create') toast.success(t("Skill 已添加，启动后由 Pi 加载。"))
    form.value = ''
  })
}
function openSkillImport(source?: PiSkillSourceDto) {
  replacingSkillSource.value = source?.id
  skillMode.value = 'import'
  skillPath.value = source?.path ?? ''
  skillPreview.value = null
  selectedSkills.value = []
  form.value = 'skill'
  if (source) void scanSkills()
}
async function scanSkills() {
  await action(async () => {
    skillPreview.value = null
    selectedSkills.value = []
    skillPreview.value = await desktopApi.previewPiSkillImport(skillPath.value.trim(), replacingSkillSource.value)
    selectAllSkills()
  })
}
function selectAllSkills() {
  selectedSkills.value = newSkillCandidates.value.slice(0, skillImportCapacity.value).map(item => item.path)
}
async function chooseSkillPath() {
  await action(async () => { const selected = await desktopApi.chooseWorkspace(skillPath.value); if (selected) skillPath.value = selected })
}
async function changeEnabled(kind: 'mcp' | 'skills', id: string, enabled: boolean) {
  await action(async () => {
    const configuration = state.value!.configuration
    await save({ ...configuration, [kind]: configuration[kind].map(item => item.id === id ? { ...item, enabled } : item) })
  })
}
async function remove(kind: 'mcp' | 'skills', id: string) {
  await action(async () => {
    const configuration = state.value!.configuration
    await save({ ...configuration, [kind]: configuration[kind].filter(item => item.id !== id) })
  })
}
onMounted(() => {
  void refresh().catch(error => toast.error(error instanceof Error ? error.message : String(error)))
})
defineExpose({ refresh: () => action(async () => {}) })
</script>

<template>
  <section :class="['extension-sections', { 'is-editing': form !== '' }]">
    <section class="settings-panel extension-group" aria-labelledby="mcp-services-title">
    <div class="extension-group-heading">
      <h2 id="mcp-services-title">{{ t("MCP 服务") }}</h2>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="busy || !state || state.running" @click="editConnection()">{{ t("添加 MCP") }}</Button>
      </div>
    </div>
    <div v-if="form === 'mcp'" class="extension-editor mt-4 rounded-xl border border-border bg-card p-4">
      <fieldset :disabled="busy || !state || state.running" class="space-y-4 disabled:opacity-60">
          <h3 class="m-0 text-sm font-medium">{{ t(editingId ? '编辑 MCP 服务' : '添加 MCP 服务') }}</h3>
          <div class="grid grid-cols-2 gap-4">
            <label class="text-xs">ID<input v-model="mcp.id" :class="fieldClass" placeholder="docs_mcp" :disabled="Boolean(editingId)" /></label>
            <label class="text-xs">{{ t("名称") }}<input v-model="mcp.name" :class="fieldClass" :placeholder="t('文档服务')" /></label>
          </div>
          <label class="block text-xs">{{ t("传输") }}<select v-model="mcp.transport" :class="fieldClass"><option value="stdio">{{ t("stdio · 本地子进程") }}</option><option value="http">Streamable HTTP</option></select></label>
          <template v-if="mcp.transport === 'stdio'">
            <label class="block text-xs">{{ t("可执行程序") }}<input v-model="mcp.command" :class="fieldClass" :placeholder="t('npx 或绝对路径（不是 shell 命令）')" /></label>
            <label class="block text-xs">{{ t("参数 JSON 数组") }}<textarea v-model="argsText" :class="[fieldClass, 'h-20 py-2 font-mono']" placeholder='["-y", "your-mcp-package"]' /></label>
            <label class="block text-xs">{{ t("环境变量引用 JSON") }}<textarea v-model="envText" :class="[fieldClass, 'h-20 py-2 font-mono']" placeholder='{"API_KEY":"MY_API_KEY"}' /></label>
          </template>
          <template v-else>
            <label class="block text-xs">{{ t("MCP 地址") }}<input v-model="mcp.url" :class="fieldClass" placeholder="https://example.com/mcp" /></label>
            <label class="block text-xs">{{ t("认证") }}<select v-model="mcp.auth" :class="fieldClass"><option value="none">{{ t("无 / Header 密钥") }}</option><option value="oauth">{{ t("OAuth · CIMD 浏览器授权") }}</option></select></label>
            <template v-if="mcp.auth === 'oauth'">
              <label class="block text-xs">{{ t("自己的 CIMD 文档 URL") }}<input v-model="mcp.clientMetadataUrl" :class="fieldClass" placeholder="https://your-domain.example/oauth/client.json" /></label>
              <label class="block text-xs">{{ t("文档中登记的本机回调") }}<input v-model="mcp.oauthRedirectUri" :class="fieldClass" placeholder="http://127.0.0.1:18456/oauth/callback" /></label>
              <details class="text-xs leading-5 text-muted-foreground">
                <summary class="cursor-pointer">{{ t("CIMD 配置要求") }}</summary>
                <p class="mt-2">{{ t("自行托管公开 HTTPS JSON，client_id 等于文档 URL，redirect_uris 包含准确的本机回调，且端口空闲。不能使用其他应用的元数据；不支持 DCR-only 服务。") }}</p>
              </details>
            </template>
            <label class="block text-xs">{{ t("Header 引用 JSON") }}<textarea v-model="headersText" :class="[fieldClass, 'h-20 py-2 font-mono']" placeholder='{"Authorization":"Bearer ${MY_TOKEN}"}' /></label>
          </template>
          <div v-if="credentialKeys.length" class="space-y-2 rounded-lg border border-border p-4">
            <p class="text-xs leading-5 text-muted-foreground">{{ t("留空保留，清除删除。启用本机保存后写入本地文件，非系统钥匙串。") }}</p>
            <div v-for="key in credentialKeys" :key="key" class="flex items-end gap-2">
              <label class="flex-1 text-xs">{{ key }} {{ configuredKeys.includes(key) ? t("· 已配置") : '' }}<input :value="credentials[key] ?? ''" type="password" autocomplete="off" :class="fieldClass" :placeholder="t('留空保留 / 使用服务环境变量')" @input="credentials[key] = ($event.target as HTMLInputElement).value" /></label>
              <Button size="sm" variant="outline" @click="credentials[key] = null">{{ t("清除") }}</Button>
            </div>
          </div>
          <div class="flex justify-end gap-2"><Button size="sm" variant="outline" @click="form = ''">{{ t("取消") }}</Button><Button size="sm" variant="outline" @click="testMcp">{{ t("测试连接") }}</Button><Button size="sm" @click="saveMcp">{{ t("保存") }}</Button></div>
      </fieldset>
    </div>
    <div v-if="state" class="extension-list">
      <div v-for="connection in state.configuration.mcp" :key="`mcp:${connection.id}`" class="extension-row">
        <div class="extension-identity"><div class="text-sm font-medium">{{ connection.name }}</div><div class="mt-1 truncate text-xs text-muted-foreground" :title="connection.url || connection.command">MCP · {{ connection.id }} · {{ connection.transport }} · {{ connection.url || connection.command }}</div></div>
        <div class="text-xs text-muted-foreground">{{ state.mcp_status?.[connection.id]?.status ?? 'stopped' }}<span v-if="connection.auth === 'oauth'"> · OAuth {{ state.mcp_status?.[connection.id]?.oauth ?? 'logged_out' }}</span><div>{{ state.mcp_status?.[connection.id]?.message }}</div></div>
        <Button v-if="state.running && connection.enabled" size="sm" variant="ghost" :disabled="busy" @click="refreshTools(connection.id)">{{ t("刷新工具") }}</Button>
        <template v-if="connection.auth === 'oauth'">
          <Button size="sm" variant="ghost" :disabled="busy || state.running" @click="oauth(connection.id)">{{ t("授权登录") }}</Button>
          <Button size="sm" variant="ghost" :disabled="busy || state.running" @click="logout(connection.id)">{{ t("注销") }}</Button>
          <Button v-if="state.mcp_status?.[connection.id]?.oauth === 'pending'" size="sm" variant="ghost" :disabled="busy" @click="cancelLogin(connection.id)">{{ t("取消授权") }}</Button>
        </template>
        <Button size="sm" variant="ghost" :disabled="busy || state.running" @click="editConnection(connection)">{{ t("编辑") }}</Button>
        <Button size="sm" variant="ghost" :disabled="busy || state.running" @click="remove('mcp', connection.id)">{{ t("移除") }}</Button>
        <Switch :model-value="connection.enabled" :disabled="busy || state.running" :aria-label="t('启停 MCP {value0}', { value0: connection.name })" @update:model-value="value => changeEnabled('mcp', connection.id, value)" />
      </div>
      <div v-if="!state.configuration.mcp.length" class="px-4 py-5 text-center text-xs text-muted-foreground">{{ t("暂无外部 MCP 服务") }}</div>
    </div>
    </section>
    <section class="settings-panel extension-group" aria-labelledby="skills-title">
    <div class="extension-group-heading">
      <h2 id="skills-title">Skills</h2>
      <Button size="sm" variant="outline" :disabled="busy || !state || state.running" @click="openSkillImport()">{{ t("添加 Skill") }}</Button>
    </div>
    <div v-if="form === 'skill'" class="extension-editor mt-4 rounded-xl border border-border bg-card p-4">
      <fieldset :disabled="busy || !state || state.running" class="space-y-4 disabled:opacity-60">
          <h3 class="m-0 text-sm font-medium">{{ t("添加标准 Pi Skill") }}</h3>
          <label class="block text-xs">{{ t("方式") }}<select v-model="skillMode" :disabled="Boolean(replacingSkillSource)" :class="fieldClass"><option value="import">{{ t("导入本地 Skill 目录 / SKILL.md") }}</option><option value="create">{{ t("创建 SKILL.md") }}</option></select></label>
          <div v-if="skillMode === 'import'">
            <label class="block text-xs">{{ t("绝对路径") }}<div class="flex items-end gap-2"><input v-model="skillPath" :class="fieldClass" placeholder="/path/to/skills" /><Button size="sm" variant="outline" @click="chooseSkillPath">{{ t("选择目录") }}</Button></div></label>
            <p class="mt-2 text-xs text-muted-foreground">{{ t("仅引用原目录，不复制或删除文件。") }}</p>
            <p class="mt-2 text-xs text-muted-foreground">{{ t("扫描后按文件夹名生成独立配置；Skill 名称仍取自文档，每项可单独启停和移除。") }}</p>
            <p v-if="replacingSkillSource" class="mt-2 text-xs text-muted-foreground">{{ t("确认添加后将替换原目录引用；未选中的 Skill 不再由该来源加载，取消则保持原配置。") }}</p>
            <Button class="mt-4" size="sm" variant="outline" :disabled="!skillPath.trim()" @click="scanSkills">{{ t("扫描目录") }}</Button>
            <div v-if="skillPreview" class="mt-4 space-y-4 rounded-lg border border-border p-4">
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{{ t("发现 {value0} 个 Skill，已选择 {value1} 个。", { value0: skillPreview.candidates.length, value1: selectedSkills.length }) }}</span>
                <div class="flex gap-2"><Button size="sm" variant="ghost" @click="selectAllSkills">{{ t("全选可添加项") }}</Button><Button size="sm" variant="ghost" @click="selectedSkills = []">{{ t("取消全选") }}</Button></div>
              </div>
              <p v-if="!skillPreview.candidates.length" class="text-xs text-muted-foreground">{{ t("未发现可加载的 Skill，请检查 SKILL.md 和描述字段。") }}</p>
              <p v-if="newSkillCandidates.length > skillImportCapacity" class="text-xs text-muted-foreground">{{ t("最多保留 100 个独立配置，本次还能添加 {value0} 个。", { value0: skillImportCapacity }) }}</p>
              <div class="max-h-80 space-y-2 overflow-y-auto">
                <label v-for="candidate in skillPreview.candidates" :key="candidate.path" class="flex items-start gap-4 rounded-lg border border-border p-4 text-xs">
                  <input v-model="selectedSkills" type="checkbox" :value="candidate.path" :aria-label="t('选择 Skill {value0}', { value0: candidate.id })" :disabled="candidate.status !== 'new' || (!selectedSkills.includes(candidate.path) && selectedSkills.length >= skillImportCapacity)" />
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="font-medium">{{ candidate.id }} <span class="font-normal text-muted-foreground">{{ candidate.name }}</span></div>
                    <div v-if="candidate.status !== 'new'" class="text-muted-foreground">{{ candidate.status === 'existing' ? t('已配置，跳过（含已停用的配置）') : t('Skill 名称冲突，不能重复添加') }}</div>
                    <div class="text-muted-foreground">{{ candidate.description }}</div>
                    <div class="break-all text-muted-foreground">{{ candidate.path }}</div>
                    <div v-for="warning in candidate.warnings" :key="warning" class="text-muted-foreground">{{ warning }}</div>
                  </div>
                </label>
              </div>
              <details v-if="skillPreview.diagnostics.length" class="text-xs text-muted-foreground"><summary>{{ t("扫描警告") }}</summary><div v-for="item in skillPreview.diagnostics" :key="`${item.path}:${item.message}`" class="mt-2 break-all">{{ item.path }} · {{ item.message }}</div></details>
            </div>
          </div>
          <template v-else>
            <label class="block text-xs">{{ t("来源 ID") }}<input v-model="skillId" :class="fieldClass" maxlength="64" placeholder="my-skill" /></label>
            <label class="block text-xs">{{ t("描述") }}<input v-model="skillDescription" :class="fieldClass" /></label>
            <label class="block text-xs">{{ t("方法说明") }}<textarea v-model="skillInstructions" :class="[fieldClass, 'h-40 py-2']" /></label>
          </template>
          <div class="flex justify-end gap-2"><Button size="sm" variant="outline" @click="form = ''">{{ t("取消") }}</Button><Button size="sm" :disabled="skillMode === 'import' && (!skillPreview || !selectedSkills.length)" @click="saveSkill">{{ skillMode === 'import' ? t('添加所选 Skill') : t('添加') }}</Button></div>
      </fieldset>
    </div>
    <div v-if="state" class="extension-list">
      <div v-for="source in state.configuration.skills" :key="`skill:${source.id}`" class="extension-row">
        <div class="extension-identity"><div class="text-sm font-medium">{{ source.id }}</div><div class="mt-1 truncate text-xs text-muted-foreground" :title="source.path">{{ t("Skill 来源 ·") }} {{ source.path }}</div></div>
        <Button v-if="!source.path.toLowerCase().endsWith('.md')" size="sm" variant="ghost" :disabled="busy || state.running" @click="openSkillImport(source)">{{ t("拆分目录") }}</Button>
        <Button size="sm" variant="ghost" :disabled="busy || state.running" @click="remove('skills', source.id)">{{ t("移除引用") }}</Button>
        <Switch :model-value="source.enabled" :disabled="busy || state.running" :aria-label="t('启停 Skill 来源 {value0}', { value0: source.id })" @update:model-value="value => changeEnabled('skills', source.id, value)" />
      </div>
      <div v-if="!state.configuration.skills.length" class="px-4 py-5 text-center text-xs text-muted-foreground">{{ t("暂无 Skills") }}</div>
    </div>
    <div v-if="state?.skill_diagnostics?.length" class="mt-4 rounded-xl border border-border bg-card p-4 text-xs" role="status">
      <h3 class="m-0 font-medium">{{ t("Skill 导入警告（不阻止其他文档加载）") }}</h3>
      <div v-for="diagnostic in state.skill_diagnostics" :key="`${diagnostic.path}:${diagnostic.message}`" class="mt-2 break-all text-muted-foreground">
        <div>{{ diagnostic.path }}</div><div>{{ diagnostic.message }}</div>
      </div>
    </div>
    </section>
    <PiSkillEditor v-if="state && state.configuration.skills.length" :key="JSON.stringify(state.configuration.skills)" :running="state.running" @changed="emit('changed')" />
  </section>
</template>

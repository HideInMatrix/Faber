<script setup lang="ts">
import { t } from '../../composables/useLocale'

import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import PiSkillEditor from './PiSkillEditor.vue'
import McpConnectionEditor from './McpConnectionEditor.vue'
import { desktopApi } from '../../api/desktop'
import type { PiExtensionConfigurationDto, PiExtensionsDto, PiMcpConnectionDto, PiSkillImportPreviewDto, PiSkillSourceDto } from '../../types'

const emit = defineEmits<{ changed: [] }>()
const state = ref<PiExtensionsDto | null>(null)
const busy = ref(false)
const form = ref<'mcp' | 'skill' | ''>('')
const editingMcp = ref<PiMcpConnectionDto | null>(null)
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
const fieldClass = 'mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50'
function connectionStatus(id: string) {
  const status = state.value?.mcp_status?.[id]
  if (status?.oauth === 'pending') return t('待授权')
  if (status?.oauth === 'failed') return t('授权失败')
  return t(({ stopped: '未连接', connecting: '连接中', connected: '已连接', disconnected: '连接已断开', tested: '测试通过', test_failed: '测试失败', error: '连接失败' } as Record<string,string>)[status?.status ?? 'stopped'] ?? '未连接')
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
  editingMcp.value = connection ? JSON.parse(JSON.stringify(connection)) as PiMcpConnectionDto : null
  form.value = 'mcp'
}
async function mcpSaved() { form.value = ''; await refresh(); emit('changed') }
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
let statusTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refresh().catch(error => toast.error(error instanceof Error ? error.message : String(error)))
  statusTimer = setInterval(() => { if (!busy.value) void refresh().catch(() => {}) }, 3000)
})
onUnmounted(() => clearInterval(statusTimer))
defineExpose({ refresh: () => action(async () => {}) })
</script>

<template>
  <section class="mt-6">
    <div class="flex items-center justify-between gap-3">
      <h2 class="m-0 text-sm font-medium">{{ t("MCP 服务") }}</h2>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" :disabled="busy || !state || state?.running" @click="editConnection()">{{ t("添加 MCP") }}</Button>
      </div>
    </div>
    <McpConnectionEditor v-if="form === 'mcp'" :key="editingMcp?.id || 'new'" :connection="editingMcp" :connections="state?.configuration.mcp ?? []" :locked="busy || Boolean(state?.running)" @saved="mcpSaved" @cancel="form = ''" />
    <div v-if="state" class="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
    <div v-for="connection in state?.configuration.mcp ?? []" :key="`mcp:${connection.id}`" class="flex flex-wrap items-center gap-2 px-4 py-3">
        <div class="min-w-0 basis-40 flex-1"><div class="text-sm font-medium">{{ connection.name }}</div><div class="mt-1 truncate text-xs text-muted-foreground">MCP · {{ connection.id }} · {{ connection.transport }} · {{ connection.url || connection.command }}</div></div>
        <div class="max-w-lg text-xs text-muted-foreground">{{ connectionStatus(connection.id) }}<span v-if="connection.auth === 'oauth'"> · {{ state?.mcp_status?.[connection.id]?.oauth === 'authorized' ? t('已授权') : t('需要授权') }}</span><span v-if="['connected','tested'].includes(state?.mcp_status?.[connection.id]?.status ?? '')"> · {{ t('{value0} 个工具', { value0: state?.mcp_status?.[connection.id]?.toolCount ?? 0 }) }}</span><div class="mt-1 break-words">{{ state?.mcp_status?.[connection.id]?.message }}</div></div>
        <Button v-if="state?.running && connection.enabled" size="sm" variant="ghost" :disabled="busy" @click="refreshTools(connection.id)">{{ t("刷新工具") }}</Button>
        <template v-if="connection.auth === 'oauth'">
          <Button size="sm" variant="ghost" :disabled="busy || state?.running" @click="oauth(connection.id)">{{ t("授权登录") }}</Button>
          <Button size="sm" variant="ghost" :disabled="busy || state?.running" @click="logout(connection.id)">{{ t("注销") }}</Button>
          <Button v-if="state?.mcp_status?.[connection.id]?.oauth === 'pending'" size="sm" variant="ghost" :disabled="busy" @click="cancelLogin(connection.id)">{{ t("取消授权") }}</Button>
        </template>
        <Button size="sm" variant="ghost" :disabled="busy || state?.running" @click="editConnection(connection)">{{ t("编辑") }}</Button>
        <Button size="sm" variant="ghost" :disabled="busy || state?.running" @click="remove('mcp', connection.id)">{{ t("移除") }}</Button>
        <Switch :model-value="connection.enabled" :disabled="busy || Boolean(state?.running)" :aria-label="t('启停 MCP {value0}', { value0: connection.name })" @update:model-value="value => changeEnabled('mcp', connection.id, value)" />
      </div>
      <div v-if="!state.configuration.mcp.length" class="px-4 py-5 text-center text-xs text-muted-foreground">{{ t("暂无外部 MCP 服务") }}</div>
    </div>
    <div class="mt-6 flex items-center justify-between gap-3">
      <h2 class="m-0 text-sm font-medium">Skills</h2>
      <Button size="sm" variant="outline" :disabled="busy || !state || state?.running" @click="openSkillImport()">{{ t("添加 Skill") }}</Button>
    </div>
    <div v-if="form === 'skill'" class="mt-3 rounded-xl border border-border bg-card p-4">
      <fieldset :disabled="busy || !state || state?.running" class="space-y-3 disabled:opacity-60">
          <h3 class="m-0 text-sm font-medium">{{ t("添加标准 Pi Skill") }}</h3>
          <label class="block text-xs">{{ t("方式") }}<select v-model="skillMode" :disabled="Boolean(replacingSkillSource)" :class="fieldClass"><option value="import">{{ t("导入本地 Skill 目录 / SKILL.md") }}</option><option value="create">{{ t("创建 SKILL.md") }}</option></select></label>
          <div v-if="skillMode === 'import'">
            <label class="block text-xs">{{ t("绝对路径") }}<div class="flex items-end gap-2"><input v-model="skillPath" :class="fieldClass" placeholder="/path/to/skills" /><Button size="sm" variant="outline" @click="chooseSkillPath">{{ t("选择目录") }}</Button></div></label>
            <p class="mt-2 text-xs text-muted-foreground">{{ t("仅引用原目录，不复制或删除文件。") }}</p>
            <p class="mt-2 text-xs text-muted-foreground">{{ t("扫描后按文件夹名生成独立配置；Skill 名称仍取自文档，每项可单独启停和移除。") }}</p>
            <p v-if="replacingSkillSource" class="mt-2 text-xs text-muted-foreground">{{ t("确认添加后将替换原目录引用；未选中的 Skill 不再由该来源加载，取消则保持原配置。") }}</p>
            <Button class="mt-3" size="sm" variant="outline" :disabled="!skillPath.trim()" @click="scanSkills">{{ t("扫描目录") }}</Button>
            <div v-if="skillPreview" class="mt-3 space-y-3 rounded-lg border border-border p-3">
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>{{ t("发现 {value0} 个 Skill，已选择 {value1} 个。", { value0: skillPreview.candidates.length, value1: selectedSkills.length }) }}</span>
                <div class="flex gap-2"><Button size="sm" variant="ghost" @click="selectAllSkills">{{ t("全选可添加项") }}</Button><Button size="sm" variant="ghost" @click="selectedSkills = []">{{ t("取消全选") }}</Button></div>
              </div>
              <p v-if="!skillPreview.candidates.length" class="text-xs text-muted-foreground">{{ t("未发现可加载的 Skill，请检查 SKILL.md 和描述字段。") }}</p>
              <p v-if="newSkillCandidates.length > skillImportCapacity" class="text-xs text-muted-foreground">{{ t("最多保留 100 个独立配置，本次还能添加 {value0} 个。", { value0: skillImportCapacity }) }}</p>
              <div class="max-h-80 space-y-2 overflow-y-auto">
                <label v-for="candidate in skillPreview.candidates" :key="candidate.path" class="flex items-start gap-3 rounded-lg border border-border p-3 text-xs">
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
    <div v-if="state" class="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
      <div v-for="source in state.configuration.skills" :key="`skill:${source.id}`" class="flex flex-wrap items-center gap-2 px-4 py-3">
        <div class="min-w-0 basis-40 flex-1"><div class="text-sm font-medium">{{ source.id }}</div><div class="mt-1 truncate text-xs text-muted-foreground">{{ t("Skill 来源 ·") }} {{ source.path }}</div></div>
        <Button v-if="!source.path.toLowerCase().endsWith('.md')" size="sm" variant="ghost" :disabled="busy || state?.running" @click="openSkillImport(source)">{{ t("拆分目录") }}</Button>
        <Button size="sm" variant="ghost" :disabled="busy || state?.running" @click="remove('skills', source.id)">{{ t("移除引用") }}</Button>
        <Switch :model-value="source.enabled" :disabled="busy || state?.running" :aria-label="t('启停 Skill 来源 {value0}', { value0: source.id })" @update:model-value="value => changeEnabled('skills', source.id, value)" />
      </div>
      <div v-if="!state.configuration.skills.length" class="px-4 py-5 text-center text-xs text-muted-foreground">{{ t("暂无 Skills") }}</div>
    </div>
    <div v-if="state?.skill_diagnostics?.length" class="mt-3 rounded-xl border border-border bg-card p-4 text-xs" role="status">
      <h3 class="m-0 font-medium">{{ t("Skill 导入警告（不阻止其他文档加载）") }}</h3>
      <div v-for="diagnostic in state.skill_diagnostics" :key="`${diagnostic.path}:${diagnostic.message}`" class="mt-2 break-all text-muted-foreground">
        <div>{{ diagnostic.path }}</div><div>{{ diagnostic.message }}</div>
      </div>
    </div>
    <PiSkillEditor v-if="state && state.configuration.skills.length" :key="JSON.stringify(state.configuration.skills)" :running="state?.running" @changed="emit('changed')" />
  </section>
</template>

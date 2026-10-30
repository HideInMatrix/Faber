<script setup lang="ts">
import { t } from '../../composables/useLocale'

import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { computerPermissionLabel } from '../../lib/computer-use-permissions'
import { desktopApi } from '../../api/desktop'
import { updateInstallationLocked } from '../../composables/useAppUpdater'
import type { ComputerUseStatusDto } from '../../types'

const props = defineProps<{ locked?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const status = ref<ComputerUseStatusDto | null>(null)
const busy = ref(false)
const loadingError = ref('')
const browserEndpoint = ref('')
const browserMode = ref<'attach' | 'managed'>('managed')
const browserChannel = ref<'chrome' | 'msedge' | 'chromium'>('chrome')
const browserProfile = ref('default')
const browserStartUrl = ref('')
const browserOrigins = ref('')
const browserDirty = ref(false)
const browserError = ref('')
function loadBrowser() {
  if (browserDirty.value) return
  const browser = status.value?.browser
  browserMode.value = browser?.mode === 'managed' || !browser ? 'managed' : 'attach'
  browserEndpoint.value = browser && browser.mode !== 'managed' ? browser.endpoint : ''
  browserOrigins.value = browser?.allowedOrigins.join('\n') ?? ''
  browserChannel.value = browser?.mode === 'managed' ? browser.channel ?? 'chrome' : 'chrome'
  browserProfile.value = browser?.mode === 'managed' ? browser.profile ?? 'default' : 'default'
  browserStartUrl.value = browser?.mode === 'managed' ? browser.startUrl ?? '' : ''
}
const granted = computed(() => status.value?.platform === 'macos'
  ? status.value.permission?.accessibility === true : status.value?.permission?.interactiveDesktop === true)
const locked = computed(() => busy.value || props.locked || status.value?.running || updateInstallationLocked.value)
const permissionLabel = computed(() => t(computerPermissionLabel(status.value, loadingError.value)))

async function refresh() {
  status.value = await desktopApi.computerUseStatus()
  loadingError.value = ''
  loadBrowser()
}
async function check(request = false) {
  status.value = await desktopApi.checkComputerUsePermissions(request)
  loadingError.value = ''
  loadBrowser()
}
async function action(work: () => Promise<void>, browser = false) {
  if (busy.value || updateInstallationLocked.value) return
  busy.value = true
  try { await work() }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (browser) browserError.value = message
    else loadingError.value = message
    toast.error(message)
  }
  finally { busy.value = false }
}
async function toggle(enabled: boolean) {
  if (locked.value) return
  await action(async () => {
    status.value = await desktopApi.setComputerUseEnabled(enabled)
    emit('changed')
    // Only check trust. Enabling never prompts, connects MCP, or starts a Tunnel.
    if (enabled) await check(false)
  })
}
async function requestPermission() {
  await action(async () => {
    // Keep the requesting application alive in its own permission window.
    // A transient IPC check is closed immediately and must not own onboarding.
    await desktopApi.openComputerUseSettings()
  })
}
async function saveBrowser(clear = false) {
  if (locked.value) return
  await action(async () => {
    browserError.value = ''
    const endpoint = browserEndpoint.value.trim()
    const allowedOrigins = [...new Set(browserOrigins.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
    if (!clear && !allowedOrigins.length) throw new Error(t("至少填写一个允许的网站"))
    if (!clear && browserMode.value === 'attach' && !endpoint) throw new Error(t("填写本地连接地址和至少一个允许的网站"))
    const startUrl = browserStartUrl.value.trim()
    status.value = await desktopApi.configureComputerUseBrowser(clear ? null : browserMode.value === 'managed'
      ? { mode: 'managed', channel: browserChannel.value, profile: browserProfile.value.trim(), allowedOrigins, ...(startUrl ? { startUrl } : {}) }
      : { mode: 'attach', endpoint, allowedOrigins })
    browserDirty.value = false
    loadBrowser()
    emit('changed')
    toast.success(clear ? t("已关闭浏览器通道") : t("浏览器配置已保存"))
  }, true)
}
// Mount reads cached metadata only. Permission checks are explicit, not timers
// or focus listeners: switching apps must not spawn helpers or disable buttons.
onMounted(() => { void action(refresh) })
defineExpose({ refresh: () => action(refresh) })
</script>

<template>
  <section class="settings-panel computer-use-settings" :aria-label="t('内置 Computer Use')">
    <div class="computer-use-heading">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h2 class="m-0 text-base font-semibold">Computer Use</h2>

      </div>
      <Switch :model-value="status?.enabled ?? false" :disabled="locked || !status || (!status.enabled && (!status.supported || !status.available || status.conflict))"
        :title="status?.running ? t('停止 Runtime 后可修改') : t('启用电脑控制工具')" :aria-label="t('启用内置 Computer Use')" @update:model-value="toggle" />
    </div>
    <div v-if="status?.enabled" class="computer-permission-summary">
      <span role="status">{{ permissionLabel }}</span>
      <span v-if="!status.allowActions">{{ t("旧配置只读") }}</span>
    </div>
    <p v-if="!status" class="mt-4 text-xs text-muted-foreground">{{ loadingError || t("正在读取配置…") }}</p>
    <p v-else-if="!status.supported || !status.available || status.conflict" role="alert" class="mt-4 text-xs text-destructive">{{ status.conflict ? t("computer_use ID 已被占用，请先为外部 MCP 改名。") : t("原生 helper 缺失或系统不支持，请安装完整的桌面包。") }}</p>
    <div v-else-if="status.enabled" class="mt-4 space-y-4">
      <template v-if="status.platform === 'macos'">
        <div class="flex flex-wrap gap-2">
          <Button v-if="!granted || status.permission?.screenRecording !== true" size="sm" :variant="granted ? 'outline' : 'default'" :disabled="busy || !status.allowActions || updateInstallationLocked" @click="requestPermission">{{ t("设置权限") }}</Button>
          <Button size="sm" variant="outline" :disabled="busy || updateInstallationLocked" @click="action(() => check(false))">{{ t("重新检测") }}</Button>
        </div>
      </template>
      <template v-else>
        <Button size="sm" variant="outline" :disabled="busy || updateInstallationLocked" @click="action(() => check(false))">{{ t("重新检测") }}</Button>
      </template>
      <Button v-if="!status.allowActions" size="sm" variant="outline" :disabled="locked" @click="toggle(true)">{{ t("启用控制动作（保留本机审批）") }}</Button>
      <p v-if="loadingError || status.error" role="alert" class="whitespace-pre-wrap text-xs text-destructive">{{ loadingError || status.error }}</p>
    </div>
    <!-- Browser configuration is platform-independent; native support still gates desktop activation above. -->
    <details v-if="status" class="browser-settings">
      <summary class="cursor-pointer text-sm">{{ t("浏览器连接") }}<span v-if="status.browser" class="ml-2 text-xs text-muted-foreground">{{ t("已配置") }}</span></summary>
      <fieldset :disabled="locked" class="browser-form">
        <FormField class="browser-wide" :label="t('浏览器连接方式')">
          <select v-model="browserMode" :aria-label="t('浏览器连接方式')" @change="browserDirty = true"><option value="managed">{{ t("托管独立窗口（无需 CDP）") }}</option><option value="attach">{{ t("附加现有 CDP 浏览器") }}</option></select>
        </FormField>
        <FormField v-if="browserMode === 'attach'" class="browser-wide" :label="t('本地浏览器连接地址')">
          <input id="computer-browser-endpoint" :aria-label="t('本地浏览器连接地址')" v-model="browserEndpoint" placeholder="ws://127.0.0.1:9222/devtools/browser/…" @input="browserDirty = true" />
        </FormField>
        <template v-else>
          <FormField :label="t('浏览器类型')"><select v-model="browserChannel" :aria-label="t('浏览器类型')" @change="browserDirty = true"><option value="chrome">Google Chrome</option><option value="msedge">Microsoft Edge</option><option value="chromium">{{ t("Playwright Chromium（需另行准备）") }}</option></select></FormField>
          <FormField :label="t('独立会话名')"><input v-model="browserProfile" maxlength="64" placeholder="default" :aria-label="t('独立会话名')" @input="browserDirty = true" /></FormField>
          <FormField class="browser-wide" :label="t('起始地址（可选）')"><input v-model="browserStartUrl" placeholder="https://example.com/" :aria-label="t('起始地址（可选）')" @input="browserDirty = true" /></FormField>
          <p class="browser-wide text-xs text-muted-foreground">{{ t("使用专用登录态，不读取日常浏览器资料。首次明确选择浏览器通道并经审批后启动独立窗口；保存和启动 Runtime 均不会打开浏览器。") }}</p>
          <p class="browser-wide text-xs text-muted-foreground">{{ t("Chrome / Edge 必须已安装；Chromium 需要另行准备匹配版本，不会自动下载。停止 Runtime 会关闭托管窗口，保留独立会话。") }}</p>
        </template>
        <FormField class="browser-wide" :label="t('允许的网站（每行一个）')">
          <textarea id="computer-browser-origins" :aria-label="t('允许的网站')" v-model="browserOrigins" :rows="3" placeholder="https://example.com" @input="browserDirty = true" />
        </FormField>
        <p v-if="browserMode === 'attach'" class="browser-wide text-xs text-muted-foreground">{{ t("仅连接已开启调试的独立 Chromium 浏览器；保存不启动浏览器或 Runtime。") }}</p>
        <p v-if="browserError" role="alert" :aria-label="t('浏览器配置错误')" class="browser-wide whitespace-pre-wrap text-xs text-destructive">{{ browserError }}</p>
        <div class="browser-wide flex gap-2">
          <Button size="sm" :disabled="locked || !browserDirty" @click="saveBrowser()">{{ t("保存") }}</Button>
          <Button size="sm" variant="outline" :disabled="locked || !status?.browser" @click="saveBrowser(true)">{{ t("关闭通道") }}</Button>
        </div>
      </fieldset>
    </details>
  </section>
</template>

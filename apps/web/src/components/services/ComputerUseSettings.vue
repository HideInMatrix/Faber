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
import type { ComputerUseStatusDto, BrowserExtensionStatusDto } from '../../types'

const props = defineProps<{ locked?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const status = ref<ComputerUseStatusDto | null>(null)
const busy = ref(false)
const loadingError = ref('')
const browserEndpoint = ref('')
const browserMode = ref<'extension' | 'attach' | 'managed'>('extension')
const extensionStatus = ref<BrowserExtensionStatusDto | null>(null)
const browserChannel = ref<'chrome' | 'msedge' | 'chromium'>('chrome')
const browserProfile = ref('default')
const browserStartUrl = ref('')
const browserOrigins = ref('')
const browserRestrictOrigins = ref(false)
const browserDirty = ref(false)
const browserError = ref('')
function loadBrowser() {
  if (browserDirty.value) return
  const browser = status.value?.browser
  browserMode.value = !browser || browser.mode === 'extension' ? 'extension' : browser.mode === 'managed' ? 'managed' : 'attach'
  browserEndpoint.value = browser && (browser.mode === 'attach' || browser.mode === undefined) ? browser.endpoint : ''
  browserOrigins.value = browser?.allowedOrigins?.join('\n') ?? ''
  browserRestrictOrigins.value = browser?.restrictOrigins ?? false
  browserChannel.value = browser?.mode === 'managed' || browser?.mode === 'extension' ? browser.channel ?? 'chrome' : 'chrome'
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
  if (browserMode.value === 'extension') await readExtensionStatus()
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
const extensionBrowser = () => browserChannel.value === 'msedge' ? 'msedge' as const : 'chrome' as const
async function readExtensionStatus() {
  extensionStatus.value = await desktopApi.computerUseBrowserExtensionStatus(extensionBrowser())
}
function changeBrowserMode() {
  browserDirty.value = true
  if (browserMode.value === 'extension') {
    browserChannel.value = extensionBrowser()
    void action(readExtensionStatus, true)
  }
}
async function prepareExtension() {
  await action(async () => {
    browserError.value = ''
    extensionStatus.value = await desktopApi.prepareComputerUseBrowserExtension(extensionBrowser())
    browserDirty.value = true
  }, true)
}
async function copyExtensionPath() {
  await action(async () => { if (extensionStatus.value) await navigator.clipboard.writeText(extensionStatus.value.extensionDirectory) }, true)
}
async function saveBrowser(clear = false) {
  if (locked.value) return
  await action(async () => {
    browserError.value = ''
    const endpoint = browserEndpoint.value.trim()
    const restrictOrigins = browserRestrictOrigins.value
    const allowedOrigins = restrictOrigins ? [...new Set(browserOrigins.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))] : []
    if (!clear && restrictOrigins && !allowedOrigins.length) throw new Error(t("至少填写一个允许的网站"))
    if (!clear && browserMode.value === 'attach' && !endpoint) throw new Error(t("填写本地浏览器连接地址"))
    const startUrl = browserStartUrl.value.trim()
    status.value = await desktopApi.configureComputerUseBrowser(clear ? null : browserMode.value === 'extension'
      ? { mode: 'extension', channel: extensionBrowser(), restrictOrigins, allowedOrigins }
      : browserMode.value === 'managed'
      ? { mode: 'managed', channel: browserChannel.value, profile: browserProfile.value.trim(), restrictOrigins, allowedOrigins, ...(startUrl ? { startUrl } : {}) }
      : { mode: 'attach', endpoint, restrictOrigins, allowedOrigins })
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
  <section class="rounded-xl border border-border bg-card p-4" :aria-label="t('内置 Computer Use')">
    <div class="flex items-center justify-between gap-4">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h2 class="m-0 text-sm font-medium">Computer Use</h2>
        <span v-if="status?.enabled" role="status" class="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{{ permissionLabel }}</span>
        <span v-if="status?.enabled && !status.allowActions" class="text-xs text-muted-foreground">{{ t("旧配置只读") }}</span>
      </div>
      <Switch :model-value="status?.enabled ?? false" :disabled="locked || !status || (!status.enabled && (!status.supported || !status.available || status.conflict))"
        :title="status?.running ? t('停止 Runtime 后可修改') : t('启用电脑控制工具')" :aria-label="t('启用内置 Computer Use')" @update:model-value="toggle" />
    </div>
    <p v-if="!status" class="mt-3 text-xs text-muted-foreground">{{ loadingError || t("正在读取配置…") }}</p>
    <p v-else-if="!status.supported || !status.available || status.conflict" role="alert" class="mt-3 text-xs text-destructive">{{ status.conflict ? t("computer_use ID 已被占用，请先为外部 MCP 改名。") : t("原生 helper 缺失或系统不支持，请安装完整的桌面包。") }}</p>
    <div v-else-if="status.enabled" class="mt-3 space-y-3">
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
    <details v-if="status" class="mt-4 border-t border-border pt-3">
      <summary class="cursor-pointer text-sm">{{ t("浏览器连接") }}<span v-if="status.browser" class="ml-2 text-xs text-muted-foreground">{{ t("已配置") }}</span></summary>
      <fieldset :disabled="locked" class="mt-3 space-y-3">
        <FormField :label="t('浏览器连接方式')">
          <select v-model="browserMode" :aria-label="t('浏览器连接方式')" @change="changeBrowserMode"><option value="extension">{{ t("使用当前浏览器（推荐）") }}</option><option value="managed">{{ t("托管独立窗口（无需 CDP）") }}</option><option value="attach">{{ t("附加现有 CDP 浏览器") }}</option></select>
        </FormField>
        <template v-if="browserMode === 'extension'">
          <FormField :label="t('浏览器类型')"><select v-model="browserChannel" :aria-label="t('浏览器类型')" @change="browserDirty = true; action(readExtensionStatus, true)"><option value="chrome">Google Chrome</option><option value="msedge">Microsoft Edge</option></select></FormField>
          <p class="text-xs text-muted-foreground">{{ t("复用当前浏览器和登录状态，在目标标签页内操作，不移动系统鼠标或抢占其他窗口。") }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" @click="prepareExtension">{{ t("准备浏览器扩展") }}</Button>
            <Button size="sm" variant="outline" @click="action(readExtensionStatus, true)">{{ t("刷新连接状态") }}</Button>
            <span role="status" :aria-label="t('扩展连接状态')" class="text-xs text-muted-foreground">{{ extensionStatus?.connected ? extensionStatus.paused ? t("已暂停，在扩展中继续") : t("浏览器扩展已连接") : t("浏览器扩展未连接") }}</span>
          </div>
          <div v-if="extensionStatus?.prepared" class="rounded-lg border border-border p-3 space-y-2 text-xs">
            <p>{{ t("首次安装：在浏览器地址栏打开下方地址，开启开发者模式，加载已解压的扩展并选择扩展目录。") }}</p>
            <FormField :label="t('扩展管理地址')"><input :value="extensionStatus.extensionsPage" readonly :aria-label="t('扩展管理地址')" /></FormField>
            <FormField :label="t('扩展目录')"><input :value="extensionStatus.extensionDirectory" readonly :aria-label="t('扩展目录')" /></FormField>
            <Button size="sm" variant="outline" @click="copyExtensionPath">{{ t("复制扩展目录") }}</Button>
            <p>{{ t("安装后打开 Faber 扩展并点击连接 Faber，再保存此浏览器连接。取消或暂停后需在扩展中继续。") }}</p>
          </div>
        </template>
        <FormField v-else-if="browserMode === 'attach'" :label="t('本地浏览器连接地址')">
          <input id="computer-browser-endpoint" :aria-label="t('本地浏览器连接地址')" v-model="browserEndpoint" placeholder="ws://127.0.0.1:9222/devtools/browser/…" @input="browserDirty = true" />
        </FormField>
        <template v-else>
          <FormField :label="t('浏览器类型')"><select v-model="browserChannel" :aria-label="t('浏览器类型')" @change="browserDirty = true"><option value="chrome">Google Chrome</option><option value="msedge">Microsoft Edge</option><option value="chromium">{{ t("Playwright Chromium（需另行准备）") }}</option></select></FormField>
          <FormField :label="t('独立会话名')"><input v-model="browserProfile" maxlength="64" placeholder="default" :aria-label="t('独立会话名')" @input="browserDirty = true" /></FormField>
          <FormField :label="t('起始地址（可选）')"><input v-model="browserStartUrl" placeholder="https://example.com/" :aria-label="t('起始地址（可选）')" @input="browserDirty = true" /></FormField>
          <p class="text-xs text-muted-foreground">{{ t("使用专用登录态，不读取日常浏览器资料。首次明确选择浏览器通道并经审批后启动独立窗口；保存和启动 Runtime 均不会打开浏览器。") }}</p>
          <p class="text-xs text-muted-foreground">{{ t("Chrome / Edge 必须已安装；Chromium 需要另行准备匹配版本，不会自动下载。停止 Runtime 会关闭托管窗口，保留独立会话。") }}</p>
        </template>
        <div class="flex items-center justify-between gap-4">
          <label for="computer-browser-site-restriction" class="text-sm">{{ t("限制可访问的网站") }}</label>
          <Switch id="computer-browser-site-restriction" v-model="browserRestrictOrigins" :aria-label="t('限制可访问的网站')" @update:model-value="browserDirty = true" />
        </div>
        <p class="text-xs text-muted-foreground">{{ t("默认可访问任意 HTTP/HTTPS 网站；开启限制后仅允许访问名单中的网站。") }}</p>
        <FormField v-if="browserRestrictOrigins" :label="t('允许的网站（每行一个）')">
          <textarea id="computer-browser-origins" :aria-label="t('允许的网站')" v-model="browserOrigins" :rows="3" placeholder="https://example.com" @input="browserDirty = true" />
        </FormField>
        <p v-if="browserMode === 'attach'" class="text-xs text-muted-foreground">{{ t("仅连接已开启调试的独立 Chromium 浏览器；保存不启动浏览器或 Runtime。") }}</p>
        <p v-if="browserError" role="alert" :aria-label="t('浏览器配置错误')" class="whitespace-pre-wrap text-xs text-destructive">{{ browserError }}</p>
        <div class="flex gap-2">
          <Button size="sm" :disabled="locked || !browserDirty" @click="saveBrowser()">{{ t("保存") }}</Button>
          <Button size="sm" variant="outline" :disabled="locked || !status?.browser" @click="saveBrowser(true)">{{ t("关闭通道") }}</Button>
        </div>
      </fieldset>
    </details>
  </section>
</template>

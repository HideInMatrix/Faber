<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { desktopApi } from '../api/desktop'
import type { CloudflaredStatusDto } from '../types'
import { dateLocale, t } from '../composables/useLocale'
import { componentUpdateBusy } from '../composables/useComponentUpdate'
import { useAppUpdater } from '../composables/useAppUpdater'

const status = ref<CloudflaredStatusDto | null>(null)
const error = ref('')
const loading = ref(false)
const action = ref<'checking' | 'updating' | ''>('')
const updater = useAppUpdater()
const busy = computed(() => Boolean(action.value) || (status.value && status.value.phase !== 'idle'))
const appBusy = computed(() => ['checking', 'downloading', 'installing', 'installed'].includes(updater.state.phase))
let timer: ReturnType<typeof setInterval> | undefined

async function refresh() {
  if (loading.value || action.value) return
  loading.value = true
  try { status.value = await desktopApi.cloudflaredStatus() }
  catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure) }
  finally { loading.value = false }
}
async function run(operation: 'checking' | 'updating') {
  if (busy.value || appBusy.value || componentUpdateBusy.value || !status.value?.supported) return
  if (operation === 'updating' && (status.value.runtimeBusy || !status.value.updateAvailable)) return
  action.value = operation
  componentUpdateBusy.value = true
  error.value = ''
  try {
    status.value = operation === 'checking' ? await desktopApi.checkCloudflaredUpdate()
      : await desktopApi.updateCloudflared(status.value.latestVersion)
    if (operation === 'updating') toast.success(t('cloudflared 更新完成，下次启动隧道时生效。'))
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
    // Clear stale availability after a failed check; a failed install remains retryable.
    if (operation === 'checking' && status.value) status.value.updateAvailable = false
  } finally {
    action.value = ''
    componentUpdateBusy.value = false
    void refresh()
  }
}
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 5000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="mt-5 space-y-3 border-t border-border pt-4 text-xs" aria-labelledby="cloudflared-heading" aria-live="polite">
    <div class="flex items-center justify-between gap-4">
      <h2 id="cloudflared-heading" class="font-medium">Cloudflare Tunnel</h2>
      <strong>{{ status?.version || '—' }}</strong>
    </div>
    <p class="text-muted-foreground">{{ t('隧道组件 cloudflared，可独立于应用更新。') }}</p>
    <p v-if="status?.source === 'custom'" class="text-muted-foreground">{{ t('正在使用自定义程序，请自行更新；移除自定义路径后可更新内置组件。') }}</p>
    <p v-else-if="status?.source === 'updated'" class="text-muted-foreground">{{ t('当前使用独立更新版本。') }}</p>
    <p v-if="status?.checkedAt" class="text-muted-foreground">{{ t('上次检查：') }} {{ new Date(status.checkedAt).toLocaleString(dateLocale) }}</p>
    <p v-if="action === 'checking' || status?.phase === 'checking'">{{ t('正在检查 cloudflared 更新…') }}</p>
    <p v-else-if="action === 'updating' || status?.phase === 'updating'">{{ t('正在下载、校验并安装 cloudflared…') }}</p>
    <p v-else-if="status?.latestVersion && !status.error && !error">{{ status.updateAvailable ? t('新版本：') : t('cloudflared 已是最新正式版。') }}<strong v-if="status.updateAvailable">{{ status.latestVersion }}</strong></p>
    <p v-if="error || status?.error" role="alert" class="text-destructive break-words">{{ error || status?.error }}</p>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" :disabled="!status?.supported || busy || appBusy || componentUpdateBusy" @click="run('checking')">{{ t('检查 cloudflared 更新') }}</Button>
      <Button v-if="status?.updateAvailable" size="sm" :disabled="status.runtimeBusy || busy || appBusy || componentUpdateBusy" @click="run('updating')">{{ t('更新 cloudflared') }}</Button>
    </div>
    <p v-if="status?.runtimeBusy" class="text-muted-foreground">{{ t('请先停止 Runtime 与隧道，再更新 cloudflared。') }}</p>
    <p v-else-if="status?.supported" class="text-muted-foreground">{{ t('更新成功后下次启动隧道时生效，无需重启应用；下载或校验失败会保留原组件。') }}</p>
    <p v-else-if="status && status.source !== 'custom'" class="text-muted-foreground">{{ t('当前平台不支持独立更新 cloudflared。') }}</p>
  </section>
</template>

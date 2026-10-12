import { t } from './useLocale'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { updateInstallationLocked } from './useAppUpdater'
import { desktopApi } from '../api/desktop'
import { confirmRuntimeStopped } from '../api/runtimeStop'
import {
  emptyRuntimeDraft,
  normalizedRuntimeDraft,
  runtimeDraft,
  restoreSavedSecrets,
  runtimeUrl,
} from '../components/services/runtimeModels'
import type { NetworkProviderDto, RuntimeDraft, RuntimeDto } from '../types'

// Runtime state intentionally outlives the route component so navigation does
// not discard a bootstrap request that is still in flight.
const runtime = ref<RuntimeDto | null>(null)
const networkProviders = ref<NetworkProviderDto[]>([])
const draft = ref<RuntimeDraft>(emptyRuntimeDraft())
const ready = ref(false)
const initializing = ref(false)
const initializationError = ref('')
const busy = ref(false)
const lifecycleBusy = ref(false)
const lifecycleAction = ref<'start' | 'stop' | null>(null)
let lifecycleSequence = 0
let startupAbort: AbortController | null = null
const copiedUrl = ref('')
const tunnelTokenVisible = ref(false)
const oauthPasswordVisible = ref(false)
let pollTimer = 0
let initializePromise: Promise<void> | null = null
let initializationErrorShown = false

export function useRuntimeManager() {
  const running = computed(() => Boolean(runtime.value?.running))
  const locked = computed(() => running.value || runtime.value?.stopping === true || lifecycleBusy.value || busy.value || updateInstallationLocked.value)

  async function refreshRuntime() {
    const previous = runtime.value
    const sequence = lifecycleSequence
    const wasRunning = Boolean(runtime.value?.running)
    const updated = await desktopApi.runtime()
    if (sequence !== lifecycleSequence || runtime.value !== previous) return
    runtime.value = updated
    if (previous?.stopping && !updated.stopping && !updated.running && lifecycleAction.value !== 'stop') {
      toast.success(t("Runtime 已停止。"))
    }
    if (wasRunning && !updated.running && updated.exit_reason && lifecycleAction.value !== 'stop') {
      toast.error(updated.exit_reason, { id: 'runtime-unexpected-exit' })
    }
  }

  async function chooseWorkspace() {
    if (locked.value) return
    try {
      const value = await desktopApi.chooseWorkspace(draft.value.workspace)
      if (value) draft.value.workspace = value
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  function validateDraft(value: Pick<RuntimeDraft, 'name' | 'workspace'>) {
    if (!value.name) throw new Error(t("Runtime 名称不能为空。"))
    if (!value.workspace) throw new Error(t("Runtime 必须选择工作目录。"))
  }

  async function persistDraft(): Promise<RuntimeDto> {
    const value = normalizedRuntimeDraft(draft.value)
    validateDraft(value)
    const saved = await desktopApi.configureRuntime(value)
    runtime.value = saved
    draft.value = runtimeDraft(saved, draft.value)
    return saved
  }

  async function saveRuntime() {
    if (busy.value || locked.value) return
    busy.value = true
    try {
      await persistDraft()
      toast.success(t("Runtime 配置已保存。"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      busy.value = false
    }
  }

  async function toggleRunning() {
    const stopping = running.value || lifecycleAction.value === 'start'
    if (busy.value || lifecycleAction.value === 'stop' || runtime.value?.stopping || (!stopping && updateInstallationLocked.value)) return
    const sequence = ++lifecycleSequence
    lifecycleAction.value = stopping ? 'stop' : 'start'
    lifecycleBusy.value = true
    if (stopping) startupAbort?.abort()
    else startupAbort = new AbortController()
    try {
      let updated: RuntimeDto
      if (stopping) {
        updated = await desktopApi.stopRuntime()
      } else {
        await persistDraft()
        if (sequence !== lifecycleSequence) return
        updated = await desktopApi.startRuntime(startupAbort!.signal)
      }
      if (sequence !== lifecycleSequence) return
      runtime.value = updated
      if (runtime.value) draft.value = runtimeDraft(runtime.value, draft.value)
      toast.success(runtime.value?.running ? t("Runtime 已启动。") : t("Runtime 已停止。"))
    } catch (error) {
      if (sequence !== lifecycleSequence) return
      if (stopping) {
        // A lost stop response does not mean Stop failed. Confirm the local
        // Runtime state before presenting a transport error to the user.
        try {
          const confirmed = await confirmRuntimeStopped({
            read: signal => desktopApi.runtime(signal),
            isCurrent: () => sequence === lifecycleSequence,
            onSnapshot: updated => { runtime.value = updated },
            delay: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
            timeoutMs: error instanceof Error && error.name === 'TimeoutError' ? 15_000 : 1000,
          })
          if (sequence !== lifecycleSequence) return
          if (confirmed && !confirmed.running && !confirmed.stopping) {
            draft.value = runtimeDraft(confirmed, draft.value)
            toast.success(t("Runtime 已停止。"))
            return
          }
          if (confirmed?.stopping) {
            toast.info(t("Runtime 仍在停止并清理连接；继续读取状态，请勿重复启停。"))
            return
          }
        } catch { /* Report the original failure if state cannot be confirmed. */ }
      }
      toast.error(error instanceof Error && error.name === 'TimeoutError'
        ? t("本机启停请求超时，结果尚未确认；正在重新读取状态。")
        : error instanceof Error ? error.message : String(error))
      // Aborting fetch alone does not cancel the server's startup transaction.
      if (!stopping) {
        try { await desktopApi.stopRuntime() } catch { /* status remains authoritative */ }
      }
      if (!stopping) try { await refreshRuntime() } catch { /* preserve the original error */ }
    } finally {
      if (sequence === lifecycleSequence) {
        lifecycleBusy.value = false
        lifecycleAction.value = null
        startupAbort = null
      }
    }
  }

  async function copyUrl(value: string) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("MCP 地址已复制。"))
      copiedUrl.value = value
      window.setTimeout(() => {
        if (copiedUrl.value === value) copiedUrl.value = ''
      }, 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function pollRuntime() {
    if (!ready.value) {
      if (initializationError.value) return
      await initialize()
      return
    }
    // The Stop transaction/reconciler owns these reads until it settles. Do
    // not race its completion proof with an older interval status response.
    if (busy.value || lifecycleAction.value === 'stop') return
    try { await refreshRuntime() } catch { /* transient polling failure */ }
  }

  async function initialize() {
    if (ready.value) return
    if (initializePromise) return initializePromise
    initializing.value = true
    initializationError.value = ''
    initializePromise = (async () => {
      try {
        const snapshot = await desktopApi.bootstrap()
        runtime.value = snapshot.runtime
        networkProviders.value = snapshot.network_providers
        draft.value = runtimeDraft(snapshot.runtime)
        try {
          const secrets = await desktopApi.savedRuntimeSecrets()
          if (secrets) draft.value = restoreSavedSecrets(draft.value, secrets)
        } catch {
          toast.error(t("已保存的密钥未能回填；现有服务密钥仍保留，可重新输入。"), { id: 'secret-restore' })
        }
        ready.value = true
        initializationErrorShown = false
      } catch (error) {
        initializationError.value = error instanceof Error ? error.message : String(error)
        if (!initializationErrorShown) {
          toast.error(initializationError.value, { id: 'runtime-initialize' })
          initializationErrorShown = true
        }
      } finally {
        initializing.value = false
        initializePromise = null
      }
    })()
    return initializePromise
  }

  onMounted(() => {
    void initialize()
    if (!pollTimer) pollTimer = window.setInterval(() => void pollRuntime(), 1000)
  })
  onBeforeUnmount(() => {
    if (pollTimer) {
      window.clearInterval(pollTimer)
      pollTimer = 0
    }
  })

  return {
    runtime,
    networkProviders,
    draft,
    ready,
    initializing,
    initializationError,
    busy,
    lifecycleBusy,
    lifecycleAction: computed(() => runtime.value?.stopping ? 'stop' : lifecycleAction.value),
    copiedUrl,
    tunnelTokenVisible,
    oauthPasswordVisible,
    running,
    locked,
    runtimeUrl: computed(() => runtime.value ? runtimeUrl(runtime.value) : ''),
    chooseWorkspace,
    initialize,
    saveRuntime,
    toggleRunning,
    copyUrl,
  }
}

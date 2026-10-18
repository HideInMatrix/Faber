import { t } from '../composables/useLocale'
import { getVersion } from '@tauri-apps/api/app'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { controlBaseUrl } from './controlUrl'
import { waitForControlService } from './serviceReadiness'
import type {
  BootstrapDto,
  BodyPluginDto,
  CapabilityCatalogDto,
  LogEntryDto,
  PermissionRequestDto,
  RuntimeConfigurationDto,
  RuntimeDto,
  SavedRuntimeSecrets,
  PiExtensionConfigurationDto,
  PiExtensionsDto,
  PiMcpConnectionDto,
  PiSkillImportPreviewDto,
  ComputerUseStatusDto,
} from '../types'

interface DesktopApiRequest {
  method: string
  args: unknown[]
}

const controlUrl = controlBaseUrl({
  configured: import.meta.env.VITE_CONTROL_URL,
  development: import.meta.env.DEV,
  tauri: isTauri(),
  origin: window.location.origin,
})

let controlReady: Promise<void> | null = null
async function waitForDesktopControl() {
  if (!isTauri()) return
  if (!controlReady) {
    controlReady = waitForControlService({
      diagnostic: () => invoke<string | null>('desktop_service_error'),
      probe: async () => {
        const response = await fetch(`${controlUrl}/healthz`, { signal: AbortSignal.timeout(1000) })
        if (!response.ok) throw new Error(t("控制服务健康检查失败：HTTP {value0}", { value0: response.status }))
        if ((await response.json()).ok !== true) throw new Error(t("控制服务健康检查返回了无效响应"))
        return true
      },
      delay: () => new Promise(resolve => window.setTimeout(resolve, 150)),
    }).catch(error => { controlReady = null; throw error })
  }
  await controlReady
}

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return request<T>(method, args)
}

async function request<T>(method: string, args: unknown[], signal?: AbortSignal): Promise<T> {
  await waitForDesktopControl()
  const request: DesktopApiRequest = { method, args }
  // Stop drains owned processes/routes as well as ingress. Five seconds was
  // shorter than legitimate sequential cleanup; keep a finite request budget.
  const timeout = AbortSignal.timeout(method === 'start_runtime' ? 120_000 : method === 'stop_runtime' ? 15_000 : ['get_runtime', 'list_permission_requests'].includes(method) ? 5000 : 60_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(`${controlUrl}/api/desktop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: requestSignal,
    })
    if (!response.ok) {
      const body = await response.text()
      let message = body
      try {
        const parsed: unknown = JSON.parse(body)
        if (parsed && typeof parsed === 'object' && typeof Reflect.get(parsed, 'error') === 'string') {
          message = Reflect.get(parsed, 'error') as string
        }
      } catch {
        // Preserve a non-JSON response as the diagnostic message.
      }
      throw new Error(message || `Desktop API ${method} failed: HTTP ${response.status}`)
    }
    return await response.json() as T
  } catch (error) {
    // WebKit may report "Fetch is aborted" for a deadline, including while
    // reading the response body. The signal records the actual abort reason.
    if (requestSignal.aborted) {
      if (timeout.aborted && requestSignal.reason === timeout.reason) {
        const failure = new Error(`Desktop API ${method} timed out`, { cause: timeout.reason })
        failure.name = 'TimeoutError'
        throw failure
      }
      throw requestSignal.reason
    }
    throw error
  }
}

export const desktopApi = {
  bootstrap: () => call<BootstrapDto>('bootstrap'),
  appVersion: () => isTauri() ? getVersion() : call<string>('get_app_version'),
  runtime: (signal?: AbortSignal) => request<RuntimeDto>('get_runtime', [], signal),
  configureRuntime: (payload: RuntimeConfigurationDto) => call<RuntimeDto>('configure_runtime', payload),
  startRuntime: (signal?: AbortSignal) => request<RuntimeDto>('start_runtime', [], signal),
  stopRuntime: () => call<RuntimeDto>('stop_runtime'),
  listBodyPlugins: () => call<BodyPluginDto[]>('list_body_plugins'),
  setBodyPluginEnabled: (pluginId: string, enabled: boolean) =>
    call<boolean>('set_body_plugin_enabled', pluginId, enabled),
  listPermissionRequests: () => call<PermissionRequestDto[]>('list_permission_requests'),
  respondPermissionRequest: (
    requestId: string,
    decision: 'deny' | 'once' | 'session',
  ) => call<boolean>('respond_permission_request', requestId, decision),
  capabilityCatalog: () => call<CapabilityCatalogDto>('get_workbench_capability_catalog'),
  piExtensions: () => call<PiExtensionsDto>('get_pi_extensions'),
  configureComputerUseBrowser: (configuration: {endpoint: string; allowedOrigins: string[]} | null) => call<ComputerUseStatusDto>('configure_computer_use_browser', configuration),
  computerUseStatus: () => call<ComputerUseStatusDto>('get_computer_use_status'),
  setComputerUseEnabled: (enabled: boolean) => call<ComputerUseStatusDto>('set_computer_use_enabled', enabled),
  checkComputerUsePermissions: (request = false) => call<ComputerUseStatusDto>('check_computer_use_permissions', request),
  async openComputerUseSettings(): Promise<void> {
    if (!isTauri()) throw new Error(t("请在桌面客户端打开系统权限设置，或手动前往系统设置 → 隐私与安全性 → 辅助功能。"))
    await invoke('open_computer_use_settings')
  },
  configurePiExtensions: (configuration: PiExtensionConfigurationDto) => call<boolean>('configure_pi_extensions', configuration),
  createPiSkill: (id: string, description: string, instructions: string) => call<boolean>('create_pi_skill', id, description, instructions),
  previewPiSkillImport: (path: string, replaceSourceId?: string) => call<PiSkillImportPreviewDto>('preview_pi_skill_import', path, ...(replaceSourceId === undefined ? [] : [replaceSourceId])),
  importPiSkills: (path: string, selection: string[], replaceSourceId?: string) => call<number>('import_pi_skills', path, selection, ...(replaceSourceId === undefined ? [] : [replaceSourceId])),
  testPiMcp: (connection: PiMcpConnectionDto) => call<{ tools: string[] }>('test_pi_mcp', connection),
  setPiMcpCredentials: (id: string, updates: Record<string, string | null>) => call<boolean>('set_pi_mcp_credentials', id, updates),
  loginPiMcp: (id: string) => call<{ url: string }>('login_pi_mcp', id),
  cancelPiMcpLogin: (id: string) => call<boolean>('cancel_pi_mcp_login', id),
  logoutPiMcp: (id: string) => call<boolean>('logout_pi_mcp', id),
  refreshPiMcp: (id: string) => call<boolean>('refresh_pi_mcp', id),
  piSkillDocuments: () => call<Array<{ id: string; description: string }>>('list_pi_skill_documents'),
  readPiSkill: (id: string) => call<{ id: string; document: string; revision: string; files: Array<{ path: string; size: number }> }>('read_pi_skill_document', id),
  editPiSkill: (id: string, document: string, revision: string) => call<boolean>('edit_pi_skill_document', id, document, revision),
  async openAuthorizationUrl(url: string): Promise<void> {
    if (isTauri()) await invoke('open_authorization_url', { url })
    else if (!window.open(url, '_blank', 'noopener,noreferrer')) throw new Error(t("浏览器拦截了授权窗口，请允许弹窗后重试。"))
  },
  logs: (after = 0) => call<{ cursor: number; entries: LogEntryDto[] }>('get_logs', after),
  clearLogs: () => call<number>('clear_logs'),
  savedRuntimeSecrets: () => isTauri() ? invoke<SavedRuntimeSecrets>('runtime_saved_secrets') : Promise.resolve(null),
  async showPermissionPrompt(): Promise<void> {
    if (isTauri()) await invoke('show_permission_prompt')
  },
  async chooseWorkspace(initial = ''): Promise<string> {
    if (!isTauri()) return call<string>('choose_workspace', initial)
    const selected = await open({ directory: true, multiple: false, ...(initial ? { defaultPath: initial } : {}) })
    return typeof selected === 'string' ? selected : ''
  },
}

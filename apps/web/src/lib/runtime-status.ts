export interface RuntimeStatusInput {
  ready: boolean
  initializationError?: string
  lifecycleAction: 'start' | 'stop' | null
  running: boolean
  networkWarning?: string
  exitReason?: string
}

export interface RuntimeStatus {
  tone: 'idle' | 'busy' | 'running' | 'warning' | 'error'
  label: string
}

// Presentation only: lifecycle transitions take priority over stale diagnostics.
export function runtimeStatus(state: RuntimeStatusInput): RuntimeStatus {
  if (!state.ready) {
    return state.initializationError
      ? { tone: 'error', label: '加载失败' }
      : { tone: 'busy', label: '加载中' }
  }
  if (state.lifecycleAction === 'stop') return { tone: 'warning', label: '停止中…' }
  if (state.lifecycleAction === 'start') return { tone: 'busy', label: '启动中…' }
  if (state.running) {
    return state.networkWarning
      ? { tone: 'warning', label: '运行中 · 公网异常' }
      : { tone: 'running', label: '运行中' }
  }
  if (state.exitReason) return { tone: 'error', label: '运行异常' }
  return { tone: 'idle', label: '已停止' }
}

import type { ComputerUseStatusDto } from '../types'
export function computerPermissionLabel(status: ComputerUseStatusDto | null, loadingError = ''): string {
  if (!status?.enabled) return '未启用'
  if (loadingError || status.error) return '检测失败'
  const permission = status.permission
  if (!permission) return '尚未检查'
  if (status.platform === 'windows') return permission.elevated ? '请使用普通权限' : permission.interactiveDesktop === true ? '交互桌面已就绪' : '需要解锁交互桌面'
  if (permission.accessibility !== true) return '辅助功能未授权'
  if (permission.screenRecording === false) return '辅助功能已授权 · 屏幕录制未授权'
  if (permission.screenRecording !== true) return '辅助功能已授权 · 屏幕录制尚未确认'
  return '辅助功能已授权 · 屏幕录制已授权'
}

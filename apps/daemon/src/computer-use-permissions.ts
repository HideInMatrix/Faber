import { resolve } from 'node:path';
import type { ComputerUsePermissionStatus } from '@micromatrix/control-plane';
export function computerPermissionSnapshot(raw: Record<string, unknown>, platform: 'macos' | 'windows', expectedPath: string, source: 'probe' | 'runtime'): ComputerUsePermissionStatus {
  if (typeof raw.helper_path !== 'string' || resolve(raw.helper_path) !== resolve(expectedPath)) throw new Error('Computer Use permission subject does not match the configured helper');
  if (platform === 'macos' ? typeof raw.accessibility !== 'boolean' || typeof raw.screen_recording !== 'boolean' : typeof raw.interactive_desktop !== 'boolean') throw new Error('Invalid native permission response');
  return { platform, helperPath: raw.helper_path, source,
    ...(Number.isSafeInteger(raw.pid) && Number(raw.pid) > 1 ? {checkedHelperPid: Number(raw.pid)} : {}),
    ...(typeof raw.component_version === 'string' ? {componentVersion: raw.component_version} : {}),
    ...(Number.isSafeInteger(raw.native_protocol) ? {nativeProtocol: Number(raw.native_protocol)} : {}),
    ...(platform === 'macos' ? {accessibility: raw.accessibility as boolean, screenRecording: raw.screen_recording as boolean,
      ...(typeof raw.bundle_id === 'string' ? {bundleId: raw.bundle_id} : {}),
      ...(raw.signing_mode === 'certificate' || raw.signing_mode === 'ad-hoc' ? {signingMode: raw.signing_mode} : {})}
      : {interactiveDesktop: raw.interactive_desktop as boolean, elevated: raw.elevated === true}),
    promptRequested: raw.prompt_requested === true, requiresScreenRecording: false };
}
// Only typed Computer Use errors change permission status. Generic capture/AX failures are not denied grants.
export function computerPermissionFailure(previous: ComputerUsePermissionStatus | null, code: unknown): {permission: ComputerUsePermissionStatus | null; error: string} | undefined {
  if (code === 'ACCESSIBILITY_PERMISSION_REQUIRED') return {permission: previous ? {...previous, accessibility: false} : null, error: '执行主体缺少辅助功能权限；请核对 helper 身份后重新检测'};
  if (code === 'SCREEN_RECORDING_PERMISSION_REQUIRED') return {permission: previous ? {...previous, screenRecording: false} : null, error: '执行主体缺少屏幕录制权限；请核对 helper 身份后重新检测'};
  if (code === 'NATIVE_PROTOCOL_MISMATCH') return {permission: null, error: 'Computer Use 原生 helper 与 npm 组件不匹配；更新资源并重启，重新授权不能修复此错误'};
  return undefined;
}

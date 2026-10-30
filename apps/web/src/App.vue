<script setup lang="ts">
import { t } from './composables/useLocale'

import { onMounted, onBeforeUnmount } from 'vue'
import { useAppUpdater } from './composables/useAppUpdater'
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
import { FocusScope } from 'reka-ui'
import 'vue-sonner/style.css'
import { Button } from '@/components/ui/button'
import AppSidebar from './components/AppSidebar.vue'
import { usePermissionRequests } from './composables/usePermissionRequests'

const updater = useAppUpdater()
let updateTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  // Never replace a development shell with a production release.
  if (!updater.native || import.meta.env.DEV) return
  void updater.check()
  updateTimer = setInterval(() => void updater.check(), 24 * 60 * 60 * 1000)
})
onBeforeUnmount(() => { if (updateTimer) clearInterval(updateTimer) })

const {
  permissionResponding,
  activePermissionRequest,
  permissionArguments,
  permissionLabel,
  respondPermission,
} = usePermissionRequests()
</script>

<template>
  <a class="skip-link" href="#main-content">{{ t("跳转到主内容") }}</a>
  <div class="app-shell" :inert="Boolean(activePermissionRequest)">
    <AppSidebar />

    <main id="main-content" tabindex="-1" class="app-main">
      <div class="app-content">
        <RouterView />
      </div>
    </main>
  </div>

  <Toaster position="top-right" rich-colors close-button />

  <div
    v-if="activePermissionRequest"
    class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]"
  >
    <FocusScope as-child :trapped="true" :loop="true">
    <section
      class="approval-dialog max-h-[min(680px,calc(100vh-48px))] w-[min(560px,100%)] overflow-auto rounded-xl border border-border bg-card p-6 shadow-[0_18px_50px_rgb(0_0_0/0.2)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="permission-dialog-title"
    >
      <header class="flex items-start justify-between gap-4">
        <div>
          <span class="text-xs leading-[18px] font-semibold text-destructive">{{ t("需要授权") }}</span>
          <h2 id="permission-dialog-title" class="mt-1 mb-0 text-lg leading-6">{{ permissionLabel(activePermissionRequest.permission) }}</h2>
        </div>
        <span class="max-w-[220px] flex-none overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-xs leading-[18px] text-muted-foreground" :title="activePermissionRequest.client_id || activePermissionRequest.runtime_name">{{ activePermissionRequest.client_name || activePermissionRequest.runtime_name }}</span>
      </header>

      <p class="mt-4 mb-0 text-xs leading-[18px] text-foreground">{{ activePermissionRequest.reason }}</p>

      <dl class="mt-4 mb-0 grid grid-cols-2 gap-2">
        <div class="min-w-0 rounded-lg border border-border bg-secondary px-4 py-2">
          <dt class="text-xs leading-[18px] text-muted-foreground">{{ t("工具") }}</dt>
          <dd class="mt-0.5 mb-0 font-mono text-xs leading-4 text-foreground [overflow-wrap:anywhere]">{{ activePermissionRequest.tool_name }}</dd>
        </div>
        <div class="min-w-0 rounded-lg border border-border bg-secondary px-4 py-2">
          <dt class="text-xs leading-[18px] text-muted-foreground">{{ t("权限") }}</dt>
          <dd class="mt-0.5 mb-0 font-mono text-xs leading-4 text-foreground [overflow-wrap:anywhere]">{{ activePermissionRequest.permission }}</dd>
        </div>
        <div class="col-span-2 min-w-0 rounded-lg border border-border bg-secondary px-4 py-2">
          <dt class="text-xs leading-[18px] text-muted-foreground">{{ t("客户端身份") }}</dt>
          <dd class="mt-0.5 mb-0 font-mono text-xs leading-4 text-foreground [overflow-wrap:anywhere]">{{ activePermissionRequest.client_name }} · {{ activePermissionRequest.authentication }}</dd>
        </div>
      </dl>

      <div class="mt-4">
        <span class="text-xs leading-[18px] text-muted-foreground">{{ t("本次调用参数（敏感字段已脱敏）") }}</span>
        <pre class="mt-2 mb-0 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary p-4 text-xs leading-4 text-foreground [overflow-wrap:anywhere]">{{ permissionArguments }}</pre>
      </div>

      <p class="mt-3 mb-0 text-xs leading-[18px] text-muted-foreground">{{ t("“仅允许本次”只作用于当前调用；“本次客户端会话允许”只放行当前 OAuth/认证会话的同类权限，并在 Runtime 停止时清空。审批模式不是操作系统沙箱。") }}</p>

      <footer class="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" class="min-w-[88px]" :disabled="permissionResponding" @click="respondPermission('deny')">{{ t("拒绝") }}</Button>
        <Button class="min-w-[104px]" size="sm" :disabled="permissionResponding" @click="respondPermission('once')">{{ t("仅允许本次") }}</Button>
        <Button variant="outline" class="min-w-[128px]" size="sm" :disabled="permissionResponding" @click="respondPermission('session')">{{ t("本次客户端会话允许") }}</Button>
      </footer>
    </section>
    </FocusScope>
  </div>
</template>

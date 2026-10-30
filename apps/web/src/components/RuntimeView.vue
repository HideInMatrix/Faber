<script setup lang="ts">
import { t } from '../composables/useLocale'
import { computed } from 'vue'
import { runtimeStatus } from '../lib/runtime-status'

import RuntimeEditor from './services/RuntimeEditor.vue'
import { useRuntimeManager } from '../composables/useRuntimeManager'
import { Button } from '@/components/ui/button'

const manager = useRuntimeManager()
const status = computed(() => runtimeStatus({
  ready: manager.ready.value,
  initializationError: manager.initializationError.value,
  lifecycleAction: manager.lifecycleAction.value,
  running: manager.running.value,
  networkWarning: manager.runtime.value?.network_warning ?? '',
  exitReason: manager.runtime.value?.exit_reason ?? '',
}))
</script>

<template>
  <section class="page-view runtime-page">
    <header class="page-header">
      <h1 class="page-title">Runtime</h1>
      <span role="status" :class="['status-badge', `status-${status.tone}`]">
        {{ t(status.label) }}
      </span>
    </header>
    <p v-if="manager.runtime.value?.exit_reason" role="alert" class="runtime-notice runtime-notice-error">{{ manager.runtime.value.exit_reason }}</p>
    <p v-if="manager.runtime.value?.network_warning" role="status" class="runtime-notice runtime-notice-warning">{{ manager.runtime.value.network_warning }}</p>

    <div v-if="!manager.ready.value" class="settings-panel runtime-loading">
      <template v-if="manager.initializationError.value">
        <p role="alert" class="max-w-xl whitespace-pre-wrap text-center text-destructive">{{ manager.initializationError.value }}</p>
        <p>{{ t("Runtime 与 Tunnel 尚未启动。") }}</p>
        <Button variant="outline" size="sm" @click="manager.initialize">{{ t("重新加载配置") }}</Button>
      </template>
      <span v-else>{{ manager.initializing.value ? t("正在加载配置（不会启动 Runtime）…") : t("等待本地控制服务…") }}</span>
    </div>

    <RuntimeEditor
      v-if="manager.ready.value"
      v-model:draft="manager.draft.value"
      v-model:tunnel-token-visible="manager.tunnelTokenVisible.value"
      :locked="manager.locked.value"
      :busy="manager.busy.value"
      :lifecycle-busy="manager.lifecycleBusy.value"
      :lifecycle-action="manager.lifecycleAction.value"
      :selected-running="manager.running.value"
      :copied-url="manager.copiedUrl.value"
      :runtime-url="manager.runtimeUrl.value"
      :network-providers="manager.networkProviders.value"
      :oauth-password-visible="manager.oauthPasswordVisible.value"
      @choose-workspace="manager.chooseWorkspace"
      @toggle-o-auth-password="manager.oauthPasswordVisible.value = !manager.oauthPasswordVisible.value"
      @copy-url="manager.copyUrl"
      @save="manager.saveRuntime"
      @toggle-running="manager.toggleRunning"
    />
  </section>
</template>

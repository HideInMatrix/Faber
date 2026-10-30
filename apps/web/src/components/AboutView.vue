<script setup lang="ts">
import { dateLocale, t } from '../composables/useLocale'

import { RefreshCw } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form'
import type { UpdateState } from '../api/updateController'
const prefix = defineModel<string>('prefix', { required: true })
defineProps<{ version: string; update: UpdateState; native: boolean; busy: boolean; progress: number | null }>()
defineEmits<{ check: []; install: []; restart: []; savePrefix: [] }>()
</script>

<template>
  <section class="page-view about-page">
    <header class="page-header"><h1 class="page-title">{{ t("关于") }}</h1></header>
    <div class="about-layout">
      <section class="settings-panel about-identity" aria-labelledby="about-brand-title">
        <div class="about-mark"><img src="/workbench-mark.svg" alt="" width="32" height="32" /></div>
        <h2 id="about-brand-title">Faber</h2>
        <span class="version-label" :aria-label="t('当前版本')">{{ version ? `v${version}` : '—' }}</span>
        <small class="about-copyright">Copyright © micromatrix.org</small>
      </section>
      <div class="about-controls">
        <section class="settings-panel about-update" aria-labelledby="about-update-title">
          <div class="panel-heading"><span class="section-icon"><RefreshCw :size="18" /></span><h2 id="about-update-title">{{ t("软件更新") }}</h2></div>
          <div class="update-status-content" aria-live="polite">
            <template v-if="native">
              <p v-if="update.phase === 'checking'" class="update-status-message text-primary">{{ t("正在检查更新…") }}</p>
              <p v-else-if="update.phase === 'current'" class="update-status-message update-current">{{ t("当前已是最新正式版。") }}</p>
              <p v-else-if="update.version" class="update-status-message">{{ t("新版本：") }}<strong>{{ update.version }}</strong></p>
              <p v-if="update.phase === 'downloading'">{{ t("正在下载并验证签名：") }}{{ progress === null ? `${Math.round(update.downloaded / 1024)} KB` : `${progress}%` }}</p>
              <p v-if="update.phase === 'installing'">{{ t("正在停止 Runtime / Tunnel 并安装更新…") }}</p>
              <p v-if="update.phase === 'installed'" class="update-current">{{ t("更新已安装，重启应用后生效。") }}</p>
              <p v-if="update.error" role="alert" class="text-destructive break-words">{{ t("更新失败：") }}{{ update.error }}</p>
              <p v-if="update.lastCheckedAt" class="update-last-checked">{{ t("上次检查：") }} {{ new Date(update.lastCheckedAt).toLocaleString(dateLocale) }}</p>
              <div class="update-actions">
                <Button v-if="update.phase !== 'installed'" size="sm" :variant="update.version ? 'outline' : 'default'" :disabled="busy" @click="$emit('check')">{{ t("检查更新") }}</Button>
                <Button v-if="update.version && ['available', 'error'].includes(update.phase)" size="sm" :disabled="busy" @click="$emit('install')">{{ update.phase === 'error' ? t("重试更新并重启") : t("下载更新并重启") }}</Button>
                <Button v-if="update.phase === 'installed'" size="sm" @click="$emit('restart')">{{ t("重启应用") }}</Button>
              </div>
              <p v-if="update.version" class="update-safety-note">{{ t("点击更新后，下载及签名验证成功才停止 Runtime 与 Tunnel，再安装并重启。请先保存工作；系统授权仍须完成，重启后需手动启动 Runtime。") }}</p>
              <details v-if="update.notes"><summary class="cursor-pointer">{{ t("版本说明") }}</summary><pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs">{{ update.notes }}</pre></details>
            </template>
            <p v-else class="text-muted-foreground">{{ t("Web 页面不支持安装桌面更新，请在桌面应用中检查更新。") }}</p>
          </div>
        </section>
        <section v-if="native" class="settings-panel about-download">
          <div class="about-prefix-form">
            <FormField :label="t('GitHub 下载加速前缀')">
              <input v-model="prefix" :disabled="busy || update.phase === 'installed'" :placeholder="t('留空则直连 GitHub')" />
            </FormField>
            <Button variant="outline" :disabled="busy || update.phase === 'installed'" @click="$emit('savePrefix')">{{ t("保存前缀") }}</Button>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

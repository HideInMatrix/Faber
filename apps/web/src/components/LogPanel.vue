<script setup lang="ts">
import { t } from '../composables/useLocale'

import { Terminal } from '@lucide/vue'
import type { LogEntryDto } from '../types'

defineProps<{ logs: LogEntryDto[] }>()
</script>

<template>
  <section class="log-panel" :aria-label="t('运行日志')">
    <div class="log-toolbar"><span class="log-toolbar-title"><Terminal :size="16" /><strong>{{ t("输出") }}</strong></span><span>{{ t('共 {count} 条', { count: logs.length }) }}</span></div>
    <pre v-if="logs.length" class="log-output"><span v-for="item in logs" :key="item.id" class="log-line">{{ item.message }}</span></pre>
    <div v-else class="log-empty"><Terminal :size="32" :stroke-width="1.3" /><p>{{ t("暂无运行日志") }}</p></div>
  </section>
</template>

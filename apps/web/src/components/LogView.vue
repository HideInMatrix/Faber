<script setup lang="ts">
import { t } from '../composables/useLocale'

import { onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { desktopApi } from '../api/desktop'
import type { LogEntryDto } from '../types'
import LogPanel from './LogPanel.vue'

const logs = ref<LogEntryDto[]>([])
const clearing = ref(false)
let cursor = 0
let pollTimer = 0

async function refreshLogs(surfaceError = false) {
  if (clearing.value) return
  try {
    const response = await desktopApi.logs(cursor)
    if (clearing.value) return
    cursor = response.cursor
    logs.value.push(...response.entries)
    if (logs.value.length > 600) logs.value.splice(0, logs.value.length - 600)
  } catch (error) {
    if (surfaceError) toast.error(error instanceof Error ? error.message : String(error), { id: 'logs-refresh' })
  }
}

async function clearLogs() {
  if (clearing.value) return
  clearing.value = true
  try {
    cursor = await desktopApi.clearLogs()
    logs.value = []
    toast.success(t("运行日志已清除。"))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    clearing.value = false
  }
}

onMounted(async () => {
  await refreshLogs(true)
  pollTimer = window.setInterval(() => void refreshLogs(false), 900)
})

onBeforeUnmount(() => window.clearInterval(pollTimer))
</script>

<template>
  <section class="page-view logs-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t("运行日志") }}</h1>
      </div>
      <Button
        variant="outline"
        size="sm"
        class="clear-logs-button"
        :disabled="clearing || logs.length === 0"
        @click="clearLogs"
      >
        <Trash2 :size="14" />
        {{ clearing ? t("清除中…") : t("清除日志") }}
      </Button>
    </header>

    <LogPanel :logs="logs" />
  </section>
</template>

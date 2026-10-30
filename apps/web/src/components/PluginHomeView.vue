<script setup lang="ts">
import { t } from '../composables/useLocale'

import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Box, RefreshCw, Search, Wrench } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { desktopApi } from '../api/desktop'
import type { BodyPluginDto, CapabilityCatalogDto } from '../types'
import PiExtensionManager from './services/PiExtensionManager.vue'
import ComputerUseSettings from './services/ComputerUseSettings.vue'

const plugins = ref<BodyPluginDto[]>([])
const catalog = ref<CapabilityCatalogDto | null>(null)
const query = ref('')
const busy = ref(false)
const togglingId = ref('')
const runtimeRunning = ref(false)
const computerUse = ref<InstanceType<typeof ComputerUseSettings> | null>(null)
const extensions = ref<InstanceType<typeof PiExtensionManager> | null>(null)

async function refreshAll() {
  // Refresh in place on user request; never remount cards or discard editors.
  await Promise.all([refresh(), computerUse.value?.refresh(), extensions.value?.refresh()])
}

const capabilities = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  const values = catalog.value?.capabilities ?? []
  return normalized
    ? values.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(normalized))
    : values
})

async function refresh() {
  busy.value = true
  try {
    const [bodyPlugins, capabilityCatalog, runtime] = await Promise.all([
      desktopApi.listBodyPlugins(),
      desktopApi.capabilityCatalog(),
      desktopApi.runtime(),
    ])
    plugins.value = bodyPlugins
    catalog.value = capabilityCatalog
    runtimeRunning.value = runtime.running
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason), { id: 'plugins-refresh' })
  } finally {
    busy.value = false
  }
}

async function togglePlugin(plugin: BodyPluginDto, enabled: boolean) {
  if (plugin.required || togglingId.value || runtimeRunning.value) return
  togglingId.value = plugin.id
  try {
    await desktopApi.setBodyPluginEnabled(plugin.id, enabled)
    await refresh()
    toast.success(t("{value0} 已{value1}。", { value0: plugin.name, value1: t(enabled ? '启用' : '停用') }))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    togglingId.value = ''
  }
}

onMounted(refresh)
</script>

<template>
  <section class="page-view plugins-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t("插件") }}</h1>
      </div>
      <Button variant="outline" size="sm" :disabled="busy" :aria-label="t('刷新')" @click="refreshAll">
        <RefreshCw :size="15" />
        {{ t("刷新") }}
      </Button>
    </header>

    <div class="plugins-overview">
    <section class="settings-panel plugin-tools-section" aria-labelledby="builtin-tools-title">
      <div class="plugin-section-heading">
        <h2 id="builtin-tools-title"><span class="section-icon"><Box :size="18" /></span>{{ t("内置工具") }}</h2>
        <span v-if="runtimeRunning" class="text-xs text-muted-foreground">{{ t("运行中 · 设置已锁定") }}</span>
      </div>
      <div class="tool-list">
        <div v-for="plugin in plugins" :key="plugin.id" class="tool-list-row">
          <div class="grid size-8 flex-none place-items-center rounded-lg border border-border bg-background"><Box :size="15" /></div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">{{ plugin.name }}</div>
            <div v-if="plugin.required" class="mt-0.5 text-xs text-muted-foreground">{{ t("必需") }}</div>
          </div>
          <Switch
            :model-value="plugin.enabled"
            :disabled="runtimeRunning || plugin.required || Boolean(togglingId)"
            :aria-label="t(plugin.enabled ? '停用 {name}' : '启用 {name}', { name: plugin.name })"
            @update:model-value="value => togglePlugin(plugin, value)"
          />
        </div>
        <div v-if="!plugins.length && !busy" class="px-4 py-8 text-center text-xs text-muted-foreground">{{ t("没有已注册插件") }}</div>
      </div>
    </section>

    <ComputerUseSettings ref="computerUse" :locked="runtimeRunning" class="computer-use-panel" @changed="refresh" />
    </div>
    <PiExtensionManager ref="extensions" @changed="refresh" />

    <details class="settings-panel tool-catalog">
      <summary class="cursor-pointer text-sm font-medium">{{ t("工具目录 ·") }} {{ catalog?.capabilities.length ?? 0 }}</summary>
      <div class="mt-3 flex justify-end">

        <div class="relative w-[240px]">
          <Search class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" :size="14" />
          <input v-model="query" class="h-8 w-full rounded-xl border border-border bg-background pr-3 pl-8 text-xs outline-none focus:ring-2 focus:ring-ring/30" :placeholder="t('搜索工具或技能')" />
        </div>
      </div>
      <div class="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
        <div v-for="item in capabilities" :key="item.id" class="flex min-h-14 items-center gap-3 px-4">
          <div class="grid size-8 flex-none place-items-center rounded-lg border border-border bg-background"><Wrench :size="14" /></div>
          <details class="min-w-0 flex-1 py-3">
            <summary class="cursor-pointer truncate text-xs font-medium">{{ item.name }}</summary>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ item.description }}</p>
          </details>
          <span class="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">{{ item.source.plugin_id || 'system' }}</span>
        </div>
        <div v-if="!capabilities.length && !busy" class="px-4 py-8 text-center text-xs text-muted-foreground">{{ t("没有匹配的工具") }}</div>
      </div>
    </details>
  </section>
</template>

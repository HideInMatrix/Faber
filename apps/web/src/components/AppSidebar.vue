<script setup lang="ts">
import { locale, setLocale, t } from '../composables/useLocale'

import { onMounted, ref } from 'vue'
import {
  Boxes,
  Info,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Server,
} from '@lucide/vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import type { AppRouteName } from '../router'
import { useAppUpdater } from '../composables/useAppUpdater'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)
const updater = useAppUpdater()

onMounted(() => {
  try {
    collapsed.value = window.localStorage.getItem('app-sidebar-collapsed') === '1'
  } catch {
    collapsed.value = false
  }
})

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  try {
    window.localStorage.setItem('app-sidebar-collapsed', collapsed.value ? '1' : '0')
  } catch {
    // Keep the in-memory state if WebView storage is unavailable.
  }
}

function navClass(name: AppRouteName): string[] {
  const active = name === 'plugins'
    ? String(route.name ?? '').startsWith('plugins')
    : route.name === name
  return [
    'group w-full text-xs font-normal',
    collapsed.value ? 'justify-center px-0' : 'justify-start gap-2 px-2.5',
    active
      ? 'bg-secondary text-foreground'
      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
  ]
}
</script>

<template>
  <aside
    :class="[
      'flex flex-none flex-col border-r border-sidebar-border bg-sidebar py-5 text-sidebar-foreground transition-[width] duration-200',
      collapsed ? 'w-16 px-2' : 'w-60 px-3',
    ]"
  >
    <div :class="['flex min-h-8 items-center gap-2', collapsed ? 'justify-center' : 'justify-between px-1.5']">
      <div v-if="!collapsed" class="flex min-w-0 items-center gap-2.5">
        <div class="grid size-9 flex-none place-items-center rounded-md border border-sidebar-border bg-background/40">
          <img src="/workbench-mark.svg" alt="" class="size-6 dark:invert" />
        </div>
        <span class="truncate text-xs font-medium" title="Faber">Faber</span>
      </div>
      <Button v-if="!collapsed" variant="ghost" size="icon" class="h-7 w-7" :title="t('收起侧边栏')" @click="toggleCollapsed">
        <PanelLeftClose :size="15" />
      </Button>
      <Button
        v-else
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        :title="t('展开侧边栏')"
        :aria-label="t('展开侧边栏')"
        aria-controls="app-sidebar-navigation"
        :aria-expanded="!collapsed"
        @click="toggleCollapsed"
      >
        <PanelLeftOpen :size="16" />
      </Button>
    </div>

    <nav id="app-sidebar-navigation" class="mt-5 grid gap-1" :aria-label="t('主导航')">
      <Button variant="ghost" size="sm" :class="navClass('runtime')" :title="collapsed ? 'Runtime' : undefined" @click="router.push({ name: 'runtime' })">
        <Server class="flex-none" :size="16" :stroke-width="1.8" />
        <span v-if="!collapsed" class="leading-none">Runtime</span>
      </Button>
      <Button variant="ghost" size="sm" :class="navClass('plugins')" :title="collapsed ? t('插件') : undefined" @click="router.push({ name: 'plugins' })">
        <Boxes class="flex-none" :size="16" :stroke-width="1.8" />
        <span v-if="!collapsed" class="leading-none">{{ t("插件") }}</span>
      </Button>
      <Button variant="ghost" size="sm" :class="navClass('logs')" :title="collapsed ? t('运行日志') : undefined" @click="router.push({ name: 'logs' })">
        <ScrollText class="flex-none" :size="16" :stroke-width="1.8" />
        <span v-if="!collapsed" class="leading-none">{{ t("运行日志") }}</span>
      </Button>
    </nav>

    <div class="mt-auto border-t border-sidebar-border pt-4">
      <div class="mb-3 min-w-0">
        <label v-if="!collapsed" for="app-language" class="mb-1.5 flex items-center gap-2 px-2.5 text-xs text-muted-foreground">
          <Languages :size="14" /><span>{{ t('界面语言') }}</span>
        </label>
        <select
          id="app-language"
          :value="locale"
          :aria-label="t('界面语言')"
          :title="t('界面语言')"
          :class="['h-8 w-full min-w-0 rounded-md border border-sidebar-border bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', collapsed ? 'px-1 text-[10px]' : 'px-2.5 text-xs']"
          @change="setLocale(($event.target as HTMLSelectElement).value)"
        >
          <option value="zh-CN">中文</option>
          <option value="en">{{ collapsed ? 'EN' : 'English' }}</option>
        </select>
      </div>
      <Button
        variant="ghost"
        size="sm"
        :class="navClass('about')"
        :title="collapsed ? t('关于') : undefined"
        :aria-label="t('关于')"
        @click="router.push({ name: 'about' })"
      >
        <Info class="flex-none" :size="16" :stroke-width="1.8" />
        <span v-if="!collapsed" class="leading-none">{{ t("关于") }}</span>
        <span v-if="updater.updateAvailable.value" class="ml-auto size-1.5 rounded-full bg-destructive" :aria-label="t('有新版本可更新')" />
      </Button>
    </div>
  </aside>
</template>

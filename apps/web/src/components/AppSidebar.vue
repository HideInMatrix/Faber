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
  return ['app-nav-item', active ? 'is-active' : '', collapsed.value ? 'is-collapsed' : '']
}
</script>

<template>
  <aside :class="['app-sidebar', { 'sidebar-collapsed': collapsed }]">
    <div class="sidebar-brand">
      <div class="brand-lockup">
        <div class="brand-mark"><img src="/workbench-mark.svg" alt="" width="24" height="24" /></div>
        <span v-if="!collapsed" class="brand-wordmark" title="Faber">Faber</span>
      </div>
      <Button variant="ghost" size="icon" class="sidebar-toggle" :title="t(collapsed ? '展开侧边栏' : '收起侧边栏')" :aria-label="t(collapsed ? '展开侧边栏' : '收起侧边栏')" aria-controls="app-sidebar-navigation" :aria-expanded="!collapsed" @click="toggleCollapsed">
        <PanelLeftOpen v-if="collapsed" :size="16" /><PanelLeftClose v-else :size="16" />
      </Button>
    </div>

    <nav id="app-sidebar-navigation" class="sidebar-navigation" :aria-label="t('主导航')">
      <Button variant="ghost" :class="navClass('runtime')" aria-label="Runtime" :title="collapsed ? 'Runtime' : undefined" :aria-current="route.name === 'runtime' ? 'page' : undefined" @click="router.push({ name: 'runtime' })">
        <Server :size="18" :stroke-width="1.7" /><span v-if="!collapsed" class="nav-label">Runtime</span>
      </Button>
      <Button variant="ghost" :class="navClass('plugins')" :aria-label="t('插件')" :title="collapsed ? t('插件') : undefined" :aria-current="String(route.name ?? '').startsWith('plugins') ? 'page' : undefined" @click="router.push({ name: 'plugins' })">
        <Boxes :size="18" :stroke-width="1.7" /><span v-if="!collapsed" class="nav-label">{{ t("插件") }}</span>
      </Button>
      <Button variant="ghost" :class="navClass('logs')" :aria-label="t('运行日志')" :title="collapsed ? t('运行日志') : undefined" :aria-current="route.name === 'logs' ? 'page' : undefined" @click="router.push({ name: 'logs' })">
        <ScrollText :size="18" :stroke-width="1.7" /><span v-if="!collapsed" class="nav-label">{{ t("运行日志") }}</span>
      </Button>
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-language">
        <label v-if="!collapsed" for="app-language"><Languages :size="16" /><span class="nav-label">{{ t('界面语言') }}</span></label>
        <select id="app-language" :value="locale" :aria-label="t('界面语言')" :title="t('界面语言')" @change="setLocale(($event.target as HTMLSelectElement).value)">
          <option value="zh-CN">中文</option><option value="en">{{ collapsed ? 'EN' : 'English' }}</option>
        </select>
      </div>
      <Button variant="ghost" :class="navClass('about')" :aria-label="t('关于')" :title="collapsed ? t('关于') : undefined" :aria-current="route.name === 'about' ? 'page' : undefined" @click="router.push({ name: 'about' })">
        <Info :size="18" :stroke-width="1.7" /><span v-if="!collapsed" class="nav-label">{{ t("关于") }}</span>
        <span v-if="updater.updateAvailable.value" class="update-dot" :aria-label="t('有新版本可更新')" />
      </Button>
    </div>
  </aside>
</template>

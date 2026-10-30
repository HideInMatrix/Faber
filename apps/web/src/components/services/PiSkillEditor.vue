<script setup lang="ts">
import { t } from '../../composables/useLocale'

import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { desktopApi } from '../../api/desktop'
const props = defineProps<{ running: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const skills = ref<Array<{ id: string; description: string }>>([])
const editor = ref<Awaited<ReturnType<typeof desktopApi.readPiSkill>> | null>(null)
const busy = ref(false)
async function action(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  try { await work() } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  finally { busy.value = false }
}
async function refresh() { await action(async () => { skills.value = await desktopApi.piSkillDocuments() }) }
async function edit(id: string) { await action(async () => { editor.value = await desktopApi.readPiSkill(id) }) }
async function save() {
  await action(async () => {
    if (!editor.value || props.running) return
    await desktopApi.editPiSkill(editor.value.id, editor.value.document, editor.value.revision)
    editor.value = await desktopApi.readPiSkill(editor.value.id)
    toast.success(t("Skill 已保存；下次启动 Runtime 加载新内容。")); emit('changed')
  })
}
onMounted(() => { void refresh() })
</script>
<template>
  <details class="settings-panel skill-documents">
    <summary class="skill-documents-summary">{{ t("Skill 文档") }}</summary>
    <div class="mt-4 flex justify-end"><Button size="sm" variant="ghost" :disabled="busy" @click="refresh">{{ t("刷新文档") }}</Button></div>
    <div v-for="skill in skills" :key="skill.id" class="mt-2 flex items-center justify-between gap-4"><span class="min-w-0 truncate text-xs" :title="skill.description">{{ skill.id }}</span><Button size="sm" variant="outline" :disabled="busy" @click="edit(skill.id)">{{ t("打开文档") }}</Button></div>
    <div v-if="editor" class="mt-4 space-y-4">
      <h4 class="text-sm font-medium">{{ editor.id }} / SKILL.md</h4>
      <p class="text-xs text-muted-foreground">{{ t("保存会修改原文件，请保留 frontmatter 和 name。") }}</p>
      <textarea v-model="editor.document" :disabled="running || busy" class="h-72 w-full rounded-lg border border-input bg-background p-4 font-mono text-sm leading-6" :aria-label="t('完整 Skill 文档')" />
      <details v-if="editor.files.length" class="text-xs text-muted-foreground">
        <summary class="cursor-pointer">{{ t("支持文件 ·") }} {{ editor.files.length }}</summary>
        <div class="mt-2 space-y-1"><div v-for="file in editor.files" :key="file.path" class="break-all">{{ file.path }} · {{ file.size }} bytes</div></div>
      </details>
      <div class="flex justify-end gap-2"><Button size="sm" variant="outline" :disabled="busy" @click="editor = null">{{ t("关闭文档") }}</Button><Button size="sm" :disabled="busy || running" @click="save">{{ t("保存文档") }}</Button></div>
    </div>
  </details>
</template>

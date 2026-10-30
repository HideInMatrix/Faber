<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
  label?: string
  span?: '1' | '2'
}>()
</script>

<template>
  <label
    :class="cn(
      'form-field grid content-start gap-2 text-xs font-medium leading-5 text-foreground',
      '[&>input]:h-10 [&>input]:w-full [&>input]:rounded-md [&>input]:border [&>input]:border-input [&>input]:bg-background [&>input]:px-3 [&>input]:text-sm [&>input]:font-normal [&>input]:text-foreground [&>input]:outline-none [&>input]:transition-[border-color,box-shadow]',
      '[&>select]:h-10 [&>select]:w-full [&>select]:rounded-md [&>select]:border [&>select]:border-input [&>select]:bg-background [&>select]:px-3 [&>select]:text-sm [&>select]:font-normal [&>select]:text-foreground [&>select]:outline-none [&>select]:transition-[border-color,box-shadow]',
      '[&>textarea]:w-full [&>textarea]:rounded-md [&>textarea]:border [&>textarea]:border-input [&>textarea]:bg-background [&>textarea]:px-3 [&>textarea]:py-2 [&>textarea]:font-mono [&>textarea]:text-sm [&>textarea]:font-normal [&>textarea]:leading-[18px] [&>textarea]:text-foreground [&>textarea]:outline-none [&>textarea]:transition-[border-color,box-shadow]',
      '[&>input:focus]:border-ring [&>input:focus]:ring-2 [&>input:focus]:ring-ring/15',
      '[&>select:focus]:border-ring [&>select:focus]:ring-2 [&>select:focus]:ring-ring/15',
      '[&>textarea:focus]:border-ring [&>textarea:focus]:ring-2 [&>textarea:focus]:ring-ring/15',
      '[&>input:disabled]:bg-muted [&>input:disabled]:text-muted-foreground',
      '[&>select:disabled]:bg-muted [&>select:disabled]:text-muted-foreground',
      '[&>textarea:disabled]:bg-muted [&>textarea:disabled]:text-muted-foreground',
      props.span === '2' && 'col-span-2',
      props.class,
    )"
  >
    <span v-if="props.label">{{ props.label }}</span>
    <slot />
  </label>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div :class="cn('form-grid grid grid-cols-2 gap-4', props.class)">
    <slot />
  </div>
</template>

<script setup lang="ts">
interface Props {
  title: string
  subtitle?: string
  overline?: string
  hideBackground?: boolean
  compact?: boolean
}

defineProps<Props>()
</script>

<template>
  <div class="relative w-full overflow-visible mb-4">
    <!-- Background effects -->
    <template v-if="!hideBackground">
      <div class="absolute inset-0 -top-24 -bottom-24 overflow-hidden -z-10 pointer-events-none">
        <div class="absolute inset-x-0 top-0 h-full bg-gradient-to-br from-emerald-50 via-white to-cyan-50"></div>
        <div class="absolute -right-24 -top-12 h-96 w-96 rounded-full bg-emerald-200/20 blur-3xl"></div>
        <div class="absolute -left-24 top-24 h-72 w-72 rounded-full bg-cyan-200/20 blur-3xl"></div>
      </div>
    </template>

    <div class="relative w-full" :class="compact ? 'py-1' : 'py-2 sm:py-3'">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex items-center gap-4">
          <div v-if="$slots.icon" class="shrink-0">
            <slot name="icon"></slot>
          </div>
          <div class="max-w-3xl">
            <p v-if="overline || $slots.overline" class="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-600 mb-1">
              <slot name="overline">{{ overline }}</slot>
            </p>
            <h1 class="font-black tracking-tight text-slate-900" :class="compact ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl lg:text-5xl'">
              {{ title }}
            </h1>
            <p v-if="subtitle" class="mt-1 text-xs font-medium text-slate-500 lg:text-sm">
              {{ subtitle }}
            </p>
          </div>
        </div>

        <div v-if="$slots.actions" class="flex flex-wrap items-center gap-3">
          <slot name="actions"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Optional: Add custom animations or transitions if needed */
</style>

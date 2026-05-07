<script setup lang="ts">
interface Props {
  /** The main title text displayed in the header */
  title: string
  /** Optional subtitle text displayed below the title */
  subtitle?: string
  /** Optional small uppercase text displayed above the title */
  overline?: string
  /** If true, hides the decorative background gradient and blur effects */
  hideBackground?: boolean
  /** If true, reduces vertical padding and title font size for a denser UI */
  compact?: boolean
  /** If true, allows the actions slot to sit on the same row as the title on mobile (default: false) */
  inlineActionsMobile?: boolean
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
      <div 
        class="flex gap-4 lg:flex-row lg:items-center lg:justify-between"
        :class="inlineActionsMobile ? 'flex-row flex-nowrap items-center justify-between' : 'flex-col'"
      >
        <!-- Left side: Icon + Title stack -->
        <div 
          class="flex items-center gap-3 sm:gap-4 flex-1 min-w-0"
        >
          <div v-if="$slots.icon" class="shrink-0">
            <slot name="icon"></slot>
          </div>
          <div class="flex-1 min-w-0">
            <p v-if="overline || $slots.overline" 
               class="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-600 mb-0.5"
               :class="inlineActionsMobile ? 'truncate' : ''"
            >
              <slot name="overline">{{ overline }}</slot>
            </p>
            <h1 
              class="font-black tracking-tight text-slate-900 leading-tight" 
              :class="[
                compact ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl lg:text-5xl',
                inlineActionsMobile ? 'truncate' : ''
              ]"
            >
              {{ title }}
            </h1>
            <p v-if="subtitle" 
               class="mt-0.5 text-xs font-medium text-slate-500 lg:text-sm"
               :class="inlineActionsMobile ? 'line-clamp-1' : ''"
            >
              {{ subtitle }}
            </p>
          </div>
        </div>

        <!-- Right side: Actions -->
        <div v-if="$slots.actions" 
             class="flex items-center gap-3 shrink-0"
             :class="inlineActionsMobile ? 'ml-auto' : 'flex-wrap'"
        >
          <slot name="actions"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Optional: Add custom animations or transitions if needed */
</style>

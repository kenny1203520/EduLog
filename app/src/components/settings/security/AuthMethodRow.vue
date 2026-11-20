<script setup lang="ts">
/** One sign-in or verification method: icon, name, status and its actions. */
defineProps<{ title: string; description?: string; status?: 'enabled' | 'not_set' | 'pending' | 'disabled'; muted?: boolean }>()
</script>

<template>
    <div class="flex flex-col gap-4 rounded-2xl border p-4 transition-colors duration-200 sm:flex-row sm:items-center"
        :class="muted ? 'border-dashed border-gray-200 bg-gray-50/60' : 'border-gray-100 bg-white hover:border-gray-200'">
        <div class="flex min-w-0 flex-1 items-start gap-4">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                :class="muted ? 'bg-gray-100 text-gray-400' : 'bg-emerald-50 text-emerald-700'" aria-hidden="true">
                <slot name="icon" />
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                    <h4 class="font-black text-gray-900">{{ title }}</h4>
                    <span v-if="status" class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-black"
                        :class="{
                            'bg-emerald-100 text-emerald-800': status === 'enabled',
                            'bg-gray-100 text-gray-600': status === 'not_set' || status === 'disabled',
                            'bg-amber-100 text-amber-800': status === 'pending',
                        }">
                        <svg v-if="status === 'enabled'" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" clip-rule="evenodd" /></svg>
                        {{ $t(`auth.status_${status}`) }}
                    </span>
                </div>
                <p v-if="description" class="mt-0.5 text-sm text-gray-600">{{ description }}</p>
                <slot />
            </div>
        </div>
        <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 sm:justify-end">
            <slot name="actions" />
        </div>
    </div>
</template>

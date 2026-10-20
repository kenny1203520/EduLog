<script setup lang="ts">
// Placeholder shaped like a list card, so the grid keeps its layout while the
// first response is in flight.  Purely decorative: the caller owns the
// role="status" announcement for the whole grid.
withDefaults(defineProps<{
    variant?: 'room' | 'session'
}>(), {
    variant: 'room'
})
</script>

<template>
    <div aria-hidden="true"
        class="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm animate-pulse motion-reduce:animate-none">
        <div class="p-5 pb-3">
            <div class="flex items-center gap-4">
                <div class="h-12 w-12 shrink-0 rounded-xl bg-gray-100"></div>
                <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-5 w-2/3 rounded-lg bg-gray-100"></div>
                    <div class="h-3 w-1/3 rounded bg-gray-100"></div>
                </div>
            </div>
            <div class="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-3">
                <div v-for="n in 3" :key="n" class="h-9 w-9 rounded-xl bg-gray-50"></div>
            </div>
        </div>

        <div v-if="variant === 'session'" class="space-y-4 px-5 pb-2">
            <div class="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/60 p-3">
                <div class="h-3 w-1/4 rounded bg-gray-100"></div>
                <div class="h-8 rounded-xl bg-white"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div v-for="n in 2" :key="n" class="h-14 rounded-xl bg-gray-50"></div>
            </div>
            <div class="h-10 rounded-xl bg-gray-100"></div>
        </div>
        <div v-else class="flex-1 space-y-3 px-5 py-3">
            <div class="h-4 w-4/5 rounded bg-gray-100"></div>
            <div class="h-4 w-1/2 rounded bg-gray-100"></div>
        </div>

        <div class="mt-auto border-t border-gray-50 bg-gray-50/30 px-5 py-4">
            <div class="ml-auto h-3 w-3 rounded-full bg-gray-100"></div>
        </div>
    </div>
</template>

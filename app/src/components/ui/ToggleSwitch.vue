<script setup lang="ts">
/**
 * On/off switch. A `<button role="switch">` so Space/Enter toggle it and
 * screen readers announce "on/off"; `label` is its accessible name.
 * The button is the 44px touch target, the track is drawn inside it.
 */
const props = withDefaults(defineProps<{ label: string, disabled?: boolean }>(), { disabled: false })
const checked = defineModel<boolean>({ required: true })

function flip() {
    if (!props.disabled) checked.value = !checked.value
}
</script>

<template>
    <button type="button" role="switch" :aria-checked="checked" :aria-label="label" :disabled="disabled"
        class="group inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        @click="flip">
        <span aria-hidden="true" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none"
            :class="checked ? 'bg-emerald-600' : 'bg-gray-300'">
            <span class="inline-block size-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 motion-reduce:transition-none"
                :class="checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'" />
        </span>
    </button>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { SupportedLocale } from '@/i18n'

const props = withDefaults(defineProps<{ fullWidth?: boolean; labelOnMobile?: boolean; align?: 'left' | 'right' }>(), {
    fullWidth: false, labelOnMobile: false, align: 'left'
})
const { t } = useI18n()
const preferences = usePreferencesStore()
const trigger = ref<HTMLButtonElement | null>(null)
const optionElements = ref<HTMLButtonElement[]>([])
const isOpen = ref(false)
const activeIndex = ref(0)
const locales: SupportedLocale[] = ['zh-TW', 'en']
const options = computed(() => locales.map(value => ({
    value,
    label: t('common.languages.' + value),
    description: t('common.language_descriptions.' + value)
})))
const currentLabel = computed(() => options.value.find(option => option.value === preferences.locale)?.label || options.value[0].label)
const accessibleLabel = computed(() => t('common.language') + ': ' + currentLabel.value)

async function open() {
    activeIndex.value = Math.max(0, options.value.findIndex(option => option.value === preferences.locale))
    isOpen.value = true
    await nextTick()
    optionElements.value[activeIndex.value]?.focus()
}
function close(restoreFocus = true) {
    isOpen.value = false
    if (restoreFocus) void nextTick(() => trigger.value?.focus())
}
function toggle() { if (isOpen.value) close(); else void open() }
function select(locale: SupportedLocale) { preferences.locale = locale; close() }
function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void open() }
    else if (event.key === 'Escape' && isOpen.value) { event.preventDefault(); close() }
}
function onDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') activeIndex.value = 0
    else if (event.key === 'End') activeIndex.value = options.value.length - 1
    else {
        const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
        activeIndex.value = (activeIndex.value + (forward ? 1 : -1) + options.value.length) % options.value.length
    }
    optionElements.value[activeIndex.value]?.focus()
}
</script>

<template>
    <div class="relative" :class="props.fullWidth ? 'w-full' : 'inline-flex'">
        <button ref="trigger" type="button" aria-haspopup="dialog" :aria-expanded="isOpen"
            :aria-label="accessibleLabel" :title="accessibleLabel" @click="toggle" @keydown="onTriggerKeydown"
            class="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5 font-bold text-gray-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
            :class="props.fullWidth ? 'w-full justify-between' : ''">
            <span class="flex min-w-0 items-center gap-2">
                <svg class="h-5 w-5 shrink-0" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.2-2.46 3.33-5.46 3.33-9S14.2 5.46 12 3m0 18c-2.2-2.46-3.33-5.46-3.33-9S9.8 5.46 12 3M3.6 9h16.8M3.6 15h16.8" />
                </svg>
                <span class="truncate" :class="props.labelOnMobile || props.fullWidth ? '' : 'hidden sm:inline'">{{ currentLabel }}</span>
            </span>
            <svg class="h-4 w-4 shrink-0 text-gray-400 transition-transform" :class="isOpen ? 'rotate-180' : ''" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <Teleport to="body">
            <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="opacity-0" leave-active-class="transition duration-150 ease-in" leave-to-class="opacity-0">
                <div v-if="isOpen" class="fixed inset-0 z-[9998] flex items-center justify-center bg-gray-950/45 p-4 backdrop-blur-sm" @mousedown.self="close()">
                    <section role="dialog" aria-modal="true" :aria-label="t('common.choose_language')"
                        class="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl" @keydown="onDialogKeydown">
                        <header class="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-5 sm:px-8 sm:py-7">
                            <div class="flex min-w-0 items-start gap-4">
                                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                                    <svg class="h-6 w-6" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.2-2.46 3.33-5.46 3.33-9S14.2 5.46 12 3m0 18c-2.2-2.46-3.33-5.46-3.33-9S9.8 5.46 12 3M3.6 9h16.8M3.6 15h16.8" />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <h2 class="text-xl font-black tracking-tight text-gray-900 sm:text-2xl">{{ t('common.choose_language') }}</h2>
                                    <p class="mt-1 text-sm font-medium leading-6 text-gray-500">{{ t('common.choose_language_hint') }}</p>
                                </div>
                            </div>
                            <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" :aria-label="t('common.close')" @click="close()">×</button>
                        </header>
                        <div class="p-5 sm:p-8">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" :aria-label="t('common.language')">
                                <button v-for="(option, index) in options" :key="option.value"
                                    :ref="element => { if (element) optionElements[index] = element as HTMLButtonElement }"
                                    type="button" role="radio" :aria-checked="preferences.locale === option.value"
                                    class="group flex min-h-28 w-full items-center justify-between gap-4 rounded-2xl border-2 p-5 text-left transition focus:outline-none focus:ring-4 focus:ring-emerald-500/15"
                                    :class="preferences.locale === option.value ? 'border-emerald-500 bg-emerald-50/80 shadow-sm' : 'border-gray-100 bg-white hover:border-emerald-200 hover:bg-emerald-50/30'"
                                    @focus="activeIndex = index" @click="select(option.value)">
                                    <span class="min-w-0">
                                        <span class="block text-lg font-black text-gray-900">{{ option.label }}</span>
                                        <span class="mt-1 block text-sm font-medium text-gray-500">{{ option.description }}</span>
                                    </span>
                                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2" :class="preferences.locale === option.value ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-200 text-transparent group-hover:border-emerald-300'">
                                        <svg class="h-4 w-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                                    </span>
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

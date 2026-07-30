<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

type SupportedLocale = 'zh-TW' | 'en'

const props = withDefaults(defineProps<{
    fullWidth?: boolean
    labelOnMobile?: boolean
    align?: 'left' | 'right'
}>(), {
    fullWidth: false,
    labelOnMobile: false,
    align: 'left'
})

const { t } = useI18n()
const preferences = usePreferencesStore()
const trigger = ref<HTMLButtonElement | null>(null)
const optionElements = ref<HTMLButtonElement[]>([])
const isOpen = ref(false)
const activeIndex = ref(0)
const menuStyle = ref<Record<string, string>>({})
const locales: SupportedLocale[] = ['zh-TW', 'en']

const options = computed(() => locales.map(value => ({
    value,
    label: t(`common.languages.${value}`)
})))
const currentLabel = computed(() => options.value.find(option => option.value === preferences.locale)?.label || options.value[0].label)
const accessibleLabel = computed(() => `${t('common.language')}: ${currentLabel.value}`)

function updatePosition() {
    if (!trigger.value) return
    const rect = trigger.value.getBoundingClientRect()
    const width = Math.max(rect.width, 190)
    const left = props.align === 'right' ? Math.max(8, rect.right - width) : Math.min(rect.left, window.innerWidth - width - 8)
    menuStyle.value = {
        position: 'fixed',
        top: `${rect.bottom + 8}px`,
        left: `${left}px`,
        width: `${width}px`,
        zIndex: '9999'
    }
}

function addPositionListeners() {
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
}

function removePositionListeners() {
    window.removeEventListener('resize', updatePosition)
    window.removeEventListener('scroll', updatePosition, true)
}

async function open(focusSelected = false) {
    activeIndex.value = Math.max(0, options.value.findIndex(option => option.value === preferences.locale))
    updatePosition()
    addPositionListeners()
    isOpen.value = true
    if (focusSelected) {
        await nextTick()
        optionElements.value[activeIndex.value]?.focus()
    }
}

function close(restoreFocus = false) {
    isOpen.value = false
    removePositionListeners()
    if (restoreFocus) nextTick(() => trigger.value?.focus())
}

function toggle() {
    isOpen.value ? close() : open()
}

function select(locale: SupportedLocale) {
    preferences.locale = locale
    close(true)
}

function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        open(true)
    } else if (event.key === 'Escape' && isOpen.value) {
        event.preventDefault()
        close(true)
    }
}

function onMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
        return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (event.key === 'Home') activeIndex.value = 0
    else if (event.key === 'End') activeIndex.value = options.value.length - 1
    else {
        const delta = event.key === 'ArrowDown' ? 1 : -1
        activeIndex.value = (activeIndex.value + delta + options.value.length) % options.value.length
    }
    optionElements.value[activeIndex.value]?.focus()
}

onUnmounted(removePositionListeners)
</script>

<template>
    <div class="relative" :class="fullWidth ? 'w-full' : 'inline-flex'">
        <button ref="trigger" type="button" aria-haspopup="menu" :aria-expanded="isOpen"
            :aria-label="accessibleLabel" :title="accessibleLabel" @click="toggle" @keydown="onTriggerKeydown"
            class="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5 font-bold text-gray-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
            :class="fullWidth ? 'w-full justify-between' : ''">
            <span class="flex min-w-0 items-center gap-2">
                <svg class="h-5 w-5 shrink-0" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.2-2.46 3.33-5.46 3.33-9S14.2 5.46 12 3m0 18c-2.2-2.46-3.33-5.46-3.33-9S9.8 5.46 12 3M3.6 9h16.8M3.6 15h16.8" />
                </svg>
                <span class="truncate" :class="labelOnMobile || fullWidth ? '' : 'hidden sm:inline'">{{ currentLabel }}</span>
            </span>
            <svg class="h-4 w-4 shrink-0 text-gray-400 transition-transform" :class="isOpen ? 'rotate-180' : ''"
                aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <Teleport to="body">
            <div v-if="isOpen" class="fixed inset-0 z-[9998]" aria-hidden="true" @click="close()"></div>
            <div v-if="isOpen" role="menu" :aria-label="t('common.language')" :style="menuStyle"
                class="rounded-2xl border border-gray-100 bg-white p-1.5 shadow-2xl" @keydown="onMenuKeydown">
                <button v-for="(option, index) in options" :key="option.value"
                    :ref="element => { if (element) optionElements[index] = element as HTMLButtonElement }"
                    type="button" role="menuitemradio" :aria-checked="preferences.locale === option.value"
                    class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                    :class="preferences.locale === option.value ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50'"
                    @focus="activeIndex = index" @click="select(option.value)">
                    <span>{{ option.label }}</span>
                    <svg v-if="preferences.locale === option.value" class="h-4 w-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                    </svg>
                </button>
            </div>
        </Teleport>
    </div>
</template>

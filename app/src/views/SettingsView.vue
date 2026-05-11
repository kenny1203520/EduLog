<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/DateUtils'

const preferences = usePreferencesStore()
const search = ref('')

const timeZoneOptions = preferences.timeZoneOptions

const filteredOptions = ref(timeZoneOptions)

function handleSearch() {
    if (!search.value) {
        filteredOptions.value = timeZoneOptions
        return
    }
    const q = search.value.toLowerCase()
    filteredOptions.value = timeZoneOptions.filter(opt =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q)
    )
}

function selectTimeZone(zone: string) {
    preferences.timeZone = zone
}

function useBrowserTimeZone() {
    preferences.timeZone = DateUtils.getBrowserTimeZone()
}

onMounted(() => {
    handleSearch()
})

</script>

<template>
    <div class="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <!-- Header -->
        <div class="bg-white rounded-[2.5rem] p-8 lg:p-10 border border-gray-100 shadow-sm relative overflow-hidden">
            <div class="absolute -top-24 -right-24 w-96 h-96 bg-emerald-50 rounded-full blur-3xl opacity-50"></div>
            <div class="relative z-10">
                <h1 class="text-4xl font-black text-gray-900 tracking-tight mb-2">{{ $t('nav.settings') }}</h1>
                <p class="text-lg text-gray-400 font-bold italic">{{ $t('settings.subtitle') }}</p>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-8">
            <!-- Sidebar Navigation (Quick scroll or tabs) -->
            <div class="md:col-span-4 space-y-2">
                <nav class="sticky top-8 space-y-1">
                    <a href="#timezone"
                        class="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-50 text-emerald-700 font-black transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {{ $t('settings.timezone.title') }}
                    </a>
                    <a href="#appearance"
                        class="flex items-center gap-3 px-4 py-3 rounded-2xl text-gray-400 hover:bg-gray-50 font-bold transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                        </svg>
                        {{ $t('settings.appearance.title') }}
                    </a>
                </nav>
            </div>

            <!-- Content -->
            <div class="md:col-span-8 space-y-8">
                <!-- Timezone Section -->
                <section id="timezone"
                    class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                    <div class="p-8 border-b border-gray-50">
                        <h3 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('settings.timezone.title') }}
                        </h3>
                        <p class="text-sm font-bold text-gray-400 italic mt-1">{{ $t('settings.timezone.description') }}
                        </p>
                    </div>

                    <div class="p-8 space-y-6">
                        <!-- Current Selection Highlight -->
                        <div
                            class="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 flex items-center justify-between">
                            <div>
                                <p class="text-xs font-black text-emerald-600 uppercase tracking-widest mb-1">{{
                                    $t('settings.timezone.current') }}</p>
                                <p class="text-xl font-black text-gray-900">{{ preferences.timeZoneLabel }}</p>
                                <p class="text-sm font-bold text-gray-400 mt-1">{{ preferences.timeZone }}</p>
                            </div>
                            <button @click="useBrowserTimeZone"
                                class="bg-white text-emerald-600 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-black hover:bg-emerald-600 hover:text-white transition-all active:scale-95">
                                {{ $t('settings.timezone.use_browser') }}
                            </button>
                        </div>

                        <!-- Picker -->
                        <div class="space-y-4">
                            <div class="relative">
                                <input v-model="search" type="text"
                                    :placeholder="$t('settings.timezone.search_placeholder')" @input="handleSearch"
                                    class="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl font-bold text-gray-900 focus:ring-2 focus:ring-emerald-500 transition-all">
                                <svg xmlns="http://www.w3.org/2000/svg"
                                    class="h-6 w-6 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>

                            <div class="max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                                <div class="grid grid-cols-1 gap-2">
                                    <button v-for="opt in filteredOptions" :key="opt.value"
                                        @click="selectTimeZone(opt.value)" :class="[
                                            'text-left px-5 py-4 rounded-2xl font-bold transition-all flex items-center justify-between group',
                                            preferences.timeZone === opt.value
                                                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200'
                                                : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-100'
                                        ]">
                                        <span>{{ opt.label }}</span>
                                        <svg v-if="preferences.timeZone === opt.value"
                                            xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                clip-rule="evenodd" />
                                        </svg>
                                        <span v-else
                                            class="text-[10px] text-gray-400 group-hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-all">{{
                                                opt.value }}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Appearance / Accessibility Section -->
                <section id="appearance"
                    class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                    <div class="p-8 border-b border-gray-50">
                        <h3 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('settings.appearance.title')
                        }}</h3>
                        <p class="text-sm font-bold text-gray-400 italic mt-1">{{ $t('settings.appearance.description')
                        }}</p>
                    </div>

                    <div class="p-8 space-y-8">
                        <!-- Font Scale -->
                        <div class="space-y-4">
                            <div class="flex items-center justify-between">
                                <label class="text-sm font-black text-gray-900 uppercase tracking-widest">{{
                                    $t('settings.appearance.font_scale') }}</label>
                                <span class="bg-gray-100 px-3 py-1 rounded-lg text-sm font-black text-gray-600">{{
                                    preferences.globalFontScale }}%</span>
                            </div>
                            <div class="flex items-center gap-4">
                                <button @click="preferences.adjustGlobalScale(-preferences.STEP)"
                                    class="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center text-gray-900 hover:bg-gray-100 active:scale-90 transition-all">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                            d="M20 12H4" />
                                    </svg>
                                </button>
                                <div class="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div class="h-full bg-emerald-500 transition-all duration-300"
                                        :style="{ width: `${(preferences.globalFontScale - 70) / (200 - 70) * 100}%` }">
                                    </div>
                                </div>
                                <button @click="preferences.adjustGlobalScale(preferences.STEP)"
                                    class="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center text-gray-900 hover:bg-gray-100 active:scale-90 transition-all">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                            d="M12 4v16m8-8H4" />
                                    </svg>
                                </button>
                            </div>
                            <p class="text-xs text-gray-400 font-bold italic">{{
                                $t('settings.appearance.font_scale_hint') }}</p>
                        </div>

                        <!-- Language -->
                        <div class="space-y-4 pt-4 border-t border-gray-50">
                            <label class="text-sm font-black text-gray-900 uppercase tracking-widest block">{{
                                $t('settings.appearance.language') }}</label>
                            <div class="grid grid-cols-2 gap-4">
                                <button @click="preferences.locale = 'zh-TW'" :class="[
                                    'py-4 rounded-2xl font-black transition-all border-2',
                                    preferences.locale === 'zh-TW' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-100 bg-white text-gray-400 hover:border-gray-200'
                                ]">
                                    繁體中文
                                </button>
                                <button @click="preferences.locale = 'en'" :class="[
                                    'py-4 rounded-2xl font-black transition-all border-2',
                                    preferences.locale === 'en' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-100 bg-white text-gray-400 hover:border-gray-200'
                                ]">
                                    English
                                </button>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
}
</style>

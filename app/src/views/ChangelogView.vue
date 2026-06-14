<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import BasePageHeader from '@/components/common/BasePageHeader.vue'

const router = useRouter()
const { tm } = useI18n()

// Get changelog data from i18n
const changelogEntries = computed(() => {
    const data = tm('changelog.entries')
    return Array.isArray(data) ? data : []
})

function getChangeTypeClass(type: string) {
    switch (type.toLowerCase()) {
        case 'added': return 'bg-emerald-100 text-emerald-700'
        case 'changed': return 'bg-blue-100 text-blue-700'
        case 'fixed': return 'bg-orange-100 text-orange-700'
        default: return 'bg-gray-100 text-gray-700'
    }
}
</script>

<template>
    <div class="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <!-- Header -->
        <BasePageHeader
            :title="$t('about.changelog')"
            :subtitle="$t('about.changelog_subtitle')"
        >
            <template #overline>
                <div class="flex items-center gap-2">
                    <button @click="router.back()" class="p-1 hover:bg-emerald-50 rounded-lg transition-colors text-emerald-600">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                    </button>
                    <span class="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600">{{ $t('nav.about') }}</span>
                </div>
            </template>
        </BasePageHeader>

        <!-- Timeline -->
        <div class="relative space-y-12 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
            
            <div v-for="(entry, index) in changelogEntries" :key="index" 
                class="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                
                <!-- Icon -->
                <div class="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-white shadow-md text-emerald-600 z-10 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                    <div class="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                </div>

                <!-- Content -->
                <div class="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-6 rounded-2xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div class="flex items-center justify-between mb-4">
                        <div class="font-bold text-gray-900 text-xl">v{{ entry.version }}</div>
                        <time class="text-xs font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded">{{ entry.date }}</time>
                    </div>

                    <div class="space-y-4">
                        <div v-for="(changes, type) in entry.changes" :key="type">
                            <!-- Only show if there are changes for this type -->
                            <template v-if="Array.isArray(changes) && changes.length > 0">
                                <div class="flex items-center gap-2 mb-2">
                                    <span :class="getChangeTypeClass(type as string)" class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm">
                                        {{ type }}
                                    </span>
                                </div>
                                <ul class="space-y-1.5">
                                    <li v-for="(item, i) in (changes as string[])" :key="i" class="text-sm text-gray-600 flex gap-2">
                                        <span class="text-gray-300 mt-1.5">•</span>
                                        <span>{{ item }}</span>
                                    </li>
                                </ul>
                            </template>
                        </div>
                    </div>
                </div>
            </div>

        </div>

        <!-- Bottom -->
        <div class="text-center pt-8 border-t border-gray-100 space-y-4">
            <a href="https://github.com/kenny1203520/EduLog/blob/master/CHANGELOG.md" 
               target="_blank" 
               rel="noopener noreferrer" 
               class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-xl transition-colors text-sm font-medium border border-gray-200 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {{ $t('about.github_changelog') }}
            </a>
            <p class="text-sm text-gray-400">
                {{ $t('about.copyright') }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.animate-in {
    animation: animate-in 0.5s ease-out;
}

@keyframes animate-in {
    from {
        opacity: 0;
        transform: translateY(1rem);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>

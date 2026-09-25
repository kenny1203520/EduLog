<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'
import { useRouter } from 'vue-router'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import { useFeedback } from '@/composables/useFeedback'

const auth = useAuthStore()
const router = useRouter()
const preferences = usePreferencesStore()
const { info, reportError } = useFeedback()
const isSidebarOpen = ref(false)
const isDesktopSidebarOpen = ref(true)
const accountMenuOpen = ref(false)
const logoutBusy = ref(false)
const isOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const pendingRequests = ref(0)
const accountDisplayName = computed(() => auth.user?.nickname?.trim() || auth.user?.display_name?.trim() || auth.user?.full_name?.trim() || auth.user?.email || '')
const accountInitial = computed(() => accountDisplayName.value.charAt(0).toLocaleUpperCase())

function onOnline() { isOnline.value = true }
function onOffline() { isOnline.value = false }
function onRequestStart() { pendingRequests.value += 1 }
function onRequestEnd() { pendingRequests.value = Math.max(0, pendingRequests.value - 1) }
function onOfflineReady() { info('common.offline_ready') }
function onAccountKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') accountMenuOpen.value = false
}

onMounted(() => {
    preferences.loadUserPreferences()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('edulog:api-request-start', onRequestStart)
    window.addEventListener('edulog:api-request-end', onRequestEnd)
    window.addEventListener('edulog:pwa-offline-ready', onOfflineReady)
    window.addEventListener('keydown', onAccountKeydown)
})

onUnmounted(() => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('edulog:api-request-start', onRequestStart)
    window.removeEventListener('edulog:api-request-end', onRequestEnd)
    window.removeEventListener('edulog:pwa-offline-ready', onOfflineReady)
    window.removeEventListener('keydown', onAccountKeydown)
})

async function handleLogout() {
    if (logoutBusy.value) return
    logoutBusy.value = true
    try {
        await auth.signOut()
        router.push('/login')
    } catch (error) {
        reportError(error)
    } finally {
        logoutBusy.value = false
        accountMenuOpen.value = false
    }
}
</script>

<template>
    <div class="flex h-dvh min-h-dvh overflow-hidden bg-gray-50">
        <!-- Mobile Header -->
        <div
            class="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-100 z-30 flex items-center px-4 justify-between shadow-sm">
            <div class="flex items-center gap-3">
                <button @click="isSidebarOpen = !isSidebarOpen"
                    class="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>
                <img src="/pwa-192x192.png" alt="EduLog Logo" class="h-8 w-8 rounded-lg shadow-sm" />
                <div class="font-bold text-emerald-600 text-lg">EduLog</div>
            </div>

            <button type="button" class="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700" :aria-label="$t('nav.account_menu')" :aria-expanded="isSidebarOpen" @click="isSidebarOpen = true; accountMenuOpen = true">
                {{ accountInitial }}
            </button>
        </div>

        <!-- Sidebar Overlay (Mobile) -->
        <div v-if="isSidebarOpen" @click="isSidebarOpen = false; accountMenuOpen = false"
            class="lg:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"></div>

        <!-- Sidebar -->
        <aside
            class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col transform border-r border-gray-100 bg-white transition-all duration-300 lg:static lg:max-w-none lg:transform-none"
            :class="[
                isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
                    isDesktopSidebarOpen ? 'lg:w-64' : 'lg:w-0 lg:overflow-hidden'
            ]">
            <div class="p-6 flex justify-between items-center" :class="{ 'lg:hidden': !isDesktopSidebarOpen }">
                <div class="whitespace-nowrap overflow-hidden">
                    <div class="flex items-center gap-3">
                        <img src="/pwa-192x192.png" alt="EduLog Logo" class="w-10 h-10 rounded-xl shadow-md" />
                        <div>
                            <h1 class="text-2xl font-bold text-emerald-600">EduLog</h1>
                            <p class="text-xs text-gray-500 mt-1">{{ $t('nav.subtitle') }}</p>
                        </div>
                    </div>
                </div>
                <!-- Close Button (Mobile Only) -->
                <button @click="isSidebarOpen = false" class="lg:hidden p-2 text-gray-400 hover:text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Subtle Divider -->
            <div class="mx-6 h-px bg-gray-100/60"></div>
            <!-- Language Switcher in Sidebar -->
            <div class="px-6 py-2">
                <LanguageSwitcher full-width label-on-mobile align="left" />
            </div>

            <!-- Font Size Switcher in Sidebar -->
            <div class="px-6 py-2">
                <div class="flex items-center justify-between bg-gray-100 rounded-xl p-1 gap-1 select-none">
                    <button @click="preferences.adjustGlobalScale(-preferences.STEP)"
                        class="w-10 h-10 flex items-center justify-center rounded-lg bg-white shadow-sm text-gray-600 hover:text-emerald-600 hover:bg-emerald-50 transition-all font-bold text-sm">
                        -A
                    </button>
                    <div class="flex-1 text-center">
                        <span class="text-xs font-bold text-emerald-600">{{ preferences.globalFontScale }}%</span>
                    </div>
                    <button @click="preferences.adjustGlobalScale(preferences.STEP)"
                        class="w-10 h-10 flex items-center justify-center rounded-lg bg-white shadow-sm text-gray-600 hover:text-emerald-600 hover:bg-emerald-50 transition-all font-bold text-sm">
                        +A
                    </button>
                </div>
            </div>

            <!-- Subtle Divider -->
            <div class="mx-6 mt-2 h-px bg-gray-100/60"></div>

            <nav class="flex-1 p-4 space-y-2 overflow-y-auto">
                <router-link to="/dashboard" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    exact-active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                        {{ $t('nav.dashboard') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/students" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        {{ $t('nav.students', 'Students') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/courses" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        {{ $t('nav.courses') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/classrooms" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        {{ $t('nav.classrooms') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/holidays" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {{ $t('nav.holidays') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/teachers" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path d="M12 14l9-5-9-5-9 5 9 5z" />
                            <path
                                d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                        </svg>
                        {{ $t('nav.teachers') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/reports/incomplete" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {{ $t('nav.incomplete_reports') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/settings" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {{ $t('nav.settings') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/about" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50/60 text-emerald-600 font-bold relative before:absolute before:left-[-1rem] before:top-3 before:bottom-3 before:w-1 before:bg-emerald-500 before:rounded-r-full">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {{ $t('nav.about') }}
                    </div>
                </router-link>
            </nav>

            <!-- Subtle Divider -->
            <div class="mx-6 h-px bg-gray-100/60"></div>

            <div class="relative p-3">
                <button type="button" class="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :aria-label="$t('nav.account_menu')" :aria-expanded="accountMenuOpen" aria-haspopup="menu" @click="accountMenuOpen = !accountMenuOpen">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">{{ accountInitial }}</span>
                    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-bold text-gray-800">{{ accountDisplayName }}</span><span class="block truncate text-xs text-gray-500">{{ auth.user?.email }}</span></span>
                    <svg class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.22 7.47a.75.75 0 011.06 0L10 11.19l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.53a.75.75 0 010-1.06z" clip-rule="evenodd" /></svg>
                </button>
                <div v-if="accountMenuOpen" class="absolute bottom-full left-3 right-3 z-50 mb-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl" role="group" :aria-label="$t('nav.account_menu')">
                    <router-link to="/dashboard/settings?tab=personal" class="block min-h-11 rounded-xl px-3 py-3 text-sm font-bold text-gray-700 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" @click="accountMenuOpen = false; isSidebarOpen = false">{{ $t('nav.account_settings') }}</router-link>
                    <button type="button" @click="handleLogout" :disabled="logoutBusy" class="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold text-red-600 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-50">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {{ logoutBusy ? $t('common.processing') : $t('nav.logout') }}
                    </button>
                </div>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="relative min-w-0 flex-1 overflow-auto bg-gray-50 pt-16 transition-all duration-300 lg:pt-0">
            <div v-if="!isOnline" class="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-bold text-amber-900" role="status" aria-live="polite">{{ $t('common.offline_notice') }}</div>
            <div v-else-if="pendingRequests > 0" class="fixed left-0 right-0 top-0 z-[70] h-1 bg-emerald-100 lg:left-64" role="status" aria-live="polite">
                <div class="h-full w-1/3 motion-safe:animate-pulse rounded-full bg-emerald-600" aria-hidden="true"></div>
                <span class="sr-only">{{ $t('common.processing') }}</span>
            </div>
            <!-- Desktop Toggle Bar (Sticky) -->
            <div class="hidden lg:flex sticky top-0 z-20 px-8 py-4 bg-gray-50/90 backdrop-blur-sm items-center gap-2">
                <button @click="isDesktopSidebarOpen = !isDesktopSidebarOpen"
                    class="min-h-11 min-w-11 p-2 -ml-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all flex items-center gap-2 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    :title="isDesktopSidebarOpen ? $t('nav.collapse') : $t('nav.expand')">
                    <div
                        class="p-1 rounded-md border border-gray-200 bg-white group-hover:border-emerald-200 transition-colors shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path v-if="isDesktopSidebarOpen" stroke-linecap="round" stroke-linejoin="round"
                                stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                            <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </div>
                    <span v-if="!isDesktopSidebarOpen"
                        class="text-sm font-bold text-gray-500 group-hover:text-emerald-600 animate-in fade-in slide-in-from-left-2">
                        {{ $t('nav.expand') || 'Expand Menu' }}
                    </span>
                </button>
            </div>

            <div class="min-w-0 px-3 pb-4 lg:px-6 lg:pb-6">
                <router-view />
            </div>
        </main>
    </div>
</template>

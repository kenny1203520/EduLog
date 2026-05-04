<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()
const isSidebarOpen = ref(false)
const isDesktopSidebarOpen = ref(true)

const version = __APP_VERSION__

async function handleLogout() {
    await auth.signOut()
    router.push('/login')
}
</script>

<template>
    <div class="flex h-screen bg-gray-50 overflow-hidden">
        <!-- Mobile Header -->
        <div
            class="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b z-30 flex items-center px-4 justify-between shadow-sm">
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

            <div
                class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs">
                {{ auth.user?.email?.charAt(0).toUpperCase() }}
            </div>
        </div>

        <!-- Sidebar Overlay (Mobile) -->
        <div v-if="isSidebarOpen" @click="isSidebarOpen = false"
            class="lg:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"></div>

        <!-- Sidebar -->
        <aside
            class="fixed lg:static inset-y-0 left-0 z-50 bg-white shadow-xl lg:shadow-md flex flex-col transition-all duration-300 transform lg:transform-none"
            :class="[
                isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
                isDesktopSidebarOpen ? 'lg:w-64' : 'lg:w-0 lg:overflow-hidden'
            ]">
            <div class="p-6 border-b flex justify-between items-center" :class="{ 'lg:hidden': !isDesktopSidebarOpen }">
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

            <!-- Language Switcher in Sidebar -->
            <div class="px-6 py-2">
                <div class="flex gap-2 text-xs font-medium bg-gray-100 rounded p-1 w-full justify-center">
                    <button @click="$i18n.locale = 'zh-TW'"
                        :class="{ 'bg-white shadow text-emerald-600': $i18n.locale === 'zh-TW', 'text-gray-500 hover:text-gray-700': $i18n.locale !== 'zh-TW' }"
                        class="px-3 py-1.5 rounded transition flex-1">中文</button>
                    <button @click="$i18n.locale = 'en'"
                        :class="{ 'bg-white shadow text-emerald-600': $i18n.locale === 'en', 'text-gray-500 hover:text-gray-700': $i18n.locale !== 'en' }"
                        class="px-3 py-1.5 rounded transition flex-1">English</button>
                </div>
            </div>

            <nav class="flex-1 p-4 space-y-2 overflow-y-auto">
                <router-link to="/dashboard" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    exact-active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
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
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
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
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
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
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
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
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
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
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M17 20h5v-1a7 7 0 00-7-7h-1m-6 8h12m-6-8a4 4 0 100-8 4 4 0 000 8zm-5 8a7 7 0 0114 0v1H6v-1z" />
                        </svg>
                        {{ $t('nav.teachers') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/reports/incomplete" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
                    <div class="flex items-center gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        {{ $t('nav.incomplete_reports') }}
                    </div>
                </router-link>

                <router-link to="/dashboard/about" @click="isSidebarOpen = false"
                    class="block px-4 py-3 rounded-xl text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition font-medium"
                    active-class="bg-emerald-50 text-emerald-700 font-bold shadow-sm ring-1 ring-emerald-100">
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

            <div class="p-4 border-t">
                <div class="flex items-center mb-4 px-2">
                    <div
                        class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
                        {{ auth.user?.email?.charAt(0).toUpperCase() }}
                    </div>
                    <div class="ml-3 overflow-hidden">
                        <p class="text-sm font-medium text-gray-700 truncate">{{ auth.user?.email }}</p>
                    </div>
                </div>
                <button @click="handleLogout"
                    class="w-full px-4 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition cursor-pointer flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {{ $t('nav.logout') }}
                </button>
                <div class="mt-4 text-center">
                    <p class="text-[10px] text-gray-400 font-medium tracking-widest uppercase">v{{ version }}</p>
                </div>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="flex-1 overflow-auto bg-gray-50 pt-16 lg:pt-0 relative transition-all duration-300">
            <!-- Desktop Toggle Bar (Sticky) -->
            <div class="hidden lg:flex sticky top-0 z-20 px-8 py-4 bg-gray-50/90 backdrop-blur-sm items-center gap-2">
                <button @click="isDesktopSidebarOpen = !isDesktopSidebarOpen"
                    class="p-2 -ml-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all flex items-center gap-2 group"
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

            <div class="px-4 pb-4 lg:px-8 lg:pb-8">
                <router-view />
            </div>
        </main>
    </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { useRouter } from 'vue-router'

const auth = useAuthStore()
const router = useRouter()

async function handleLogout() {
    await auth.signOut()
    router.push('/login')
}
</script>

<template>
    <div class="flex h-screen bg-gray-50">
        <!-- Sidebar -->
        <aside class="w-64 bg-white shadow-md flex flex-col">
            <div class="p-6 border-b">
                <h1 class="text-2xl font-bold text-emerald-600">EduLog</h1>
                <p class="text-xs text-gray-500 mt-1">{{ $t('nav.subtitle') }}</p>

                <!-- Language Switcher -->
                <div class="flex gap-2 mt-4 text-xs font-medium bg-gray-100 rounded p-1 w-fit">
                    <button @click="$i18n.locale = 'zh-TW'"
                        :class="{ 'bg-white shadow text-emerald-600': $i18n.locale === 'zh-TW', 'text-gray-500 hover:text-gray-700': $i18n.locale !== 'zh-TW' }"
                        class="px-2 py-1 rounded transition">中文</button>
                    <button @click="$i18n.locale = 'en'"
                        :class="{ 'bg-white shadow text-emerald-600': $i18n.locale === 'en', 'text-gray-500 hover:text-gray-700': $i18n.locale !== 'en' }"
                        class="px-2 py-1 rounded transition">EN</button>
                </div>
            </div>

            <nav class="flex-1 p-4 space-y-2">
                <router-link to="/dashboard"
                    class="block px-4 py-2 rounded-md text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
                    exact-active-class="bg-emerald-50 text-emerald-700 font-medium">
                    {{ $t('nav.dashboard') }}
                </router-link>

                <router-link to="/dashboard/students"
                    class="block px-4 py-2 rounded-md text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
                    active-class="bg-emerald-50 text-emerald-700 font-medium">
                    {{ $t('nav.students', 'Students') }}
                </router-link>

                <router-link to="/dashboard/courses"
                    class="block px-4 py-2 rounded-md text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
                    active-class="bg-emerald-50 text-emerald-700 font-medium">
                    {{ $t('nav.courses') }}
                </router-link>

                <router-link to="/dashboard/classrooms"
                    class="block px-4 py-2 rounded-md text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
                    active-class="bg-emerald-50 text-emerald-700 font-medium">
                    {{ $t('nav.classrooms') }}
                </router-link>

                <router-link to="/dashboard/holidays"
                    class="block px-4 py-2 rounded-md text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition"
                    active-class="bg-emerald-50 text-emerald-700 font-medium">
                    {{ $t('nav.holidays') }}
                </router-link>
                <!-- Future Navigation Items -->
                <!-- <router-link to="/students" ...>Students</router-link> -->
            </nav>

            <div class="p-4 border-t">
                <div class="flex items-center mb-4">
                    <div
                        class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
                        {{ auth.user?.email?.charAt(0).toUpperCase() }}
                    </div>
                    <div class="ml-3 overflow-hidden">
                        <p class="text-sm font-medium text-gray-700 truncate">{{ auth.user?.email }}</p>
                    </div>
                </div>
                <button @click="handleLogout"
                    class="w-full px-4 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition cursor-pointer">
                    {{ $t('nav.logout') }}
                </button>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="flex-1 overflow-auto">
            <div class="p-8">
                <router-view />
            </div>
        </main>
    </div>
</template>

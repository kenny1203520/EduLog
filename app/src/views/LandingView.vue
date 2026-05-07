<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

const router = useRouter()
const auth = useAuthStore()
const preferences = usePreferencesStore()

function handleGetStarted() {
    if (auth.isAuthenticated) {
        router.push('/dashboard')
    } else {
        router.push('/login')
    }
}
</script>

<template>
    <div class="min-h-screen bg-white flex flex-col selection:bg-emerald-100 selection:text-emerald-900">
        <!-- Header -->
        <header
            class="container mx-auto px-6 py-8 flex justify-between items-center bg-white/70 backdrop-blur-2xl sticky top-0 z-50 border-b border-emerald-50/50">
            <div class="flex items-center gap-4 group cursor-pointer" @click="router.push('/')">
                <div
                    class="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-2xl shadow-emerald-200 group-hover:rotate-12 transition-transform overflow-hidden">
                    <img src="/pwa-192x192.png" alt="EduLog Logo" class="w-full h-full object-cover" />
                </div>
                <span class="text-3xl font-black text-gray-900 tracking-tighter">EduLog</span>
            </div>
            <div class="flex items-center gap-4">
                <div class="hidden md:flex gap-1 text-xs font-bold bg-gray-100 rounded-xl p-1">
                    <button @click="preferences.locale = 'zh-TW'"
                        :class="{ 'bg-white shadow-sm text-emerald-600': preferences.locale === 'zh-TW', 'text-gray-400 hover:text-gray-600': preferences.locale !== 'zh-TW' }"
                        class="px-3 py-1.5 rounded-lg transition-all active:scale-95">
                        中文
                    </button>
                    <button @click="preferences.locale = 'en'"
                        :class="{ 'bg-white shadow-sm text-emerald-600': preferences.locale === 'en', 'text-gray-400 hover:text-gray-600': preferences.locale !== 'en' }"
                        class="px-3 py-1.5 rounded-lg transition-all active:scale-95">
                        English
                    </button>
                </div>
                <button @click="router.push('/login')"
                    class="px-8 py-3 bg-gray-900 text-white rounded-2xl font-black hover:bg-emerald-600 transition-all shadow-xl hover:shadow-emerald-200 active:scale-95">
                    {{ $t('auth.submit') }}
                </button>
            </div>
        </header>

        <!-- Hero Section -->
        <main class="flex-grow container mx-auto px-6 py-24 md:py-32 text-center relative overflow-hidden">
            <!-- Decoration -->
            <div
                class="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-emerald-50/50 blur-[120px] rounded-full -z-10">
            </div>

            <div class="animate-in fade-in slide-in-from-bottom-8 duration-700">
                <h1 class="text-6xl md:text-8xl font-black text-gray-900 mb-10 leading-[0.95] tracking-tighter">
                    {{ $t('landing.title_prefix') }}<br>
                    <span
                        class="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent italic px-2">{{
                            $t('landing.title_highlight') }}</span>
                </h1>
                <p
                    class="text-xl md:text-3xl text-gray-500 mb-16 max-w-3xl mx-auto leading-relaxed font-semibold italic">
                    {{ $t('landing.subtitle') }}
                </p>
                <button @click="handleGetStarted"
                    class="px-12 py-6 bg-emerald-600 text-white rounded-[2rem] font-black text-2xl hover:bg-emerald-700 transition-all shadow-2xl shadow-emerald-200 hover:-translate-y-2 active:translate-y-0 flex items-center gap-4 mx-auto group">
                    {{ $t('landing.get_started') }}
                    <svg xmlns="http://www.w3.org/2000/svg"
                        class="h-8 w-8 group-hover:translate-x-2 transition-transform" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                            d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </button>
            </div>
        </main>

        <!-- Features Section -->
        <section class="container mx-auto px-6 py-32 border-t border-emerald-50">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-16">
                <div
                    class="p-10 bg-emerald-50/30 rounded-[3rem] border border-emerald-100 hover:bg-white hover:shadow-2xl hover:shadow-emerald-200 transition-all group">
                    <div
                        class="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mb-8 shadow-sm group-hover:bg-emerald-600 group-hover:text-white transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <h3 class="text-3xl font-black mb-6 text-gray-900 tracking-tight">{{ $t('landing.realtime_title') }}
                    </h3>
                    <p class="text-gray-600 text-lg leading-relaxed font-medium">{{ $t('landing.realtime_desc') }}</p>
                </div>

                <div
                    class="p-10 bg-emerald-50/30 rounded-[3rem] border border-emerald-100 hover:bg-white hover:shadow-2xl hover:shadow-emerald-200 transition-all group">
                    <div
                        class="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mb-8 shadow-sm group-hover:bg-emerald-600 group-hover:text-white transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                        </svg>
                    </div>
                    <h3 class="text-3xl font-black mb-6 text-gray-900 tracking-tight">{{ $t('landing.split_title') }}
                    </h3>
                    <p class="text-gray-600 text-lg leading-relaxed font-medium">{{ $t('landing.split_desc') }}</p>
                </div>

                <div
                    class="p-10 bg-emerald-50/30 rounded-[3rem] border border-emerald-100 hover:bg-white hover:shadow-2xl hover:shadow-emerald-200 transition-all group">
                    <div
                        class="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mb-8 shadow-sm group-hover:bg-emerald-600 group-hover:text-white transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                    </div>
                    <h3 class="text-3xl font-black mb-6 text-gray-900 tracking-tight">{{ $t('landing.private_title') }}
                    </h3>
                    <p class="text-gray-600 text-lg leading-relaxed font-medium">{{ $t('landing.private_desc') }}</p>
                </div>
            </div>
        </section>

        <!-- Final CTA -->
        <section class="container mx-auto px-6 py-24">
            <div class="bg-gray-900 rounded-[4rem] p-16 md:p-32 text-center relative overflow-hidden">
                <div class="absolute -top-24 -right-24 w-96 h-96 bg-emerald-600/20 blur-[100px] rounded-full"></div>
                <div class="relative z-10">
                    <h2 class="text-5xl md:text-7xl font-black text-white mb-12 tracking-tighter">{{
                        $t('landing.cta_title') }}</h2>
                    <button @click="handleGetStarted"
                        class="px-16 py-7 bg-emerald-600 text-white rounded-[2.5rem] font-black text-3xl hover:bg-emerald-50 hover:text-emerald-900 transition-all shadow-2xl hover:-translate-y-2 active:translate-y-0">
                        {{ $t('landing.get_started') }}
                    </button>
                </div>
            </div>
        </section>

        <!-- Footer -->
        <footer class="container mx-auto px-6 py-20 text-center text-gray-400 font-bold italic tracking-wide">
            <p>{{ $t('landing.copyright', { year: new Date().getFullYear() }) }}</p>
        </footer>
    </div>
</template>

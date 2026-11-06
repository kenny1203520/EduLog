<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { computed } from 'vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'
import { useAccountIdentity } from '@/composables/useAccountIdentity'

const auth = useAuthStore()
const { accountDisplayName, accountInitial } = useAccountIdentity()

const getStartedRoute = computed(() => auth.isAuthenticated ? '/dashboard' : '/login')
</script>

<template>
    <div class="min-h-screen bg-white flex flex-col selection:bg-emerald-100 selection:text-emerald-900">
        <!-- Header -->
        <header
            class="container mx-auto sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-emerald-50/50 bg-white/70 px-4 py-4 backdrop-blur-2xl sm:px-6 sm:py-6">
            <router-link to="/" class="group flex min-w-0 items-center gap-2 sm:gap-4">
                <div
                    class="h-10 w-10 shrink-0 bg-white sm:h-12 sm:w-12 rounded-2xl flex items-center justify-center shadow-2xl shadow-emerald-200 group-hover:rotate-12 transition-transform overflow-hidden">
                    <img src="/pwa-192x192.png" alt="EduLog Logo" class="w-full h-full object-cover" />
                </div>
                <span class="truncate text-xl font-black tracking-tighter text-gray-900 sm:text-3xl">EduLog</span>
            </router-link>
            <div class="flex shrink-0 items-center gap-2 sm:gap-3">
                <LanguageSwitcher align="right" />
                <router-link v-if="auth.isAuthenticated" :to="{ name: 'dashboard' }"
                    :aria-label="$t('landing.enter_app_as', { name: accountDisplayName })"
                    class="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gray-900 py-1.5 pl-1.5 pr-4 font-black text-white shadow-lg transition-colors hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:rounded-2xl sm:pr-6">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-white sm:rounded-xl" aria-hidden="true">{{ accountInitial || '?' }}</span>
                    <span>{{ $t('landing.enter_app') }}</span>
                </router-link>
                <router-link v-else to="/login"
                    class="flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-4 py-2.5 font-black text-white shadow-lg transition-all hover:bg-emerald-600 hover:shadow-emerald-200 active:scale-95 sm:rounded-2xl sm:px-7">
                    {{ $t('auth.submit') }}
                </router-link>
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
                <router-link :to="getStartedRoute"
                    class="px-12 py-6 bg-emerald-600 text-white rounded-[2rem] font-black text-2xl hover:bg-emerald-700 transition-all shadow-2xl shadow-emerald-200 hover:-translate-y-2 active:translate-y-0 flex items-center gap-4 mx-auto group">
                    {{ $t('landing.get_started') }}
                    <svg xmlns="http://www.w3.org/2000/svg"
                        class="h-8 w-8 group-hover:translate-x-2 transition-transform" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                            d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </router-link>
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
                    <router-link :to="getStartedRoute"
                        class="px-16 py-7 bg-emerald-600 text-white rounded-[2.5rem] font-black text-3xl hover:bg-emerald-50 hover:text-emerald-900 transition-all shadow-2xl hover:-translate-y-2 active:translate-y-0">
                        {{ $t('landing.get_started') }}
                    </router-link>
                </div>
            </div>
        </section>

        <!-- Footer -->
        <footer class="container mx-auto px-6 py-20 text-center text-gray-400 font-bold italic tracking-wide">
            <p>{{ $t('landing.copyright', { year: new Date().getFullYear() }) }}</p>
        </footer>
    </div>
</template>

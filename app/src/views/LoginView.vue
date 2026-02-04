<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'
import { useRouter } from 'vue-router'

const email = ref('')
const password = ref('')
const errorMsg = ref('')
const loading = ref(false)

const authStore = useAuthStore()
const router = useRouter()

async function handleLogin() {
    loading.value = true
    errorMsg.value = ''

    try {
        await authStore.signIn(email.value, password.value)
        router.push('/dashboard')
    } catch (e: any) {
        errorMsg.value = e.message || 'Login failed'
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <div
        class="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-6 bg-fixed overflow-hidden relative">
        <!-- Animated background accents -->
        <div class="absolute -top-40 -left-40 w-96 h-96 bg-emerald-200/40 rounded-full blur-3xl animate-pulse"></div>
        <div
            class="absolute -bottom-40 -right-40 w-96 h-96 bg-teal-200/40 rounded-full blur-3xl animate-pulse delay-1000">
        </div>

        <div
            class="bg-white/80 backdrop-blur-xl p-8 md:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-md border border-white ring-1 ring-emerald-100 flex flex-col items-center relative z-10 animate-in fade-in zoom-in duration-500">
            <div @click="router.push('/')"
                class="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center mb-10 shadow-xl shadow-emerald-200 transform hover:rotate-12 transition-transform cursor-pointer overflow-hidden border-4 border-white">
                <img src="/pwa-192x192.png" alt="EduLog Logo" class="w-full h-full object-cover" />
            </div>

            <h1 class="text-4xl font-black text-gray-900 mb-2 tracking-tight text-center">{{ $t('auth.login_title') }}
            </h1>
            <p class="text-gray-500 mb-10 font-medium italic">Welcome back to EduLog</p>

            <form @submit.prevent="handleLogin" class="space-y-6 w-full">
                <div class="space-y-2">
                    <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] ml-1">{{
                        $t('auth.email') }}</label>
                    <div class="relative group">
                        <input v-model="email" type="email" required
                            class="w-full border-gray-100 rounded-2xl px-5 py-4 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all outline-none bg-gray-50/50 focus:bg-white text-gray-800 placeholder-gray-400 font-medium"
                            :placeholder="$t('auth.email_placeholder')">
                        <div
                            class="absolute inset-0 border-2 border-transparent group-focus-within:border-emerald-500/20 rounded-2xl pointer-events-none transition-all">
                        </div>
                    </div>
                </div>

                <div class="space-y-2">
                    <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] ml-1">{{
                        $t('auth.password') }}</label>
                    <div class="relative group">
                        <input v-model="password" type="password" required
                            class="w-full border-gray-100 rounded-2xl px-5 py-4 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all outline-none bg-gray-50/50 focus:bg-white text-gray-800 placeholder-gray-400 font-medium"
                            :placeholder="$t('auth.password_placeholder')">
                        <div
                            class="absolute inset-0 border-2 border-transparent group-focus-within:border-emerald-500/20 rounded-2xl pointer-events-none transition-all">
                        </div>
                    </div>
                </div>

                <div v-if="errorMsg"
                    class="text-sm text-red-600 bg-red-50/50 backdrop-blur-sm p-4 rounded-2xl border border-red-100 flex items-center gap-2 animate-in slide-in-from-top-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" viewBox="0 0 20 20"
                        fill="currentColor">
                        <path fill-rule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                            clip-rule="evenodd" />
                    </svg>
                    {{ $t('auth.error_login', { msg: errorMsg }) }}
                </div>

                <button type="submit" :disabled="loading"
                    class="w-full bg-emerald-600 text-white font-black py-4.5 rounded-2xl hover:bg-emerald-700 hover:shadow-2xl hover:shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed group flex items-center justify-center gap-3 active:scale-95 overflow-hidden relative">
                    <div
                        class="absolute inset-0 bg-gradient-to-r from-emerald-400/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000">
                    </div>
                    <svg v-if="loading" class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg"
                        fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                        </circle>
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                        </path>
                    </svg>
                    <span class="relative z-10">{{ loading ? $t('auth.loading') : $t('auth.submit') }}</span>
                </button>
            </form>
        </div>
    </div>
</template>

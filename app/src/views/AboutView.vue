<script setup lang="ts">
const version = __APP_VERSION__
</script>

<template>
    <div class="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <!-- Header -->
        <div class="text-center space-y-4">
            <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-50 text-emerald-600 shadow-inner mb-2">
                <img src="/pwa-192x192.png" alt="EduLog Logo" class="w-16 h-16 rounded-xl shadow-md" />
            </div>
            <h1 class="text-4xl font-extrabold text-gray-900 tracking-tight">
                EduLog
            </h1>
            <p class="text-lg text-gray-500 max-w-2xl mx-auto">
                {{ $t('about.description') }}
            </p>
        </div>

        <!-- Info Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Version Card -->
            <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div class="flex items-center gap-4">
                    <div class="p-3 bg-blue-50 text-blue-600 rounded-xl">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-sm font-medium text-gray-500">{{ $t('about.version') }}</h3>
                        <p class="text-xl font-bold text-gray-900">v{{ version }}</p>
                    </div>
                </div>
            </div>

            <!-- Developer Card -->
            <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div class="flex items-center gap-4">
                    <div class="p-3 bg-purple-50 text-purple-600 rounded-xl">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-sm font-medium text-gray-500">{{ $t('about.developer') }}</h3>
                        <p class="text-xl font-bold text-gray-900">Kenny</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Links Section -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="p-6 border-b border-gray-50">
                <h2 class="text-lg font-bold text-gray-900">{{ $t('about.resources') }}</h2>
            </div>
            <div class="divide-y divide-gray-50">
                <router-link to="/dashboard/about/changelog" class="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group">
                    <div class="flex items-center gap-3">
                        <div class="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        <span class="font-medium text-gray-700">{{ $t('about.changelog') }}</span>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </router-link>
                <a href="mailto:support@kenny945.tk" class="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group">
                    <div class="flex items-center gap-3">
                        <div class="p-2 bg-orange-50 text-orange-600 rounded-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <span class="font-medium text-gray-700">{{ $t('about.contact') }}</span>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div class="text-center pt-8">
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

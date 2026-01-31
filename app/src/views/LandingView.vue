<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'

const router = useRouter()
const auth = useAuthStore()

function handleGetStarted() {
  if (auth.isAuthenticated) {
    router.push('/dashboard')
  } else {
    router.push('/login')
  }
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex flex-col">
    <!-- Header -->
    <header class="p-6 flex justify-between items-center max-w-7xl mx-auto w-full">
      <div class="text-2xl font-bold text-emerald-700">EduLog</div>
      <nav>
        <router-link to="/login" class="text-emerald-800 font-medium hover:text-emerald-600 transition">{{ $t('nav.login') }}</router-link>
      </nav>
    </header>

    <!-- Hero Section -->
    <main class="flex-1 flex flex-col items-center justify-center text-center px-4">
      <h1 class="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6 drop-shadow-sm">
        {{ $t('landing.title_prefix') }} <br/>
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">{{ $t('landing.title_highlight') }}</span>
      </h1>
      
      <p class="text-xl text-gray-600 max-w-2xl mb-10 leading-relaxed">
        {{ $t('landing.subtitle') }}
      </p>

      <div class="space-x-4">
        <button 
          @click="handleGetStarted"
          class="px-8 py-3 bg-emerald-600 text-white font-bold rounded-full shadow-lg hover:bg-emerald-700 hover:shadow-xl transform hover:-translate-y-1 transition duration-200"
        >
          {{ $t('nav.get_started') }}
        </button>
      </div>

      <!-- Feature Teaser -->
      <div class="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl text-left">
        <div class="bg-white/60 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-emerald-100">
          <div class="text-3xl mb-2">⚡</div>
          <h3 class="font-bold text-lg mb-2">{{ $t('landing.realtime_title') }}</h3>
          <p class="text-gray-600 text-sm">{{ $t('landing.realtime_desc') }}</p>
        </div>
        <div class="bg-white/60 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-emerald-100">
          <div class="text-3xl mb-2">📄</div>
          <h3 class="font-bold text-lg mb-2">{{ $t('landing.split_title') }}</h3>
          <p class="text-gray-600 text-sm">{{ $t('landing.split_desc') }}</p>
        </div>
        <div class="bg-white/60 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-emerald-100">
          <div class="text-3xl mb-2">🔒</div>
          <h3 class="font-bold text-lg mb-2">{{ $t('landing.private_title') }}</h3>
          <p class="text-gray-600 text-sm">{{ $t('landing.private_desc') }}</p>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="p-6 text-center text-gray-500 text-sm">
      {{ $t('landing.copyright', { year: new Date().getFullYear() }) }}
    </footer>
  </div>
</template>

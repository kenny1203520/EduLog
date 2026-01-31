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
        <router-link to="/login" class="text-emerald-800 font-medium hover:text-emerald-600 transition">Log In</router-link>
      </nav>
    </header>

    <!-- Hero Section -->
    <main class="flex-1 flex flex-col items-center justify-center text-center px-4">
      <h1 class="text-5xl md:text-6xl font-extrabold text-gray-900 mb-6 drop-shadow-sm">
        Streamline Your <br/>
        <span class="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-500">Student Reports</span>
      </h1>
      
      <p class="text-xl text-gray-600 max-w-2xl mb-10 leading-relaxed">
        The professional tool for tutors. Write reports in real-time, sync across devices, 
        and access student history instantly while you type.
      </p>

      <div class="space-x-4">
        <button 
          @click="handleGetStarted"
          class="px-8 py-3 bg-emerald-600 text-white font-bold rounded-full shadow-lg hover:bg-emerald-700 hover:shadow-xl transform hover:-translate-y-1 transition duration-200"
        >
          Get Started
        </button>
        <!-- Future: Learn More / Demo button -->
      </div>

      <!-- Feature Teaser -->
      <div class="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl text-left">
        <div class="bg-white/60 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-emerald-100">
          <div class="text-3xl mb-2">⚡</div>
          <h3 class="font-bold text-lg mb-2">Real-time Sync</h3>
          <p class="text-gray-600 text-sm">Write on your tablet during class, finish on your desktop later. Never lose progress.</p>
        </div>
        <div class="bg-white/60 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-emerald-100">
          <div class="text-3xl mb-2">📄</div>
          <h3 class="font-bold text-lg mb-2">Split-Pane View</h3>
          <p class="text-gray-600 text-sm">Reference past reports side-by-side while writing new ones. No more tab switching.</p>
        </div>
        <div class="bg-white/60 backdrop-blur-sm p-6 rounded-xl shadow-sm border border-emerald-100">
          <div class="text-3xl mb-2">🔒</div>
          <h3 class="font-bold text-lg mb-2">Private & Secure</h3>
          <p class="text-gray-600 text-sm">Your data belongs to you. Self-hosted database ensures complete privacy.</p>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="p-6 text-center text-gray-500 text-sm">
      &copy; {{ new Date().getFullYear() }} EduLog. All rights reserved.
    </footer>
  </div>
</template>

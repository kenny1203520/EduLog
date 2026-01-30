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
  <div class="p-8">
    <h1 class="text-2xl font-bold mb-4">Welcome, {{ auth.user?.email }}</h1>
    <p class="mb-4">You are securely logged in.</p>
    <button 
      @click="handleLogout"
      class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
    >
      Sign Out
    </button>
  </div>
</template>

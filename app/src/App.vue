<script setup lang="ts">
import { useAuthStore } from '@/stores/useAuthStore'
import { onMounted } from 'vue'

const auth = useAuthStore()

onMounted(() => {
  auth.initialize()
})
</script>

<template>
  <div v-if="auth.loading" class="flex items-center justify-center min-h-screen bg-gray-100">
    <p class="text-gray-500">Loading...</p>
  </div>
  <router-view v-else />
</template>

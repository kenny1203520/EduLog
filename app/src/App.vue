<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from './lib/supabase'

const status = ref('Connecting to Supabase...')
const errorMsg = ref('')

onMounted(async () => {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    status.value = 'Connected to Local Supabase! (No active session)'
    console.log('Session data:', data)
  } catch (e: any) {
    status.value = 'Connection Failed'
    errorMsg.value = e.message
    console.error(e)
  }
})
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen bg-gray-100 text-gray-800 font-sans">
    <div class="p-8 bg-white rounded-lg shadow-xl text-center max-w-md w-full">
      <h1 class="text-3xl font-bold mb-4 text-emerald-600">EduLog</h1>
      <p class="text-lg mb-4">Study Report Management System</p>
      
      <div class="p-4 rounded-md mb-4" :class="errorMsg ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'">
        <p class="font-semibold">{{ status }}</p>
        <p v-if="errorMsg" class="text-sm mt-2">{{ errorMsg }}</p>
      </div>

      <p class="text-sm text-gray-500">
        Edit <code class="bg-gray-200 px-1 rounded">components/HelloWorld.vue</code> to start building.
      </p>
    </div>
  </div>
</template>

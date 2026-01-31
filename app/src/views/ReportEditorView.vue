<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useStudentStore } from '@/stores/useStudentStore'
import { useReportStore } from '@/stores/useReportStore'
import SplitPaneLayout from '@/layouts/SplitPaneLayout.vue'

const route = useRoute()
const studentStore = useStudentStore()
const reportStore = useReportStore()

const studentId = computed(() => route.params.id as string)

// Editor State
const isSaving = ref(false)
const reportContent = ref('')
const reportDate = ref(new Date().toISOString().split('T')[0] || '')

onMounted(async () => {
  if (studentId.value) {
    await studentStore.loadStudent(studentId.value)
    await reportStore.fetchByStudent(studentId.value)
  }
})

async function handleSave() {
  const sId = route.params.id
  // Ensure sId is a simple string and current report has content
  if (typeof sId !== 'string' || !sId || !reportContent.value.trim()) return
  
  isSaving.value = true
  try {
    await reportStore.createReport(sId, reportContent.value, reportDate.value)
    reportContent.value = '' // Clear content after save
    // Optional: Show success toast
  } catch (e) {
    console.error(e)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="h-[calc(100vh-64px)] overflow-hidden"> <!-- Subtract Header Height -->
    <div v-if="studentStore.loading" class="p-8 text-center text-gray-500">Loading...</div>
    <div v-else-if="!studentStore.currentStudent" class="p-8 text-center text-red-500">Student not found</div>
    
    <div v-else class="h-full flex flex-col">
      <!-- Toolbar -->
      <header class="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm z-10">
        <div>
          <h1 class="text-xl font-bold text-gray-800">{{ studentStore.currentStudent.name }}</h1>
          <p class="text-xs text-gray-500">{{ studentStore.currentStudent.grade }}</p>
        </div>
        <div class="flex items-center space-x-3">
          <input 
            v-model="reportDate" 
            type="date" 
            class="border rounded px-2 py-1 text-sm text-gray-600 focus:ring-emerald-500 focus:border-emerald-500"
          >
          <button 
            @click="handleSave" 
            :disabled="isSaving || !reportContent.trim()"
            class="bg-emerald-600 text-white px-6 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm font-medium"
          >
            {{ isSaving ? 'Saving...' : 'Save Report' }}
          </button>
        </div>
      </header>

      <!-- Editor & History Split -->
      <div class="flex-1 overflow-hidden">
        <SplitPaneLayout>
          <!-- Left: History (Past Reports) -->
          <template #left>
            <div class="p-6">
              <h2 class="font-bold text-gray-500 text-xs mb-4 uppercase tracking-wide">History</h2>
              
              <div v-if="reportStore.loading" class="text-sm text-gray-400">Loading history...</div>
              <div v-else-if="reportStore.reports.length === 0" class="text-sm text-gray-400 italic">No past reports.</div>
              
              <div class="space-y-4">
                <article 
                  v-for="report in reportStore.reports" 
                  :key="report.id" 
                  class="bg-white p-4 rounded-lg border border-gray-100 shadow-sm hover:shadow-md transition"
                >
                  <div class="text-xs text-emerald-600 font-bold mb-2">{{ report.formattedDate }}</div>
                  <div class="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{{ report.content }}</div>
                </article>
              </div>
            </div>
          </template>

          <!-- Right: Editor (New Report) -->
          <template #right>
            <div class="h-full flex flex-col bg-white">
              <textarea 
                v-model="reportContent"
                placeholder="Write your report here..." 
                class="flex-1 w-full p-8 resize-none outline-none text-base leading-relaxed text-gray-800 placeholder-gray-300"
              ></textarea>
            </div>
          </template>
        </SplitPaneLayout>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useStudentStore } from '@/stores/useStudentStore'
import { useRouter } from 'vue-router'

const studentStore = useStudentStore()
const router = useRouter()

const showCreateModal = ref(false)
const newStudentName = ref('')
const newStudentGrade = ref('')

onMounted(() => {
  studentStore.fetchAll()
})

async function handleCreateStudent() {
  if (!newStudentName.value) return
  await studentStore.addStudent(newStudentName.value, newStudentGrade.value)
  showCreateModal.value = false
  newStudentName.value = ''
  newStudentGrade.value = ''
}

function navigateToStudent(id: string) {
  router.push({ name: 'student-report', params: { id } })
}

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
    // Optional: Add toast notification here
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">{{ $t('dashboard.title') }}</h2>
      <button 
        @click="showCreateModal = true"
        class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md transition shadow-sm font-medium cursor-pointer"
      >
        + {{ $t('dashboard.add_student') }}
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="studentStore.loading" class="text-gray-500 py-8 text-center">
      {{ $t('dashboard.loading') }}
    </div>

    <!-- Error State -->
    <div v-if="studentStore.error" class="bg-red-50 text-red-700 p-4 rounded-md mb-4 border border-red-200">
      {{ studentStore.error }}
    </div>

    <!-- Student Grid -->
    <div v-if="!studentStore.loading && studentStore.students.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div 
        v-for="student in studentStore.students" 
        :key="student.id"
        @click="navigateToStudent(student.id)"
        class="bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 cursor-pointer group overflow-hidden flex flex-col h-full"
      >
        <!-- Card Header -->
        <div class="p-6 pb-4 flex items-start justify-between">
          <div class="flex items-center gap-4">
            <!-- Avatar -->
            <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl font-bold uppercase shrink-0">
              {{ student.name.charAt(0) }}
            </div>
            <!-- Name & Info -->
            <div class="min-w-0">
              <h3 class="font-bold text-lg text-gray-900 truncate group-hover:text-emerald-700 transition">{{ student.name }}</h3>
              <p class="text-sm text-gray-500 truncate" :title="student.displaySchoolName">
                {{ student.displaySchoolName }}
              </p>
            </div>
          </div>
        </div>

        <!-- Card Body -->
        <div class="px-6 py-2 flex-1">
          <div class="flex items-center gap-2 mb-2">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              {{ student.displayGrade }}
            </span>
            <span v-if="student.displaySchoolId" class="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100 cursor-copy hover:bg-gray-100" @click.stop.prevent="copyToClipboard(student.displaySchoolId)">
              ID: {{ student.displaySchoolId }}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3">
                <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
              </svg>
            </span>
          </div>
        </div>

        <!-- Card Footer -->
        <div class="bg-gray-50 px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
           <div class="flex items-center gap-4">
               <!-- Credentials Count -->
               <div class="flex items-center gap-1" title="Credentials">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-gray-400">
                      <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clip-rule="evenodd" />
                   </svg>
                   <span>{{ student.credentials?.length || 0 }}</span>
               </div>
               <!-- Contacts Count -->
               <div class="flex items-center gap-1" title="Contacts">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-gray-400">
                       <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.532-2.411 1.618 1.618 0 0 0-1.448.387c.187.018.377.049.567.099v.003c.005.001.009.001.013.002a4.96 4.96 0 0 0 6 3.582 1.224 1.224 0 0 1 1.234 1.516l-.439 2.378a1.225 1.225 0 0 1-1.224.992H2.822a1.225 1.225 0 0 1-1.207-.992l-.439-2.378Z" />
                   </svg>
                   <span>{{ student.contacts?.length || 0 }}</span>
               </div>
           </div>
           
           <span class="text-gray-400">Added {{ new Date(student.created_at).toLocaleDateString() }}</span>
        </div>
      </div>
    </div>
    
    <!-- Empty State (v-else of Grid) -->
    <div v-else-if="!studentStore.loading" class="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300 shadow-sm">
      <div class="mx-auto w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-gray-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
      </div>
      <p class="text-gray-500 font-medium mb-1">{{ $t('dashboard.empty') }}</p>
      <p class="text-sm text-gray-400">{{ $t('dashboard.empty_sub') }}</p>
    </div>

    <!-- Simple Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white p-6 rounded-lg w-full max-w-md shadow-xl">
        <h3 class="text-xl font-bold mb-4">{{ $t('student.add_title') }}</h3>
        
        <form @submit.prevent="handleCreateStudent">
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('student.name') }}</label>
            <input 
              v-model="newStudentName" 
              type="text" 
              class="w-full border rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
              required
              :placeholder="$t('student.name')"
            />
          </div>
          
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('student.grade') }}</label>
            <input 
              v-model="newStudentGrade" 
              type="text" 
              class="w-full border rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"
              :placeholder="$t('student.grade')"
            />
          </div>

          <div class="flex justify-end space-x-3">
            <button 
              type="button" 
              @click="showCreateModal = false"
              class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition"
            >
              {{ $t('student.cancel') }}
            </button>
            <button 
              type="submit" 
              :disabled="studentStore.loading"
              class="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {{ $t('student.create') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

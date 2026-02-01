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

    <!-- Empty State -->
    <div v-if="!studentStore.loading && studentStore.students.length === 0" class="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
      <p class="text-gray-500 mb-2">{{ $t('dashboard.empty') }}</p>
      <p class="text-sm text-gray-400">{{ $t('dashboard.empty_sub') }}</p>
    </div>

    <!-- Student Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div 
        v-for="student in studentStore.students" 
        :key="student.id"
        @click="navigateToStudent(student.id)"
        class="bg-white p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer group"
      >
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-bold text-lg text-gray-800 group-hover:text-emerald-700 transition">{{ student.name }}</h3>
            <p class="text-sm text-gray-500">{{ student.grade || 'No Grade' }}</p>
          </div>
          <div class="bg-gray-100 p-2 rounded-full text-gray-400 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition">
            <!-- Icon placeholder -->
            <span class="text-emerald-600">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </span>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-gray-50 flex justify-between text-xs text-gray-400">
          <span>Added: {{ new Date(student.created_at).toLocaleDateString() }}</span>
        </div>
      </div>
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

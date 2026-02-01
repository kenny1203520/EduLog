<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useStudentStore } from '@/stores/useStudentStore'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Pagination from '@/components/common/Pagination.vue'

const { t } = useI18n()
const studentStore = useStudentStore()
const router = useRouter()

const showCreateModal = ref(false)
const newStudentName = ref('')
const newStudentGrade = ref('')

onMounted(() => {
  studentStore.fetchAll(studentStore.pagination.page, studentStore.pagination.perPage)
})

watch(() => studentStore.pagination.page, (newPage) => {
    studentStore.fetchAll(newPage, studentStore.pagination.perPage)
})

watch(() => studentStore.pagination.perPage, (newSize) => {
    studentStore.fetchAll(1, newSize)
})

async function handleCreateStudent() {
  if (!newStudentName.value) return
  await studentStore.addStudent(newStudentName.value)
  showCreateModal.value = false
  newStudentName.value = ''
  newStudentGrade.value = ''
}

function navigateToProfile(id: string) {
  router.push({ name: 'student-profile', params: { id } })
}

function navigateToReports(id: string) {
  // We need an enrollment ID for reports, but for now we link to profile
  // where the user can see enrollments.
  router.push({ name: 'student-profile', params: { id } })
}

const showSuccessToast = ref(false)
function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showSuccessToast.value = true
      setTimeout(() => { showSuccessToast.value = false }, 3000)
    })
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex justify-between items-center flex-wrap gap-4">
      <h2 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('common.students') }}</h2>
      <button 
        @click="showCreateModal = true"
        class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-emerald-200 font-bold flex items-center gap-2 active:scale-95"
      >
        <span class="text-xl">+</span> {{ $t('student.add_title') }}
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="studentStore.loading" class="text-center py-20 bg-white rounded-3xl border border-gray-100 shadow-sm">
      <svg class="animate-spin h-10 w-10 mx-auto mb-4 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p class="text-gray-500 font-medium">{{ $t('student.loading') }}</p>
    </div>

    <!-- Error State -->
    <div v-if="studentStore.error" class="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-100 animate-in fade-in slide-in-from-top-4">
      <div class="flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span class="font-bold">{{ studentStore.error }}</span>
      </div>
    </div>

    <!-- Student Grid -->
    <div v-if="!studentStore.loading && studentStore.students.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div 
        v-for="student in studentStore.students" 
        :key="student.id"
        class="bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group overflow-hidden flex flex-col h-full"
      >
        <!-- Card Header -->
        <div class="p-6 pb-4 flex items-start justify-between">
          <div class="flex items-center gap-4">
            <!-- Avatar -->
            <div class="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-2xl font-black uppercase shrink-0 group-hover:scale-110 transition-transform">
              {{ student.name.charAt(0) }}
            </div>
            <!-- Name & Info -->
            <div class="min-w-0">
              <h3 class="font-black text-xl text-gray-900 truncate group-hover:text-emerald-700 transition">{{ student.name }}</h3>
              <p class="text-sm text-gray-400 truncate font-medium" :title="student.displaySchoolName">
                {{ student.displaySchoolName || $t('student.management.no_school', 'No School Info') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Card Body -->
        <div class="px-6 py-2 flex-1 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center px-3 py-1 rounded-xl text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-100">
              {{ student.displayGrade || $t('student.management.no_grade', 'N/A') }}
            </span>
            <span 
              v-if="student.displaySchoolId" 
              class="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-400 bg-gray-50 px-2.5 py-1 rounded-xl border border-gray-100 cursor-copy hover:bg-gray-100 hover:text-emerald-600 transition-colors" 
              @click.stop.prevent="copyToClipboard(student.displaySchoolId)"
            >
              ID: {{ student.displaySchoolId }}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
                <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
              </svg>
            </span>
          </div>
        </div>

        <!-- Card Actions -->
        <div class="px-6 py-4 flex gap-2">
           <button 
             @click="navigateToProfile(student.id)"
             class="flex-1 bg-gray-50 hover:bg-emerald-50 text-gray-600 hover:text-emerald-700 py-2.5 rounded-xl text-sm font-bold transition-all border border-gray-100 hover:border-emerald-200"
           >
             {{ $t('common.edit') }}
           </button>
           <button 
             @click="navigateToReports(student.id)"
             class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-emerald-100 active:scale-95"
           >
             {{ $t('report.list_title') }}
           </button>
        </div>

        <!-- Card Footer -->
        <div class="bg-gray-50/50 px-6 py-3 border-t border-gray-50 flex items-center justify-between text-[10px] font-bold text-gray-400 tracking-wider uppercase">
           <div class="flex items-center gap-4">
               <div class="flex items-center gap-1.5" :title="$t('student.credentials_title')">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 opacity-50">
                      <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clip-rule="evenodd" />
                   </svg>
                   <span>{{ student.credentials?.length || 0 }}</span>
               </div>
               <div class="flex items-center gap-1.5" :title="$t('student.contacts_title')">
                   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 opacity-50">
                        <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.532-2.411 1.618 1.618 0 0 0-1.448.387c.187.018.377.049.567.099v.003c.005.001.009.001.013.002a4.96 4.96 0 0 0 6 3.582 1.224 1.224 0 0 1 1.234 1.516l-.439 2.378a1.225 1.225 0 0 1-1.224.992H2.822a1.225 1.225 0 0 1-1.207-.992l-.439-2.378Z" />
                   </svg>
                   <span>{{ student.contacts?.length || 0 }}</span>
               </div>
           </div>
           
           <span>{{ new Date(student.created_at).toLocaleDateString() }}</span>
        </div>
      </div>
    </div>
    
    <!-- Empty State -->
    <div v-else-if="!studentStore.loading" class="text-center py-32 bg-white rounded-[3rem] border border-dashed border-gray-200 shadow-sm flex flex-col items-center">
      <div class="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mb-8 shadow-inner">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 text-emerald-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
      </div>
      <h3 class="text-2xl font-black text-gray-900 mb-2">{{ $t('dashboard.empty') }}</h3>
      <p class="text-gray-400 font-medium max-w-xs">{{ $t('dashboard.empty_sub') }}</p>
    </div>

    <!-- Pagination -->
    <div v-if="!studentStore.loading && studentStore.pagination.total > 0" class="mt-12 flex justify-center">
        <Pagination 
            v-model="studentStore.pagination.page"
            v-model:perPage="studentStore.pagination.perPage"
            :totalItems="studentStore.pagination.total"
        />
    </div>

    <!-- Create Student Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div class="bg-white p-10 rounded-[2.5rem] w-full max-w-md shadow-2xl animate-in zoom-in fade-in duration-300">
        <h3 class="text-3xl font-black text-gray-900 mb-8 tracking-tight">{{ $t('student.add_title') }}</h3>
        
        <form @submit.prevent="handleCreateStudent" class="space-y-6">
          <div class="space-y-2">
            <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{ $t('student.name') }}</label>
            <input 
              v-model="newStudentName" 
              type="text" 
              class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold placeholder-gray-300"
              required
              :placeholder="$t('student.name')"
            />
          </div>
          
          <div class="space-y-2">
            <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{ $t('student.grade') }}</label>
            <input 
              v-model="newStudentGrade" 
              type="text" 
              class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold placeholder-gray-300"
              :placeholder="$t('student.grade')"
            />
          </div>

          <div class="flex gap-4 pt-4">
            <button 
              type="button" 
              @click="showCreateModal = false"
              class="flex-1 px-8 py-4 text-gray-400 hover:text-gray-600 font-black transition-colors"
            >
              {{ $t('common.cancel') }}
            </button>
            <button 
              type="submit" 
              :disabled="studentStore.loading"
              class="flex-1 px-8 py-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 disabled:opacity-50 font-black active:scale-95"
            >
              {{ $t('common.add') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Success Toast -->
    <div 
      v-if="showSuccessToast"
      class="fixed bottom-10 right-10 bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-10 duration-500 z-[100]"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
      </svg>
      <span class="font-black tracking-wide">{{ $t('common.copy_success') }}</span>
    </div>
  </div>
</template>

<template>
  <div class="student-reports-view p-6 max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold text-gray-900 mb-6">{{ $t('report.list_title') }}</h1>
-
    <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-gray-500 bg-white rounded-2xl shadow-sm border border-gray-100">
      <svg class="animate-spin h-10 w-10 mb-4 text-emerald-500" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
      </svg>
      <p class="font-medium">{{ $t('report.loading_full') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Calendar Section -->
      <div class="lg:col-span-1">
        <OccurrenceCalendar 
          :occurrences="occurrences"
          @select-occurrence="selectOccurrence"
        />
        <div v-if="occurrences.length === 0" class="mt-4 p-4 bg-amber-50 rounded-xl text-amber-700 text-xs border border-amber-200 shadow-sm">
          {{ $t('report.no_occurrences') }}
        </div>
      </div>

      <!-- Editor Section -->
      <div class="lg:col-span-2">
        <div v-if="selectedOccurrence && selectedReport">
          <!-- Occurrence Info Card -->
          <div class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-5 mb-6 border border-emerald-100 shadow-sm">
            <h2 class="font-bold text-gray-900 text-lg mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {{ selectedOccurrence.displayString }}
            </h2>
            <div class="text-sm text-gray-600 grid grid-cols-2 gap-4">
              <div class="bg-white/50 p-2 rounded-lg">
                <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{ $t('report.status') }}</span>
                <span class="text-gray-800 font-medium">{{ selectedOccurrence.status }}</span>
              </div>
              <div v-if="selectedOccurrence.effectiveStartTime" class="bg-white/50 p-2 rounded-lg">
                <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{ $t('report.time') }}</span>
                <span class="text-gray-800 font-medium">{{ selectedOccurrence.effectiveStartTime }} - {{ selectedOccurrence.effectiveEndTime }}</span>
              </div>
              <div v-if="selectedReport.updatedAt" class="col-span-2 bg-white/50 p-2 rounded-lg flex items-center justify-between">
                <div>
                    <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{ $t('report.last_updated') }}</span>
                    <span class="text-gray-800 font-medium">{{ selectedReport.updatedAt.toLocaleString() }}</span>
                </div>
                <span v-if="selectedReport.lastEditedBy" class="text-[10px] text-gray-400 font-bold italic">By: {{ selectedReport.lastEditedBy }}</span>
              </div>
            </div>
          </div>

          <!-- Report Editor -->
          <ReportEditor
            :report-id="selectedReport.id"
            :initial-content="selectedReport.content"
            :initial-version="selectedReport.version"
            :title="`Report for ${selectedOccurrence.displayString}`"
            :show-manual-save="true"
            @save-success="handleSaveSuccess"
            @save-error="handleSaveError"
            @conflict="handleConflict"
          />
        </div>

        <!-- Empty State -->
        <div v-else class="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center h-full flex flex-col items-center justify-center min-h-[400px]">
          <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm ring-1 ring-gray-100">
            <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </div>
          <h3 class="text-xl font-bold text-gray-800 mb-3">
            {{ occurrences.length > 0 ? $t('report.no_occurrence_selected') : $t('report.no_reports_available') }}
          </h3>
          <p class="text-gray-500 max-w-sm mx-auto leading-relaxed">
            {{ occurrences.length > 0 ? $t('report.no_occurrence_selected_desc') : $t('report.no_reports_available_desc') }}
          </p>
        </div>
      </div>
    </div>

    <!-- Conflict Resolution Modal -->
    <ConflictModal
      :is-open="showConflictModal"
      :server-content="conflictServerContent"
      :local-content="conflictLocalContent"
      @close="closeConflictModal"
      @resolve="resolveConflict"
    />

    <!-- Success Toast -->
    <div 
      v-if="showSuccessToast"
      class="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-slide-up z-[100] border border-emerald-500"
    >
      <div class="bg-white/20 p-1 rounded-full">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      <span class="font-bold tracking-wide">{{ $t('report.save_success') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import OccurrenceCalendar from '@/components/OccurrenceCalendar.vue'
import ReportEditor from '@/components/ReportEditor.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import { CourseService } from '@/services/CourseService'
import { ClassOccurrence } from '@/models/ClassOccurrence'
import { OccurrenceReport } from '@/models/OccurrenceReport'

const route = useRoute()

const loading = ref(true)
const occurrences = ref<ClassOccurrence[]>([])
const selectedOccurrence = ref<ClassOccurrence | null>(null)
const selectedReport = ref<OccurrenceReport | null>(null)
const showConflictModal = ref(false)
const conflictServerContent = ref('')
const conflictLocalContent = ref('')
const showSuccessToast = ref(false)

// Lifecycle
onMounted(async () => {
  await loadOccurrences()
})

// Methods
async function loadOccurrences() {
  try {
    loading.value = true
    const enrollmentId = route.params.enrollmentId as string
    if (!enrollmentId) return

    // Fetch enrollment to get session ID
    const enrollment = await CourseService.getEnrollmentById(enrollmentId)
    if (!enrollment || !enrollment.classSessionId) {
      console.warn('Enrollment not found or no class session assigned')
      loading.value = false
      return
    }

    // Load occurrences: 4 weeks ago to 8 weeks ahead
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 28) // 4 weeks ago
    
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 56) // 8 weeks forward

    const data = await OccurrenceService.getOccurrencesByDateRange(
      startDate, 
      endDate, 
      [enrollment.classSessionId]
    )
    occurrences.value = data
  } catch (error) {
    console.error('Failed to load occurrences:', error)
  } finally {
    loading.value = false
  }
}

async function selectOccurrence(occurrence: ClassOccurrence) {
  selectedOccurrence.value = occurrence

  try {
    // Get or create report for this occurrence
    const enrollmentId = route.params.enrollmentId as string
    if (!enrollmentId || !occurrence.id) return

    const report = await OccurrenceReportService.getOrCreateReport(
      enrollmentId,
      occurrence.id
    )
    selectedReport.value = report
  } catch (error) {
    console.error('Failed to load report:', error)
  }
}

function handleSaveSuccess(newVersion: number) {
  if (selectedReport.value) {
    selectedReport.value.version = newVersion
  }

  // Show success toast
  showSuccessToast.value = true
  setTimeout(() => {
    showSuccessToast.value = false
  }, 3000)
}

function handleSaveError(error: string) {
  alert(`Failed to save report: ${error}`)
}

function handleConflict(serverContent: string) {
  conflictServerContent.value = serverContent
  conflictLocalContent.value = selectedReport.value?.content || ''
  showConflictModal.value = true
}

function closeConflictModal() {
  showConflictModal.value = false
}

async function resolveConflict(resolvedContent: string) {
  if (!selectedReport.value) return

  try {
    const report = await OccurrenceReportService.resolveConflict(
      selectedReport.value.id!,
      resolvedContent
    )
    
    selectedReport.value = report
    showConflictModal.value = false

    // Show success toast
    showSuccessToast.value = true
    setTimeout(() => {
      showSuccessToast.value = false
    }, 3000)
  } catch (error) {
    console.error('Failed to resolve conflict:', error)
    alert('Failed to resolve conflict')
  }
}
</script>

<style scoped>
@keyframes slide-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}
</style>

<template>
  <div class="student-reports-view p-6 max-w-7xl mx-auto">
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Class Reports</h1>

    <div v-if="loading" class="flex flex-col items-center justify-center py-20 text-gray-500">
      <svg class="animate-spin h-10 w-10 mb-4" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
      </svg>
      <p>Loading reports and calendar...</p>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Calendar Section -->
      <div class="lg:col-span-1">
        <OccurrenceCalendar 
          :occurrences="occurrences"
          @select-occurrence="selectOccurrence"
        />
        <div v-if="occurrences.length === 0" class="mt-4 p-4 bg-amber-50 rounded-lg text-amber-700 text-sm border border-amber-200">
          No occurrences found for this session. Reports cannot be created until occurrences are generated.
        </div>
      </div>

      <!-- Editor Section -->
      <div class="lg:col-span-2">
        <div v-if="selectedOccurrence && selectedReport">
          <!-- Occurrence Info Card ... (existing card) -->
          <div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 mb-4 border border-blue-200">
            <h2 class="font-semibold text-gray-900 mb-2">
              {{ selectedOccurrence.displayString }}
            </h2>
            <div class="text-sm text-gray-600 space-y-1">
              <p><strong>Status:</strong> {{ selectedOccurrence.status }}</p>
              <p v-if="selectedOccurrence.effectiveStartTime">
                <strong>Time:</strong> {{ selectedOccurrence.effectiveStartTime }} - {{ selectedOccurrence.effectiveEndTime }}
              </p>
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
        <div v-else class="bg-gray-50 rounded-lg border-2 border-dashed border-gray-300 p-12 text-center h-full flex flex-col items-center justify-center">
          <svg class="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <h3 class="text-lg font-medium text-gray-900 mb-2">
            {{ occurrences.length > 0 ? 'No Occurrence Selected' : 'No Reports Available' }}
          </h3>
          <p class="text-gray-600">
            {{ occurrences.length > 0 ? 'Select a class occurrence from the calendar to view or edit its report.' : 'This session has no scheduled occurrences yet.' }}
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
      class="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-slide-up"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
      Report saved successfully!
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

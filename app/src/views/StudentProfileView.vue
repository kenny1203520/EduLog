<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useStudentStore } from '@/stores/useStudentStore'
import { StudentService } from '@/services/StudentService'
import { CourseService } from '@/services/CourseService'
import { Course } from '@/models/Course'
import { Classroom, type ClassSessionDTO } from '@/models/Classroom'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const studentStore = useStudentStore()
const studentId = computed(() => route.params.id as string)

// Form State for Main Details
const form = ref({
  name: '',
  gov_id: '',
  email: '',
  phone: '',
  residence_address: '',
  mailing_address: '',
  notes: ''
})

// UI State
const isSaving = ref(false)
const isEditingMainDetails = ref(false)

function toggleEditMainDetails() {
  if (isEditingMainDetails.value) {
    // Cancel editing: revert form to current student data
    populateForm()
    isEditingMainDetails.value = false
  } else {
    // Start editing
    isEditingMainDetails.value = true
  }
}

// Load Data
onMounted(async () => {
  if (studentId.value) {
    await studentStore.loadStudent(studentId.value)
    populateForm()
    fetchEnrollments()
  }
})

function populateForm() {
  const s = studentStore.currentStudent
  if (!s) return
  form.value = {
    name: s.name,
    gov_id: s.gov_id,
    email: s.email,
    phone: s.phone,
    residence_address: s.residence_address,
    mailing_address: s.mailing_address,
    notes: s.notes
  }
}

// --- Main Student Update ---
async function saveMainDetails() {
  isSaving.value = true
  try {
    await studentStore.updateStudent(studentId.value, form.value)
    // Success feedback could go here
  } catch (e) {
    console.error(e)
    alert('Failed to save details')
  } finally {
    isSaving.value = false
    isEditingMainDetails.value = false
  }
}

async function handleDeleteStudent() {
  if (!confirm(t('student.confirm_delete_student'))) return
  
  try {
    await studentStore.deleteStudent(studentId.value)
    router.push('/dashboard')
  } catch (e: any) {
    console.error(e)
    alert('Failed to delete student: ' + (e.message || e))
  }
}

// --- Contacts Management ---
const newContact = ref({ name: '', relation: '', phone: '', email: '' })
async function addContact() {
  if (!newContact.value.name) return
  try {
    await StudentService.addContact({ ...newContact.value, student_id: studentId.value })
    newContact.value = { name: '', relation: '', phone: '', email: '' } // Reset
    await studentStore.loadStudent(studentId.value) // Refresh
  } catch (e) {
    console.error(e)
  }
}
const enrollments = ref<Enrollment[]>([])
const availableCourses = ref<Course[]>([])
const availableClassrooms = ref<Classroom[]>([])
const availableSessions = ref<ClassSessionDTO[]>([])
const isEnrollModalOpen = ref(false)
const newEnrollment = ref<Partial<EnrollmentDTO>>({ status: 'active' })

const filteredSessions = computed(() => {
    if (!newEnrollment.value.course_id) return []
    return availableSessions.value.filter(s => s.course_ids.includes(newEnrollment.value.course_id!))
})

// Watch Session Selection to Auto-Set Classroom
watch(() => newEnrollment.value.class_session_id, (sessionId) => {
    if (sessionId) {
        const session = availableSessions.value.find(s => s.id === sessionId)
        if (session && session.classroom_id) {
            newEnrollment.value.classroom_id = session.classroom_id
        }
    }
})

async function fetchEnrollments() {
  if (!studentId.value) return
  enrollments.value = await CourseService.getStudentEnrollments(studentId.value)
}

async function openEnrollModal() {
  isEnrollModalOpen.value = true
  // Fetch all data needed
  const [courses, rooms, sessions] = await Promise.all([
      CourseService.getCourses(),
      CourseService.getClassrooms(),
      CourseService.getClassSessions()
  ])
  availableCourses.value = courses
  availableClassrooms.value = rooms
  availableSessions.value = sessions
  
  newEnrollment.value = { student_id: studentId.value, status: 'active' }
}

async function enrollStudent() {
  if (!newEnrollment.value.course_id) return
  try {
    await CourseService.enrollStudent({
      ...newEnrollment.value,
      student_id: studentId.value
    })
    await fetchEnrollments()
    isEnrollModalOpen.value = false
  } catch (e) {
    alert(e)
  }
}

async function removeEnrollment(id: string) {
    if(!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteEnrollment(id)
        await fetchEnrollments()
    } catch(e) {
        alert(e)
    }
}
async function deleteContact(id: string) {
  if (!confirm(t('student.contacts.confirm_delete'))) return
  await StudentService.deleteContact(id)
  await studentStore.loadStudent(studentId.value)
}

// --- Schools Management ---
const schoolStatusOptions = ['enrolled', 'graduated', 'incomplete', 'suspended']
const newSchool = ref({ name: '', status: '', grade: '', class: '', start_date: '', end_date: '', school_student_id: '' })

async function addSchool() {
  // Name can be empty, but status is strictly required
  if (!newSchool.value.status) {
      alert(t('student.schools.status') + ' is required')
      return;
  }

  // Validation Logic
  if (newSchool.value.status === 'enrolled') {
      // Enrolled: Grade & Start Date required. End Date optional (implies Present)
      if (!newSchool.value.grade) {
          alert(t('student.schools.grade_required'))
          return
      }
      if (!newSchool.value.start_date) {
          alert(t('student.schools.start_date') + ' is required for Enrolled status')
          return
      }
  } else {
      // Graduated, Incomplete, Suspended: Start & End Date required. Grade NOT required.
      if (!newSchool.value.start_date || !newSchool.value.end_date) {
          alert(t('student.schools.start_date') + ' and ' + t('student.schools.end_date') + ' are required')
          return
      }
  }
  
  try {
    await StudentService.addSchool({ ...newSchool.value, student_id: studentId.value })
    newSchool.value = { name: '', status: '', grade: '', class: '', start_date: '', end_date: '', school_student_id: '' }
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
  }
}
async function deleteSchool(id: string) {
  if (!confirm(t('student.schools.confirm_delete'))) return
  await StudentService.deleteSchool(id)
  await studentStore.loadStudent(studentId.value)
}

// --- Credentials Management ---
const newCredential = ref({ platform: 'Orange Apple', custom_platform: '', username: '', password: '', url: '' })
const platforms = ['Orange Apple', 'Roblox', 'Minecraft', 'Anydesk', 'Quiz Platform', 'Other']

async function addCredential() {
  if (!newCredential.value.platform) return
  
  let finalPlatform = newCredential.value.platform
  if (finalPlatform === 'Other' && newCredential.value.custom_platform) {
      finalPlatform = newCredential.value.custom_platform
  }

  const payload = {
    ...newCredential.value,
    platform: finalPlatform,
    student_id: studentId.value
  }
  delete (payload as any).custom_platform

  try {
    await StudentService.addCredential(payload)
    newCredential.value = { platform: 'Orange Apple', custom_platform: '', username: '', password: '', url: '' }
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
  }
}
async function deleteCredential(id: string) {
  if (!confirm(t('student.credentials.confirm_delete'))) return
  await StudentService.deleteCredential(id)
  await studentStore.loadStudent(studentId.value)
}

// --- Editing State & Functions ---

// Contacts Editing (No changes needed)
const editingContactId = ref<string | null>(null)
const editContactForm = ref({ name: '', relation: '', phone: '', email: '' })

function startEditContact(contact: any) {
  editingContactId.value = contact.id
  editContactForm.value = { ...contact }
}

function cancelEditContact() {
  editingContactId.value = null
  editContactForm.value = { name: '', relation: '', phone: '', email: '' }
}

async function saveContact() {
  if (!editingContactId.value) return
  try {
    await StudentService.updateContact(editingContactId.value, editContactForm.value)
    cancelEditContact()
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
    alert('Failed to update contact')
  }
}

// Schools Editing
const editingSchoolId = ref<string | null>(null)
const editSchoolForm = ref({ name: '', status: '', grade: '', class: '', start_date: '', end_date: '', school_student_id: '' })

function startEditSchool(school: any) {
  editingSchoolId.value = school.id
  editSchoolForm.value = { ...school }
}

function cancelEditSchool() {
  editingSchoolId.value = null
  editSchoolForm.value = { name: '', status: '', grade: '', class: '', start_date: '', end_date: '', school_student_id: '' }
}

async function saveSchool() {
  if (!editingSchoolId.value) return
  
  // Validation Logic (Same as Add)
  if (!editSchoolForm.value.status) {
      alert(t('student.schools.status') + ' is required')
      return;
  }
  if (editSchoolForm.value.status === 'enrolled') {
      if (!editSchoolForm.value.grade) {
          alert(t('student.schools.grade_required'))
          return
      }
      if (!editSchoolForm.value.start_date) {
          alert(t('student.schools.start_date') + ' is required for Enrolled status')
          return
      }
  } else {
      if (!editSchoolForm.value.start_date || !editSchoolForm.value.end_date) {
          alert(t('student.schools.start_date') + ' and ' + t('student.schools.end_date') + ' are required')
          return
      }
  }

  try {
    await StudentService.updateSchool(editingSchoolId.value, editSchoolForm.value)
    cancelEditSchool()
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
    alert('Failed to update school')
  }
}

// Credentials Editing
const editingCredentialId = ref<string | null>(null)
const editCredentialForm = ref({ platform: '', custom_platform: '', username: '', password: '', url: '' })

function startEditCredential(cred: any) {
  editingCredentialId.value = cred.id
  const isStandard = platforms.includes(cred.platform)
  
  editCredentialForm.value = { 
      ...cred,
      platform: isStandard ? cred.platform : 'Other',
      custom_platform: isStandard ? '' : cred.platform,
      url: cred.url || ''
  }
}

function cancelEditCredential() {
  editingCredentialId.value = null
  editCredentialForm.value = { platform: '', custom_platform: '', username: '', password: '', url: '' }
}

async function saveCredential() {
  if (!editingCredentialId.value) return

  let finalPlatform = editCredentialForm.value.platform
  if (finalPlatform === 'Other' && editCredentialForm.value.custom_platform) {
      finalPlatform = editCredentialForm.value.custom_platform
  }

  const payload = {
    ...editCredentialForm.value,
    platform: finalPlatform
  }
  delete (payload as any).custom_platform

  try {
    await StudentService.updateCredential(editingCredentialId.value, payload)
    cancelEditCredential()
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
    alert('Failed to update credential')
  }
}

// Password Visibility
const showPasswordMap = ref<Record<string, boolean>>({})
function togglePasswordVisibility(id: string) {
  showPasswordMap.value[id] = !showPasswordMap.value[id]
}

// --- Clipboard Utils ---
function copyToClipboard(text: string) {
  if (!text) return
  navigator.clipboard.writeText(text).then(() => {
    // Ideally we would show a toast, but for now we can just show a temporary "Copied!" text or rely on user action.
    // Let's assume the button icon might briefly change or we just quietly succeed.
    // For this MVP, we will not block flows.
  }).catch(err => {
    console.error('Failed to copy: ', err)
  })
}

// --- Date Picker Helper removed (using native inputs) ---
</script>

<template>
  <div v-if="studentStore.loading && !studentStore.currentStudent" class="p-8 text-center text-gray-500">
    {{ $t('student.loading') }}
  </div>
  
  <div v-else-if="studentStore.currentStudent" class="max-w-4xl mx-auto p-6 space-y-8">
    
    <!-- Header -->
    <div class="flex items-center justify-between border-b pb-4">
      <div>
        <h1 class="text-3xl font-bold text-gray-800">{{ studentStore.currentStudent.name }}</h1>
        <p class="text-gray-500">{{ studentStore.currentStudent.displayGrade }} • {{ studentStore.currentStudent.id }}</p>
      </div>
      <div class="space-x-3">
        <router-link 
          :to="`/dashboard/student/${studentId}`"
          class="text-emerald-600 hover:text-emerald-700 font-medium"
        >
          {{ $t('student.view_reports') }}
        </router-link>
      </div>
    </div>

    <!-- Main Details Form -->
    <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
      <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
        <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        </div>
        {{ $t('student.details') }}
      </h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.name') }}</label>
          <input v-if="isEditingMainDetails" v-model="form.name" type="text" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">{{ form.name || '-' }}</div>
        </div>
        
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.gov_id') }}</label>
          <input v-if="isEditingMainDetails" v-model="form.gov_id" type="text" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px] font-mono">{{ form.gov_id || '-' }}</div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('auth.email') }}</label>
          <input v-if="isEditingMainDetails" v-model="form.email" type="email" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">{{ form.email || '-' }}</div>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.contacts.phone') }}</label>
          <input v-if="isEditingMainDetails" v-model="form.phone" type="tel" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">{{ form.phone || '-' }}</div>
        </div>

        <div class="space-y-1.5 md:col-span-2">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.residence_address') }}</label>
          <input v-if="isEditingMainDetails" v-model="form.residence_address" type="text" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">{{ form.residence_address || '-' }}</div>
        </div>
        <div class="space-y-1.5 md:col-span-2">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.mailing_address') }}</label>
          <input v-if="isEditingMainDetails" v-model="form.mailing_address" type="text" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">{{ form.mailing_address || '-' }}</div>
        </div>
        
        <div class="space-y-1.5 md:col-span-2">
          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.notes') }}</label>
          <textarea v-if="isEditingMainDetails" v-model="form.notes" rows="3" class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400 resize-y"></textarea>
          <div v-else class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[86px] whitespace-pre-wrap">{{ form.notes || '-' }}</div>
        </div>
      </div>

      <div class="mt-8 flex justify-between items-center pt-6 border-t border-gray-100">
        <button 
          @click="handleDeleteStudent" 
          class="text-red-500 hover:text-red-700 text-sm font-medium hover:underline cursor-pointer flex items-center gap-1 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          {{ $t('student.delete') }}
        </button>

        <div class="flex items-center gap-2">
            <button 
              v-if="isEditingMainDetails"
              @click="toggleEditMainDetails" 
              class="text-gray-500 hover:text-gray-700 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            >
              {{ $t('student.cancel') }}
            </button>
            <button 
              @click="isEditingMainDetails ? saveMainDetails() : toggleEditMainDetails()" 
              :disabled="isSaving"
              class="bg-emerald-600 text-white px-8 py-2.5 rounded-lg shadow-sm hover:bg-emerald-700 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2 cursor-pointer"
            >
              <svg v-if="!isSaving && isEditingMainDetails" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <svg v-else-if="!isSaving" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
              </svg>
              <svg v-else class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ isSaving ? $t('student.saving') : (isEditingMainDetails ? $t('student.save_details') : $t('student.edit')) }}
            </button>
        </div>
      </div>
    </section>

    <!-- Sub Sections Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      
      <!-- Contacts -->
      <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit transition-all hover:shadow-md">
        <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
          <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          </div>
          {{ $t('student.sections.contacts') }}
        </h2>
        
        <ul class="space-y-4 mb-8">
          <li v-for="c in studentStore.currentStudent.contacts" :key="c.id" class="bg-gray-50 p-4 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
            <div v-if="editingContactId !== c.id" class="flex justify-between items-start">
              <div>
                <div class="font-bold text-gray-800 text-lg flex items-center gap-2">
                  {{ c.name }} 
                  <span class="text-xs text-gray-500 font-medium bg-white px-2 py-0.5 rounded-full border border-gray-100">{{ c.relation }}</span>
                </div>
                <div class="text-sm text-gray-600 mt-1 flex items-center gap-2 group">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                  </svg>
                  {{ c.phone }}
                  <button v-if="c.phone" @click="copyToClipboard(c.phone)" class="text-gray-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all ml-1 cursor-pointer" title="Copy">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                  </button>
                </div>
                <div class="text-sm text-gray-600 flex items-center gap-2 group">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                  {{ c.email }}
                  <button v-if="c.email" @click="copyToClipboard(c.email)" class="text-gray-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all ml-1 cursor-pointer" title="Copy">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="flex space-x-1">
                <button @click="startEditContact(c)" class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer" title="Edit">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button @click="deleteContact(c.id!)" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <!-- Edit Mode -->
            <div v-else class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <input v-model="editContactForm.name" placeholder="Name" class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                <input v-model="editContactForm.relation" placeholder="Relation" class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                <input v-model="editContactForm.phone" placeholder="Phone" class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                <input v-model="editContactForm.email" placeholder="Email" class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
              </div>
              <div class="flex justify-end space-x-2 pt-2">
                <button @click="cancelEditContact" class="text-gray-500 text-sm hover:text-gray-700 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer">{{ $t('student.cancel') }}</button>
                <button @click="saveContact" class="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer">{{ $t('student.save_details') }}</button>
              </div>
            </div>
          </li>
        </ul>

        <div class="border-t border-gray-100 pt-6">
          <h3 class="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            {{ $t('student.contacts.add_title') }}
          </h3>
          <div class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
            <div class="grid grid-cols-2 gap-3 mb-3">
              <input v-model="newContact.name" :placeholder="$t('student.contacts.name')" class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
              <input v-model="newContact.relation" :placeholder="$t('student.contacts.relation')" class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
              <input v-model="newContact.phone" :placeholder="$t('student.contacts.phone')" class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
              <input v-model="newContact.email" :placeholder="$t('student.contacts.email')" class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
            </div>
            <button @click="addContact" class="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {{ $t('student.contacts.add_btn') }}
            </button>
          </div>
        </div>
      </section>

      <!-- Schools -->
      <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit transition-all hover:shadow-md">
        <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
          <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 0 0-.491 6.347A48.627 48.627 0 0 1 12 20.904a48.627 48.627 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.57 50.57 0 0 0-2.658-.813A59.905 59.905 0 0 1 12 3.493a59.902 59.902 0 0 1 10.499 5.516 50.548 50.548 0 0 0-2.658.813m-15.482 0A50.697 50.697 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
            </svg>
          </div>
          {{ $t('student.sections.schools') }}
        </h2>
        
        <ul class="space-y-4 mb-8">
          <li v-for="s in studentStore.currentStudent.schools" :key="s.id" class="bg-gray-50 p-4 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
            <div v-if="editingSchoolId !== s.id" class="flex justify-between items-start">
              <div class="space-y-2">
                <div>
                    <div class="font-bold text-gray-800 text-lg">{{ s.name }}</div>
                    
                    <!-- ID, Grade, Class Row -->
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
                        <!-- Student ID -->
                        <div v-if="s.school_student_id" class="flex items-center gap-2 text-sm text-gray-600 group">
                            <span class="font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{{ $t('student.schools.school_student_id') }}</span>
                            <span class="font-mono text-gray-800 font-medium">{{ s.school_student_id }}</span>
                            <button @click="copyToClipboard(s.school_student_id)" class="text-gray-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all ml-0.5 cursor-pointer" title="Copy">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                </svg>
                            </button>
                        </div>

                        <!-- Grade -->
                        <div v-if="s.status === 'enrolled' && s.grade" class="flex items-center gap-2 text-sm text-gray-600">
                            <span class="font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{{ $t('student.schools.grade') }}</span>
                            <span class="font-medium text-gray-800">{{ s.grade }}</span>
                        </div>

                        <!-- Class -->
                        <div v-if="s.status === 'enrolled' && s.class" class="flex items-center gap-2 text-sm text-gray-600">
                            <span class="font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{{ $t('student.schools.class') }}</span>
                            <span class="font-medium text-gray-800">{{ s.class }}</span>
                        </div>
                    </div>
                </div>
                
                <div class="text-xs text-gray-500 flex flex-wrap items-center gap-2 mt-2">
                  <span v-if="s.status" class="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100 font-medium">{{ $t(`student.schools.status_options.${s.status}`) }}</span>
                  <span class="bg-white border border-gray-200 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
                    </svg>
                    {{ s.start_date }} - {{ s.end_date || $t('student.schools.present') }}
                  </span>
                </div>
              </div>
              <div class="flex space-x-1">
                <button @click="startEditSchool(s)" class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer" title="Edit">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button @click="deleteSchool(s.id!)" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Edit Mode -->
            <div v-else class="space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-1">
                   <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.name') }}</label>
                   <input v-model="editSchoolForm.name" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                </div>
                <div class="space-y-1">
                   <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.status') }}</label>
                   <select v-model="editSchoolForm.status" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                      <option value="" disabled>{{ $t('student.schools.status') }}</option>
                      <option v-for="opt in schoolStatusOptions" :key="opt" :value="opt">{{ $t(`student.schools.status_options.${opt}`) }}</option>
                   </select>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <!-- Student ID Field -->
                 <div class="space-y-1">
                   <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.school_student_id') }}</label>
                   <input v-model="editSchoolForm.school_student_id" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                 </div>

                 <div class="grid grid-cols-2 gap-4">
                     <div class="space-y-1">
                       <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.grade') }}</label>
                       <input v-model="editSchoolForm.grade" :disabled="editSchoolForm.status !== 'enrolled'" :placeholder="editSchoolForm.status !== 'enrolled' ? '-' : ''" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                     </div>
                     <div class="space-y-1">
                       <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.class') }}</label>
                       <input v-model="editSchoolForm.class" :disabled="editSchoolForm.status !== 'enrolled'" :placeholder="editSchoolForm.status !== 'enrolled' ? '-' : ''" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                     </div>
                 </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div class="space-y-1">
                   <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.start_date') }}</label>
                   <input type="date" v-model="editSchoolForm.start_date" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                   <p v-if="editSchoolForm.status === 'enrolled'" class="text-[10px] text-red-500 text-right mt-0.5">* {{ $t('student.required') }}</p>
                 </div>
                 
                 <div class="space-y-1">
                   <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.end_date') }}</label>
                   <input type="date" v-model="editSchoolForm.end_date" class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                   <p class="text-[10px] text-gray-400 text-right mt-0.5">{{ $t('student.schools.present') }}</p>
                 </div>
              </div>

              <div class="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <button @click="cancelEditSchool" class="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700 hover:bg-gray-100 rounded transition-colors cursor-pointer">{{ $t('student.cancel') }}</button>
                <button @click="saveSchool" class="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer">{{ $t('student.save_details') }}</button>
              </div>
            </div>
          </li>
        </ul>

        <div class="border-t border-gray-100 pt-6">
          <h3 class="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
             <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
             {{ $t('student.schools.add_title') }}
          </h3>
          
          <div class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
             <div class="grid grid-cols-2 md:grid-cols-2 gap-4 mb-4">
                <div class="space-y-1">
                   <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.name') }}</label>
                   <input v-model="newSchool.name" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                </div>
                <div class="space-y-1">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.status') }}</label>
                    <select v-model="newSchool.status" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                        <option value="" disabled selected>{{ $t('student.schools.status') }}</option>
                        <option v-for="opt in schoolStatusOptions" :key="opt" :value="opt">{{ $t(`student.schools.status_options.${opt}`) }}</option>
                    </select>
                </div>

                 <!-- Student ID Field -->
                 <div class="space-y-1">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.school_student_id') }}</label>
                    <input v-model="newSchool.school_student_id" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                 </div>

                 <div class="grid grid-cols-2 gap-4">
                     <div class="space-y-1">
                         <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.grade') }}</label>
                         <input v-model="newSchool.grade" :disabled="newSchool.status !== 'enrolled'" :placeholder="newSchool.status !== 'enrolled' ? '-' : ''" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                     </div>
                     <div class="space-y-1">
                         <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.class') }}</label>
                         <input v-model="newSchool.class" :disabled="newSchool.status !== 'enrolled'" :placeholder="newSchool.status !== 'enrolled' ? '-' : ''" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                     </div>
                 </div>
             </div>

             <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                 <div class="space-y-1">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.start_date') }}</label>
                     <input type="date" v-model="newSchool.start_date" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none">
                     <p v-if="newSchool.status === 'enrolled'" class="text-[10px] text-red-500 text-right mt-0.5">* {{ $t('student.required') }}</p>
                 </div>
                 
                 <div class="space-y-1">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.schools.end_date') }}</label>
                     <input type="date" v-model="newSchool.end_date" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none">
                     <p class="text-[10px] text-gray-400 text-right mt-0.5">{{ $t('student.schools.present') }}</p>
                 </div>
             </div>

             <button @click="addSchool" class="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                 <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
               </svg>
               {{ $t('student.schools.add_btn') }}
             </button>
          </div>
        </div>
      </section>
      <!-- Internal Courses -->
      <section class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
           <span class="p-1.5 bg-purple-100 text-purple-600 rounded-lg">
             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
               <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
             </svg>
           </span>
           {{ $t('internal_courses.title') }}
        </h2>

        <div v-if="enrollments.length === 0" class="text-center py-6 text-gray-400 text-sm italic bg-gray-50 rounded-xl mb-4 border border-dashed border-gray-200">
           {{ $t('internal_courses.no_enrollments') }}
        </div>

        <ul class="space-y-3 mb-6">
            <li v-for="enr in enrollments" :key="enr.id" class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl hover:shadow-sm transition-shadow">
               <div>
                   <div class="font-bold text-gray-800">{{ enr.courseSubject }} <span class="text-gray-500 font-normal text-sm">- {{ enr.courseStage }}</span></div>
                   <div class="text-xs text-gray-500 flex items-center gap-2 mt-1">
                       <span v-if="enr.classroomName" class="px-2 py-0.5 bg-gray-100 rounded text-gray-600">{{ enr.classroomName }}</span>
                       <span class="capitalize" :class="{'text-emerald-600': enr.status === 'active', 'text-gray-400': enr.status !== 'active'}">
                           {{ enr.status }}
                       </span>
                   </div>
               </div>
               <div class="flex items-center gap-2">
                   <router-link :to="{ name: 'lesson-reports', params: { enrollmentId: enr.id } }" class="text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded transition text-sm font-medium">
                        {{ $t('internal_courses.reports') }}
                   </router-link>
                   <button @click="removeEnrollment(enr.id!)" class="text-gray-400 hover:text-red-500 transition p-1 rounded hover:bg-red-50">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                   </button>
               </div>
            </li>
        </ul>

        <button @click="openEnrollModal" class="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-bold hover:border-emerald-500 hover:text-emerald-600 transition-colors flex items-center justify-center gap-2">
            <span>+</span> {{ $t('internal_courses.add_title') }}
        </button>
      </section>

      <!-- Enroll Modal -->
      <div v-if="isEnrollModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-white rounded-xl p-6 w-full max-w-md shadow-xl m-4">
            <h3 class="text-xl font-bold mb-4">{{ $t('internal_courses.add_title') }}</h3>
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('internal_courses.course') }}</label>
                    <select v-model="newEnrollment.course_id" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                        <option v-for="c in availableCourses" :key="c.id" :value="c.id">
                            {{ c.subject }} - {{ c.stage }}
                        </option>
                    </select>
                </div>
                
                <div v-if="newEnrollment.course_id">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Class Session (Optional)</label>
                    <select v-model="newEnrollment.class_session_id" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                        <option :value="undefined">-- Select Session --</option>
                        <option v-for="s in filteredSessions" :key="s.id" :value="s.id">
                            {{ s.name }} ({{ s.day_of_week !== undefined ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.day_of_week] : '' }} {{ s.start_time?.slice(0,5) }})
                        </option>
                        <option v-if="filteredSessions.length === 0" disabled>No sessions found for this course</option>
                    </select>
                    <p class="text-xs text-gray-400 mt-1">Selecting a session auto-fills the classroom.</p>
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('internal_courses.classroom') }}</label>
                    <select v-model="newEnrollment.classroom_id" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                        <option :value="undefined">-- None --</option>
                        <option v-for="r in availableClassrooms" :key="r.id" :value="r.id">
                            {{ r.name }}
                        </option>
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('internal_courses.status') }}</label>
                    <select v-model="newEnrollment.status" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="dropped">Dropped</option>
                    </select>
                </div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <!-- Hardcoded Cancel translation fallback -->
                <button @click="isEnrollModalOpen = false" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">{{ $t('common.cancel') || $t('student.cancel') }}</button>
                <button @click="enrollStudent" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">{{ $t('internal_courses.add_btn') }}</button>
            </div>
        </div>
      </div>

      <!-- Credentials -->
      <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 md:col-span-2 transition-all hover:shadow-md">
        <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
          <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
          </div>
          {{ $t('student.sections.credentials') }}
        </h2>
        
        <div class="overflow-x-auto rounded-xl border border-gray-100 mb-8">
          <table class="w-full text-sm text-left">
            <thead class="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
              <tr>
                <th class="px-4 py-3 font-semibold w-1/3">{{ $t('student.credentials.platform') }}</th>
                <th class="px-4 py-3 font-semibold">{{ $t('student.credentials.username') }}</th>
                <th class="px-4 py-3 font-semibold">{{ $t('student.credentials.password') }}</th>
                <th class="px-4 py-3 font-semibold text-right">{{ $t('student.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <template v-for="cred in studentStore.currentStudent.credentials" :key="cred.id">
                <!-- View Mode -->
                <tr v-if="editingCredentialId !== cred.id" class="bg-white hover:bg-gray-50 transition-colors">
                  <td class="px-4 py-3 font-medium text-gray-800">
                    <div class="flex items-center gap-2">
                      <span>{{ platforms.includes(cred.platform) ? $t(`student.credentials.platforms.${cred.platform}`) : cred.platform }}</span>
                      <a v-if="cred.url" :href="cred.url" target="_blank" class="text-emerald-600 hover:text-emerald-700" :title="cred.url">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                      </a>
                    </div>
                  </td>
                  <td class="px-4 py-3 text-gray-600 font-mono">{{ cred.username }}</td>
                  <td class="px-4 py-3 text-gray-600 font-mono flex items-center gap-2">
                    <span class="min-w-[80px]">
                         {{ showPasswordMap[cred.id!] ? cred.password : '••••••••' }}
                    </span>
                    <button @click="togglePasswordVisibility(cred.id!)" class="text-gray-400 hover:text-emerald-600 transition-colors ml-1 cursor-pointer" :title="showPasswordMap[cred.id!] ? 'Hide' : 'Show'">
                       <svg v-if="!showPasswordMap[cred.id!]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                         <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                         <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                       </svg>
                       <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                         <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                       </svg>
                    </button>
                    <button @click="copyToClipboard(cred.password?.toString() || '')" class="text-gray-400 hover:text-emerald-600 transition-colors ml-1 cursor-pointer" title="Copy">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                        </svg>
                    </button>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-1">
                      <button @click="startEditCredential(cred)" class="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button @click="deleteCredential(cred.id!)" class="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>

                <!-- Edit Mode -->
                <tr v-else class="bg-emerald-50/50">
                  <td class="px-3 py-2 space-y-2">
                    <select v-model="editCredentialForm.platform" class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                      <option v-for="p in platforms" :key="p" :value="p">{{ $t(`student.credentials.platforms.${p}`) }}</option>
                    </select>
                    <input v-if="editCredentialForm.platform === 'Other'" v-model="editCredentialForm.custom_platform" :placeholder="$t('student.credentials.platform_name')" class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                    <input v-if="editCredentialForm.platform === 'Quiz Platform' || editCredentialForm.platform === 'Other'" v-model="editCredentialForm.url" :placeholder="$t('student.credentials.url')" class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input v-model="editCredentialForm.username" class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input v-model="editCredentialForm.password" type="text" class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                  </td>
                  <td class="px-3 py-2 text-right align-top">
                    <div class="flex justify-end gap-2">
                      <button @click="cancelEditCredential" class="text-xs text-gray-500 hover:text-gray-700 bg-white px-2 py-1 rounded border border-gray-200 cursor-pointer">{{ $t('student.cancel') }}</button>
                      <button @click="saveCredential" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 cursor-pointer">{{ $t('student.save_details') }}</button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="border-t border-gray-100 pt-6">
          <h3 class="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            {{ $t('student.credentials.add_title') }}
          </h3>
          <div class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3 items-start">
              <select v-model="newCredential.platform" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                <option v-for="p in platforms" :key="p" :value="p">{{ p }}</option>
              </select>
              <input v-model="newCredential.username" :placeholder="$t('student.credentials.username')" class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
              <input v-model="newCredential.password" :placeholder="$t('student.credentials.password')" type="text" class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
              <button @click="addCredential" class="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer h-[38px]">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {{ $t('student.credentials.add_btn') }}
              </button>
            </div>
            
            <!-- Conditional Fields Row -->
            <div v-if="newCredential.platform === 'Other' || newCredential.platform === 'Quiz Platform'" class="grid grid-cols-1 md:grid-cols-2 gap-3 pb-1">
                 <input v-if="newCredential.platform === 'Other'" v-model="newCredential.custom_platform" :placeholder="$t('student.credentials.platform_name')" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                 <input v-if="newCredential.platform === 'Quiz Platform' || newCredential.platform === 'Other'" v-model="newCredential.url" :placeholder="$t('student.credentials.url')" class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none" :class="{'md:col-span-2': newCredential.platform === 'Quiz Platform'}">
            </div>
          </div>
        </div>
      </section>

    </div>

  </div>
</template>

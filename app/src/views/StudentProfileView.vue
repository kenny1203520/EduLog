<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useStudentStore } from '@/stores/useStudentStore'
import { StudentService } from '@/services/StudentService'
import { CourseService } from '@/services/CourseService'
import { EnrollmentService } from '@/services/EnrollmentService'
import { Course } from '@/models/Course'
import { Classroom, type ClassSessionDTO } from '@/models/Classroom'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { useEmailValidation } from '@/composables/useEmailValidation'
import StudentSuspensions from '@/components/StudentSuspensions.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const studentStore = useStudentStore()
const studentId = computed(() => route.params.id as string)
const { validateEmail, getEmailError } = useEmailValidation()

// Form State for Main Details
interface StudentForm {
    name: string
    gov_id: string
    email: string
    phone: string
    residence_address: string
    mailing_address: string
    birthday: string
    external_link: string
    notes: string
}

const form = ref<StudentForm>({
    name: '',
    gov_id: '',
    email: '',
    phone: '',
    residence_address: '',
    mailing_address: '',
    birthday: '',
    external_link: '',
    notes: ''
})

// Email validation state
const emailTouched = ref(false)
const emailError = computed(() => emailTouched.value ? getEmailError(form.value.email) : null)

// UI State
const isSaving = ref(false)
const isEditingMainDetails = ref(false)
const showGovId = ref(false)

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
        birthday: s.birthday,
        external_link: s.external_link,
        notes: s.notes
    }
}

// --- Main Student Update ---
async function saveMainDetails() {
    // Validate email if provided
    if (form.value.email && !validateEmail(form.value.email)) {
        emailTouched.value = true
        alert('Please enter a valid email address')
        return
    }

    isSaving.value = true
    try {
        // Sanitize payload: convert empty strings to null/undefined where appropriate
        const payload = {
            ...form.value,
            birthday: form.value.birthday || null,
            external_link: form.value.external_link || null
        }
        await studentStore.updateStudent(studentId.value, payload)
        emailTouched.value = false // Reset validation state
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
const contactEmailTouched = ref(false)
const contactEmailError = computed(() => contactEmailTouched.value ? getEmailError(newContact.value.email) : null)

const showSuccessToast = ref(false)
const toastMessage = ref('')

function showToast(msg: string) {
    toastMessage.value = msg
    showSuccessToast.value = true
    setTimeout(() => {
        showSuccessToast.value = false
    }, 3000)
}

async function addContact() {
    if (!newContact.value.name) return

    // Validate email if provided
    if (newContact.value.email && !validateEmail(newContact.value.email)) {
        contactEmailTouched.value = true
        alert('Please enter a valid email address for contact')
        return
    }

    try {
        await StudentService.addContact({ ...newContact.value, student_id: studentId.value })
        newContact.value = { name: '', relation: '', phone: '', email: '' } // Reset
        contactEmailTouched.value = false
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
const selectedSessionDetails = ref<any>(null)
const classroomSearchTerm = ref('')

const filteredSessions = computed(() => {
    if (!newEnrollment.value.course_id) return []
    let sessions = availableSessions.value.filter(s => s.course_ids.includes(newEnrollment.value.course_id!))

    // Filter by classroom if selected
    if (newEnrollment.value.classroom_id) {
        sessions = sessions.filter(s => s.classroom_id === newEnrollment.value.classroom_id)
    }

    return sessions
})

const isSessionFull = computed(() => {
    if (!selectedSessionDetails.value) return false
    return selectedSessionDetails.value.current_enrollments >= selectedSessionDetails.value.capacity
})



const filteredClassrooms = computed(() => {
    if (!classroomSearchTerm.value.trim()) return availableClassrooms.value
    const search = classroomSearchTerm.value.toLowerCase()
    return availableClassrooms.value.filter(c =>
        c.name.toLowerCase().includes(search) ||
        c.address?.toLowerCase().includes(search)
    )
})

// Watch Session Selection to Fetch Details
watch(() => newEnrollment.value.class_session_id, async (sessionId) => {
    if (!sessionId) {
        selectedSessionDetails.value = null
        return
    }

    try {
        // Fetch session details including classroom info and enrollment count
        selectedSessionDetails.value = await CourseService.getSessionDetails(sessionId)

        // Auto-set classroom from session
        if (selectedSessionDetails.value.classroom_id) {
            newEnrollment.value.classroom_id = selectedSessionDetails.value.classroom_id
        }
    } catch (e) {
        console.error('Failed to fetch session details:', e)
        selectedSessionDetails.value = null
    }
})

async function fetchEnrollments() {
    if (!studentId.value) return
    enrollments.value = await EnrollmentService.getByStudentId(studentId.value)
}

async function openEnrollModal() {
    isEnrollModalOpen.value = true
    // Fetch all data needed (with large page size to get all)
    const [coursesRes, roomsRes, sessionsRes] = await Promise.all([
        CourseService.getCourses(1, 1000),
        CourseService.getClassrooms(1, 1000),
        CourseService.getClassSessions(1, 1000)
    ])
    availableCourses.value = coursesRes.data
    availableClassrooms.value = roomsRes.data
    availableSessions.value = sessionsRes.data

    newEnrollment.value = {
        student_id: studentId.value,
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
        lesson_number: 1
    }
}

async function enrollStudent() {
    if (!newEnrollment.value.course_id) return
    try {
        await EnrollmentService.create({
            ...newEnrollment.value,
            student_id: studentId.value
        })
        await fetchEnrollments()
        isEnrollModalOpen.value = false
        showToast(t('student.internal_courses.add_btn') + ' ' + t('common.success'))
    } catch (e) {
        alert(e)
    }
}

// --- Enrollment Editing ---
const editingEnrollmentId = ref<string | null>(null)
const editEnrollmentForm = ref<Partial<EnrollmentDTO>>({})

async function startEditEnrollment(enr: Enrollment) {
    editingEnrollmentId.value = enr.id!
    editEnrollmentForm.value = {
        course_id: enr.courseId,
        classroom_id: enr.classroomId,
        class_session_id: enr.classSessionId,
        status: enr.status as any,
        start_date: enr.startDate,
        lesson_number: enr.lessonNumber,
        external_link: enr.externalLink
    }

    // Ensure options are loaded
    if (availableCourses.value.length === 0) {
        try {
            const [coursesRes, roomsRes, sessionsRes] = await Promise.all([
                CourseService.getCourses(1, 1000),
                CourseService.getClassrooms(1, 1000),
                CourseService.getClassSessions(1, 1000)
            ])
            availableCourses.value = coursesRes.data
            availableClassrooms.value = roomsRes.data
            availableSessions.value = sessionsRes.data
        } catch (e) {
            console.error('Failed to load edit options', e)
        }
    }
}

function cancelEditEnrollment() {
    editingEnrollmentId.value = null
    editEnrollmentForm.value = {}
}

async function saveEnrollment() {
    if (!editingEnrollmentId.value) return
    try {
        await CourseService.updateEnrollment(editingEnrollmentId.value, editEnrollmentForm.value)
        await fetchEnrollments()
        cancelEditEnrollment()
    } catch (e) {
        console.error(e)
        alert('Failed to update enrollment')
    }
}

// Filtered sessions for edit form
const editFilteredSessions = computed(() => {
    if (!editEnrollmentForm.value.course_id) return []

    let sessions = availableSessions.value.filter(s => s.course_ids?.includes(editEnrollmentForm.value.course_id!))

    // Further filter by classroom if selected
    if (editEnrollmentForm.value.classroom_id) {
        sessions = sessions.filter(s => s.classroom_id === editEnrollmentForm.value.classroom_id)
    }

    return sessions
})


async function removeEnrollment(id: string) {
    if (!confirm(t('common.confirm_delete'))) return
    try {
        await EnrollmentService.delete(id)
        await fetchEnrollments()
        showToast(t('common.deleted'))
    } catch (e) {
        alert(e)
    }
}

watch(isEditingMainDetails, (val) => {
    if (val) {
        showGovId.value = true
    }
})

// --- Student Suspension ---
const isSuspensionsModalOpen = ref(false)
const selectedEnrollmentIdForSuspension = ref<string>('')

function openSuspensionsModal(enrollmentId: string) {
    selectedEnrollmentIdForSuspension.value = enrollmentId
    isSuspensionsModalOpen.value = true
}

// --- Transfer Class ---
const isTransferModalOpen = ref(false)
const transferEnrollment = ref<Enrollment | null>(null)
const transferTargetSessionId = ref('')
const transferDate = ref('')
const transferOriginalLastDateValue = ref('')  // User-selected last lesson date for original session
const itemTransferSessions = ref<ClassSessionDTO[]>([])

const selectedTargetSession = computed(() =>
    itemTransferSessions.value.find(s => s.id === transferTargetSessionId.value)
)



// Available future dates for the ORIGINAL session
const transferOriginalAvailableDates = computed(() => {
    if (!transferEnrollment.value || transferEnrollment.value.classSessionDayOfWeek === undefined) return []

    const dates = []
    const targetDay = transferEnrollment.value.classSessionDayOfWeek
    // Get start time from enrollment's session
    const startTime = transferEnrollment.value.formattedSchedule?.match(/(\d{2}:\d{2})/)?.[1] || '10:00'

    let d = new Date()
    const now = new Date()

    // Find next occurrence
    let currentDay = d.getDay()
    let diff = targetDay - currentDay
    if (diff < 0) diff += 7
    d.setDate(d.getDate() + diff)

    // Check time if it's today
    if (d.toDateString() === now.toDateString()) {
        const parts = startTime.split(':')
        if (parts.length >= 2) {
            const h = parseInt(parts[0]!)
            const m = parseInt(parts[1]!)

            if (!isNaN(h) && !isNaN(m)) {
                const classTime = new Date(d)
                classTime.setHours(h, m, 0, 0)
                if (classTime < now) {
                    d.setDate(d.getDate() + 7)
                }
            }
        }
    }

    // Generate 5 occurrences
    for (let i = 0; i < 5; i++) {
        const dateStr = d.toISOString().split('T')[0]
        if (!dateStr) continue

        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
        const label = `${dateStr.replace(/-/g, '/')} (${dayName}) ${startTime}`
        dates.push({ value: dateStr, label: label })
        d.setDate(d.getDate() + 7)
    }
    return dates
})

const transferNewFirstDate = computed(() => {
    // Check strict explicit undefined check because 0 is valid (Sunday)
    if (!selectedTargetSession.value || selectedTargetSession.value.day_of_week === undefined || !transferDate.value) return '-'
    // If user picks a date directly, just show that date?
    // Or recalculate? If dropdown is used, transferDate IS the first lesson date.
    return transferDate.value.replace(/-/g, '/')
})

const transferAvailableDates = computed(() => {
    if (!selectedTargetSession.value || selectedTargetSession.value.day_of_week === undefined) return []

    const dates = []
    const targetDay = selectedTargetSession.value.day_of_week
    const startTime = selectedTargetSession.value.start_time?.slice(0, 5)

    if (!startTime) return []

    let d = new Date()
    const now = new Date()

    // Find next occurrence
    let currentDay = d.getDay()
    let diff = targetDay - currentDay
    if (diff < 0) diff += 7
    d.setDate(d.getDate() + diff)

    // Check time if it's today
    if (d.toDateString() === now.toDateString()) {
        const parts = startTime.split(':')
        if (parts.length >= 2) {
            const h = parseInt(parts[0]!)
            const m = parseInt(parts[1]!)

            if (!isNaN(h) && !isNaN(m)) {
                const classTime = new Date(d)
                classTime.setHours(h, m, 0, 0)
                if (classTime < now) {
                    d.setDate(d.getDate() + 7)
                }
            }
        }
    }

    // Generate 5 occurrences
    for (let i = 0; i < 5; i++) {
        const dateStr = d.toISOString().split('T')[0]
        if (!dateStr) continue

        const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
        const label = `${dateStr.replace(/-/g, '/')} (${dayName}) ${startTime}`
        dates.push({ value: dateStr, label: label })
        d.setDate(d.getDate() + 7)
    }
    return dates
})



// Date helpers removed - now using dropdown selections



async function openTransferModal(enr: Enrollment) {
    transferEnrollment.value = enr
    transferTargetSessionId.value = ''
    transferDate.value = ''
    transferOriginalLastDateValue.value = ''
    isTransferModalOpen.value = true

    // Fetch sessions for this course
    try {
        const { data } = await CourseService.getClassSessions(1, 1000)
        // Filter for same course but different session
        itemTransferSessions.value = data.filter(s =>
            s.course_ids.includes(enr.courseId) &&
            s.id !== enr.classSessionId
        )
    } catch (e) {
        console.error(e)
        alert('Failed to load available sessions')
    }
}

async function submitTransfer() {
    if (!transferEnrollment.value || !transferTargetSessionId.value || !transferDate.value) return

    if (!confirm(t('common.confirm_save'))) return

    try {
        await EnrollmentService.transferClass(
            transferEnrollment.value.id!,
            transferTargetSessionId.value,
            transferDate.value
        )
        await fetchEnrollments()
        isTransferModalOpen.value = false
        showToast(t('common.success'))
    } catch (e: any) {
        console.error(e)
        alert(e.message || 'Transfer failed')
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
        showToast(t('common.copy_success'))
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
                <p class="text-gray-500">
                    <span v-if="studentStore.currentStudent.displayGrade">{{ studentStore.currentStudent.displayGrade }}
                        • </span>
                    <span v-else>{{ $t('student.management.no_grade') }} • </span>
                    {{ studentStore.currentStudent.id }}
                </p>
            </div>
            <div class="space-x-3">
                <!-- Removed redundant view-reports link as per user request to go to profile first -->
            </div>
        </div>

        <!-- Main Details Form -->
        <section class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
            <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
                <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                        stroke="currentColor" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                </div>
                {{ $t('student.details') }}
            </h2>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.name')
                    }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.name" type="text"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                        {{ form.name || '-' }}</div>
                </div>

                <div class="space-y-1.5">
                    <div class="flex items-center gap-2 mb-1.5">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                            $t('student.gov_id') }}</label>
                        <button @click.stop="showGovId = !showGovId"
                            class="text-gray-400 hover:text-gray-600 focus:outline-none"
                            :title="showGovId ? 'Hide' : 'Show'" type="button">
                            <svg v-if="showGovId" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                            </svg>
                            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                        </button>
                    </div>
                    <input v-if="isEditingMainDetails" v-model="form.gov_id" :type="showGovId ? 'text' : 'password'"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px] font-mono flex items-center">
                        <span v-if="showGovId">{{ form.gov_id || '-' }}</span>
                        <span v-else>{{ form.gov_id ? '•'.repeat(Math.min(form.gov_id.length, 10)) : '-' }}</span>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.birthday')
                    }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.birthday" type="date"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                        {{ form.birthday || '-' }}</div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                        $t('student.external_link') }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.external_link" type="url" placeholder="https://"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px] overflow-hidden text-ellipsis whitespace-nowrap">
                        <a v-if="form.external_link" :href="form.external_link" target="_blank"
                            class="text-emerald-600 hover:text-emerald-700 underline flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                            </svg>
                            {{ $t('common.view_link', 'View Link') }}
                        </a>
                        <span v-else>-</span>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('auth.email')
                    }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.email" type="email" @blur="emailTouched = true"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400"
                        :class="{ 'border-red-500 focus:ring-red-500': emailError }">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                        {{ form.email || '-' }}</div>
                    <p v-if="emailError && isEditingMainDetails" class="text-xs text-red-500 mt-1">{{ emailError }}</p>
                </div>
                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                        $t('student.contacts.phone') }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.phone" type="tel"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                        {{ form.phone || '-' }}</div>
                </div>

                <div class="space-y-1.5 md:col-span-2">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                        $t('student.residence_address') }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.residence_address" type="text"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                        {{ form.residence_address || '-' }}</div>
                </div>
                <div class="space-y-1.5 md:col-span-2">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                        $t('student.mailing_address') }}</label>
                    <input v-if="isEditingMainDetails" v-model="form.mailing_address" type="text"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                        {{ form.mailing_address || '-' }}</div>
                </div>

                <div class="space-y-1.5 md:col-span-2">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{ $t('student.notes')
                    }}</label>
                    <textarea v-if="isEditingMainDetails" v-model="form.notes" rows="3"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400 resize-y"></textarea>
                    <div v-else
                        class="text-gray-800 px-4 py-2.5 bg-gray-50/50 rounded-lg border border-transparent min-h-[86px] whitespace-pre-wrap">
                        {{ form.notes || '-' }}</div>
                </div>
            </div>

            <div class="mt-8 flex justify-between items-center pt-6 border-t border-gray-100">
                <button @click="handleDeleteStudent"
                    class="text-red-500 hover:text-red-700 text-sm font-medium hover:underline cursor-pointer flex items-center gap-1 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                        stroke="currentColor" class="w-4 h-4">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                    {{ $t('student.delete') }}
                </button>

                <div class="flex items-center gap-2">
                    <button v-if="isEditingMainDetails" @click="toggleEditMainDetails"
                        class="text-gray-500 hover:text-gray-700 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                        {{ $t('student.cancel') }}
                    </button>
                    <button @click="isEditingMainDetails ? saveMainDetails() : toggleEditMainDetails()"
                        :disabled="isSaving"
                        class="bg-emerald-600 text-white px-8 py-2.5 rounded-lg shadow-sm hover:bg-emerald-700 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2 cursor-pointer">
                        <svg v-if="!isSaving && isEditingMainDetails" xmlns="http://www.w3.org/2000/svg" fill="none"
                            viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        <svg v-else-if="!isSaving" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                            stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                        </svg>
                        <svg v-else class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg"
                            fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        {{ isSaving ? $t('student.saving') : (isEditingMainDetails ? $t('student.save_details') :
                            $t('student.edit')) }}
                    </button>
                </div>
            </div>
        </section>

        <!-- Sub Sections Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">

            <!-- Contacts -->
            <section
                class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit transition-all hover:shadow-md">
                <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                        </svg>
                    </div>
                    {{ $t('student.sections.contacts') }}
                </h2>

                <ul class="space-y-4 mb-8">
                    <li v-for="c in studentStore.currentStudent.contacts" :key="c.id"
                        class="bg-gray-50 p-4 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
                        <div v-if="editingContactId !== c.id" class="flex justify-between items-start">
                            <div>
                                <div class="font-bold text-gray-800 text-lg flex items-center gap-2">
                                    {{ c.name }}
                                    <span
                                        class="text-xs text-gray-500 font-medium bg-white px-2 py-0.5 rounded-full border border-gray-100">{{
                                            c.relation }}</span>
                                </div>
                                <div class="text-sm text-gray-600 mt-1 flex items-center gap-2 group">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                                    </svg>
                                    {{ c.phone }}
                                    <button v-if="c.phone" @click="copyToClipboard(c.phone)"
                                        class="text-gray-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all ml-1 cursor-pointer"
                                        title="Copy">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                            stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                        </svg>
                                    </button>
                                </div>
                                <div class="text-sm text-gray-600 flex items-center gap-2 group">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                    </svg>
                                    {{ c.email }}
                                    <button v-if="c.email" @click="copyToClipboard(c.email)"
                                        class="text-gray-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all ml-1 cursor-pointer"
                                        title="Copy">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                            stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div class="flex space-x-1">
                                <button @click="startEditContact(c)"
                                    class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="Edit">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                    </svg>
                                </button>
                                <button @click="deleteContact(c.id!)"
                                    class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Edit Mode -->
                        <div v-else class="space-y-3">
                            <div class="grid grid-cols-2 gap-3">
                                <input v-model="editContactForm.name" placeholder="Name"
                                    class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                <input v-model="editContactForm.relation" placeholder="Relation"
                                    class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                <input v-model="editContactForm.phone" placeholder="Phone"
                                    class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                <input v-model="editContactForm.email" placeholder="Email"
                                    class="border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            </div>
                            <div class="flex justify-end space-x-2 pt-2">
                                <button @click="cancelEditContact"
                                    class="text-gray-500 text-sm hover:text-gray-700 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer">{{
                                        $t('student.cancel') }}</button>
                                <button @click="saveContact"
                                    class="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer">{{
                                        $t('student.save_details') }}</button>
                            </div>
                        </div>
                    </li>
                </ul>

                <div class="border-t border-gray-100 pt-6">
                    <h3 class="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        {{ $t('student.contacts.add_title') }}
                    </h3>
                    <div
                        class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
                        <div class="grid grid-cols-2 gap-3 mb-3">
                            <input v-model="newContact.name" :placeholder="$t('student.contacts.name')"
                                class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            <input v-model="newContact.relation" :placeholder="$t('student.contacts.relation')"
                                class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            <input v-model="newContact.phone" :placeholder="$t('student.contacts.phone')"
                                class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            <div class="relative">
                                <input v-model="newContact.email" type="email" @blur="contactEmailTouched = true"
                                    :placeholder="$t('student.contacts.email')"
                                    class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                    :class="{ 'border-red-500 focus:ring-red-500': contactEmailError }">
                                <p v-if="contactEmailError" class="text-xs text-red-500 mt-1">{{ contactEmailError }}
                                </p>
                            </div>
                        </div>
                        <button @click="addContact"
                            class="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            {{ $t('student.contacts.add_btn') }}
                        </button>
                    </div>
                </div>
            </section>

            <!-- Schools -->
            <section
                class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit transition-all hover:shadow-md">
                <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M4.26 10.147a60.436 60.436 0 0 0-.491 6.347A48.627 48.627 0 0 1 12 20.904a48.627 48.627 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.57 50.57 0 0 0-2.658-.813A59.905 59.905 0 0 1 12 3.493a59.902 59.902 0 0 1 10.499 5.516 50.548 50.548 0 0 0-2.658.813m-15.482 0A50.697 50.697 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
                        </svg>
                    </div>
                    {{ $t('student.sections.schools') }}
                </h2>

                <ul class="space-y-4 mb-8">
                    <li v-for="s in studentStore.currentStudent.schools" :key="s.id"
                        class="bg-gray-50 p-4 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
                        <div v-if="editingSchoolId !== s.id" class="flex justify-between items-start">
                            <div class="space-y-2">
                                <div>
                                    <div class="font-bold text-gray-800 text-lg">{{ s.name }}</div>

                                    <!-- ID, Grade, Class Row -->
                                    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
                                        <!-- Student ID -->
                                        <div v-if="s.school_student_id"
                                            class="flex items-center gap-2 text-sm text-gray-600 group">
                                            <span
                                                class="font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{{
                                                    $t('student.schools.school_student_id') }}</span>
                                            <span class="font-mono text-gray-800 font-medium">{{ s.school_student_id
                                            }}</span>
                                            <button @click="copyToClipboard(s.school_student_id)"
                                                class="text-gray-300 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-all ml-0.5 cursor-pointer"
                                                title="Copy">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                                    stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                                </svg>
                                            </button>
                                        </div>

                                        <!-- Grade -->
                                        <div v-if="s.status === 'enrolled' && s.grade"
                                            class="flex items-center gap-2 text-sm text-gray-600">
                                            <span
                                                class="font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{{
                                                    $t('student.schools.grade') }}</span>
                                            <span class="font-medium text-gray-800">{{ s.grade }}</span>
                                        </div>

                                        <!-- Class -->
                                        <div v-if="s.status === 'enrolled' && s.class"
                                            class="flex items-center gap-2 text-sm text-gray-600">
                                            <span
                                                class="font-medium text-gray-500 text-xs uppercase tracking-wide bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">{{
                                                    $t('student.schools.class') }}</span>
                                            <span class="font-medium text-gray-800">{{ s.class }}</span>
                                        </div>
                                    </div>
                                </div>

                                <div class="text-xs text-gray-500 flex flex-wrap items-center gap-2 mt-2">
                                    <span v-if="s.status"
                                        class="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full border border-blue-100 font-medium">{{
                                            $t(`student.schools.status_options.${s.status}`) }}</span>
                                    <span
                                        class="bg-white border border-gray-200 text-gray-500 px-2 py-0.5 rounded-full flex items-center gap-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                            stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
                                        </svg>
                                        {{ s.start_date }} - {{ s.end_date || $t('student.schools.present') }}
                                    </span>
                                </div>
                            </div>
                            <div class="flex space-x-1">
                                <button @click="startEditSchool(s)"
                                    class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="Edit">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                    </svg>
                                </button>
                                <button @click="deleteSchool(s.id!)"
                                    class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                    title="Delete">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Edit Mode -->
                        <div v-else class="space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.name') }}</label>
                                    <input v-model="editSchoolForm.name"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                </div>
                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.status') }}</label>
                                    <select v-model="editSchoolForm.status"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                                        <option value="" disabled>{{ $t('student.schools.status') }}</option>
                                        <option v-for="opt in schoolStatusOptions" :key="opt" :value="opt">{{
                                            $t(`student.schools.status_options.${opt}`) }}</option>
                                    </select>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <!-- Student ID Field -->
                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.school_student_id') }}</label>
                                    <input v-model="editSchoolForm.school_student_id"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                </div>

                                <div class="grid grid-cols-2 gap-4">
                                    <div class="space-y-1">
                                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                            $t('student.schools.grade') }}</label>
                                        <input v-model="editSchoolForm.grade"
                                            :disabled="editSchoolForm.status !== 'enrolled'"
                                            :placeholder="editSchoolForm.status !== 'enrolled' ? '-' : ''"
                                            class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                                    </div>
                                    <div class="space-y-1">
                                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                            $t('student.schools.class') }}</label>
                                        <input v-model="editSchoolForm.class"
                                            :disabled="editSchoolForm.status !== 'enrolled'"
                                            :placeholder="editSchoolForm.status !== 'enrolled' ? '-' : ''"
                                            class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                                    </div>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.start_date') }}</label>
                                    <input type="date" v-model="editSchoolForm.start_date"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                    <p v-if="editSchoolForm.status === 'enrolled'"
                                        class="text-[10px] text-red-500 text-right mt-0.5">* {{ $t('student.required')
                                        }}</p>
                                </div>

                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.end_date') }}</label>
                                    <input type="date" v-model="editSchoolForm.end_date"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                    <p class="text-[10px] text-gray-400 text-right mt-0.5">{{
                                        $t('student.schools.present') }}</p>
                                </div>
                            </div>

                            <div class="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                                <button @click="cancelEditSchool"
                                    class="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700 hover:bg-gray-100 rounded transition-colors cursor-pointer">{{
                                        $t('student.cancel') }}</button>
                                <button @click="saveSchool"
                                    class="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 shadow-sm transition-colors cursor-pointer">{{
                                        $t('student.save_details') }}</button>
                            </div>
                        </div>
                    </li>
                </ul>

                <div class="border-t border-gray-100 pt-6">
                    <h3 class="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        {{ $t('student.schools.add_title') }}
                    </h3>

                    <div
                        class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
                        <div class="grid grid-cols-2 md:grid-cols-2 gap-4 mb-4">
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                    $t('student.schools.name') }}</label>
                                <input v-model="newSchool.name"
                                    class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                    $t('student.schools.status') }}</label>
                                <select v-model="newSchool.status"
                                    class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                                    <option value="" disabled selected>{{ $t('student.schools.status') }}</option>
                                    <option v-for="opt in schoolStatusOptions" :key="opt" :value="opt">{{
                                        $t(`student.schools.status_options.${opt}`) }}</option>
                                </select>
                            </div>

                            <!-- Student ID Field -->
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                    $t('student.schools.school_student_id') }}</label>
                                <input v-model="newSchool.school_student_id"
                                    class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            </div>

                            <div class="grid grid-cols-2 gap-4">
                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.grade') }}</label>
                                    <input v-model="newSchool.grade" :disabled="newSchool.status !== 'enrolled'"
                                        :placeholder="newSchool.status !== 'enrolled' ? '-' : ''"
                                        class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                                </div>
                                <div class="space-y-1">
                                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                        $t('student.schools.class') }}</label>
                                    <input v-model="newSchool.class" :disabled="newSchool.status !== 'enrolled'"
                                        :placeholder="newSchool.status !== 'enrolled' ? '-' : ''"
                                        class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                    $t('student.schools.start_date') }}</label>
                                <input type="date" v-model="newSchool.start_date"
                                    class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none">
                                <p v-if="newSchool.status === 'enrolled'"
                                    class="text-[10px] text-red-500 text-right mt-0.5">* {{ $t('student.required') }}
                                </p>
                            </div>

                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                    $t('student.schools.end_date') }}</label>
                                <input type="date" v-model="newSchool.end_date"
                                    class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none">
                                <p class="text-[10px] text-gray-400 text-right mt-0.5">{{ $t('student.schools.present')
                                }}</p>
                            </div>
                        </div>

                        <button @click="addSchool"
                            class="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            {{ $t('student.schools.add_btn') }}
                        </button>
                    </div>
                </div>
            </section>
            <!-- Internal Courses -->
            <section class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 lg:col-span-2">
                <h2 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <span class="p-1.5 bg-purple-100 text-purple-600 rounded-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                            stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                        </svg>
                    </span>
                    {{ $t('student.internal_courses.title') }}
                </h2>

                <div v-if="enrollments.length === 0"
                    class="text-center py-6 text-gray-400 text-sm italic bg-gray-50 rounded-xl mb-4 border border-dashed border-gray-200">
                    {{ $t('student.internal_courses.no_enrollments') }}
                </div>

                <ul class="space-y-4 mb-6">
                    <li v-for="enr in enrollments" :key="enr.id"
                        class="group bg-white border-2 border-gray-100 rounded-2xl p-5 hover:border-emerald-200 hover:shadow-lg transition-all duration-200">
                        <!-- View Mode -->
                        <div v-if="editingEnrollmentId !== enr.id">
                            <div class="flex items-start justify-between mb-3">
                                <div class="flex-1">
                                    <div class="flex items-center gap-3 mb-2">
                                        <h4 class="text-lg font-bold text-gray-900">
                                            {{ enr.courseSubject }}<span class="text-gray-500 font-normal">_{{
                                                enr.courseStage }}</span>
                                        </h4>
                                        <span class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide"
                                            :class="{
                                                'bg-emerald-100 text-emerald-700': enr.status === 'active',
                                                'bg-blue-100 text-blue-700': enr.status === 'completed',
                                                'bg-gray-100 text-gray-500': enr.status === 'dropped'
                                            }">
                                            {{ enr.status }}
                                        </span>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                                        <span v-if="enr.classroomName"
                                            class="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 rounded-lg border border-gray-200">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400"
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                            </svg>
                                            {{ enr.classroomName }}
                                        </span>
                                        <span v-if="enr.classSessionName && enr.formattedSchedule"
                                            class="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 rounded-lg border border-purple-200 text-purple-700">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                                viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            {{ enr.classSessionName }} {{ enr.formattedSchedule }}
                                        </span>
                                        <span v-if="enr.lessonNumber"
                                            class="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 rounded-lg border border-blue-200 text-blue-700">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                                viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            {{ $t('student.internal_courses.lesson_label') }} {{ enr.lessonNumber }}
                                        </span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button @click="openTransferModal(enr)"
                                        class="p-2.5 rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white transition-all shadow-sm hover:shadow-md"
                                        :title="$t('student.internal_courses.transfer_btn')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                        </svg>
                                    </button>
                                    <button @click="openSuspensionsModal(enr.id!)"
                                        class="p-2.5 rounded-xl bg-purple-50 text-purple-600 hover:bg-purple-600 hover:text-white transition-all shadow-sm hover:shadow-md"
                                        :title="$t('student.suspension.title')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </button>
                                    <router-link :to="{ name: 'lesson-reports', params: { enrollmentId: enr.id } }"
                                        class="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all shadow-sm hover:shadow-md"
                                        :title="$t('student.internal_courses.view_reports')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </router-link>
                                    <button @click="startEditEnrollment(enr)"
                                        class="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm hover:shadow-md"
                                        :title="$t('student.internal_courses.edit_enrollment')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                    <button @click="removeEnrollment(enr.id!)"
                                        class="p-2.5 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm hover:shadow-md"
                                        :title="$t('student.internal_courses.delete_enrollment')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                                clip-rule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Edit Mode -->
                        <div v-else
                            class="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-4 border-2 border-blue-200">
                            <h4 class="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                {{ $t('student.internal_courses.edit_enrollment_title') }}
                            </h4>
                            <div class="space-y-3">
                                <!-- 1. Course -->
                                <div>
                                    <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                        $t('student.internal_courses.course') }}</label>
                                    <select v-model="editEnrollmentForm.course_id"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option v-for="c in availableCourses" :key="c.id" :value="c.id">
                                            {{ c.subject }}_{{ c.stage }}
                                        </option>
                                    </select>
                                </div>

                                <!-- 2. Classroom -->
                                <div>
                                    <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                        $t('student.internal_courses.classroom_optional') }}</label>
                                    <select v-model="editEnrollmentForm.classroom_id"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option :value="undefined">{{ $t('student.internal_courses.none_option') }}
                                        </option>
                                        <option v-for="r in availableClassrooms" :key="r.id" :value="r.id">
                                            {{ r.name }}
                                        </option>
                                    </select>
                                </div>

                                <!-- 3. Session -->
                                <div>
                                    <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                        $t('student.internal_courses.session_optional') }}</label>
                                    <select v-model="editEnrollmentForm.class_session_id"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option :value="undefined">{{ $t('student.internal_courses.none_option') }}
                                        </option>
                                        <option v-for="s in editFilteredSessions" :key="s.id" :value="s.id">
                                            {{ s.name }} ({{ s.day_of_week !== undefined ?
                                                ['日', '一', '二', '三', '四', '五', '六'][s.day_of_week] : '' }} {{
                                                s.start_time?.slice(0, 5) }})
                                        </option>
                                    </select>
                                </div>

                                <div class="grid grid-cols-2 gap-3">
                                    <!-- 4. Status -->
                                    <div>
                                        <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                            $t('student.internal_courses.status') }}</label>
                                        <select v-model="editEnrollmentForm.status"
                                            class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                            <option value="active">{{ $t('student.internal_courses.status_active') }}
                                            </option>
                                            <option value="completed">{{ $t('student.internal_courses.status_completed')
                                            }}</option>
                                            <option value="dropped">{{ $t('student.internal_courses.status_dropped') }}
                                            </option>
                                        </select>
                                    </div>
                                    <!-- 5. Lesson Number -->
                                    <div>
                                        <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                            $t('student.internal_courses.lesson_number') }}</label>
                                        <input type="number" v-model.number="editEnrollmentForm.lesson_number"
                                            class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                                    </div>
                                </div>

                                <!-- 6. Start Date -->
                                <div>
                                    <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                        $t('student.internal_courses.start_date') }}</label>
                                    <input type="date" v-model="editEnrollmentForm.start_date"
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>

                                <!-- 7. External Link -->
                                <div class="col-span-2">
                                    <label class="text-xs font-semibold text-gray-600 mb-1 block">{{
                                        $t('student.internal_courses.external_link') || 'Company Report Overview URL'
                                    }}</label>
                                    <input type="url" v-model="editEnrollmentForm.external_link"
                                        placeholder="https://..."
                                        class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
                                </div>
                                <div class="flex justify-end gap-2 pt-3 border-t border-blue-200">
                                    <button @click="cancelEditEnrollment"
                                        class="px-4 py-2 text-gray-600 bg-white hover:bg-gray-100 rounded-lg text-sm font-semibold transition-colors border border-gray-300">
                                        {{ $t('common.cancel') }}
                                    </button>
                                    <button @click="saveEnrollment"
                                        class="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-semibold transition-colors shadow-sm">
                                        {{ $t('common.save') }}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </li>
                </ul>

                <button @click="openEnrollModal"
                    class="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-bold hover:border-emerald-500 hover:text-emerald-600 transition-colors flex items-center justify-center gap-2">
                    <span>+</span> {{ $t('student.internal_courses.add_title') }}
                </button>
            </section>

            <!-- Enroll Modal -->
            <div v-if="isEnrollModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div
                    class="bg-white rounded-2xl flex flex-col w-full max-w-md md:max-w-xl max-h-[85vh] shadow-2xl m-4 overflow-hidden">
                    <!-- Modal Header -->
                    <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <h3 class="text-xl font-bold text-gray-900">{{ $t('student.internal_courses.add_title') }}</h3>
                        <button @click="isEnrollModalOpen = false"
                            class="text-gray-400 hover:text-gray-600 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <!-- Modal Body (Scrollable) -->
                    <div class="flex-1 overflow-y-auto p-6 space-y-6">
                        <div class="space-y-6">
                            <!-- 1. Course Selection -->
                            <div>
                                <label class="block text-sm font-bold text-gray-700 mb-2">{{
                                    $t('student.internal_courses.course') }}</label>
                                <select v-model="newEnrollment.course_id"
                                    class="w-full border-gray-300 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 shadow-sm transition-all bg-white">
                                    <option :value="undefined">{{ $t('student.internal_courses.select_course_option') }}
                                    </option>
                                    <option v-for="c in availableCourses" :key="c.id" :value="c.id">
                                        {{ c.subject }}_{{ c.stage }}
                                    </option>
                                </select>
                            </div>

                            <div v-if="newEnrollment.course_id"
                                class="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                                <!-- 2. Classroom Selection with Search -->
                                <div class="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100">
                                    <label class="block text-sm font-bold text-emerald-900 mb-3">{{
                                        $t('student.internal_courses.classroom') }}</label>

                                    <!-- Search Input -->
                                    <div class="relative mb-3">
                                        <input v-model="classroomSearchTerm" type="text"
                                            :placeholder="$t('student.internal_courses.search_classroom')"
                                            class="w-full border-gray-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-emerald-500 focus:border-emerald-500 bg-white shadow-sm transition-all">
                                        <svg xmlns="http://www.w3.org/2000/svg"
                                            class="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                    </div>

                                    <!-- Filtered Classroom List -->
                                    <select v-model="newEnrollment.classroom_id"
                                        class="w-full border-gray-200 rounded-xl focus:ring-emerald-500 bg-white transition-all text-sm mb-2"
                                        size="6">
                                        <option :value="undefined" class="py-2 px-3">{{
                                            $t('student.internal_courses.classroom_none') }}
                                        </option>
                                        <option v-for="r in filteredClassrooms" :key="r.id" :value="r.id"
                                            class="py-2 px-3 rounded-lg hover:bg-emerald-50">
                                            {{ r.name }}{{ r.address ? ' - ' + r.address : '' }}
                                        </option>
                                        <option v-if="filteredClassrooms.length === 0 && classroomSearchTerm" disabled
                                            class="py-2 px-3 text-gray-400 italic">
                                            {{ $t('student.internal_courses.no_classrooms_found') }}
                                        </option>
                                    </select>
                                    <p class="text-[10px] font-bold text-emerald-600 uppercase tracking-wider px-1">
                                        {{ $t('student.internal_courses.classroom_search_hint') }}
                                    </p>
                                </div>

                                <!-- 3. Session Selection -->
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-2">{{
                                        $t('student.internal_courses.session_select') }}</label>
                                    <select v-model="newEnrollment.class_session_id"
                                        class="w-full border-gray-300 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 shadow-sm transition-all bg-white mb-2">
                                        <option :value="undefined">{{
                                            $t('student.internal_courses.session_select_placeholder') }}</option>
                                        <option v-for="s in filteredSessions" :key="s.id" :value="s.id">
                                            {{ s.name }} ({{ $t('classroom.days.' + s.day_of_week) }} {{
                                                s.start_time?.slice(0, 5) }})
                                        </option>
                                        <option v-if="filteredSessions.length === 0" disabled>{{
                                            $t('student.internal_courses.no_sessions_found') }}</option>
                                    </select>
                                    <p class="text-xs font-medium text-gray-400 px-1">{{
                                        $t('student.internal_courses.session_hint') }}</p>

                                    <!-- Session Details Card -->
                                    <div v-if="selectedSessionDetails"
                                        class="mt-4 p-5 bg-gradient-to-br from-emerald-50/50 to-blue-50/50 rounded-2xl border border-emerald-100/50 shadow-inner">
                                        <div class="flex items-center gap-2 mb-4">
                                            <div class="p-1.5 bg-emerald-50 rounded-lg">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                                    stroke-width="2" stroke="currentColor"
                                                    class="w-4 h-4 text-emerald-600">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                                </svg>
                                            </div>
                                            <h4 class="font-bold text-xs uppercase tracking-widest text-emerald-800">
                                                {{ $t('student.internal_courses.session_details') }}
                                            </h4>
                                        </div>
                                        <div class="grid gap-3 text-sm">
                                            <div class="flex justify-between items-center group">
                                                <span class="text-gray-500 font-medium">{{
                                                    $t('student.internal_courses.session_classroom') }}</span>
                                                <span class="font-bold text-gray-900">{{
                                                    selectedSessionDetails.classroom_name }}</span>
                                            </div>
                                            <div v-if="selectedSessionDetails.classroom_address"
                                                class="flex justify-between items-start pt-1 border-t border-gray-100/50">
                                                <span class="text-gray-500 font-medium">{{
                                                    $t('student.internal_courses.session_address') }}</span>
                                                <span
                                                    class="text-gray-600 text-right max-w-[200px] text-xs leading-relaxed font-medium">{{
                                                        selectedSessionDetails.classroom_address }}</span>
                                            </div>
                                            <div
                                                class="flex justify-between items-center pt-1 border-t border-gray-100/50">
                                                <span class="text-gray-500 font-medium">{{
                                                    $t('student.internal_courses.session_schedule') }}</span>
                                                <span
                                                    class="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg">
                                                    {{ $t('classroom.days.' + selectedSessionDetails.day_of_week) }}
                                                    {{ selectedSessionDetails.start_time?.slice(0, 5) }} - {{
                                                        selectedSessionDetails.end_time?.slice(0, 5) }}
                                                </span>
                                            </div>
                                            <div
                                                class="flex justify-between items-center pt-3 mt-1 border-t-2 border-dashed border-emerald-100">
                                                <span class="text-gray-500 font-medium">{{
                                                    $t('student.internal_courses.session_capacity') }}</span>
                                                <div class="flex items-center gap-2">
                                                    <div class="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                        <div class="h-full transition-all duration-500"
                                                            :class="isSessionFull ? 'bg-red-500' : 'bg-emerald-500'"
                                                            :style="{ width: `${(selectedSessionDetails.current_enrollments / selectedSessionDetails.capacity) * 100}%` }">
                                                        </div>
                                                    </div>
                                                    <span class="font-black tabular-nums"
                                                        :class="isSessionFull ? 'text-red-600' : 'text-emerald-700'">
                                                        {{ selectedSessionDetails.current_enrollments }}/{{
                                                            selectedSessionDetails.capacity }}
                                                    </span>
                                                </div>
                                            </div>
                                            <div v-if="isSessionFull"
                                                class="mt-1 bg-red-50 text-red-700 px-4 py-2 rounded-xl text-xs font-bold border border-red-100 animate-pulse text-center">
                                                {{ $t('student.internal_courses.session_full') }}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 4. Configuration Grid -->
                                <div class="grid grid-cols-2 gap-6 pt-2">
                                    <div>
                                        <label class="block text-sm font-bold text-gray-700 mb-2">{{
                                            $t('student.internal_courses.status') }}</label>
                                        <select v-model="newEnrollment.status"
                                            class="w-full border-gray-300 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 shadow-sm transition-all bg-white">
                                            <option value="active">{{ $t('student.internal_courses.status_active') }}
                                            </option>
                                            <option value="completed">{{ $t('student.internal_courses.status_completed')
                                            }}</option>
                                            <option value="dropped">{{ $t('student.internal_courses.status_dropped') }}
                                            </option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-sm font-bold text-gray-700 mb-2">{{
                                            $t('student.internal_courses.lesson_number') }}</label>
                                        <input type="number" v-model.number="newEnrollment.lesson_number"
                                            class="w-full border-gray-300 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 shadow-sm transition-all" />
                                    </div>
                                </div>

                                <!-- 5. Start Date -->
                                <div class="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50">
                                    <label class="block text-sm font-bold text-blue-900 mb-2">{{
                                        $t('student.internal_courses.start_date') }}</label>
                                    <input type="date" v-model="newEnrollment.start_date"
                                        class="w-full border-gray-200 rounded-xl focus:ring-blue-500 focus:border-blue-500 transition-all bg-white shadow-sm" />
                                </div>

                                <!-- 6. External Link -->
                                <div>
                                    <label class="block text-sm font-bold text-gray-700 mb-2">{{
                                        $t('student.internal_courses.external_link') || 'Company Report Overview URL'
                                    }}</label>
                                    <div class="relative">
                                        <input type="url" v-model="newEnrollment.external_link"
                                            placeholder="https://..."
                                            class="w-full border-gray-300 rounded-xl pl-10 focus:ring-emerald-500 focus:border-emerald-500 shadow-sm transition-all" />
                                        <svg xmlns="http://www.w3.org/2000/svg"
                                            class="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M10.172 13.828a4 4 0 015.656 0l4-4a4 4 0 11-5.656-5.656l-1.102 1.101" />
                                        </svg>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Modal Footer (Fixed) -->
                    <div class="px-6 py-5 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
                        <button @click="isEnrollModalOpen = false"
                            class="px-5 py-2.5 text-gray-600 hover:bg-gray-200/60 font-bold rounded-xl transition-all">
                            {{ $t('common.cancel') || $t('student.cancel') }}
                        </button>
                        <button @click="enrollStudent"
                            :disabled="isSessionFull || !newEnrollment.course_id || !newEnrollment.class_session_id"
                            class="px-8 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 hover:shadow-lg shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                            :title="isSessionFull ? 'This session is at full capacity' : ''">
                            {{ $t('student.internal_courses.add_btn') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Credentials -->
        <section
            class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 lg:col-span-2 transition-all hover:shadow-md">
            <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
                <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                        stroke="currentColor" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
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
                            <tr v-if="editingCredentialId !== cred.id"
                                class="bg-white hover:bg-gray-50 transition-colors">
                                <td class="px-4 py-3 font-medium text-gray-800">
                                    <div class="flex items-center gap-2">
                                        <span>{{ platforms.includes(cred.platform) ?
                                            $t(`student.credentials.platforms.${cred.platform}`) : cred.platform
                                        }}</span>
                                        <a v-if="cred.url" :href="cred.url" target="_blank"
                                            class="text-emerald-600 hover:text-emerald-700" :title="cred.url">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                                <path stroke-linecap="round" stroke-linejoin="round"
                                                    d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                            </svg>
                                        </a>
                                    </div>
                                </td>
                                <td class="px-4 py-3 text-gray-600 font-mono">{{ cred.username }}</td>
                                <td class="px-4 py-3 text-gray-600 font-mono flex items-center gap-2">
                                    <span class="min-w-[80px]">
                                        {{ showPasswordMap[cred.id!] ? cred.password : '••••••••' }}
                                    </span>
                                    <button @click="togglePasswordVisibility(cred.id!)"
                                        class="text-gray-400 hover:text-emerald-600 transition-colors ml-1 cursor-pointer"
                                        :title="showPasswordMap[cred.id!] ? 'Hide' : 'Show'">
                                        <svg v-if="!showPasswordMap[cred.id!]" xmlns="http://www.w3.org/2000/svg"
                                            fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
                                            class="w-4 h-4">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                        </svg>
                                        <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                            stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                                        </svg>
                                    </button>
                                    <button @click="copyToClipboard(cred.password?.toString() || '')"
                                        class="text-gray-400 hover:text-emerald-600 transition-colors ml-1 cursor-pointer"
                                        title="Copy">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                            stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                        </svg>
                                    </button>
                                </td>
                                <td class="px-4 py-3 text-right">
                                    <div class="flex justify-end gap-1">
                                        <button @click="startEditCredential(cred)"
                                            class="p-1 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors cursor-pointer">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                                <path stroke-linecap="round" stroke-linejoin="round"
                                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                            </svg>
                                        </button>
                                        <button @click="deleteCredential(cred.id!)"
                                            class="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                                <path stroke-linecap="round" stroke-linejoin="round"
                                                    d="M6 18 18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>

                            <!-- Edit Mode -->
                            <tr v-else class="bg-emerald-50/50">
                                <td class="px-3 py-2 space-y-2">
                                    <select v-model="editCredentialForm.platform"
                                        class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                                        <option v-for="p in platforms" :key="p" :value="p">{{
                                            $t(`student.credentials.platforms.${p}`) }}</option>
                                    </select>
                                    <input v-if="editCredentialForm.platform === 'Other'"
                                        v-model="editCredentialForm.custom_platform"
                                        :placeholder="$t('student.credentials.platform_name')"
                                        class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                    <input
                                        v-if="editCredentialForm.platform === 'Quiz Platform' || editCredentialForm.platform === 'Other'"
                                        v-model="editCredentialForm.url" :placeholder="$t('student.credentials.url')"
                                        class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                </td>
                                <td class="px-3 py-2 align-top">
                                    <input v-model="editCredentialForm.username"
                                        class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                </td>
                                <td class="px-3 py-2 align-top">
                                    <input v-model="editCredentialForm.password" type="text"
                                        class="w-full border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                                </td>
                                <td class="px-3 py-2 text-right align-top">
                                    <div class="flex justify-end gap-2">
                                        <button @click="cancelEditCredential"
                                            class="text-xs text-gray-500 hover:text-gray-700 bg-white px-2 py-1 rounded border border-gray-200 cursor-pointer">{{
                                                $t('student.cancel') }}</button>
                                        <button @click="saveCredential"
                                            class="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 cursor-pointer">{{
                                                $t('student.save_details') }}</button>
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
                <div
                    class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3 items-start">
                        <select v-model="newCredential.platform"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none cursor-pointer">
                            <option v-for="p in platforms" :key="p" :value="p">{{ p }}</option>
                        </select>
                        <input v-model="newCredential.username" :placeholder="$t('student.credentials.username')"
                            class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                        <input v-model="newCredential.password" :placeholder="$t('student.credentials.password')"
                            type="text"
                            class="border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                        <button @click="addCredential"
                            class="w-full bg-white border border-gray-200 text-gray-600 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer h-[38px]">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            {{ $t('student.credentials.add_btn') }}
                        </button>
                    </div>

                    <!-- Conditional Fields Row -->
                    <div v-if="newCredential.platform === 'Other' || newCredential.platform === 'Quiz Platform'"
                        class="grid grid-cols-1 md:grid-cols-2 gap-3 pb-1">
                        <input v-if="newCredential.platform === 'Other'" v-model="newCredential.custom_platform"
                            :placeholder="$t('student.credentials.platform_name')"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                        <input v-if="newCredential.platform === 'Quiz Platform' || newCredential.platform === 'Other'"
                            v-model="newCredential.url" :placeholder="$t('student.credentials.url')"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                            :class="{ 'md:col-span-2': newCredential.platform === 'Quiz Platform' }">
                    </div>
                </div>
            </div>
        </section>

    </div>

    <!-- Success Toast -->
    <div v-if="showSuccessToast"
        class="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-toast-up z-[100] border border-emerald-500">
        <div class="bg-white/20 p-1 rounded-full">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
        </div>
        <span class="font-bold tracking-wide">{{ toastMessage }}</span>
    </div>

    <!-- Transfer Class Modal -->
    <div v-if="isTransferModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div
            class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div class="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-orange-500" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {{ $t('student.internal_courses.transfer_title') }}
                </h3>
                <button @click="isTransferModalOpen = false"
                    class="text-gray-400 hover:text-gray-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="p-6 space-y-4">
                <!-- Comparison Grid -->
                <div v-if="transferEnrollment" class="grid grid-cols-2 gap-4">
                    <div class="p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <label class="text-[10px] text-gray-500 font-bold uppercase block mb-1.5">{{
                            $t('student.internal_courses.transfer_from') }}</label>
                        <div class="font-bold text-gray-800 text-sm mb-0.5">{{ transferEnrollment.formattedSchedule ||
                            '-'
                        }}</div>
                        <div class="text-xs text-gray-500 mb-1">{{ transferEnrollment.classSessionName || '-' }}</div>
                        <div class="bg-gray-50 border border-gray-100 rounded-lg p-2 flex-1">
                            <label class="text-[10px] text-gray-400 font-bold uppercase block mb-1.5">{{
                                $t('student.internal_courses.last_lesson') }}</label>
                            <select v-model="transferOriginalLastDateValue"
                                class="w-full text-xs border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-gray-300 outline-none bg-white">
                                <option value="" disabled>{{ $t('student.internal_courses.transfer_date_placeholder') }}
                                </option>
                                <option v-for="d in transferOriginalAvailableDates" :key="d.value" :value="d.value">
                                    {{ d.label }}
                                </option>
                            </select>
                        </div>
                    </div>

                    <div class="p-3 bg-orange-50 rounded-lg border border-orange-100">
                        <label class="text-[10px] text-orange-500 font-bold uppercase block mb-1.5">{{
                            $t('student.internal_courses.transfer_target') }}</label>
                        <template v-if="selectedTargetSession">
                            <div class="font-bold text-gray-800 text-sm mb-0.5">
                                {{ ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][selectedTargetSession.day_of_week]
                                }}
                                {{ selectedTargetSession.start_time?.slice(0, 5) }}
                            </div>
                            <div class="text-xs text-gray-500 mb-1">{{ selectedTargetSession.name }}</div>
                            <div class="text-[10px] text-emerald-600 font-bold border-t border-orange-200 pt-1 mt-1">
                                {{ $t('student.internal_courses.first_lesson') }}: {{ transferNewFirstDate }}
                            </div>
                        </template>
                        <div v-else class="text-gray-400 italic text-xs py-1">{{
                            $t('student.internal_courses.session_select_placeholder') }}</div>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                        $t('student.internal_courses.transfer_target') }}</label>
                    <select v-model="transferTargetSessionId"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none bg-white">
                        <option value="" disabled>{{ $t('student.internal_courses.session_select_placeholder') }}
                        </option>
                        <option v-for="s in itemTransferSessions" :key="s.id" :value="s.id">
                            {{ s.name }} ({{ s.day_of_week !== undefined ?
                                ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.day_of_week] : '' }} {{
                                s.start_time?.slice(0, 5)
                            }})
                        </option>
                    </select>
                </div>

                <div class="space-y-1.5">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                        $t('student.internal_courses.transfer_date') }}</label>
                    <select v-model="transferDate"
                        class="w-full border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-orange-500 outline-none bg-white">
                        <option value="" disabled>{{ $t('student.internal_courses.transfer_date_placeholder') }}
                        </option>
                        <option v-for="d in transferAvailableDates" :key="d.value" :value="d.value">
                            {{ d.label }}
                        </option>
                    </select>
                    <p class="text-xs text-gray-500">{{ $t('student.internal_courses.transfer_hint') }}</p>
                </div>
            </div>

            <div class="px-6 py-4 bg-gray-50 flex justify-end gap-3 border-t">
                <button @click="isTransferModalOpen = false"
                    class="px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-200 font-medium transition-colors">
                    {{ $t('student.cancel') }}
                </button>
                <button @click="submitTransfer" :disabled="!transferTargetSessionId || !transferDate"
                    class="px-4 py-2 rounded-xl bg-orange-500 text-white hover:bg-orange-600 font-medium shadow-sm hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    {{ $t('student.internal_courses.transfer_confirm') }}
                </button>
            </div>
        </div>
    </div>
    <StudentSuspensions v-if="isSuspensionsModalOpen" :enrollment-id="selectedEnrollmentIdForSuspension"
        @close="isSuspensionsModalOpen = false" />
</template>

<style scoped>
@keyframes toast-up {
    from {
        transform: translateY(100%) scale(0.9);
        opacity: 0;
    }

    to {
        transform: translateY(0) scale(1);
        opacity: 1;
    }
}

.animate-toast-up {
    animation: toast-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
                                                                                                                                                                                                                                                                                                                                                                                         
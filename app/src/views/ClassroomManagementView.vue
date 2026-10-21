<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { AggregateService } from '@/services/AggregateService'
import { SessionService } from '@/services/session/SessionService'
import { VisibilityPreferenceService } from '@/services/VisibilityPreferenceService'
import { OccurrenceService } from '@/services/occurrence/OccurrenceService'
import { TeacherService } from '@/services/teacher/TeacherService'
import { RoleService } from '@/services/rbac/RoleService'
import { INCOMPLETE_REPORT_PERMISSION, PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'
import type { PermissionDTO, RoleDTO, RolePermissionPolicyDTO } from '@/models/Rbac'
import type { RolePolicySelections } from '@/components/settings/ScopedRolePolicyEditor.vue'
import { roleDisplayName } from '@/utils/roleDisplay'
import ScopedRolePolicyEditor from '@/components/settings/ScopedRolePolicyEditor.vue'
import ClassroomManagementPanel from '@/components/classroom/ClassroomManagementPanel.vue'
import DashboardScheduleModeEditor from '@/components/settings/DashboardScheduleModeEditor.vue'
import { scheduleSelectionsAt, type DashboardSchedulePolicies, type DashboardScheduleSelections } from '@/models/DashboardScheduleMode'
import { Classroom, type ClassroomDTO, type ClassSessionDTO } from '@/models/Classroom'
import {
    type ClassSessionScheduleRuleDTO,
    type ScheduleMode,
    type SessionType
} from '@/models/ClassSession'
import { Course } from '@/models/Course'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import Pagination from '@/components/common/Pagination.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import EffectiveTeachingRoles from '@/components/rbac/EffectiveTeachingRoles.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/DateUtils'
import { paginateTeacherAssignments, partitionTeacherAssignments } from '@/utils/teacherAssignmentHistory'
import { buildSessionScheduleDisplayItems } from '@/utils/sessionScheduleDisplay'

import ConfirmModal from '../components/common/ConfirmModal.vue'

import BaseDropdown from '@/components/common/BaseDropdown.vue'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import BaseSkeletonCard from '@/components/common/BaseSkeletonCard.vue'

const { t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
const preferences = usePreferencesStore()
const activeTab = ref<'rooms' | 'sessions'>('rooms')
type DisplayMode = 'visible' | 'all' | 'hidden'

// Hidden records remain available through the explicit display controls, but
// the management page starts with the user's visible working set.
const displayMode = ref<DisplayMode>('visible')
const selectedSessionClassroomFilter = ref('')

const classroomOptions = computed(() => [
    { label: t('classroom.all_rooms'), value: '' },
    ...allClassrooms.value.map(r => ({ label: r.name, value: r.id }))
])

// Generic Confirm Modal State
const genericConfirm = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as (() => any) | null
})

function openConfirm(message: string, action: () => any, title?: string, isDangerous = false) {
    genericConfirm.value = {
        isOpen: true,
        title: title || t('common.confirm'),
        message,
        confirmText: t('common.confirm'),
        isDangerous,
        isLoading: false,
        action
    }
}

async function handleGenericConfirm() {
    if (genericConfirm.value.action) {
        try {
            genericConfirm.value.isLoading = true
            await genericConfirm.value.action()
            genericConfirm.value.isOpen = false
        } catch (e) {
            // The modal used to just stop loading here with no other signal --
            // the user was left staring at an unchanged dialog with no idea
            // whether it was safe to retry.
            console.error(e)
            reportError(e)
        } finally {
            genericConfirm.value.isLoading = false
        }
    } else {
        genericConfirm.value.isOpen = false
    }
}

// Data
const classrooms = ref<Classroom[]>([])
const sessions = ref<ClassSessionDTO[]>([])
const courses = ref<Course[]>([])
// Each tab tracks its own request so "not loaded yet" never renders as the
// empty state, and a slower stale response cannot overwrite a newer one.
const roomsLoading = ref(true)
const roomsLoaded = ref(false)
const sessionsLoading = ref(false)
const sessionsLoaded = ref(false)
let roomsRequestSequence = 0
let sessionsRequestSequence = 0
const showRoomsSkeleton = computed(() => roomsLoading.value && (!roomsLoaded.value || classrooms.value.length === 0))
const showSessionsSkeleton = computed(() => sessionsLoading.value && (!sessionsLoaded.value || sessions.value.length === 0))
const searchQuery = ref('')
const allClassrooms = ref<Classroom[]>([]) // For Dropdown
const hiddenClassroomIds = ref<Set<string>>(new Set())
const hiddenSessionIds = ref<Set<string>>(new Set())
const classroomOverviewCounts = ref({ total: 0, visible: 0, hidden: 0 })
const sessionOverviewCounts = ref({ total: 0, visible: 0, hidden: 0 })
const teachersList = ref<any[]>([])
const roles = ref<RoleDTO[]>([])
const teacherRoleCatalog = ref<RoleDTO[]>([])
const teacherRoleCatalogError = ref(false)
const teacherRoleManageAllowed = ref<boolean | null>(null)
const teacherRolePermissionError = ref(false)
let teacherRoleCatalogSequence = 0
const notificationPermission = ref<PermissionDTO | null>(null)
const notificationPolicies = ref<RolePermissionPolicyDTO[]>([])
const roomPolicySelections = ref<RolePolicySelections>({})
const sessionPolicySelections = ref<RolePolicySelections>({})
const schedulePolicies = ref<DashboardSchedulePolicies>({ all: [], view: [] })
const schedulePoliciesLoaded = ref(false)
const roomScheduleSelections = ref<DashboardScheduleSelections>({})
const sessionScheduleSelections = ref<DashboardScheduleSelections>({})
const roomSessions = ref<ClassSessionDTO[]>([])
const returnToRoomAfterSession = ref(false)
const roomPanelInitialTab = ref<'details' | 'notifications' | 'sessions' | 'role_assignments'>('details')

interface SessionTeacherConfig {
    teacher_id: string
    role_id: string
    effective_from: string
    effective_to?: string | null
}
const selectedTeacherConfigs = ref<SessionTeacherConfig[]>([])
const teacherAssignmentBaseline = ref<SessionTeacherConfig[]>([])
const teacherAssignmentSaveError = ref(false)
const teacherAssignmentsLoadError = ref(false)
const teacherAssignmentsChanged = computed(() => {
    const normalize = (items: SessionTeacherConfig[]) => items
        .filter(item => item.teacher_id)
        .map(item => ({ teacher_id: item.teacher_id, role_id: item.role_id, effective_from: item.effective_from, effective_to: item.effective_to || null }))
        .sort((a, b) => `${a.teacher_id}:${a.effective_from}:${a.role_id}`.localeCompare(`${b.teacher_id}:${b.effective_from}:${b.role_id}`))
    return JSON.stringify(normalize(selectedTeacherConfigs.value)) !== JSON.stringify(normalize(teacherAssignmentBaseline.value))
})
const teacherAssignmentsPerPage = 10
const currentUpcomingAssignmentsPage = ref(1)
const pastAssignmentsPage = ref(1)
const showPastAssignments = ref(false)
const teacherAssignmentPartitions = computed(() => partitionTeacherAssignments(
    selectedTeacherConfigs.value,
    DateUtils.todayString(newSession.value.time_zone || preferences.timeZone)
))
const currentUpcomingTeacherAssignments = computed(() => teacherAssignmentPartitions.value.currentAndUpcoming)
const pastTeacherAssignments = computed(() => teacherAssignmentPartitions.value.past)
const currentUpcomingAssignmentsView = computed(() => paginateTeacherAssignments(currentUpcomingTeacherAssignments.value, currentUpcomingAssignmentsPage.value, teacherAssignmentsPerPage))
const pastAssignmentsView = computed(() => paginateTeacherAssignments(pastTeacherAssignments.value, pastAssignmentsPage.value, teacherAssignmentsPerPage))
const visibleTeacherAssignments = computed(() => showPastAssignments.value ? pastAssignmentsView.value : currentUpcomingAssignmentsView.value)

const roomsPagination = ref({ page: 1, perPage: 10, total: 0 })
const sessionsPagination = ref({ page: 1, perPage: 10, total: 0 })

// Modals
const isCreateRoomModalOpen = ref(false)
const isCreateSessionModalOpen = ref(false)
const isSavingRoom = ref(false)
const isSavingSession = ref(false)

// Forms
const newClassroom = ref<Partial<ClassroomDTO>>({ name: '', address: '', phone: '', color: '#10b981', external_link: '' })
const editingClassroom = ref<Classroom | null>(null)

const newSession = ref<Partial<ClassSessionDTO>>({
    name: '',
    classroom_id: '',
    course_ids: [],
    day_of_week: 1,
    start_time: '10:00',
    end_time: '12:00',
    time_zone: preferences.timeZone,
    capacity: 10,
    lesson_number: 1,
    external_link: '',
    session_type: 'regular',
    schedule_mode: 'weekly',
    schedule_rules: [{ schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' }]
})
const editingSession = ref<ClassSessionDTO | null>(null)

async function loadNotificationPolicies() {
    const permission = await PermissionPolicyService.getPermission(INCOMPLETE_REPORT_PERMISSION)
    notificationPermission.value = permission
    notificationPolicies.value = await PermissionPolicyService.getPolicies(permission.id)
}

function policySelectionsFor(scopeType: 'classroom' | 'class_session', scopeId?: string | null): RolePolicySelections {
    return Object.fromEntries(roles.value.map(role => {
        const policy = notificationPolicies.value.find(item => item.role_id === role.id
            && item.scope_type === scopeType && item.scope_id === scopeId)
        return [role.id, policy?.effect || 'inherit']
    })) as RolePolicySelections
}

function policyOverrides(selections: RolePolicySelections) {
    return roles.value.flatMap(role => {
        const effect = selections[role.id]
        return effect === 'allow' || effect === 'deny' ? [{ role_id: role.id, effect }] : []
    })
}

async function refreshNotificationPolicies() {
    if (!notificationPermission.value) return loadNotificationPolicies()
    notificationPolicies.value = await PermissionPolicyService.getPolicies(notificationPermission.value.id)
}

async function loadSchedulePolicies() {
    schedulePolicies.value = await PermissionPolicyService.getDashboardSchedulePolicies()
    schedulePoliciesLoaded.value = true
}

function scheduleSelectionsFor(scopeType: 'classroom' | 'class_session', scopeId?: string | null): DashboardScheduleSelections {
    return scheduleSelectionsAt(schedulePolicies.value, roles.value.map(role => role.id), { type: scopeType, id: scopeId })
}

function inheritScheduleSelections(): DashboardScheduleSelections {
    return Object.fromEntries(roles.value.map(role => [role.id, 'inherit']))
}

async function refreshRolePolicies() {
    await Promise.all([refreshNotificationPolicies(), loadSchedulePolicies()])
}

async function loadRoomSessions(roomId?: string | null) {
    if (!roomId) {
        roomSessions.value = []
        return
    }
    const result = await AggregateService.getAllClassSessionsOverview('', roomId, 'all')
    roomSessions.value = [...result.data].sort((a, b) => {
        const firstA = a.schedule_rules?.[0]
        const firstB = b.schedule_rules?.[0]
        const dayA = firstA?.day_of_week ?? a.day_of_week ?? 7
        const dayB = firstB?.day_of_week ?? b.day_of_week ?? 7
        if (dayA !== dayB) return dayA - dayB
        return (firstA?.start_time || a.start_time || '').localeCompare(firstB?.start_time || b.start_time || '')
    })
}

async function loadTeachers() {
    try {
        teachersList.value = await AggregateService.getAllTeachersOverview()
    } catch (e) {
        console.error('Failed to load teachers:', e)
    }
}

const days = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
]

const dayOptions = computed(() => days.map(d => ({
    label: t(`classroom.days.${d.value}`),
    value: d.value
})))

onMounted(async () => {
    // The room list is the visible initial tab.  Editor dependencies and
    // session data are loaded only when the user opens that UI, rather
    // than turning one page render into seven unrelated requests.
    await loadRooms()
})

async function loadRooms() {
    const sequence = ++roomsRequestSequence
    roomsLoading.value = true
    try {
        const agg = await AggregateService.getClassroomSessionManagerAggregate(
            roomsPagination.value.page,
            roomsPagination.value.perPage,
            searchQuery.value,
            displayMode.value
        )
        if (sequence !== roomsRequestSequence) return
        classrooms.value = (agg.classrooms || []).map((d: any) => new Classroom(d))
        allClassrooms.value = classrooms.value
        roomsPagination.value.total = agg.count || 0
        hiddenClassroomIds.value = new Set((agg.hiddenClassroomIds as string[] | undefined) || [])
        hiddenSessionIds.value = new Set((agg.hiddenSessionIds as string[] | undefined) || [])
        classroomOverviewCounts.value = {
            total: Number(agg.classroomTotal ?? agg.count ?? 0),
            visible: Number(agg.visibleClassroomCount ?? Math.max(0, Number(agg.count ?? 0) - hiddenClassroomIds.value.size)),
            hidden: Number(agg.hiddenClassroomCount ?? hiddenClassroomIds.value.size),
        }
        sessionOverviewCounts.value = {
            total: Number(agg.sessionTotal ?? agg.sessionCount ?? 0),
            visible: Number(agg.visibleSessionCount ?? Math.max(0, Number(agg.sessionCount ?? 0) - hiddenSessionIds.value.size)),
            hidden: Number(agg.hiddenSessionCount ?? hiddenSessionIds.value.size),
        }
    } catch (e) {
        if (sequence === roomsRequestSequence) reportError(e)
    } finally {
        if (sequence === roomsRequestSequence) {
            roomsLoading.value = false
            roomsLoaded.value = true
        }
    }
}

async function ensureEditorDependencies() {
    if (roles.value.length === 0) roles.value = await RoleService.getRoles()
    if (courses.value.length === 0) {
        const result = await CourseCatalogService.getCourses()
        courses.value = result.data
    }
    if (teachersList.value.length === 0) await loadTeachers()
    if (!notificationPermission.value) await loadNotificationPolicies()
    if (!schedulePoliciesLoaded.value) await loadSchedulePolicies()
}

async function loadTeacherRoleCatalog(scopeType: 'classroom' | 'class_session', scopeId: string) {
    const sequence = ++teacherRoleCatalogSequence
    teacherRoleCatalog.value = []
    teacherRoleCatalogError.value = false
    teacherRoleManageAllowed.value = null
    teacherRolePermissionError.value = false
    const [catalog, managePermission] = await Promise.allSettled([
        RoleService.getRolesForScope({ domain: 'teaching', scopeType, scopeId }),
        RoleService.canManageRoleScope(scopeType, scopeId)
    ])
    if (sequence !== teacherRoleCatalogSequence) return
    if (catalog.status === 'fulfilled') teacherRoleCatalog.value = catalog.value
    else {
        teacherRoleCatalog.value = []
        teacherRoleCatalogError.value = true
        reportError(catalog.reason)
    }
    if (managePermission.status === 'fulfilled') teacherRoleManageAllowed.value = managePermission.value
    else {
        teacherRoleManageAllowed.value = false
        teacherRolePermissionError.value = true
        reportError(managePermission.reason)
    }
}

async function loadSessionTeacherAssignments(sessionId: string) {
    teacherAssignmentsLoadError.value = false
    try {
        const assignedTeachers = await TeacherService.getSessionTeachers(sessionId)
        selectedTeacherConfigs.value = assignedTeachers.map(teacher => ({
            teacher_id: teacher.id!,
            role_id: teacher.role_id,
            effective_from: teacher.effective_from,
            effective_to: teacher.effective_to
        }))
        teacherAssignmentBaseline.value = selectedTeacherConfigs.value.map(item => ({ ...item }))
    } catch (error) {
        clearTeacherSelection()
        teacherAssignmentBaseline.value = []
        teacherAssignmentsLoadError.value = true
        console.error('Failed to load session teachers:', error)
    }
}

function retrySessionTeacherAssignments() {
    if (editingSession.value?.id) void loadSessionTeacherAssignments(editingSession.value.id)
}

function retryTeacherRoleCatalog() {
    if (editingSession.value?.id) {
        void loadTeacherRoleCatalog('class_session', editingSession.value.id)
    } else if (newSession.value.classroom_id) {
        void loadTeacherRoleCatalog('classroom', newSession.value.classroom_id)
    }
}

watch(() => [isCreateSessionModalOpen.value, editingSession.value?.id, newSession.value.classroom_id] as const, ([isOpen, sessionId, classroomId]) => {
    if (!isOpen || sessionId || !classroomId) return
    void loadTeacherRoleCatalog('classroom', classroomId)
}, { immediate: true })

async function loadSessions() {
    const sequence = ++sessionsRequestSequence
    sessionsLoading.value = true
    try {
        const res = await AggregateService.getClassSessionsOverview(
            sessionsPagination.value.page,
            sessionsPagination.value.perPage,
            searchQuery.value,
            selectedSessionClassroomFilter.value || null,
            displayMode.value
        )
        if (sequence !== sessionsRequestSequence) return
        sessions.value = res.data as any[]
        sessionsPagination.value.total = res.count
        hiddenSessionIds.value = new Set(res.hiddenSessionIds)
        sessionOverviewCounts.value = {
            total: Number((res as any).sessionTotal ?? res.count ?? 0),
            visible: Number((res as any).visibleSessionCount ?? Math.max(0, Number(res.count ?? 0) - hiddenSessionIds.value.size)),
            hidden: Number((res as any).hiddenSessionCount ?? hiddenSessionIds.value.size),
        }
    } finally {
        if (sequence === sessionsRequestSequence) {
            sessionsLoading.value = false
            sessionsLoaded.value = true
        }
    }
}

async function loadAllRooms() {
    try {
        const agg = await AggregateService.getAllClassroomsOverview('')
        allClassrooms.value = (agg.classrooms || []).map((d: any) => new Classroom(d))
        return
    } catch (e) {
        const res = await ClassroomService.getAllClassrooms()
        allClassrooms.value = res.data
    }
}

watch(() => roomsPagination.value.page, loadRooms)
watch(() => roomsPagination.value.perPage, () => { roomsPagination.value.page = 1; loadRooms() })
watch(() => sessionsPagination.value.page, loadSessions)
watch(() => sessionsPagination.value.perPage, () => { sessionsPagination.value.page = 1; loadSessions() })
watch(selectedSessionClassroomFilter, () => {
    sessionsPagination.value.page = 1
    loadSessions()
})
watch(activeTab, () => {
    if (activeTab.value === 'rooms') {
        loadRooms()
        return
    }

    void Promise.all([loadSessions(), loadAllRooms()])
})
watch(displayMode, () => {
    if (activeTab.value === 'rooms') {
        roomsPagination.value.page = 1
        loadRooms()
    } else if (activeTab.value === 'sessions') {
        sessionsPagination.value.page = 1
        loadSessions()
    }
})
watch(searchQuery, () => {
    if (activeTab.value === 'rooms') {
        roomsPagination.value.page = 1
        loadRooms()
    } else if (activeTab.value === 'sessions') {
        sessionsPagination.value.page = 1
        loadSessions()
    }
})

const dayColorMap: Record<number, string> = {
    1: '#3b82f6', // Mon: Blue
    2: '#8b5cf6', // Tue: Violet
    3: '#ec4899', // Wed: Pink
    4: '#f59e0b', // Thu: Amber
    5: '#06b6d4', // Fri: Cyan
    6: '#10b981', // Sat: Emerald
    0: '#ef4444'  // Sun: Red
}

function getDayColor(day: number) {
    return dayColorMap[day] || '#10b981'
}

const sortedSessions = computed(() => {
    return [...sessions.value].sort((a, b) => {
        const roomA = getRoomName(a.classroom_id!)
        const roomB = getRoomName(b.classroom_id!)
        const roomCompare = roomA.localeCompare(roomB)
        if (roomCompare !== 0) return roomCompare

        const firstA = a.schedule_rules?.[0]
        const firstB = b.schedule_rules?.[0]
        const rawDayA = firstA?.day_of_week ?? a.day_of_week ?? 7
        const rawDayB = firstB?.day_of_week ?? b.day_of_week ?? 7
        const dayA = rawDayA === 0 ? 7 : rawDayA
        const dayB = rawDayB === 0 ? 7 : rawDayB
        if (dayA !== dayB) return dayA - dayB

        return (firstA?.start_time || a.start_time || '').localeCompare(firstB?.start_time || b.start_time || '')
    })
})

function createScheduleRule(mode: ScheduleMode): ClassSessionScheduleRuleDTO {
    const base = { schedule_kind: mode, start_time: '10:00', end_time: '12:00' } as ClassSessionScheduleRuleDTO
    if (mode === 'weekly') {
        const used = new Set((newSession.value.schedule_rules || []).map(rule => rule.day_of_week))
        base.day_of_week = [1, 2, 3, 4, 5, 6, 0].find(day => !used.has(day)) ?? 1
    } else if (mode === 'monthly') {
        const used = new Set((newSession.value.schedule_rules || []).map(rule => rule.day_of_month))
        base.day_of_month = Array.from({ length: 31 }, (_, index) => index + 1).find(day => !used.has(day)) ?? 1
    } else {
        base.occurrence_date = newSession.value.start_date || DateUtils.todayString(newSession.value.time_zone || preferences.timeZone)
    }
    return base
}

function setSessionType(type: SessionType) {
    newSession.value.session_type = type
    const mode: ScheduleMode = type === 'camp' ? 'specific_dates' : 'weekly'
    newSession.value.schedule_mode = mode
    newSession.value.schedule_rules = [createScheduleRule(mode)]
    if (type === 'camp') {
        newSession.value.start_date = null
        newSession.value.end_date = null
    } else if (!newSession.value.start_date) {
        newSession.value.start_date = DateUtils.todayString(newSession.value.time_zone || preferences.timeZone)
    }
}

function setScheduleMode(mode: ScheduleMode) {
    newSession.value.schedule_mode = mode
    newSession.value.schedule_rules = [createScheduleRule(mode)]
}

function addScheduleRule() {
    const mode = newSession.value.schedule_mode || 'weekly'
    newSession.value.schedule_rules = [...(newSession.value.schedule_rules || []), createScheduleRule(mode)]
}

function removeScheduleRule(index: number) {
    newSession.value.schedule_rules = (newSession.value.schedule_rules || []).filter((_, ruleIndex) => ruleIndex !== index)
}

function primaryScheduleDay(session: ClassSessionDTO): number {
    return session.schedule_rules?.find(rule => rule.day_of_week !== null && rule.day_of_week !== undefined)?.day_of_week
        ?? session.day_of_week
        ?? 1
}

function scheduleDisplayItems(session: ClassSessionDTO) {
    return buildSessionScheduleDisplayItems(
        session,
        (key, named) => named ? t(key, named) : t(key),
        day => String(getDayLabel(day))
    )
}



const teacherOptions = computed(() => teachersList.value.map(t => ({
    label: t.name + (t.email ? ` (${t.email})` : ''),
    value: t.id
})))

const teacherRoleOptions = computed(() => teacherRoleCatalog.value.map(role => ({
    label: roleDisplayName(role, t),
    value: role.id
})))
function linkedTeacherUserId(teacherId: string) {
    return teachersList.value.find(teacher => teacher.id === teacherId)?.user_id ?? null
}

const roomOptions = computed(() => allClassrooms.value.map(c => ({
    label: c.name + (c.address ? ` (${c.address})` : ''),
    value: c.id
})))

// Actions
async function saveClassroom() {
    if (!newClassroom.value.name) return
    try {
        isSavingRoom.value = true
        const saved = editingClassroom.value?.id
            ? await ClassroomService.updateClassroom(editingClassroom.value.id, newClassroom.value)
            : await ClassroomService.createClassroom(newClassroom.value)

        // Switch to edit mode immediately so a policy failure cannot create a duplicate room on retry.
        editingClassroom.value = saved
        await PermissionPolicyService.replacePolicies(
            INCOMPLETE_REPORT_PERMISSION,
            { type: 'classroom', id: saved.id },
            policyOverrides(roomPolicySelections.value)
        )
        await PermissionPolicyService.replaceDashboardScheduleModes({ type: 'classroom', id: saved.id }, roomScheduleSelections.value)
        AggregateService.clearCache()
        await Promise.all([loadRooms(), loadAllRooms(), refreshRolePolicies()])
        closeRoomModal()
        toast.success(t('classroom.room_save_success') || 'Room saved successfully')
    } catch (e: any) {
        reportError(e)
    } finally {
        isSavingRoom.value = false
    }
}

async function openEditRoom(room: Classroom) {
    await ensureEditorDependencies()
    roomPanelInitialTab.value = 'details'
    editingClassroom.value = room
    newClassroom.value = {
        name: room.name,
        address: room.address,
        phone: room.phone,
        color: room.color || '#10b981',
        external_link: room.external_link || ''
    }
    roomPolicySelections.value = policySelectionsFor('classroom', room.id)
    roomScheduleSelections.value = scheduleSelectionsFor('classroom', room.id)
    await loadRoomSessions(room.id)
    isCreateRoomModalOpen.value = true
}

async function openCreateRoomModal() {
    await ensureEditorDependencies()
    roomPanelInitialTab.value = 'details'
    editingClassroom.value = null
    newClassroom.value = { name: '', address: '', phone: '', color: '#10b981', external_link: '' }
    roomPolicySelections.value = Object.fromEntries(roles.value.map(role => [role.id, 'inherit'])) as RolePolicySelections
    roomScheduleSelections.value = inheritScheduleSelections()
    roomSessions.value = []
    isCreateRoomModalOpen.value = true
}

function closeRoomModal() {
    isCreateRoomModalOpen.value = false
    editingClassroom.value = null
    newClassroom.value = { name: '', address: '', phone: '', color: '#10b981', external_link: '' }
    roomPolicySelections.value = {}
    roomScheduleSelections.value = {}
    roomSessions.value = []
}

async function editSessionFromRoomPanel(session: ClassSessionDTO) {
    roomPanelInitialTab.value = 'sessions'
    returnToRoomAfterSession.value = true
    isCreateRoomModalOpen.value = false
    await openEditSession(session)
}

async function deleteClassroom(id: string) {
    openConfirm(t('classroom.confirm_delete_room'), async () => {
        try {
            await ClassroomService.deleteClassroom(id)
            AggregateService.clearCache()
            await Promise.all([loadRooms(), loadAllRooms()])
            toast.success(t('classroom.room_delete_success') || 'Room deleted successfully')
        } catch (e) {
            reportError(e)
        }
    }, t('common.delete'), true)
}

function isClassroomHidden(id?: string) {
    return !!id && hiddenClassroomIds.value.has(id)
}

function isSessionHidden(id?: string) {
    return !!id && hiddenSessionIds.value.has(id)
}

async function refreshActiveList() {
    AggregateService.clearCache()
    if (activeTab.value === 'rooms') {
        await loadRooms()
        return
    }

    await loadSessions()
}

async function toggleClassroomVisibility(id?: string) {
    if (!id) return

    const willHide = !hiddenClassroomIds.value.has(id)

    try {
        await VisibilityPreferenceService.setEntityHidden('classroom', id, willHide)
        await refreshActiveList()
        toast.success(willHide ? t('classroom.room_hidden') : t('classroom.room_shown'))
    } catch (e) {
        reportError(e)
    }
}

async function toggleSessionVisibility(id?: string) {
    if (!id) return

    const willHide = !hiddenSessionIds.value.has(id)

    try {
        await VisibilityPreferenceService.setEntityHidden('class_session', id, willHide)
        await refreshActiveList()
        toast.success(willHide ? t('classroom.session_hidden') : t('classroom.session_shown'))
    } catch (e) {
        reportError(e)
    }
}

async function saveSession() {
    if (!newSession.value.name) return
    teacherAssignmentSaveError.value = false
    if (teacherAssignmentsChanged.value && teacherRoleManageAllowed.value !== true) {
        teacherAssignmentSaveError.value = true
        return
    }
    const payload = {
        ...newSession.value,
        schedule_rules: (newSession.value.schedule_rules || []).map(rule => ({
            ...rule,
            schedule_kind: newSession.value.schedule_mode || 'weekly'
        }))
    }
    if (!DateUtils.isValidTimeZone(payload.time_zone)) payload.time_zone = preferences.timeZone
    if (!payload.classroom_id) payload.classroom_id = null
    if (!payload.end_date) payload.end_date = null

    try {
        isSavingSession.value = true
        let saved: ClassSessionDTO
        if (editingSession.value?.id) {
            saved = await SessionService.updateClassSession(editingSession.value.id, payload)
        } else {
            saved = await SessionService.createClassSession(payload)
        }

        // Keep the created id before follow-up writes so retry updates instead of inserting again.
        editingSession.value = saved
        newSession.value = { ...newSession.value, id: saved.id }
        const sessionId = saved.id!
        if (teacherAssignmentsChanged.value) {
            const assignmentsToSave = selectedTeacherConfigs.value.filter(c => c.teacher_id)
            await TeacherService.replaceTeachersForSession(sessionId, assignmentsToSave)
            teacherAssignmentBaseline.value = assignmentsToSave.map(item => ({ ...item }))
        }
        await PermissionPolicyService.replacePolicies(
            INCOMPLETE_REPORT_PERMISSION,
            { type: 'class_session', id: sessionId },
            policyOverrides(sessionPolicySelections.value)
        )
        await PermissionPolicyService.replaceDashboardScheduleModes({ type: 'class_session', id: sessionId }, sessionScheduleSelections.value)
        const reconciliation = await OccurrenceService.syncSessionOccurrences(sessionId)

        AggregateService.clearCache()
        await Promise.all([loadSessions(), refreshRolePolicies()])
        if (returnToRoomAfterSession.value && saved.classroom_id) await loadRoomSessions(saved.classroom_id)
        closeSessionModal()
        toast.success(t('classroom.session_save_success') || 'Session saved successfully')
        if (reconciliation.preserved > 0) toast.info(t('classroom.schedule_preserved_notice', { count: reconciliation.preserved }))
    } catch (e: any) {
        reportError(e)
    } finally {
        isSavingSession.value = false
    }
}

async function openEditSession(session: ClassSessionDTO) {
    await ensureEditorDependencies()
    if (session.id) await loadTeacherRoleCatalog('class_session', session.id)
    clearTeacherSelection()
    teacherAssignmentBaseline.value = []
    teacherAssignmentsLoadError.value = false
    editingSession.value = session
    currentUpcomingAssignmentsPage.value = 1
    pastAssignmentsPage.value = 1
    showPastAssignments.value = false
    sessionPolicySelections.value = policySelectionsFor('class_session', session.id)
    sessionScheduleSelections.value = scheduleSelectionsFor('class_session', session.id)
    newSession.value = {
        ...session,
        time_zone: session.time_zone || preferences.timeZone,
        session_type: session.session_type || 'regular',
        schedule_mode: session.schedule_mode || 'weekly',
        schedule_rules: (session.schedule_rules || []).map(rule => ({ ...rule }))
    }
    if (session.id) await loadSessionTeacherAssignments(session.id)
    teacherAssignmentSaveError.value = false
    isCreateSessionModalOpen.value = true
}

async function openCreateSessionModal() {
    await ensureEditorDependencies()
    returnToRoomAfterSession.value = false
    currentUpcomingAssignmentsPage.value = 1
    pastAssignmentsPage.value = 1
    showPastAssignments.value = false
    clearTeacherSelection()
    teacherRoleCatalog.value = []
    teacherRoleCatalogError.value = false
    teacherRoleManageAllowed.value = null
    teacherRolePermissionError.value = false
    teacherAssignmentBaseline.value = []
    teacherAssignmentSaveError.value = false
    teacherAssignmentsLoadError.value = false
    editingSession.value = null
    sessionPolicySelections.value = Object.fromEntries(roles.value.map(role => [role.id, 'inherit'])) as RolePolicySelections
    sessionScheduleSelections.value = inheritScheduleSelections()
    newSession.value = {
        name: '',
        classroom_id: '',
        course_ids: [],
        day_of_week: 1,
        start_time: '10:00',
        end_time: '12:00',
        time_zone: preferences.timeZone,
        capacity: 10,
        lesson_number: 1,
        external_link: '',
        user_id: undefined,
        start_date: DateUtils.todayString(preferences.timeZone),
        end_date: null,
        session_type: 'regular',
        schedule_mode: 'weekly',
        schedule_rules: [{ schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' }]
    }
    isCreateSessionModalOpen.value = true
}

function closeSessionModal() {
    const restoreRoom = returnToRoomAfterSession.value
    isCreateSessionModalOpen.value = false
    editingSession.value = null
    teacherRoleManageAllowed.value = null
    teacherRolePermissionError.value = false
    teacherAssignmentBaseline.value = []
    teacherAssignmentSaveError.value = false
    teacherAssignmentsLoadError.value = false
    sessionPolicySelections.value = {}
    sessionScheduleSelections.value = {}
    clearTeacherSelection()
    newSession.value = {
        name: '',
        classroom_id: '',
        course_ids: [],
        day_of_week: 1,
        start_time: '10:00',
        end_time: '12:00',
        time_zone: preferences.timeZone,
        capacity: 10,
        lesson_number: 1,
        external_link: '',
        user_id: undefined,
        session_type: 'regular',
        schedule_mode: 'weekly',
        schedule_rules: [{ schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' }]
    }
    returnToRoomAfterSession.value = false
    if (restoreRoom && editingClassroom.value) isCreateRoomModalOpen.value = true
}


async function deleteSession(id: string) {
    openConfirm(t('classroom.confirm_delete_session'), async () => {
        try {
            await SessionService.deleteClassSession(id)
            AggregateService.clearCache()
            await loadSessions()
            toast.success(t('classroom.copy.session_delete_success'))
        } catch (e) {
            reportError(e)
        }
    }, t('common.delete'), true)
}

// Helpers
function getDayLabel(day: number) {
    return t(`classroom.days.${day}`) || day
}

function getRoomName(id?: string) {
    return allClassrooms.value.find(c => c.id === id)?.name || t('classroom.copy.unknown_room')
}

function toggleCourseSelection(courseId: string) {
    const list = newSession.value.course_ids || []
    if (list.includes(courseId)) {
        newSession.value.course_ids = list.filter(id => id !== courseId)
    } else {
        newSession.value.course_ids = [...list, courseId]
    }
}

function addTeacherAssignment() {
    showPastAssignments.value = false
    currentUpcomingAssignmentsPage.value = Math.max(1, Math.ceil((currentUpcomingTeacherAssignments.value.length + 1) / teacherAssignmentsPerPage))
    selectedTeacherConfigs.value.push({
        teacher_id: '',
        role_id: teacherRoleCatalog.value.find(role => role.code === 'teacher')?.id || '',
        effective_from: newSession.value.start_date || DateUtils.todayString(newSession.value.time_zone || preferences.timeZone),
        effective_to: null
    })
}

function removeTeacherAssignment(index: number) {
    selectedTeacherConfigs.value.splice(index, 1)
    currentUpcomingAssignmentsPage.value = currentUpcomingAssignmentsView.value.page
    pastAssignmentsPage.value = pastAssignmentsView.value.page
}

function clearTeacherSelection() {
    selectedTeacherConfigs.value = []
}
</script>

<template>
    <div class="space-y-6">
        <BasePageHeader :overline="t('nav.classrooms')" :title="t('classroom.title')"
            :subtitle="t('nav.description.classrooms')">
            <template #icon>
                <div
                    class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                </div>
            </template>

            <template #actions>
                <div class="flex flex-col sm:flex-row flex-1 items-center gap-4 w-full max-w-2xl">
                    <!-- Search Bar -->
                    <div
                        class="w-full flex-1 flex items-center gap-4 bg-white/50 p-1.5 rounded-2xl border border-gray-100 shadow-sm group focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-500/5 transition-all">
                        <div class="pl-3 text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input v-model="searchQuery" type="text" :placeholder="t('common.search')"
                            class="flex-1 bg-transparent border-none outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300 py-2 min-w-0" />
                        <button v-if="searchQuery" @click="searchQuery = ''"
                            class="p-2 text-gray-300 hover:text-gray-500 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <!-- Tab Switcher -->
                    <div
                        class="flex bg-gray-100/80 p-1 rounded-2xl border border-gray-100 shadow-inner w-full sm:w-auto overflow-x-auto shrink-0">
                        <button @click="activeTab = 'rooms'"
                            class="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all uppercase tracking-widest whitespace-nowrap"
                            :class="activeTab === 'rooms' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'">
                            {{ t('classroom.rooms_tab') }}
                        </button>
                        <button @click="activeTab = 'sessions'"
                            class="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all uppercase tracking-widest whitespace-nowrap"
                            :class="activeTab === 'sessions' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'">
                            {{ t('classroom.sessions_tab') }}
                        </button>
                    </div>
                </div>

                <!-- Primary Action Button -->
                <button v-if="activeTab === 'rooms'" @click="openCreateRoomModal"
                    class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl transition-all shadow-lg shadow-emerald-200 font-black flex items-center justify-center gap-2 active:scale-95 text-sm uppercase tracking-widest w-full md:w-auto shrink-0">
                    <span class="text-xl leading-none">+</span> {{ t('classroom.add_room') }}
                </button>
                <button v-else @click="openCreateSessionModal"
                    class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl transition-all shadow-lg shadow-emerald-200 font-black flex items-center justify-center gap-2 active:scale-95 text-sm uppercase tracking-widest w-full md:w-auto shrink-0">
                    <span class="text-xl leading-none">+</span> {{ t('classroom.add_session') }}
                </button>
            </template>
        </BasePageHeader>

        <div
            class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div class="flex items-center gap-2">
                <span class="text-xs font-black text-gray-500 uppercase tracking-widest">{{ $t('classroom.display_mode')
                }}</span>
                <div class="flex bg-gray-100 p-1 rounded-xl border border-gray-100">
                    <button @click="displayMode = 'visible'"
                        class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                        :class="displayMode === 'visible' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                        {{ $t('classroom.show_visible_only') }}
                    </button>
                    <button @click="displayMode = 'all'"
                        class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                        :class="displayMode === 'all' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                        {{ $t('classroom.show_all') }}
                    </button>
                    <button @click="displayMode = 'hidden'"
                        class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                        :class="displayMode === 'hidden' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                        {{ $t('classroom.show_hidden_only') }}
                    </button>
                </div>
            </div>

            <div v-if="activeTab === 'sessions'" class="flex items-center gap-2 md:ml-auto w-full md:w-auto relative">
                <label class="text-xs font-black text-gray-500 uppercase tracking-widest whitespace-nowrap">{{
                    $t('classroom.filter_by_room') }}</label>

                <SearchableSelect v-model="selectedSessionClassroomFilter" :options="classroomOptions"
                    :placeholder="$t('classroom.all_rooms')" class="min-w-[240px]" />

                <button v-if="selectedSessionClassroomFilter" @click="selectedSessionClassroomFilter = ''"
                    class="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all border border-transparent hover:border-red-100">
                    {{ $t('classroom.clear_room_filter') }}
                </button>
            </div>
        </div>

        <!-- ROOMS TAB -->
        <div v-if="activeTab === 'rooms'" :aria-busy="roomsLoading">

            <div v-if="showRoomsSkeleton" data-test="rooms-skeleton" role="status" aria-live="polite"
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <span class="sr-only">{{ $t('common.loading') }}</span>
                <BaseSkeletonCard v-for="n in 6" :key="n" variant="room" />
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-opacity duration-200"
                :class="{ 'opacity-60': roomsLoading }">
                <div v-for="room in classrooms" :key="room.id"
                    class="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group overflow-hidden flex flex-col h-full">

                    <!-- Card Header -->
                    <div class="flex flex-col gap-4 p-5 pb-3">
                        <div class="flex min-w-0 items-center gap-4">
                            <!-- Room Indicator Icon -->
                            <div class="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black uppercase shrink-0 group-hover:scale-110 transition-transform shadow-inner"
                                :style="{ backgroundColor: `${room.color}15`, color: room.color }">
                                {{ room.name.charAt(0) }}
                            </div>
                            <!-- Room Name & Info -->
                            <div class="min-w-0 flex-1">
                                <h3
                                    class="font-black text-xl text-gray-900 break-words group-hover:text-emerald-700 transition leading-tight">
                                    {{ room.name }}
                                </h3>
                                <p
                                    class="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5 flex items-center gap-2">
                                    {{ $t('classroom.rooms_tab') }}
                                    <span v-if="isClassroomHidden(room.id)"
                                        class="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 text-[10px]">{{
                                            $t('classroom.hidden') }}</span>
                                </p>
                            </div>
                        </div>

                        <!-- Quick Actions (always visible for mouse, keyboard, and touch) -->
                        <div
                            class="flex w-full items-center justify-end gap-2 border-t border-gray-100 pt-3">
                            <button @click="openEditRoom(room)"
                                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-emerald-600 transition-all hover:bg-emerald-50"
                                :title="$t('common.edit')"
                                :aria-label="$t('common.edit')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path
                                        d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                            </button>
                            <button @click="deleteClassroom(room.id!)"
                                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-red-500 transition-all hover:bg-red-50"
                                :title="$t('common.delete')"
                                :aria-label="$t('common.delete')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path fill-rule="evenodd"
                                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                        clip-rule="evenodd" />
                                </svg>
                            </button>
                            <button @click="toggleClassroomVisibility(room.id)"
                                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-amber-600 transition-all hover:bg-amber-50"
                                :title="isClassroomHidden(room.id) ? $t('classroom.show') : $t('classroom.hide')"
                                :aria-label="isClassroomHidden(room.id) ? $t('classroom.show') : $t('classroom.hide')">
                                <svg v-if="isClassroomHidden(room.id)" xmlns="http://www.w3.org/2000/svg"
                                    class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path
                                        d="M10 3C5 3 1.73 7.11.46 9.04a1.75 1.75 0 000 1.92C1.73 12.89 5 17 10 17c5 0 8.27-4.11 9.54-6.04a1.75 1.75 0 000-1.92C18.27 7.11 15 3 10 3zm0 11a4 4 0 110-8 4 4 0 010 8z" />
                                </svg>
                                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path fill-rule="evenodd"
                                        d="M3.28 2.22a.75.75 0 00-1.06 1.06l1.468 1.468C2.22 5.99 1.15 7.58.46 9.04a1.75 1.75 0 000 1.92C1.73 12.89 5 17 10 17c2.1 0 3.88-.72 5.34-1.73l1.38 1.38a.75.75 0 001.06-1.06l-14.5-14.5zM6.86 7.92A3 3 0 0010 13a2.99 2.99 0 002.08-.86L6.86 7.92zm6.36 1.06A3 3 0 0111.78 12l2.77 2.77c1.67-1.26 2.95-3.01 3.98-4.53a.25.25 0 000-.28c-1.27-1.87-4.17-5.43-8.53-5.43-.95 0-1.82.17-2.61.45l2.43 2.43A2.99 2.99 0 0113.22 8.98z"
                                        clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Card Body -->
                    <div class="px-5 py-3 flex-1 space-y-3">
                        <div v-if="room.address" class="flex items-start gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                            <span class="text-sm font-medium leading-tight pt-1">{{ room.address }}</span>
                        </div>
                        <div v-if="room.phone" class="flex items-center gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                            </div>
                            <span class="text-sm font-medium pt-0.5">{{ room.phone }}</span>
                        </div>
                        <div v-if="room.external_link" class="flex items-center gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                            </div>
                            <a :href="room.external_link" target="_blank" rel="noopener noreferrer"
                                class="text-sm font-medium pt-0.5 text-emerald-600 hover:underline break-all">{{
                                    room.external_link }}</a>
                        </div>
                    </div>

                    <!-- Card Footer -->
                    <div class="px-5 py-4 bg-gray-50/30 border-t border-gray-50 flex items-center justify-end">
                        <div class="w-3 h-3 rounded-full shadow-inner" :style="{ backgroundColor: room.color }"></div>
                    </div>
                </div>

                <div v-if="classrooms.length === 0" data-test="rooms-empty"
                    class="col-span-full text-center py-16 bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
                    {{ $t('classroom.no_rooms') }} <span v-if="searchQuery">{{ $t('common.matching') }} "{{ searchQuery
                    }}"</span>
                    <template v-if="displayMode === 'visible' && classroomOverviewCounts.hidden > 0">
                        <p class="mt-2">{{ $t('classroom.all_rooms_hidden') }}</p>
                        <button class="mt-3 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700"
                            @click="displayMode = 'all'">
                            {{ $t('classroom.show_all_rooms') }}
                        </button>
                    </template>
                </div>
            </div>

            <div v-if="roomsPagination.total > 0" class="mt-4">
                <Pagination v-model="roomsPagination.page" v-model:perPage="roomsPagination.perPage"
                    :totalItems="roomsPagination.total" />
            </div>
        </div>

        <!-- SESSIONS TAB -->
        <div v-else-if="activeTab === 'sessions'" :aria-busy="sessionsLoading">

            <div v-if="showSessionsSkeleton" data-test="sessions-skeleton" role="status" aria-live="polite"
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <span class="sr-only">{{ $t('common.loading') }}</span>
                <BaseSkeletonCard v-for="n in 6" :key="n" variant="session" />
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 transition-opacity duration-200"
                :class="{ 'opacity-60': sessionsLoading }">
                <div v-for="session in sortedSessions" :key="session.id"
                    class="session-card group min-w-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">

                    <div class="p-5 pb-4">
                        <div class="flex min-w-0 items-start gap-3">
                            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-black uppercase shadow-inner transition-transform group-hover:scale-110"
                                :style="{ backgroundColor: `${getDayColor(primaryScheduleDay(session))}15`, color: getDayColor(primaryScheduleDay(session)) }">
                                {{ session.name.charAt(0) }}
                            </div>
                            <div class="min-w-0 flex-1">
                                <h3 class="break-words text-xl font-black leading-tight text-gray-900 transition group-hover:text-emerald-700">
                                    {{ session.name }}
                                </h3>
                                <div class="mt-2 flex flex-wrap gap-2">
                                    <span class="rounded-lg border px-2 py-1 text-[11px] font-black"
                                        :style="{ backgroundColor: `${getDayColor(primaryScheduleDay(session))}10`, color: getDayColor(primaryScheduleDay(session)), borderColor: `${getDayColor(primaryScheduleDay(session))}30` }">
                                        {{ session.session_type === 'camp' ? $t('classroom.camp') : $t('classroom.regular_session') }}
                                    </span>
                                    <span v-if="isSessionHidden(session.id)"
                                        class="rounded-lg border border-amber-100 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-600">
                                        {{ $t('classroom.hidden') }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div class="mt-4 flex items-center justify-end gap-1 border-t border-gray-100 pt-3">
                            <button @click="openEditSession(session)"
                                class="rounded-xl p-2.5 text-gray-400 transition-all hover:bg-emerald-50 hover:text-emerald-600"
                                :title="$t('common.edit')" :aria-label="$t('common.edit')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                            </button>
                            <button @click="deleteSession(session.id!)"
                                class="rounded-xl p-2.5 text-gray-400 transition-all hover:bg-red-50 hover:text-red-600"
                                :title="$t('common.delete')" :aria-label="$t('common.delete')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                            <button @click="toggleSessionVisibility(session.id)"
                                class="rounded-xl p-2.5 text-gray-400 transition-all hover:bg-amber-50 hover:text-amber-600"
                                :title="isSessionHidden(session.id) ? $t('classroom.show') : $t('classroom.hide')"
                                :aria-label="isSessionHidden(session.id) ? $t('classroom.show') : $t('classroom.hide')">
                                <svg v-if="isSessionHidden(session.id)" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3C5 3 1.73 7.11.46 9.04a1.75 1.75 0 000 1.92C1.73 12.89 5 17 10 17c5 0 8.27-4.11 9.54-6.04a1.75 1.75 0 000-1.92C18.27 7.11 15 3 10 3zm0 11a4 4 0 110-8 4 4 0 010 8z" /></svg>
                                <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l1.468 1.468C2.22 5.99 1.15 7.58.46 9.04a1.75 1.75 0 000 1.92C1.73 12.89 5 17 10 17c2.1 0 3.88-.72 5.34-1.73l1.38 1.38a.75.75 0 001.06-1.06l-14.5-14.5zM6.86 7.92A3 3 0 0010 13a2.99 2.99 0 002.08-.86L6.86 7.92zm6.36 1.06A3 3 0 0111.78 12l2.77 2.77c1.67-1.26 2.95-3.01 3.98-4.53a.25.25 0 000-.28c-1.27-1.87-4.17-5.43-8.53-5.43-.95 0-1.82.17-2.61.45l2.43 2.43A2.99 2.99 0 0113.22 8.98z" clip-rule="evenodd" /></svg>
                            </button>
                        </div>
                    </div>

                    <div class="space-y-4 px-5 pb-2">
                        <section class="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
                            <h4 class="flex items-center gap-2 text-[11px] font-black text-emerald-800">
                                <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                {{ $t('classroom.schedule') }}
                            </h4>
                            <div class="mt-2 flex flex-col gap-1.5">
                                <span v-for="item in scheduleDisplayItems(session)" :key="item.key"
                                    class="break-words rounded-xl bg-white px-3 py-2 text-xs font-bold leading-5 text-gray-700 ring-1 ring-emerald-100">
                                    {{ item.text }}
                                </span>
                            </div>
                        </section>

                        <div class="session-card__metadata gap-3">
                            <div class="flex min-w-0 items-start gap-2.5 rounded-xl bg-gray-50 p-3 text-gray-500">
                                <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                                <div class="min-w-0"><p class="text-[10px] font-black text-gray-400">{{ $t('student.internal_courses.classroom') }}</p><p class="break-words text-sm font-bold text-gray-700">{{ getRoomName(session.classroom_id!) }}</p></div>
                            </div>
                            <div class="flex min-w-0 items-start gap-2.5 rounded-xl bg-gray-50 p-3 text-gray-500">
                                <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.5 2.7 3.8 6 3.8 10S14.5 19.3 12 22M2 12h20M12 2c-2.5 2.7-3.8 6-3.8 10s1.3 7.3 3.8 10" /></svg>
                                <div class="min-w-0"><p class="text-[10px] font-black text-gray-400">{{ $t('classroom.session_time_zone') }}</p><p class="break-words text-sm font-bold text-gray-700">{{ DateUtils.formatTimeZoneLabel(session.time_zone || preferences.timeZone, preferences.locale) }}</p></div>
                            </div>
                            <div class="flex min-w-0 items-start gap-2.5 rounded-xl bg-gray-50 p-3 text-gray-500">
                                <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2c0-1.18.68-2.2 1.67-2.69M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                <div class="min-w-0"><p class="text-[10px] font-black text-gray-400">{{ $t('classroom.capacity_short') }}</p><p class="text-sm font-bold text-gray-700">{{ session.capacity }}</p></div>
                            </div>
                        </div>

                        <div v-if="session.course_ids?.length" class="flex flex-wrap gap-1.5">
                            <span v-for="cid in session.course_ids" :key="cid"
                                class="max-w-full truncate rounded-lg border border-gray-100 bg-gray-50 px-2 py-1 text-[10px] font-black text-gray-500">
                                {{ courses.find(c => c.id === cid)?.subject }}
                            </span>
                        </div>

                        <a v-if="session.external_link" :href="session.external_link" target="_blank"
                            rel="noopener noreferrer" :title="session.external_link"
                            class="inline-flex max-w-full items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">
                            <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                            <span class="truncate">{{ $t('classroom.external_link') }}</span>
                        </a>
                    </div>

                    <div class="px-5 py-4">
                        <router-link :to="{ name: 'session-details', params: { id: session.id! } }"
                            class="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black text-white shadow-md transition-all active:scale-95"
                            :style="{ backgroundColor: getDayColor(primaryScheduleDay(session)) }">
                            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                            {{ $t('classroom.view_students') }}
                        </router-link>
                    </div>

                    <div class="flex items-center justify-between border-t border-gray-50 bg-gray-50/50 px-5 py-3 text-[10px] font-black tracking-widest text-gray-300">
                        <span>#{{ session.id?.slice(0, 8) }}</span>
                        <span>{{ $t('classroom.lesson_count', session.lesson_number || 0, { named: { count: session.lesson_number || 0 } }) }}</span>
                    </div>
                </div>

                <div v-if="sortedSessions.length === 0" data-test="sessions-empty"
                    class="col-span-full text-center py-16 bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
                    {{ $t('classroom.no_sessions') }}
                    <template v-if="displayMode === 'visible' && sessionOverviewCounts.hidden > 0">
                        <p class="mt-2">{{ $t('classroom.all_sessions_hidden') }}</p>
                        <button class="mt-3 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700"
                            @click="displayMode = 'all'">
                            {{ $t('classroom.show_all_sessions') }}
                        </button>
                    </template>
                </div>
            </div>

            <div v-if="sessionsPagination.total > 0" class="mt-4">
                <Pagination v-model="sessionsPagination.page" v-model:perPage="sessionsPagination.perPage"
                    :totalItems="sessionsPagination.total" />
            </div>
        </div>
        <!-- Responsive Room Management Panel -->
        <ClassroomManagementPanel v-if="isCreateRoomModalOpen" v-model:room="newClassroom"
            v-model:room-selections="roomPolicySelections" v-model:room-schedule-selections="roomScheduleSelections"
            :room-id="editingClassroom?.id" :sessions="roomSessions" :roles="roles" :policies="notificationPolicies"
            :schedule-policies="schedulePolicies" :saving="isSavingRoom" :initial-tab="roomPanelInitialTab"
            @close="closeRoomModal" @save="saveClassroom" @edit-session="editSessionFromRoomPanel"
            @policies-changed="refreshRolePolicies" />

        <!-- Create Session Modal -->
        <div v-if="isCreateSessionModalOpen"
            class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div
                class="bg-white rounded-2xl p-6 w-full max-w-4xl shadow-2xl m-4 animate-in fade-in zoom-in duration-200 overflow-y-auto max-h-[90vh]">
                <h3 class="text-xl font-bold mb-6 text-gray-800">{{ editingSession ? $t('classroom.edit_session') : $t('classroom.add_session') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.session_name')
                            }}</label>
                        <input v-model="newSession.name" :placeholder="$t('classroom.session_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">{{ $t('classroom.session_type') }}</label>
                        <div class="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
                            <button type="button" @click="setSessionType('regular')"
                                class="rounded-lg px-4 py-2 text-sm font-bold transition"
                                :class="newSession.session_type !== 'camp' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500'">
                                {{ $t('classroom.regular_session') }}
                            </button>
                            <button type="button" @click="setSessionType('camp')"
                                class="rounded-lg px-4 py-2 text-sm font-bold transition"
                                :class="newSession.session_type === 'camp' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'">
                                {{ $t('classroom.camp') }}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{
                            $t('student.internal_courses.classroom') }}</label>
                        <SearchableSelect v-model="newSession.classroom_id" :options="roomOptions"
                            :placeholder="$t('student.internal_courses.session_select_placeholder')" />
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.capacity')
                            }}</label>
                        <input type="number" v-model="newSession.capacity"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>

                    <!-- <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{
                            $t('student.internal_courses.lesson_number') }}</label>
                        <input type="number" v-model.number="newSession.lesson_number"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="1">
                    </div> -->

                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('common.start_date') }}
                            <span v-if="newSession.session_type !== 'camp'" class="text-red-500">*</span></label>
                        <input type="date" v-model="newSession.start_date" :required="newSession.session_type !== 'camp'"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>

                    <div>
                        <div class="flex items-center justify-between mb-1.5">
                            <label class="block text-sm font-semibold text-gray-700">{{ $t('common.end_date') }}</label>
                            <button v-if="newSession.end_date" @click="newSession.end_date = null"
                                class="text-[10px] text-gray-400 hover:text-red-500 font-medium uppercase tracking-wider transition-colors">
                                {{ $t('common.clear') }}
                            </button>
                        </div>
                        <input type="date" v-model="newSession.end_date"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                        <p class="text-xs text-gray-500 mt-1">{{ newSession.session_type === 'camp' ? $t('classroom.camp_date_hint') : $t('classroom.long_term_hint') }}</p>
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.external_link')
                            }}</label>
                        <input v-model="newSession.external_link"
                            :placeholder="$t('classroom.external_link_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">{{ $t('classroom.schedule')
                            }}</label>
                        <div v-if="newSession.session_type !== 'camp'" class="flex gap-2 mb-3">
                            <button type="button" @click="setScheduleMode('weekly')"
                                class="rounded-lg border px-3 py-1.5 text-sm font-bold"
                                :class="newSession.schedule_mode === 'weekly' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'">
                                {{ $t('classroom.weekly') }}
                            </button>
                            <button type="button" @click="setScheduleMode('monthly')"
                                class="rounded-lg border px-3 py-1.5 text-sm font-bold"
                                :class="newSession.schedule_mode === 'monthly' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500'">
                                {{ $t('classroom.monthly') }}
                            </button>
                        </div>
                        <div class="space-y-2">
                            <div v-for="(rule, index) in newSession.schedule_rules" :key="rule.id || index"
                                class="grid grid-cols-1 sm:grid-cols-[minmax(120px,1fr)_auto_auto_auto] items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                                <BaseDropdown v-if="newSession.schedule_mode === 'weekly'"
                                    v-model="rule.day_of_week" :options="dayOptions" theme="emerald" />
                                <label v-else-if="newSession.schedule_mode === 'monthly'" class="flex items-center gap-2 text-sm text-gray-600">
                                    {{ $t('classroom.monthly_day_prefix') }}
                                    <input type="number" min="1" max="31" v-model.number="rule.day_of_month"
                                        class="w-20 border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                                    {{ $t('classroom.monthly_day_suffix') }}
                                </label>
                                <input v-else type="date" v-model="rule.occurrence_date"
                                    class="border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500">
                                <input type="time" v-model="rule.start_time"
                                    class="border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                                <input type="time" v-model="rule.end_time"
                                    class="border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                                <button type="button" @click="removeScheduleRule(index)"
                                    class="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                    :title="$t('common.delete')">×</button>
                            </div>
                        </div>
                        <button type="button" @click="addScheduleRule"
                            class="mt-3 w-full rounded-xl border-2 border-dashed border-gray-300 py-2 text-sm font-bold text-gray-500 hover:border-emerald-500 hover:text-emerald-600">
                            + {{ $t('classroom.add_schedule_rule') }}
                        </button>
                        <p v-if="newSession.session_type === 'camp' && (!newSession.start_date || !newSession.end_date || !newSession.schedule_rules?.length)"
                            class="mt-2 text-xs font-medium text-amber-600">
                            {{ $t('classroom.camp_draft_hint') }}
                        </p>
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('common.time_zone')
                            }}</label>
                        <select v-model="newSession.time_zone"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                            <option v-for="option in preferences.timeZoneOptions" :key="option.value"
                                :value="option.value">
                                {{ option.label }}
                            </option>
                        </select>
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-2">{{
                            $t('student.internal_courses.course') }}</label>
                        <div class="h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-1">
                            <div v-for="c in courses" :key="c.id" @click="toggleCourseSelection(c.id!)"
                                class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-white select-none transition"
                                :class="newSession.course_ids?.includes(c.id!) ? 'bg-white shadow-sm ring-1 ring-emerald-500' : ''">
                                <div class="w-4 h-4 rounded border flex items-center justify-center transition-colors"
                                    :class="newSession.course_ids?.includes(c.id!) ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'">
                                    <svg v-if="newSession.course_ids?.includes(c.id!)"
                                        xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white"
                                        viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clip-rule="evenodd" />
                                    </svg>
                                </div>
                                <span class="text-sm text-gray-700">{{ c.subject }} <span class="text-gray-400">- {{
                                    c.stage }}{{ c.displayNameValue ? ` (${c.displayNameValue})` : ''
                                        }}</span></span>
                            </div>
                        </div>
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">{{
                            $t('classroom.copy.teaching_schedule') }}</label>
                        <p v-if="teacherRolePermissionError" role="alert" class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                            <span>{{ $t('rbac.teacher_assignment_permission_check_failed') }}</span>
                            <button type="button" class="min-h-11 rounded-lg px-3 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500" @click="retryTeacherRoleCatalog">{{ $t('rbac.platform_teaching_assignments.retry') }}</button>
                        </p>
                        <p v-if="teacherAssignmentsLoadError" role="alert" class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                            <span>{{ $t('rbac.teacher_assignment_list_load_failed') }}</span>
                            <button type="button" class="min-h-11 rounded-lg px-3 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500" @click="retrySessionTeacherAssignments">{{ $t('rbac.platform_teaching_assignments.retry') }}</button>
                        </p>
                        <p v-else-if="teacherRoleManageAllowed === null" role="status" aria-live="polite" class="mb-3 text-xs text-slate-500">{{ $t('rbac.teacher_assignment_permission_loading') }}</p>
                        <p v-else-if="teacherRoleManageAllowed === false" role="status" class="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{{ $t('rbac.teacher_assignment_manage_required') }}</p>
                        <p v-if="teacherAssignmentSaveError" role="alert" class="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{{ $t('rbac.teacher_assignment_manage_required') }}</p>
                        <div class="mb-3 flex flex-wrap gap-2 rounded-xl bg-gray-100 p-1">
                            <button type="button" @click="showPastAssignments = false; currentUpcomingAssignmentsPage = 1"
                                class="rounded-lg px-3 py-2 text-xs font-bold transition-colors"
                                :class="!showPastAssignments ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'">
                                {{ $t('classroom.teacher_assignments_current_upcoming') }} ({{ currentUpcomingTeacherAssignments.length }})
                            </button>
                            <button v-if="pastTeacherAssignments.length" type="button"
                                @click="showPastAssignments = true; pastAssignmentsPage = 1"
                                class="rounded-lg px-3 py-2 text-xs font-bold transition-colors"
                                :class="showPastAssignments ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'">
                                {{ $t('classroom.teacher_assignments_history') }} ({{ pastTeacherAssignments.length }})
                            </button>
                        </div>
                        <div class="space-y-3">
                            <div v-for="entry in visibleTeacherAssignments.items" :key="`${entry.config.teacher_id}:${entry.config.effective_from}:${entry.index}`"
                                class="p-3 border border-gray-200 rounded-xl bg-gray-50/50 space-y-3">
                                <div class="flex items-start justify-between gap-3">
                                    <div class="flex-1">
                                        <label
                                            class="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{{
                                                $t('classroom.teacher') }}</label>
                                        <SearchableSelect v-model="entry.config.teacher_id" :options="teacherOptions"
                                            :placeholder="$t('classroom.teacher_search_placeholder')" :disabled="teacherRoleManageAllowed !== true || teacherAssignmentsLoadError" />
                                    </div>
                                    <div class="flex-1">
                                        <label class="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                                            {{ $t('classroom.teacher_role') }}</label>
                                        <SearchableSelect v-model="entry.config.role_id" :options="teacherRoleOptions"
                                            :placeholder="$t('classroom.teacher_role_placeholder')"
                                            :disabled="teacherRoleManageAllowed !== true || teacherAssignmentsLoadError || teacherRoleCatalogError || !teacherRoleCatalog.length" />
                                    </div>
                                    <button @click="removeTeacherAssignment(entry.index)" :disabled="teacherRoleManageAllowed !== true || teacherAssignmentsLoadError"
                                        class="mt-6 p-2 text-gray-400 hover:text-red-500 transition-colors">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                                <div v-if="teacherRoleCatalogError" role="alert" class="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-rose-700">
                                    <span>{{ $t('rbac.teacher_assignment_role_catalog_failed') }}</span>
                                    <button type="button" class="min-h-11 rounded-lg px-3 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500" @click="retryTeacherRoleCatalog">{{ $t('rbac.platform_teaching_assignments.retry') }}</button>
                                </div>
                                <p v-else-if="entry.config.teacher_id && !linkedTeacherUserId(entry.config.teacher_id)" role="status" class="text-xs leading-5 text-amber-700">{{ $t('rbac.teacher_assignment_unlinked') }}</p>
                                <template v-else>
                                    <p class="text-xs leading-5 text-slate-500">{{ $t('rbac.teacher_assignment_role_grant_notice') }}</p>
                                    <EffectiveTeachingRoles v-if="editingSession?.id && linkedTeacherUserId(entry.config.teacher_id)" :user-id="linkedTeacherUserId(entry.config.teacher_id)" scope-type="class_session" :scope-id="editingSession.id" :effective-date="entry.config.effective_from" />
                                </template>
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label
                                            class="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{{
                                                $t('common.start_date') }}</label>
                                        <input type="date" v-model="entry.config.effective_from"
                                            :disabled="teacherRoleManageAllowed !== true || teacherAssignmentsLoadError" class="w-full text-sm border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100" />
                                    </div>
                                    <div>
                                        <div class="flex items-center justify-between mb-1">
                                            <label
                                                class="block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                                {{ $t('common.end_date') }}
                                                <span v-if="!entry.config.effective_to"
                                                    class="ml-1 text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{{
                                                        $t('classroom.default_teacher') }}</span>
                                            </label>
                                            <button v-if="entry.config.effective_to" @click="entry.config.effective_to = null"
                                                class="text-[9px] text-gray-400 hover:text-red-500 font-bold uppercase transition-colors">
                                                {{ $t('common.clear') }}
                                            </button>
                                        </div>
                                        <input type="date" v-model="entry.config.effective_to"
                                            :disabled="teacherRoleManageAllowed !== true || teacherAssignmentsLoadError" class="w-full text-sm border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-100" />
                                    </div>
                                </div>
                            </div>
                            <div v-if="visibleTeacherAssignments.items.length === 0"
                                class="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs font-bold text-gray-400">
                                {{ $t('classroom.no_teachers_assigned') }}
                            </div>
                            <div v-if="visibleTeacherAssignments.pageCount > 1"
                                class="flex items-center justify-between border-t border-gray-100 pt-3 text-xs font-bold text-gray-500">
                                <button type="button" class="rounded-lg px-3 py-2 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    :disabled="visibleTeacherAssignments.page <= 1"
                                    @click="showPastAssignments ? pastAssignmentsPage-- : currentUpcomingAssignmentsPage--">
                                    {{ $t('classroom.teacher_assignments_previous_page') }}
                                </button>
                                <span>{{ $t('classroom.teacher_assignments_page', { page: visibleTeacherAssignments.page, pages: visibleTeacherAssignments.pageCount }) }}</span>
                                <button type="button" class="rounded-lg px-3 py-2 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    :disabled="visibleTeacherAssignments.page >= visibleTeacherAssignments.pageCount"
                                    @click="showPastAssignments ? pastAssignmentsPage++ : currentUpcomingAssignmentsPage++">
                                    {{ $t('classroom.teacher_assignments_next_page') }}
                                </button>
                            </div>
                            <button @click="addTeacherAssignment" :disabled="teacherRoleManageAllowed !== true || teacherAssignmentsLoadError || teacherRoleCatalogError || !teacherRoleCatalog.length"
                                class="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm font-bold text-gray-500 hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50/30 transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 4v16m8-8H4" />
                                </svg>
                                {{ $t('classroom.copy.add_teacher_assignment') }}
                            </button>
                        </div>
                    </div>
                </div>

                <section class="mt-6 space-y-4 rounded-2xl border border-gray-100 bg-gray-50 p-4 sm:p-5">
                    <div>
                        <h4 class="font-black text-gray-900">{{ $t('settings.incomplete_notifications.title') }}</h4>
                        <p class="mt-1 text-xs font-bold text-gray-400">{{ $t('classroom.session_notification_hint') }}</p>
                    </div>
                    <ScopedRolePolicyEditor v-model="sessionPolicySelections" :roles="roles" :policies="notificationPolicies"
                        scope-type="class_session" :scope-id="editingSession?.id"
                        :classroom-id="newSession.classroom_id || null" :class-session-id="editingSession?.id"
                        compact :disabled="isSavingSession" />
                </section>

                <section class="mt-4 space-y-4 rounded-2xl border border-gray-100 bg-gray-50 p-4 sm:p-5">
                    <div>
                        <h4 class="font-black text-gray-900">{{ $t('settings.dashboard_schedule.title') }}</h4>
                        <p class="mt-1 text-xs font-bold text-gray-500">{{ $t('classroom.session_schedule_hint') }}</p>
                    </div>
                    <DashboardScheduleModeEditor v-model="sessionScheduleSelections" :roles="roles" :policies="schedulePolicies"
                        scope-type="class_session" :scope-id="editingSession?.id"
                        :classroom-id="newSession.classroom_id || null" :class-session-id="editingSession?.id"
                        compact :disabled="isSavingSession" />
                </section>

                <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-gray-50">
                    <button @click="closeSessionModal" :disabled="isSavingSession"
                        class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">{{
                            $t('common.cancel') }}</button>
                    <button @click="saveSession" :disabled="isSavingSession"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm font-bold transition-all flex items-center gap-2">
                        <svg v-if="isSavingSession" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        {{ editingSession ? $t('common.save') : $t('common.add') }}
                    </button>
                </div>
            </div>
        </div>
        <ConfirmModal :is-open="genericConfirm.isOpen" :title="genericConfirm.title" :message="genericConfirm.message"
            :confirm-text="genericConfirm.confirmText" :is-dangerous="genericConfirm.isDangerous"
            :is-loading="genericConfirm.isLoading" @confirm="handleGenericConfirm"
            @close="genericConfirm.isOpen = false" />
    </div>
</template>

<style scoped>
.session-card {
    container-type: inline-size;
}

.session-card__metadata {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
}

@container (min-width: 26rem) {
    .session-card__metadata {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>

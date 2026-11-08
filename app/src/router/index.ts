import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'
import { useCapabilityStore } from '@/stores/useCapabilityStore'
import LoginView from '@/views/LoginView.vue'
import { getSafePostLoginTarget } from './authRedirect'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
      meta: { requiresAuth: false, title: 'nav.home', description: 'nav.subtitle' }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { title: 'nav.login', description: 'nav.subtitle' }
    },
    {
      path: '/account-disabled',
      name: 'account-disabled',
      component: () => import('@/views/AccountDisabledView.vue'),
      meta: { title: 'auth.account_disabled_title', description: 'nav.subtitle' }
    },
    {
      path: '/dashboard',
      component: () => import('@/layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/HomeView.vue'),
          meta: { title: 'nav.dashboard', description: 'nav.description.dashboard' }
        },
        {
          path: 'student/:id',
          name: 'student-profile',
          component: () => import('@/views/StudentProfileView.vue'),
          meta: { title: 'nav.student_profile', description: 'nav.description.students' }
        },
        {
          path: 'courses',
          name: 'courses',
          component: () => import('@/views/CourseManagementView.vue'),
          meta: { capability: 'teaching.courses.list', title: 'nav.courses', description: 'nav.description.courses' }
        },
        {
          path: 'students',
          name: 'students',
          component: () => import('@/views/StudentManagementView.vue'),
          meta: { capability: 'teaching.students.list', title: 'nav.students', description: 'nav.description.students' }
        },
        {
          path: 'classrooms',
          name: 'classrooms',
          component: () => import('@/views/ClassroomManagementView.vue'),
          meta: { capability: 'teaching.classrooms.list', title: 'nav.classrooms', description: 'nav.description.classrooms' }
        },
        {
          path: 'classrooms/session/:id',
          name: 'session-details',
          component: () => import('@/views/SessionDetailsView.vue'),
          meta: { title: 'nav.session_details', description: 'nav.description.classrooms' }
        },
        {
          path: 'student/:id/reports',
          name: 'student-all-reports',
          component: () => import('@/views/StudentAllReportsView.vue'),
          meta: { title: 'nav.historical_reports', description: 'nav.description.reports' }
        },
        {
          path: 'reports/:enrollmentId',
          name: 'lesson-reports',
          component: () => import('@/views/StudentReportsView.vue'),
          meta: { title: 'nav.report_editor', description: 'nav.description.reports' }
        },
        {
          path: 'reports/incomplete',
          name: 'incomplete-reports',
          component: () => import('@/views/GlobalIncompleteReportsView.vue'),
          meta: { capability: 'teaching.reports.list', title: 'nav.incomplete_reports', description: 'nav.description.incomplete' }
        },
        {
          path: 'holidays',
          name: 'holidays',
          component: () => import('@/views/HolidayManagementView.vue'),
          meta: { capability: 'teaching.holidays.list', title: 'nav.holidays', description: 'nav.description.holidays' }
        },
        {
          path: 'teachers',
          name: 'teachers',
          component: () => import('@/views/TeacherManagementView.vue'),
          meta: { capability: 'teaching.teachers.list', title: 'nav.teachers', description: 'nav.description.teachers' }
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { title: 'nav.settings', description: 'nav.description.settings' }
        },
        {
          path: 'about',
          name: 'about',
          component: () => import('@/views/AboutView.vue'),
          meta: { title: 'nav.about', description: 'nav.about' }
        },
        {
          path: 'about/changelog',
          name: 'changelog',
          component: () => import('@/views/ChangelogView.vue'),
          meta: { title: 'about.changelog', description: 'about.changelog_subtitle' }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard'
    }
  ]
})

// Navigation Guard
router.beforeEach(async (to: RouteLocationNormalized) => {
  const authStore = useAuthStore()
  
  // Wait for auth init if not ready
  if (authStore.loading) {
    await authStore.initialize()
  }

  if (authStore.accountDisabled && to.name !== 'account-disabled') {
    return { name: 'account-disabled' }
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  
  if (to.path === '/login' && authStore.isAuthenticated) {
    return getSafePostLoginTarget(to.query.redirect, router)
  }

  // Pages the user holds no permission for in any scope go back to the
  // dashboard instead of rendering a page full of permission errors.
  const capability = to.meta.capability
  if (typeof capability === 'string' && authStore.isAuthenticated) {
    const capabilities = useCapabilityStore()
    await capabilities.ensureLoaded()
    if (!capabilities.can(capability)) return { name: 'dashboard' }
  }

  return true
})

export default router

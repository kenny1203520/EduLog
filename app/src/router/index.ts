import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'
import LoginView from '@/views/LoginView.vue'

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
          meta: { title: 'nav.courses', description: 'nav.description.courses' }
        },
        {
          path: 'students',
          name: 'students',
          component: () => import('@/views/StudentManagementView.vue'),
          meta: { title: 'nav.students', description: 'nav.description.students' }
        },
        {
          path: 'classrooms',
          name: 'classrooms',
          component: () => import('@/views/ClassroomManagementView.vue'),
          meta: { title: 'nav.classrooms', description: 'nav.description.classrooms' }
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
          meta: { title: 'nav.incomplete_reports', description: 'nav.description.incomplete' }
        },
        {
          path: 'holidays',
          name: 'holidays',
          component: () => import('@/views/HolidayManagementView.vue'),
          meta: { title: 'nav.holidays', description: 'nav.description.holidays' }
        },
        {
          path: 'teachers',
          name: 'teachers',
          component: () => import('@/views/TeacherManagementView.vue'),
          meta: { title: 'nav.teachers', description: 'nav.description.teachers' }
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

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return '/login'
  }
  
  if (to.path === '/login' && authStore.isAuthenticated) {
    return '/dashboard'
  }

  return true
})

export default router

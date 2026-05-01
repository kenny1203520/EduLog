import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'
import LoginView from '@/views/LoginView.vue'
import i18n from '@/i18n'

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

// Dynamic Title & SEO Metadata Guard
router.afterEach((to) => {
  const t = i18n.global.t
  const baseTitle = 'EduLog'
  
  // 1. Handle Dynamic Title
  const titleKey = to.meta.title as string | undefined
  let finalTitle = baseTitle
  if (titleKey) {
    const translatedTitle = t(titleKey)
    if (translatedTitle !== titleKey) {
      finalTitle = `${baseTitle} | ${translatedTitle}`
    }
  }
  document.title = finalTitle

  // 2. Handle Meta Description & Social Tags
  const descKey = to.meta.description as string | undefined
  const finalDesc = descKey ? t(descKey) : t('nav.subtitle')

  const updateMetaTag = (selector: string, attr: string, value: string) => {
    let el = document.querySelector(selector)
    if (!el) {
      el = document.createElement('meta')
      if (selector.startsWith('meta[name')) {
        const name = selector.match(/name="([^"]+)"/)?.[1]
        if (name) el.setAttribute('name', name)
      } else if (selector.startsWith('meta[property')) {
        const prop = selector.match(/property="([^"]+)"/)?.[1]
        if (prop) el.setAttribute('property', prop)
      }
      document.head.appendChild(el)
    }
    el.setAttribute(attr, value)
  }

  updateMetaTag('meta[name="description"]', 'content', finalDesc)
  updateMetaTag('meta[property="og:title"]', 'content', finalTitle)
  updateMetaTag('meta[property="og:description"]', 'content', finalDesc)
  updateMetaTag('meta[property="og:type"]', 'content', 'website')
  updateMetaTag('meta[property="og:url"]', 'content', window.location.href)
  updateMetaTag('meta[name="twitter:card"]', 'content', 'summary_large_image')
  updateMetaTag('meta[name="twitter:title"]', 'content', finalTitle)
  updateMetaTag('meta[name="twitter:description"]', 'content', finalDesc)
})

export default router

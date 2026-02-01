import { createRouter, createWebHistory, type RouteLocationNormalized, type NavigationGuardNext } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'
import LoginView from '@/views/LoginView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView
    },
    {
      path: '/dashboard',
      component: () => import('@/layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/HomeView.vue')
        },
        {
          path: 'student/:id',
          name: 'student-profile',
          component: () => import('@/views/StudentProfileView.vue')
        },
        {
          path: 'courses',
          name: 'courses',
          component: () => import('@/views/CourseManagementView.vue')
        },
        {
          path: 'students',
          name: 'students',
          component: () => import('@/views/StudentManagementView.vue')
        },
        {
          path: 'classrooms',
          name: 'classrooms',
          component: () => import('@/views/ClassroomManagementView.vue')
        },
        {
          path: 'classrooms/session/:id',
          name: 'session-details',
          component: () => import('@/views/SessionDetailsView.vue')
        },
        {
          path: 'reports/:enrollmentId',
          name: 'lesson-reports',
          component: () => import('@/views/StudentReportsView.vue')
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
router.beforeEach(async (to: RouteLocationNormalized, _from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const authStore = useAuthStore()
  
  // Wait for auth init if not ready
  if (authStore.loading) {
    await authStore.initialize()
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && authStore.isAuthenticated) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router

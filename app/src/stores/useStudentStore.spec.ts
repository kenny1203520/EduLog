import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStudentStore } from './useStudentStore'
import { StudentQueryService } from '@/services/student/StudentQueryService'
import { StudentCommandService } from '@/services/student/StudentCommandService'

vi.mock('@/services/student/StudentQueryService', () => ({
  StudentQueryService: {
    getAll: vi.fn(),
    getById: vi.fn()
  }
}))

vi.mock('@/services/student/StudentCommandService', () => ({
  StudentCommandService: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}))

describe('useStudentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('initializes with empty students array', () => {
    const store = useStudentStore()
    expect(store.students).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('fetchAll calls StudentQueryService and updates state', async () => {
    const store = useStudentStore()
    vi.mocked(StudentQueryService.getAll).mockResolvedValue({
      data: [{ id: '1', name: 'John Doe' }],
      count: 1
    } as any)

    await store.fetchAll()
    expect(store.students.length).toBe(1)
    expect(store.students[0].name).toBe('John Doe')
    expect(store.studentCount).toBe(1)
  })

  it('addStudent adds a student', async () => {
    const store = useStudentStore()
    vi.mocked(StudentCommandService.create).mockResolvedValue({ id: '2', name: 'Jane Doe' } as any)
    await store.addStudent('Jane Doe')
    expect(store.students.length).toBe(1)
    expect(store.students[0].name).toBe('Jane Doe')
  })

  it('deleteStudent removes a student from the list', async () => {
    const store = useStudentStore()
    store.students = [{ id: '1', name: 'John Doe', created_at: new Date(), updated_at: new Date() } as any]
    
    vi.mocked(StudentCommandService.delete).mockResolvedValue(undefined)
    await store.deleteStudent('1')

    expect(store.students.length).toBe(0)
    expect(StudentCommandService.delete).toHaveBeenCalledWith('1')
  })
})

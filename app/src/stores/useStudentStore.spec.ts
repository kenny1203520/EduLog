import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useStudentStore } from './useStudentStore'
import { StudentService } from '@/services/student/StudentService'

vi.mock('@/services/student/StudentService', () => ({
  StudentService: {
    getAll: vi.fn(),
    getById: vi.fn(),
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

  it('fetchAll calls StudentService and updates state', async () => {
    const store = useStudentStore()
    vi.mocked(StudentService.getAll).mockResolvedValue({
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
    vi.mocked(StudentService.create).mockResolvedValue({ id: '2', name: 'Jane Doe' } as any)
    await store.addStudent('Jane Doe')
    expect(store.students.length).toBe(1)
    expect(store.students[0].name).toBe('Jane Doe')
  })

  it('deleteStudent removes a student from the list', async () => {
    const store = useStudentStore()
    store.students = [{ id: '1', name: 'John Doe', organization_id: 'org1', created_at: '', updated_at: '' }]
    
    vi.mocked(StudentService.delete).mockResolvedValue(undefined)
    await store.deleteStudent('1')
    
    expect(store.students.length).toBe(0)
    expect(StudentService.delete).toHaveBeenCalledWith('1')
  })
})

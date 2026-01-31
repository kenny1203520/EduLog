import { supabase } from '@/lib/supabase'
import { Student, type StudentDTO } from '@/models/Student'

export class StudentService {
  /**
   * Fetch all students ordered by name
   */
  static async getAll(): Promise<Student[]> {
    const { data, error } = await supabase
      .from('students')
      .select('*, student_contacts(*), student_schools(*), student_credentials(*)')
      .order('name')
    
    if (error) throw new Error(error.message)
    
    return (data as any[]).map(dto => new Student(dto))
  }

  /**
   * Get a single student by ID
   */
  static async getById(id: string): Promise<Student | null> {
    const { data, error } = await supabase
      .from('students')
      .select('*, student_contacts(*), student_schools(*), student_credentials(*)')
      .eq('id', id)
      .single()
    
    if (error) throw new Error(error.message)
    if (!data) return null

    return new Student(data as any)
  }

  /**
   * Create a new student
   */
  static async create(student: Partial<StudentDTO>): Promise<Student> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')

    const { data, error } = await supabase
      .from('students')
      .insert({ ...student, user_id: user.id })
      .select()
      .single()

    if (error) throw new Error(error.message)

    return new Student(data as StudentDTO)
  }

  /**
   * Update an existing student
   */
  static async update(id: string, updates: Partial<StudentDTO>): Promise<Student> {
    const { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)

    return new Student(data as StudentDTO)
  }

  // --- Contacts ---
  static async addContact(contact: any) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')
    const { data, error } = await supabase.from('student_contacts').insert({ ...contact, user_id: user.id }).select().single()
    if (error) throw new Error(error.message)
    return data
  }

  static async deleteContact(id: string) {
    const { error } = await supabase.from('student_contacts').delete().eq('id', id)
    if (error) throw new Error(error.message)
  }

  // --- Schools ---
  static async addSchool(school: any) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')
    const { data, error } = await supabase.from('student_schools').insert({ ...school, user_id: user.id }).select().single()
    if (error) throw new Error(error.message)
    return data
  }

  static async deleteSchool(id: string) {
    const { error } = await supabase.from('student_schools').delete().eq('id', id)
    if (error) throw new Error(error.message)
  }

  // --- Credentials ---
  static async addCredential(credential: any) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')
    const { data, error } = await supabase.from('student_credentials').insert({ ...credential, user_id: user.id }).select().single()
    if (error) throw new Error(error.message)
    return data
  }

  static async deleteCredential(id: string) {
    const { error } = await supabase.from('student_credentials').delete().eq('id', id)
    if (error) throw new Error(error.message)
  }
}

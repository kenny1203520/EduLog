export interface StudentContactDTO {
  id?: string
  name: string
  relation?: string
  phone?: string
  email?: string
  created_at?: string
  updated_at?: string
}

export interface StudentSchoolDTO {
  id?: string
  name: string
  status?: string
  start_date?: string // YYYY-MM-DD
  end_date?: string // YYYY-MM-DD or empty/null for Present
  grade?: string // e.g. "Year 1" (Required if status is Enrolled)
  class?: string // e.g. "Class A"
  school_student_id?: string // 学号
  created_at?: string
  updated_at?: string
}

export interface StudentCredentialDTO {
  id?: string
  platform: 'Orange Apple' | 'Roblox' | 'Minecraft' | 'Anydesk' | 'Quiz Platform' | string
  username?: string
  password?: string
  url?: string
  created_at?: string
  updated_at?: string
}

export interface StudentDTO {
  id: string
  created_at: string
  updated_at?: string
  name: string
  notes?: string
  // New Fields
  gov_id?: string
  email?: string
  phone?: string
  residence_address?: string
  mailing_address?: string
  // Relations
  student_contacts?: StudentContactDTO[]
  student_schools?: StudentSchoolDTO[]
  student_credentials?: StudentCredentialDTO[]
}

export class Student {
  public id: string
  public created_at: Date
  public updated_at?: Date
  public name: string
  public notes: string
  
  public gov_id: string
  public email: string
  public phone: string
  public residence_address: string
  public mailing_address: string
  
  public contacts: StudentContactDTO[]
  public schools: StudentSchoolDTO[]
  public credentials: StudentCredentialDTO[]

  constructor(dto: StudentDTO) {
    this.id = dto.id
    this.created_at = new Date(dto.created_at)
    if (dto.updated_at) this.updated_at = new Date(dto.updated_at)
    this.name = dto.name
    this.notes = dto.notes || ''
    
    this.gov_id = dto.gov_id || ''
    this.email = dto.email || ''
    this.phone = dto.phone || ''
    this.residence_address = dto.residence_address || ''
    this.mailing_address = dto.mailing_address || ''
    
    this.contacts = dto.student_contacts || []
    this.schools = dto.student_schools || []
    this.credentials = dto.student_credentials || []
  }

  /**
   * Validates if the student has a valid name.
   */
  public isValid(): boolean {
    return this.name.trim().length > 0
  }

  /**
   * Returns a formatted display name (e.g., "John - Grade 5")
   */
  get displayName(): string {
    const g = this.displayGrade
    return g !== 'No Grade' ? `${this.name} (${g})` : this.name
  }

  /**
   * Returns the current school (status 'Enrolled') if any.
   * If multiple, returns the first one (or logic could be improved).
   */
  get currentSchool(): StudentSchoolDTO | undefined {
    return this.schools.find(s => s.status === 'Enrolled' || s.status === 'enrolled')
  }

  get displayGrade(): string {
    const s = this.currentSchool
    if (!s) return 'No Grade'
    return s.class ? `${s.grade} - ${s.class}` : (s.grade || 'No Grade')
  }

  get displaySchoolName(): string {
    return this.currentSchool?.name || 'No School'
  }

  get displaySchoolId(): string {
    return this.currentSchool?.school_student_id || ''
  }
}

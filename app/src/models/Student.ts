export interface StudentContactDTO {
  id?: string
  name: string
  relation?: string
  phone?: string
  email?: string
}

export interface StudentSchoolDTO {
  id?: string
  name: string
  status?: string
}

export interface StudentCredentialDTO {
  id?: string
  platform: 'Orange Apple' | 'Roblox' | 'Minecraft' | 'Anydesk' | 'Quiz Platform' | string
  username?: string
  password?: string
  url?: string
}

export interface StudentDTO {
  id: string
  created_at: string
  name: string
  grade?: string
  notes?: string
  // New Fields
  gov_id?: string
  email?: string
  phone?: string
  residence_address?: string
  mailing_address?: string
  orange_apple_id?: string
  // Relations
  student_contacts?: StudentContactDTO[]
  student_schools?: StudentSchoolDTO[]
  student_credentials?: StudentCredentialDTO[]
}

export class Student {
  public id: string
  public created_at: Date
  public name: string
  public grade: string
  public notes: string
  
  public gov_id: string
  public email: string
  public phone: string
  public residence_address: string
  public mailing_address: string
  public orange_apple_id: string
  
  public contacts: StudentContactDTO[]
  public schools: StudentSchoolDTO[]
  public credentials: StudentCredentialDTO[]

  constructor(dto: StudentDTO) {
    this.id = dto.id
    this.created_at = new Date(dto.created_at)
    this.name = dto.name
    this.grade = dto.grade || ''
    this.notes = dto.notes || ''
    
    this.gov_id = dto.gov_id || ''
    this.email = dto.email || ''
    this.phone = dto.phone || ''
    this.residence_address = dto.residence_address || ''
    this.mailing_address = dto.mailing_address || ''
    this.orange_apple_id = dto.orange_apple_id || ''
    
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
    return this.grade ? `${this.name} (${this.grade})` : this.name
  }
}

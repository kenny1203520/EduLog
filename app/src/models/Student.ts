export interface StudentDTO {
  id: string
  created_at: string
  name: string
  grade?: string
  notes?: string
}

export class Student {
  public id: string
  public created_at: Date
  public name: string
  public grade: string
  public notes: string

  constructor(dto: StudentDTO) {
    this.id = dto.id
    this.created_at = new Date(dto.created_at)
    this.name = dto.name
    this.grade = dto.grade || ''
    this.notes = dto.notes || ''
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

  /**
   * Serializes back to DTO for saving
   */
  public toDTO(): Partial<StudentDTO> {
    return {
      name: this.name,
      grade: this.grade,
      notes: this.notes
    }
  }
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('student profile capability contract', () => {
  const profile = read('src/views/StudentProfileView.vue')
  const details = read('src/components/student/StudentMainDetails.vue')
  const query = read('src/services/student/StudentQueryService.ts')

  it('loads each sensitive section only when its read capability permits it', () => {
    expect(query).toContain("capabilities?.personal?.read === true ? PageApiService.getStudentPrivateDetails(id)")
    expect(query).toContain("capabilities?.contacts?.read === true ? apiResourceClient.list<StudentContactDTO>('student-contacts'")
    expect(query).toContain("capabilities?.schools?.read === true ? apiResourceClient.list<StudentSchoolDTO>('student-schools'")
    expect(query).toContain('capabilities?.credentials?.read === true ? StudentCredentialsQueryService.getForStudent(id)')
    for (const section of ['contacts', 'schools', 'credentials']) {
      expect(profile).toContain(`v-if="studentStore.currentStudent.capabilities.${section}.read"`)
      expect(profile).toContain(`:can-update="studentStore.currentStudent.capabilities.${section}.update"`)
    }
    expect(profile).toContain("$t('student.restricted.title')")
    expect(profile).not.toMatch(/[一-鿿]/)
  })

  it('does not submit personal fields without personal update capability', () => {
    expect(profile).toContain(':can-read-personal="studentStore.currentStudent.capabilities.personal.read"')
    expect(details).toContain('props.canUpdatePersonal ? {')
    expect(details).toContain('v-if="canReadPersonal"')
    expect(details).toContain('isEditingMainDetails && canUpdatePersonal')
  })
})

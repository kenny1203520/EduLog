import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('student profile capability contract', () => {
  const profile = read('src/views/StudentProfileView.vue')
  const details = read('src/components/StudentMainDetails.vue')
  const query = read('src/services/student/StudentQueryService.ts')

  it('loads private resources only when the profile capability permits it', () => {
    expect(query).toContain("result.data.capabilities?.read_sensitive !== true")
    expect(query).toContain('PageApiService.getStudentPrivateDetails(id)')
    expect(profile).toContain('studentStore.currentStudent.capabilities.read_sensitive')
    expect(profile).toContain('需要額外權限')
  })

  it('does not submit sensitive fields without update-sensitive capability', () => {
    expect(details).toContain('props.canUpdateSensitive ? {')
    expect(details).toContain('v-if="canReadSensitive"')
    expect(details).toContain('isEditingMainDetails && canUpdateSensitive')
  })
})

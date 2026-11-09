import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useEnrollmentHistory } from './useEnrollmentHistory'
import type { EnrollmentHistoryReport } from '@/models/EnrollmentHistoryReport'
const api=vi.hoisted(()=>({list:vi.fn(),candidates:vi.fn(),bind:vi.fn()}))
vi.mock('@/services/enrollment/EnrollmentHistoryService',()=>({EnrollmentHistoryService:api}))
const row=(id='history')=>({id,enrollment_id:'enrollment',report_date:'2026-10-04',version:2,identity_status:'evidence_only',source_fields:[]} as EnrollmentHistoryReport)
describe('history view model',()=>{
 let scope:ReturnType<typeof effectScope>
 beforeEach(()=>{vi.resetAllMocks();scope=effectScope();api.list.mockResolvedValue({items:[row()],next_cursor:null});api.candidates.mockResolvedValue({items:[],next_cursor:null})})
 afterEach(()=>scope.stop())
 const setup=()=>scope.run(()=>useEnrollmentHistory(ref({student_id:'student'})))!
 it('ignores a candidate response for the previous selection',async()=>{
  const state=setup();await nextTick();let finish:(v:unknown)=>void=()=>{}
  api.candidates.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const first=state.choose(row('old'));await state.choose(row('current'));finish({items:[{id:'obsolete'}],next_cursor:null});await first
  expect(state.selected.value?.id).toBe('current');expect(state.candidates.value).toEqual([])
 })
 it('preserves conflict controls when an overwrite invalidates a preview',async()=>{
  const state=setup();await nextTick();await state.choose(row());state.occurrence.value='occurrence';await nextTick()
  api.bind.mockResolvedValue({conflicts:[{field:'content',before:'old',after:'source'}],patch:{},report_id:'report'})
  await state.bind();expect(state.preview.value).not.toBeNull();state.overwrite.value=['content'];await nextTick();expect(state.preview.value).toBeNull();expect(state.conflicts.value).toHaveLength(1)
 })
 it('retries a lost apply response with the original idempotency key and version',async()=>{
  const state=setup();await nextTick();await state.choose(row());state.occurrence.value='occurrence';await nextTick();api.bind.mockResolvedValueOnce({conflicts:[],patch:{content:'text'}})
  await state.bind();api.bind.mockRejectedValueOnce(new Error('network'));await state.bind(true);api.bind.mockResolvedValueOnce({report_id:'report',status:'linked'});await state.bind(true)
  expect(api.bind.mock.calls[2]?.[3]).toBe(api.bind.mock.calls[1]?.[3]);expect(api.bind.mock.calls[2]?.[1].version).toBe(2);expect(state.rows.value).toEqual([])
 })
})

import { describe, expect, it, vi } from 'vitest'
const post=vi.hoisted(()=>vi.fn())
vi.mock('../api/ApiV1Client',()=>({apiV1Client:{post}}))
import { EnrollmentHistoryService as service } from './EnrollmentHistoryService'
describe('permission-scoped history service',()=>{
 it('uses the named history route and carries the selected enrollment and cursor',async()=>{post.mockResolvedValue({data:{items:[],next_cursor:null}});await service.list({enrollment_id:'enrollment'},'date|id');expect(post).toHaveBeenLastCalledWith('/enrollment-history/list',{enrollment_id:'enrollment',cursor:'date|id',limit:50,unlinked_only:true})})
 it('surfaces authorization failures rather than presenting an empty history',async()=>{post.mockRejectedValue(new Error('PERMISSION_DENIED'));await expect(service.candidates('history')).rejects.toThrow('PERMISSION_DENIED')})
})

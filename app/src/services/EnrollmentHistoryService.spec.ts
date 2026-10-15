import { describe, expect, it, vi } from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('./api/ApiDataClient',()=>({apiDataClient:{rpc}}))
import { EnrollmentHistoryService as service } from './EnrollmentHistoryService'
describe('permission-scoped history service',()=>{
 it('uses only the guarded RPC and carries the selected enrollment and cursor',async()=>{rpc.mockResolvedValue({data:{items:[],next_cursor:null}});await service.list({enrollment_id:'enrollment'},'date|id');expect(rpc).toHaveBeenLastCalledWith('enrollment_history_access',{p_operation:'list',p_input:{enrollment_id:'enrollment',cursor:'date|id',limit:50,unlinked_only:true}})})
 it('surfaces authorization failures rather than presenting an empty history',async()=>{rpc.mockResolvedValue({error:{message:'PERMISSION_DENIED'}});await expect(service.candidates('history')).rejects.toThrow('PERMISSION_DENIED')})
})

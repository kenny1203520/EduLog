import { supabase } from '@/lib/supabase'
import { Suspension, type SuspensionDTO } from '@/models/Suspension'
import { SuspensionPolicyService } from './SuspensionPolicyService'
import { DateUtils } from '@/utils/DateUtils'

export class SuspensionCommandService {
    static async createSuspension(enrollmentId: string, startDate: string, endDate: string | null, reason?: string): Promise<Suspension> {
        await SuspensionPolicyService.validateNoOverlap(enrollmentId, startDate, endDate)

        const { data, error } = await supabase
            .from('student_suspensions')
            .insert({
                enrollment_id: enrollmentId,
                start_date: startDate,
                end_date: endDate,
                reason: reason
            })
            .select()
            .single()

        if (error) throw new Error(`Failed to create suspension: ${error.message}`)

        const suspension = new Suspension(data)
        await SuspensionPolicyService.syncReportsForSuspension(suspension)
        return suspension
    }

    static async updateSuspension(id: string, updates: Partial<SuspensionDTO>): Promise<Suspension> {
        const { data: oldData, error: fetchError } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('id', id)
            .single()

        if (fetchError) throw new Error(`Failed to fetch original suspension: ${fetchError.message}`)
        const oldSuspension = new Suspension(oldData)

        const { data: newData, error: updateError } = await supabase
            .from('student_suspensions')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to update suspension: ${updateError.message}`)

        const newSuspension = new Suspension(newData)

        if (oldSuspension.endDate && newSuspension.endDate && newSuspension.endDate < oldSuspension.endDate) {
            const revertStart = new Date(newSuspension.endDate)
            revertStart.setDate(revertStart.getDate() + 1)
            const revertStartStr = DateUtils.formatLocalDate(revertStart)

            await SuspensionPolicyService.revertReports({
                enrollment_id: newSuspension.enrollmentId,
                start_date: revertStartStr,
                end_date: oldSuspension.endDate
            })

            if (newSuspension.enrollmentId) {
                await SuspensionPolicyService.ensureReportsForRange(newSuspension.enrollmentId, revertStartStr, oldSuspension.endDate)
            }
        } else if (!oldSuspension.endDate && newSuspension.endDate) {
            const revertStart = new Date(newSuspension.endDate)
            revertStart.setDate(revertStart.getDate() + 1)
            const revertStartStr = DateUtils.formatLocalDate(revertStart)

            await SuspensionPolicyService.revertReports({
                enrollment_id: newSuspension.enrollmentId,
                start_date: revertStartStr,
                end_date: null
            })

            if (newSuspension.enrollmentId) {
                await SuspensionPolicyService.ensureReportsForRange(newSuspension.enrollmentId, revertStartStr, null)
            }
        }

        await SuspensionPolicyService.syncReportsForSuspension(newSuspension)

        return newSuspension
    }

    static async deleteSuspension(id: string): Promise<void> {
        const { data: suspension, error: fetchError } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('id', id)
            .single()

        if (fetchError) throw new Error(fetchError.message)

        const { error } = await supabase
            .from('student_suspensions')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete suspension: ${error.message}`)

        await SuspensionPolicyService.revertReports(suspension)
    }
}

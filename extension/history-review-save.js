/** A review decision becomes confirmed only after its exact draft is durable. */
export function createReviewSaveCoordinator(hooks) {
  const operations = new Map()
  const keyFor = (work, key) => `${work.id}:${key}`
  return {
    isSaving(work) { return Boolean(work && [...operations.values()].some(operation => operation.work === work)) },
    async confirm(item, fields) {
      const owner = hooks.work(), record = hooks.record(item)
      if (!owner || !record || !fields.length || fields.some(field => !['source','keep','mixed','skip'].includes(record.historyFieldDecisions?.[field]))) return false
      const resolved = (owner.staleReviewPending || []).filter(row => row.kind === 'history_report' && row.source_id === item.key && fields.includes(row.field))
      if (!resolved.length) return false
      const key = keyFor(owner, item.key)
      if (operations.has(key)) return false
      const operation = { work: owner }, stamp = hooks.stamp(), signature = JSON.stringify(record)
      const current = () => hooks.work() === owner && operations.get(key) === operation && hooks.stamp() === stamp && JSON.stringify(hooks.record(item)) === signature
      operations.set(key, operation)
      hooks.saving(owner, item.key, fields)
      let persisted = false, committed = false
      try {
        await hooks.refresh(owner)
        if (!current()) return false
        const transaction = hooks.prepare(owner, record, item.key, fields, resolved)
        const saved = await hooks.save({ projectWork: live => {
          if (live !== owner || !current()) throw Object.assign(new Error('Review changed while saving'), { code: 'REVIEW_SAVE_SUPERSEDED' })
          return transaction.project(live)
        } })
        persisted = Boolean(saved)
        if (!saved) throw Object.assign(new Error('Review save was not confirmed'), { code: 'WORK_CONFLICT' })
        if (!current()) return false
        transaction.commit()
        committed = true
        hooks.saved(owner, item.key)
        return true
      } catch (error) {
        if (hooks.work() === owner) hooks.failed(error)
        return false
      } finally {
        const changed = !committed && !current()
        // A durable older decision must not hide a newer, still-unconfirmed edit
        // when this work is reopened. This write only saves the current draft.
        if (persisted && changed && hooks.work() === owner) {
          try { await hooks.save() } catch (error) { hooks.failed(error) }
        }
        operations.delete(key)
        hooks.saving(owner, item.key, [])
      }
    }
  }
}

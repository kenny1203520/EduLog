/**
 * Generations currently running in this API process, so a teacher can stop
 * one explicitly. A dropped connection no longer stops anything: the
 * generation finishes and is saved for the teacher to find later.
 */
export class GenerationRegistry {
  private readonly running = new Map<string, { userId: string, controller: AbortController }>()

  register(generationId: string, userId: string): AbortController {
    const controller = new AbortController()
    this.running.set(generationId, { userId, controller })
    return controller
  }

  unregister(generationId: string): void {
    this.running.delete(generationId)
  }

  /** Stop a generation the user started. False when it is not running here (finished, or another user's). */
  cancel(generationId: string, userId: string): boolean {
    const entry = this.running.get(generationId)
    if (!entry || entry.userId !== userId) return false
    entry.controller.abort()
    return true
  }

  isRunning(generationId: string): boolean {
    return this.running.has(generationId)
  }
}

export const sharedGenerationRegistry = new GenerationRegistry()

/** A running row older than this was left behind by a restart (the model call times out sooner). */
export const STALE_RUNNING_MS = 5 * 60_000

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installProcessGuards } from './processGuards.js'

function fakeProcess() {
  const emitter = new EventEmitter()
  const exit = vi.fn()
  return { proc: { on: emitter.on.bind(emitter), exit } as unknown as NodeJS.Process, emitter, exit }
}

describe('installProcessGuards', () => {
  it('logs unhandled rejections, including undefined reasons, without exiting', () => {
    const { proc, emitter, exit } = fakeProcess()
    const logger = { error: vi.fn(), fatal: vi.fn() }
    installProcessGuards(logger as never, proc)

    emitter.emit('unhandledRejection', undefined)
    emitter.emit('unhandledRejection', new TypeError('boom'))

    expect(logger.error.mock.calls.map(([fields]) => fields.reason_type)).toEqual(['undefined', 'TypeError'])
    expect(exit).not.toHaveBeenCalled()
  })

  it('logs and exits on uncaught exceptions', () => {
    const { proc, emitter, exit } = fakeProcess()
    const logger = { error: vi.fn(), fatal: vi.fn() }
    installProcessGuards(logger as never, proc)

    emitter.emit('uncaughtException', new Error('fatal'))

    expect(logger.fatal).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
  })
})

import pino from 'pino'

type Logger = Pick<pino.Logger, 'error' | 'fatal'>
type ProcessLike = Pick<NodeJS.Process, 'on' | 'exit'>

/**
 * Keep one stray promise from taking the whole API down.
 *
 * Some provider SDKs (e.g. ai-sdk-ollama when a stream is aborted) leave a
 * promise that rejects with `undefined` and is never handled. Node's default
 * is to exit on that, disconnecting every teacher. Unhandled rejections are
 * logged and the process keeps serving; uncaught exceptions still exit after
 * logging, because the process state can no longer be trusted (the container
 * restarts it).
 */
export function installProcessGuards(logger: Logger = pino(), proc: ProcessLike = process): void {
  proc.on('unhandledRejection', (reason) => {
    logger.error({
      event: 'unhandled_rejection',
      reason_type: reason === undefined ? 'undefined' : reason instanceof Error ? reason.name : typeof reason,
      err: reason instanceof Error ? reason : undefined,
    }, 'unhandled_rejection')
  })
  proc.on('uncaughtException', (error) => {
    logger.fatal({ event: 'uncaught_exception', err: error }, 'uncaught_exception')
    proc.exit(1)
  })
}

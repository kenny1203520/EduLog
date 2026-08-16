export type AppErrorKind = 'network' | 'validation' | 'conflict' | 'authorization' | 'unknown'

export interface AppErrorOptions {
    /** Raw (usually English, developer-facing) message. Never shown to the user directly. */
    message?: string
    /** Interpolation params for the i18n key. */
    params?: Record<string, unknown>
    cause?: unknown
}

/**
 * Base class for errors with a known, translatable cause. `i18nKey` is what the
 * UI should show (via useFeedback); `message` stays developer-facing English for
 * logs/console, matching how Error.message is used everywhere else in the app.
 */
export class AppError extends Error {
    readonly kind: AppErrorKind = 'unknown'
    readonly i18nKey: string
    readonly i18nParams?: Record<string, unknown>
    override readonly cause?: unknown

    constructor(i18nKey: string, options: AppErrorOptions = {}) {
        super(options.message || i18nKey)
        this.name = 'AppError'
        this.i18nKey = i18nKey
        this.i18nParams = options.params
        this.cause = options.cause
    }
}

export class NetworkError extends AppError {
    override readonly kind: AppErrorKind = 'network'
    constructor(options: AppErrorOptions = {}) {
        super('errors.network', options)
        this.name = 'NetworkError'
    }
}

export class ValidationError extends AppError {
    override readonly kind: AppErrorKind = 'validation'
    constructor(i18nKey: string, options: AppErrorOptions = {}) {
        super(i18nKey, options)
        this.name = 'ValidationError'
    }
}

export class ConflictError extends AppError {
    override readonly kind: AppErrorKind = 'conflict'
    constructor(options: AppErrorOptions = {}) {
        super('errors.conflict', options)
        this.name = 'ConflictError'
    }
}

export class AuthorizationError extends AppError {
    override readonly kind: AppErrorKind = 'authorization'
    constructor(options: AppErrorOptions = {}) {
        super('errors.permission_denied', options)
        this.name = 'AuthorizationError'
    }
}

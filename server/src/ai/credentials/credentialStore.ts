import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { classifyProviderFailure, providerErrorDetail, type ProviderErrorDetail, type ProviderFailure } from '../providers/providerErrors.js'
import { createLanguageModel, AI_PROVIDERS, type AiProvider, type ModelTarget } from '../providers/providerRegistry.js'
import { credentialAssociatedData } from '../report/reportGenerationService.js'
import { maskSecret, type SecretCipher } from './secretCipher.js'
import { isPublicIpAddress } from '../providers/publicOllamaTransport.js'

/** Personal endpoints are server-side requested only through the public HTTPS policy. */
export const PERSONAL_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'] as const

export const CREDENTIAL_FIELDS = 'id,scope,owner_user_id,provider,auth_type,secret_hint,base_url,label,status,last_verified_at,created_at,updated_at'
export const MODEL_FIELDS = 'id,credential_id,model_id,display_name,enabled,is_default,quota_weight,price_input_per_mtok,price_output_per_mtok,supports_structured_output,created_at,updated_at'

const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), 'Only http(s) URLs are allowed').max(2048)
const personalOllamaUrl = z.string().trim().min(1).max(2048).url().superRefine((value, ctx) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error()
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error()
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (isIP(hostname) && !isPublicIpAddress(hostname)) throw new Error()
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Personal Ollama requires a public HTTPS base URL without credentials, query, or fragment' })
  }
})

export const siteCredentialInput = z.object({
  provider: z.enum(AI_PROVIDERS),
  label: z.string().trim().min(1).max(120),
  secret: z.string().trim().min(1).max(4096).optional(),
  base_url: httpUrl.nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.provider === 'ollama' && !input.base_url) ctx.addIssue({ code: 'custom', path: ['base_url'], message: 'Ollama needs a base URL' })
  if (input.provider !== 'ollama' && !input.secret) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'An API key is required' })
})

export const personalCredentialInput = z.object({
  provider: z.enum(PERSONAL_PROVIDERS),
  label: z.string().trim().min(1).max(120),
  secret: z.string().trim().min(1).max(4096).optional(),
  base_url: personalOllamaUrl.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.provider === 'ollama') {
    if (!input.base_url) ctx.addIssue({ code: 'custom', path: ['base_url'], message: 'Ollama needs a public HTTPS base URL' })
  } else {
    if (!input.secret) ctx.addIssue({ code: 'custom', path: ['secret'], message: 'An API key is required' })
    if (input.base_url !== undefined) ctx.addIssue({ code: 'custom', path: ['base_url'], message: 'Custom endpoints are only supported for Ollama' })
  }
})

export const personalCredentialPatchInput = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  secret: z.string().trim().min(1).max(4096).nullable().optional(),
  base_url: personalOllamaUrl.optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict()

export const credentialPatchInput = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  secret: z.string().trim().min(1).max(4096).nullable().optional(),
  base_url: httpUrl.nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict()

export const modelInput = z.object({
  model_id: z.string().trim().min(1).max(200),
  display_name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  quota_weight: z.number().min(0).max(1000).optional(),
  price_input_per_mtok: z.number().min(0).max(100000).nullable().optional(),
  price_output_per_mtok: z.number().min(0).max(100000).nullable().optional(),
}).strict()

export function requireCipher(cipher: SecretCipher | null): SecretCipher {
  if (!cipher) throw new ApiError(503, 'AI_SECRET_KEY_MISSING', 'AI_SECRET_KEY is not configured on the server')
  return cipher
}

type Db = SupabaseClient

/** Insert a credential, encrypting the secret bound to the new row id. */
export async function createCredential(db: Db, cipher: SecretCipher | null, input: {
  scope: 'site' | 'user'
  ownerUserId: string | null
  provider: AiProvider
  authType: 'api_key' | 'oauth' | 'none'
  secret?: string
  baseUrl?: string | null
  label: string
  createdBy: string
}) {
  const id = randomUUID()
  const encrypted = input.authType === 'none' || !input.secret
    ? { secret_ciphertext: null, secret_hint: null }
    : { secret_ciphertext: requireCipher(cipher).encrypt(input.secret, credentialAssociatedData(id)), secret_hint: maskSecret(input.secret) }
  const result = await db.from('ai_credentials').insert({
    id,
    scope: input.scope,
    owner_user_id: input.ownerUserId,
    provider: input.provider,
    auth_type: input.authType,
    base_url: input.baseUrl ?? null,
    label: input.label,
    created_by: input.createdBy,
    ...encrypted,
  }).select(CREDENTIAL_FIELDS).single()
  if (result.error) throw mapDatabaseError(result.error)
  return result.data
}

/** Apply a patch; a new secret is re-encrypted and marks the credential active again. */
export async function updateCredential(db: Db, cipher: SecretCipher | null, id: string, patch: z.infer<typeof credentialPatchInput>) {
  const update: Record<string, unknown> = {}
  if (patch.label !== undefined) update.label = patch.label
  if (patch.base_url !== undefined) update.base_url = patch.base_url
  if (patch.status !== undefined) update.status = patch.status
  if (patch.secret !== undefined) {
    if (patch.secret === null) {
      update.secret_ciphertext = null
      update.secret_hint = null
      // The database constraint requires Ollama's no-token state to be atomic.
      const current = await db.from('ai_credentials').select('provider').eq('id', id).maybeSingle()
      if (current.error) throw mapDatabaseError(current.error)
      if (current.data?.provider !== 'ollama') throw new ApiError(400, 'INVALID_CREDENTIAL', 'Only Ollama credentials may remove their secret')
      update.auth_type = 'none'
    } else {
      update.secret_ciphertext = requireCipher(cipher).encrypt(patch.secret, credentialAssociatedData(id))
      update.secret_hint = maskSecret(patch.secret)
      const current = await db.from('ai_credentials').select('provider').eq('id', id).maybeSingle()
      if (current.error) throw mapDatabaseError(current.error)
      if (current.data?.provider === 'ollama') update.auth_type = 'api_key'
    }
    update.status = patch.status ?? 'active'
  }
  const result = await db.from('ai_credentials').update(update).eq('id', id).select(CREDENTIAL_FIELDS).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Credential was not found')
  return result.data
}

/** Bearer token for credentials that store no plain API key (see ReportGenerationDeps.resolveToken). */
export type TokenResolver = (credential: { provider: string, authType: string, credentialId: string }) => Promise<string | undefined>

export interface UsableCredential {
  id: string
  provider: AiProvider
  credentialScope: 'site' | 'user'
  authType: 'api_key' | 'oauth' | 'none'
  baseUrl: string | null
  apiKey: string | undefined
}

/** Load a credential and turn its stored secret into something a provider call can use. */
export async function loadUsableCredential(db: Db, cipher: SecretCipher | null, credentialId: string, resolveToken?: TokenResolver): Promise<UsableCredential> {
  const row = await db.from('ai_credentials').select('id,scope,provider,auth_type,secret_ciphertext,base_url').eq('id', credentialId).maybeSingle()
  if (row.error) throw mapDatabaseError(row.error)
  if (!row.data) throw new ApiError(404, 'NOT_FOUND', 'Credential was not found')
  const token = await resolveToken?.({ provider: row.data.provider, authType: row.data.auth_type, credentialId })
  const apiKey = token ?? (row.data.auth_type === 'none' || !row.data.secret_ciphertext
    ? undefined
    : requireCipher(cipher).decrypt(row.data.secret_ciphertext, credentialAssociatedData(credentialId)))
  return { id: credentialId, credentialScope: row.data.scope, provider: row.data.provider, authType: row.data.auth_type, baseUrl: row.data.base_url ?? null, apiKey }
}

/**
 * Send a tiny fixed prompt (no student data) to check that a credential and
 * model work, and record the outcome on the credential.
 */
export async function testCredential(db: Db, cipher: SecretCipher | null, credentialId: string, modelId: string, options: {
  createModel?: (target: ModelTarget) => LanguageModel
  resolveToken?: TokenResolver
} = {}) {
  const credential = await loadUsableCredential(db, cipher, credentialId, options.resolveToken)
  const model = (options.createModel ?? createLanguageModel)({ provider: credential.provider, modelId, apiKey: credential.apiKey, baseUrl: credential.baseUrl ?? undefined, credentialScope: credential.credentialScope })
  let ok = false
  let errorName: string | null = null
  let detail: ProviderErrorDetail | null = null
  let failure: ProviderFailure | null = null
  try {
    // Any successful response proves the endpoint, key and model id; reasoning
    // models may spend the small budget thinking and return no text.
    await generateText({ model, prompt: 'Reply with the single word OK.', maxOutputTokens: 16, abortSignal: AbortSignal.timeout(30_000) })
    ok = true
  } catch (error) {
    errorName = error instanceof Error ? error.name : 'Error'
    detail = providerErrorDetail(error)
    failure = classifyProviderFailure(detail)
  }
  // Only a rejected key makes the credential invalid; a rate limit or a model
  // the account cannot use says nothing about the key itself.
  const status = ok ? { status: 'active', last_verified_at: new Date().toISOString() } : failure === 'AUTH_FAILED' ? { status: 'invalid' } : null
  if (status) {
    const update = await db.from('ai_credentials').update(status).eq('id', credentialId)
    if (update.error) throw mapDatabaseError(update.error)
  }
  return { ok, error: errorName, failure, status: detail?.status ?? null, message: detail?.message ?? null }
}

import { apiV1Client } from '@/services/api/ApiV1Client'

export type LoginMethod = 'email' | 'magicLink' | 'sms' | 'saml'
export type EnrollableFactor = 'totp' | 'phone' | 'webauthn'
export type Factor = {
  id: string
  factor_type: EnrollableFactor | 'recovery_code'
  status: 'verified' | 'unverified'
  friendly_name?: string | null
  can_verify: boolean
}
export type AuthCapabilities = {
  providers: string[]
  providerLabels?: Record<string, string>
  methods: { password: boolean; emailOtp: boolean; magicLink: boolean; sms: boolean; saml: boolean; passkeys: boolean }
  mfa: Record<EnrollableFactor | 'recoveryCodes', boolean>
  unavailable: string[]
}
type RecoveryCodes = { remaining?: number; codes?: string[] }
type Passkey = { id: string; friendly_name?: string; created_at: string }
type WebAuthnType = 'create' | 'request'
type BrowserOptions = PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON
type PasskeyOptions = { challenge_id: string; options: BrowserOptions }
type FactorChallenge = { id: string; webauthn?: { type: WebAuthnType; credential_options: { publicKey: BrowserOptions } } }

const query = async <T>(path: string) => (await apiV1Client.get<T>(`/auth${path}`)).data
const command = async <T>(path: string, data: unknown = {}) => (await apiV1Client.post<T>(`/auth${path}`, data, { changesData: false })).data
const remove = async (path: string) => apiV1Client.delete(`/auth${path}`, {}, { changesData: false })

export function supportsWebAuthn() {
  return typeof PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials)
}

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}
function encode(value: ArrayBuffer) {
  return btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function credentialDescriptor(item: PublicKeyCredentialDescriptorJSON): PublicKeyCredentialDescriptor {
  return { id: decode(item.id), type: 'public-key' }
}
function creationOptions(input: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function') return PublicKeyCredential.parseCreationOptionsFromJSON(input)
  return {
    rp: input.rp, challenge: decode(input.challenge), user: { ...input.user, id: decode(input.user.id) },
    pubKeyCredParams: input.pubKeyCredParams.map(({ alg }) => ({ alg, type: 'public-key' })),
    timeout: input.timeout,
    authenticatorSelection: input.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    attestation: input.attestation as AttestationConveyancePreference | undefined,
    excludeCredentials: input.excludeCredentials?.map(credentialDescriptor),
  }
}
function requestOptions(input: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function') return PublicKeyCredential.parseRequestOptionsFromJSON(input)
  return {
    challenge: decode(input.challenge), rpId: input.rpId, timeout: input.timeout,
    userVerification: input.userVerification as UserVerificationRequirement | undefined,
    allowCredentials: input.allowCredentials?.map(credentialDescriptor),
  }
}
async function publicKeyCredential(type: WebAuthnType, options: BrowserOptions) {
  const credential = type === 'create'
    ? await navigator.credentials.create({ publicKey: creationOptions(options as PublicKeyCredentialCreationOptionsJSON) })
    : await navigator.credentials.get({ publicKey: requestOptions(options as PublicKeyCredentialRequestOptionsJSON) })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Credential request was cancelled')
  if (typeof credential.toJSON === 'function') return credential.toJSON()
  const data = credential.response
  const response = data instanceof AuthenticatorAttestationResponse
    ? { clientDataJSON: encode(data.clientDataJSON), attestationObject: encode(data.attestationObject), transports: data.getTransports?.() }
    : data instanceof AuthenticatorAssertionResponse
      ? { clientDataJSON: encode(data.clientDataJSON), authenticatorData: encode(data.authenticatorData),
        signature: encode(data.signature), userHandle: data.userHandle ? encode(data.userHandle) : null }
      : null
  if (!response) throw new Error('Credential response is invalid')
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response,
    clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment }
}

export const additionalAuth = {
  capabilities: () => query<AuthCapabilities>('/capabilities'),
  sendOtp: (method: Exclude<LoginMethod, 'saml'>, destination: string, returnTo?: string) => command('/session/otp',
    { method, ...(method === 'sms' ? { phone: destination } : { email: destination }),
      ...(method === 'magicLink' && returnTo ? { return_to: returnTo } : {}) }),
  verifyOtp: (method: 'email' | 'sms', destination: string, code: string) => command<{ redirect: string }>('/session/otp/verify',
    { method, code, ...(method === 'sms' ? { phone: destination } : { email: destination }) }),
  startSso: (domain: string, returnTo?: string) => command<{ url: string }>('/session/sso', { domain, return_to: returnTo }),
  async signInWithPasskey() {
    const { challenge_id, options } = await command<PasskeyOptions>('/session/passkey/options')
    return command<{ redirect: string }>('/session/passkey/verify', { challenge_id, credential: await publicKeyCredential('request', options) })
  },
  factors: () => query<Factor[]>('/me/factors'),
  enrollFactor: (factor_type: EnrollableFactor, phone: string) => command<{ id: string; totp?: { secret: string } }>('/me/factors',
    { factor_type, ...(factor_type === 'phone' ? { phone } : {}) }),
  removeFactor: (id: string) => remove(`/me/factors/${encodeURIComponent(id)}`),
  challengeFactor: (id: string) => command<FactorChallenge>(`/me/factors/${encodeURIComponent(id)}/challenge`),
  async verifyFactor(id: string, challenge: FactorChallenge, code = '') {
    const factorOptions = challenge.webauthn
    return command<{ redirect: string }>(`/me/factors/${encodeURIComponent(id)}/verify`, {
      challenge_id: challenge.id,
      ...(factorOptions ? { webauthn: { type: factorOptions.type,
        credential_response: await publicKeyCredential(factorOptions.type, factorOptions.credential_options.publicKey) } } : { code }),
    })
  },
  recoveryCodes: () => query<RecoveryCodes | null>('/me/recovery-codes'),
  generateRecoveryCodes: (regenerate: boolean) => command<RecoveryCodes>(regenerate ? '/me/recovery-codes/regenerate' : '/me/recovery-codes'),
  removeRecoveryCodes: () => remove('/me/recovery-codes'),
  verifyRecoveryCode: (code: string) => command<{ redirect: string }>('/me/recovery-codes/verify', { code }),
  passkeys: () => query<Passkey[]>('/me/passkeys'),
  async addPasskey() {
    const { challenge_id, options } = await command<PasskeyOptions>('/me/passkeys/registration/options')
    await command('/me/passkeys/registration/verify', { challenge_id, credential: await publicKeyCredential('create', options) })
  },
  removePasskey: (id: string) => remove(`/me/passkeys/${encodeURIComponent(id)}`),
}

import { apiV1Client } from '@/services/api/ApiV1Client'

type OAuthClient = { client_id: string; client_name: string; redirect_uris: string[]; client_type: 'public' | 'confidential' }
type OAuthGrant = { client: { id: string; name?: string }; scopes: string[]; granted_at: string }
type OAuthConsentDetails = {
  client: { id: string; name?: string }
  user: { id: string; email?: string }
  redirect_uri: string
  scope: string
}
type OAuthRedirect = { redirect_url: string }

const path = '/auth/outbound'
export const outboundOAuthService = {
  async clients(page: number) {
    return (await apiV1Client.get<{ clients: OAuthClient[] }>(`${path}/clients?page=${page}`)).data.clients
  },
  async register(name: string, callbackUrls: string[]) {
    return (await apiV1Client.post<OAuthClient & { client_secret: string }>(`${path}/clients`, {
      client_name: name, redirect_uris: callbackUrls,
    })).data
  },
  async removeClient(id: string) {
    await apiV1Client.request(`${path}/clients/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  async authorization(id: string) {
    return (await apiV1Client.get<OAuthConsentDetails | OAuthRedirect>(`${path}/authorizations/${encodeURIComponent(id)}`)).data
  },
  async decide(id: string, action: 'approve' | 'deny') {
    return (await apiV1Client.post<OAuthRedirect>(`${path}/authorizations/${encodeURIComponent(id)}/consent`, { action })).data
  },
  async grants() {
    return (await apiV1Client.get<OAuthGrant[]>(`${path}/grants`)).data
  },
  async revoke(id: string) {
    await apiV1Client.request(`${path}/grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
}

const scopeLabels: Record<string, string> = {
  openid: 'oauthServer.scope_openid',
  email: 'oauthServer.scope_email',
  profile: 'oauthServer.scope_profile',
  phone: 'oauthServer.scope_phone',
  offline_access: 'oauthServer.scope_offline',
}
export function oauthScopeLabel(scope: string, translate: (key: string) => string) {
  return Object.hasOwn(scopeLabels, scope) ? translate(scopeLabels[scope]!) : scope
}

export type { OAuthClient, OAuthGrant, OAuthConsentDetails }

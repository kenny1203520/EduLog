export function outboundConsentReturn(value: unknown): string | undefined {
  const prefix = '/oauth/consent?authorization_id='
  if (typeof value !== 'string' || !value.startsWith(prefix)) return
  const id = value.slice(prefix.length)
  if (/^[A-Za-z0-9_-]{10,128}$/.test(id)) return prefix + id
}

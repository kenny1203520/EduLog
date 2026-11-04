import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch } from 'undici'

const MAX_URL_LENGTH = 2048

/** Validate URL syntax before storing a personal endpoint. DNS/IP policy is enforced at connect time. */
export function validatePublicOllamaBaseUrl(value: string): string {
  if (value.length > MAX_URL_LENGTH) throw new Error('Ollama base URL is too long')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Ollama requires a valid public HTTPS base URL') }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (url.protocol !== 'https:' || !hostname || url.username || url.password || url.search || url.hash || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Ollama requires a public HTTPS base URL without credentials, query, or fragment')
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('Ollama endpoint must use a public IP address')
  return url.toString().replace(/\/$/, '')
}

function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address)
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6
      if (ipv6.isIPv4MappedAddress()) return isPublicAddress(ipv6.toIPv4Address().toString())
    }
    return parsed.range() === 'unicast'
  } catch {
    return false
  }
}

async function resolvePublicAddresses(hostname: string, resolve: (hostname: string) => Promise<Array<{ address: string, family: number }>> = (name) => dnsLookup(name, { all: true, verbatim: true })): Promise<Array<{ address: string, family: number }>> {
  const literalFamily = ipaddr.isValid(hostname) ? ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 : 0
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolve(hostname)
  validatePublicDnsAnswers(addresses)
  return addresses
}

export function validatePublicDnsAnswers(addresses: Array<{ address: string, family: number }>): void {
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Ollama endpoint must resolve only to public IP addresses')
  }
}

export function createPinnedLookup(addresses: Array<{ address: string, family: number }>) {
  validatePublicDnsAnswers(addresses)
  return (_hostname: string, options: number | { family?: number | 'IPv4' | 'IPv6', all?: boolean, hints?: number, order?: string, verbatim?: boolean }, callback: (...args: [NodeJS.ErrnoException | null, string | Array<{ address: string, family: number }>, number?]) => void) => {
    const requestedFamily = typeof options === 'number' ? options : options.family
    const family = requestedFamily === 'IPv4' ? 4 : requestedFamily === 'IPv6' ? 6 : requestedFamily
    const selected = addresses.find((item) => !family || item.family === family) ?? addresses[0]!
    if (typeof options === 'object' && options.all) callback(null, [selected])
    else callback(null, selected.address, selected.family)
  }
}

/** Fetch wrapper that resolves and validates every DNS answer, then pins the socket to an approved address. */
export function createPublicOllamaFetch(baseUrl: string, dependencies: {
  resolve?: (hostname: string) => Promise<Array<{ address: string, family: number }>>
  fetch?: typeof undiciFetch
} = {}): typeof fetch {
  const endpoint = new URL(validatePublicOllamaBaseUrl(baseUrl))
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl = new URL(input instanceof Request ? input.url : input.toString())
    if (requestUrl.origin !== endpoint.origin || requestUrl.protocol !== 'https:') throw new Error('Ollama request escaped its configured endpoint')
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '')
    const addresses = await resolvePublicAddresses(hostname, dependencies.resolve)
    const agent = new Agent({ connect: {
      lookup: createPinnedLookup(addresses),
    } })
    try {
      const requestBody = input instanceof Request ? (init?.body ?? input.body) : init?.body
      const requestInit = {
        ...(input instanceof Request ? { method: input.method, headers: input.headers, body: requestBody, signal: input.signal } : {}),
        ...init,
        redirect: 'manual' as const,
        dispatcher: agent,
        ...(requestBody ? { duplex: 'half' as const } : {}),
      }
      const upstream = await (dependencies.fetch ?? undiciFetch)(requestUrl, requestInit as Parameters<typeof undiciFetch>[1])
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel()
        await agent.close()
        throw new Error('Ollama endpoint redirects are not allowed')
      }
      if (!upstream.body) {
        await agent.close()
        return upstream as unknown as Response
      }
      const reader = upstream.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              controller.close()
              await agent.close()
            } else controller.enqueue(chunk.value)
          } catch (error) {
            controller.error(error)
            await agent.close()
          }
        },
        async cancel(reason) {
          try { await reader.cancel(reason) }
          finally { await agent.close() }
        },
      })
      return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers })
    } catch (error) {
      await agent.close().catch(() => undefined)
      throw error
    }
  }
}

export const isPublicIpAddress = isPublicAddress

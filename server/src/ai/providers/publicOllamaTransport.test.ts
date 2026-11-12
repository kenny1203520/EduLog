import { describe, expect, it, vi } from 'vitest'
import { createPinnedLookup, createPublicOllamaFetch, isPublicIpAddress, validatePublicDnsAnswers, validatePublicOllamaBaseUrl } from './publicOllamaTransport.js'

describe('personal Ollama endpoint policy', () => {
  it('accepts public HTTPS endpoints with reverse-proxy path prefixes', () => {
    expect(validatePublicOllamaBaseUrl('https://models.example.com/ollama/')).toBe('https://models.example.com/ollama')
    expect(validatePublicOllamaBaseUrl('https://[2606:4700:4700::1111]/api')).toContain('https://[2606:4700:4700::1111]/api')
  })

  it.each([
    'http://models.example.com',
    'https://user:password@models.example.com',
    'https://models.example.com?token=secret',
    'https://models.example.com/#fragment',
    'https://localhost:11434',
    'https://ollama.localhost',
    'https://127.0.0.1:11434',
    'https://[::1]:11434',
    'https://10.0.0.1',
    'https://[::ffff:10.0.0.1]',
  ])('rejects unsafe endpoint %s', (endpoint) => {
    expect(() => validatePublicOllamaBaseUrl(endpoint)).toThrow()
  })

  it('classifies mapped, private, reserved and public IPv4/IPv6 addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true)
    expect(isPublicIpAddress('192.168.1.5')).toBe(false)
    expect(isPublicIpAddress('100.64.0.1')).toBe(false)
    expect(isPublicIpAddress('203.0.113.4')).toBe(false)
    expect(isPublicIpAddress('fd00::1')).toBe(false)
    expect(isPublicIpAddress('::ffff:127.0.0.1')).toBe(false)
  })

  it.each([
    ['RFC 9637 documentation prefix', '3fff::1'],
    ['RFC 9602 SRv6 SID prefix', '5f00::1'],
    ['RFC 8215 local-use translation prefix', '64:ff9b:1::1'],
    ['RFC 3879 deprecated site-local prefix', 'fec0::1'],
  ])('rejects the non-public address in the %s (%s)', (_range, address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it('rejects mixed DNS answers and pins the actual lookup to a validated address', () => {
    expect(() => validatePublicDnsAnswers([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ])).toThrow('only to public IP addresses')

    const pinned = createPinnedLookup([{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }])
    const callback = (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string, family: number }>, family?: number) => {
      expect(error).toBeNull()
      expect(address).toEqual('2606:4700:4700::1111')
      expect(family).toBe(6)
    }
    pinned('models.example.com', { family: 6 }, callback)
  })

  it('refuses redirects and requests that escape the configured origin', async () => {
    const resolve = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }))
    const guardedFetch = createPublicOllamaFetch('https://models.example.com/prefix', { resolve, fetch: fetch as never })
    await expect(guardedFetch('https://models.example.com/prefix/api/tags')).rejects.toThrow('redirects are not allowed')
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
    await expect(guardedFetch('https://other.example.com/api/tags')).rejects.toThrow('escaped its configured endpoint')
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})

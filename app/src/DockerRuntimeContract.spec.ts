import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CSP_HEADER, DEFAULT_HSTS_HEADER } from '../vite.security'

const appRoot = resolve(__dirname, '..')

describe('Docker runtime contract', () => {
  it('runs the EduLog bootstrap script before nginx', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')

    expect(dockerfile).toContain(
      'ENTRYPOINT ["/docker-entrypoint.d/05-edulog-runtime.envsh"]',
    )
    expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]')
    expect(dockerfile).toContain(
      'COPY --chown=65532:65532 --from=build /app/dist ./',
    )
    expect(dockerfile).toContain('EXPOSE 4173 4174')
    expect(dockerfile).not.toContain('/etc/nginx/templates/default.conf.template')
  })

  it('writes the active nginx config and hands off to the container command', () => {
    const bootstrap = readFileSync(
      resolve(appRoot, 'nginx/docker-entrypoint.d/05-edulog-runtime.envsh'),
      'utf8',
    )

    expect(bootstrap).toContain('> /etc/nginx/conf.d/default.conf')
    expect(bootstrap).toContain('exec "$@"')
    expect(bootstrap).not.toContain('envsubst')
    expect(bootstrap).not.toContain('\r\n')
  })

  it('keeps the dev-server and nginx default security headers identical', () => {
    const bootstrap = readFileSync(resolve(appRoot, 'nginx/docker-entrypoint.d/05-edulog-runtime.envsh'), 'utf8')
    const shellDefault = (name: string) => new RegExp(`^${name}="([^"]*)"`, 'm').exec(bootstrap)?.[1]

    expect(shellDefault('DEFAULT_CSP_HEADER')).toBe(DEFAULT_CSP_HEADER.replace("frame-ancestors 'none'", 'frame-ancestors __FRAME_ANCESTORS__'))
    expect(shellDefault('DEFAULT_HSTS_HEADER')).toBe(DEFAULT_HSTS_HEADER)
  })

  it.skipIf(process.platform === 'win32')('accepts the API body-limit syntax for nginx', () => {
    const bootstrap = readFileSync(resolve(appRoot, 'nginx/docker-entrypoint.d/05-edulog-runtime.envsh'), 'utf8')
    const fn = /^nginx_size\(\) \{[\s\S]*?^\}/m.exec(bootstrap)?.[0]
    expect(fn).toBeTruthy()
    const convert = (value: string) => execFileSync('sh', ['-c', `${fn}
nginx_size "$1"`, 'sh', value], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    expect(convert('1mb')).toBe('1m')
    expect(convert('512kb')).toBe('512k')
    expect(convert('1m')).toBe('1m')
    expect(convert('2048')).toBe('2048')
    expect(convert('not-a-size')).toBe('1m')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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
})
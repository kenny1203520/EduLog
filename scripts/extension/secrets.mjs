import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Report locations and rule names only. Never include matched credentials in errors.
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google-access-token', /\bya29\.[A-Za-z0-9_-]{30,}\b/g],
  ['embedded-credential', /\b(?:service_role_key|supabase_service_role_key|client_secret|api_token|access_token|refresh_token|password|token)\b["']?\s*[:=]\s*["']([A-Za-z0-9_+/.=:-]{32,})["']/gi],
  ['credential-url', /\b(?:https?|postgres(?:ql)?):\/\/[^\s/@:"']+:[^\s/@"']+@/gi],
]

export function secretFindings(files) {
  const findings = []
  for (const [path, bytes] of files) {
    const text = bytes.toString('utf8')
    if (text.includes('\0')) continue
    for (const [rule, expression] of rules) {
      expression.lastIndex = 0
      for (const match of text.matchAll(expression)) {
        // This exact pre-existing negative URL fixture is synthetic. No file/rule-wide exclusions.
        if (path === 'extension/tests/unit/mapping-presentation.test.mjs' && rule === 'credential-url' && match[0] === ['https://', 'user:', 'secret@'].join('')) continue
        findings.push({ path, rule, line: text.slice(0, match.index).split('\n').length })
      }
    }
    // Any embedded JWT is a credential risk; public manifest SPKI keys are not JWTs.
    for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g)) {
      findings.push({ path, rule: 'embedded-jwt', line: text.slice(0, match.index).split('\n').length })
    }
  }
  return findings
}

export function assertNoSecrets(files) {
  const findings = secretFindings(files)
  if (findings.length) throw new Error('Potential credentials detected; remove or revoke before release:\n' + findings.map(({ path, line, rule }) => `${path}:${line} [${rule}]`).join('\n'))
}

export function scanSource(repository = fileURLToPath(new URL('../..', import.meta.url))) {
  // Scan current source (including staged/new files), never ignored .env or browser profiles.
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'extension/', 'scripts/extension/', '.github/workflows/extension-release.yml', '.github/workflows/extension-store-status.yml'], { cwd: repository, shell: false }).toString().split('\0').filter(Boolean) // NOSONAR: This local source scanner intentionally uses the caller's Git installation.
  const files = new Map([...new Set(names)].filter(name => /\.(?:[cm]?js|json|html|css|ya?ml|md)$/.test(name)).map(name => [name, readFileSync(resolve(repository, name))]))
  assertNoSecrets(files)
  return files.size
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`Credential scan passed: ${scanSource()} source files (pattern-based; not a history audit)`) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

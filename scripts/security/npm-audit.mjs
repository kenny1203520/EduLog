#!/usr/bin/env node
// Runs `npm audit --omit=dev` in a package directory and fails on HIGH or
// CRITICAL advisories, except those listed in .github/npm-audit-allowlist.json
// for that directory. Allowlist entries must carry a reason and an expiry date;
// an expired entry fails the run so it gets reviewed again.
//
// Usage: node scripts/security/npm-audit.mjs <app|server|.>

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FAIL_LEVELS = new Set(['high', 'critical'])
// Only these package directories (relative to the repo root) can be audited.
const AUDITABLE_DIRS = ['app', 'server', '.']
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const scope = AUDITABLE_DIRS.find((dir) => dir === process.argv[2])
if (!scope) {
  console.error(`usage: node scripts/security/npm-audit.mjs <${AUDITABLE_DIRS.join('|')}>`)
  process.exit(2)
}
const packageDir = join(repoRoot, scope)

// Run npm's CLI through the current Node binary instead of looking `npm` up on
// PATH or going through a shell.
const nodeDir = dirname(process.execPath)
const npmCli = [
  join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find((candidate) => existsSync(candidate))
if (!npmCli) {
  console.error(`cannot find npm-cli.js next to ${process.execPath}`)
  process.exit(2)
}

const allowlist = JSON.parse(readFileSync(join(repoRoot, '.github', 'npm-audit-allowlist.json'), 'utf8'))
const today = new Date().toISOString().slice(0, 10)
const allowed = new Map()
let failed = false

for (const entry of allowlist.advisories ?? []) {
  if (!entry.dirs?.includes(scope)) continue
  if (!entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires ?? '')) {
    console.error(`allowlist entry ${entry.id} needs a reason and an expires date (YYYY-MM-DD)`)
    failed = true
    continue
  }
  if (entry.expires < today) {
    console.error(`allowlist entry ${entry.id} expired on ${entry.expires}; review it again`)
    failed = true
    continue
  }
  allowed.set(entry.id, entry)
}

let raw
try {
  raw = execFileSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], {
    cwd: packageDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (error) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = error.stdout
  if (!raw) throw error
}

const report = JSON.parse(raw)
if (report.error) {
  console.error(`npm audit failed in ${scope}: ${report.error.summary ?? JSON.stringify(report.error)}`)
  process.exit(1)
}

const advisories = new Map()
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === 'string' || !FAIL_LEVELS.has(via.severity)) continue
    const id = via.url?.split('/').pop() ?? String(via.source)
    advisories.set(id, { id, name: via.name, severity: via.severity, range: via.range, title: via.title, url: via.url })
  }
}

const used = new Set()
for (const advisory of advisories.values()) {
  if (allowed.has(advisory.id)) {
    used.add(advisory.id)
    console.log(`allowed  ${advisory.severity.padEnd(8)} ${advisory.id} ${advisory.name}@${advisory.range} - ${allowed.get(advisory.id).reason}`)
    continue
  }
  console.error(`FAIL     ${advisory.severity.padEnd(8)} ${advisory.id} ${advisory.name}@${advisory.range} - ${advisory.title} (${advisory.url})`)
  failed = true
}

for (const id of allowed.keys()) {
  if (!used.has(id)) console.warn(`note: allowlist entry ${id} no longer matches anything in ${scope}; remove it`)
}

console.log(`${scope}: ${advisories.size} high/critical advisories, ${used.size} allowlisted`)
process.exit(failed ? 1 : 0)

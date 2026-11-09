#!/usr/bin/env node
// Keeps the root `.env.example` honest:
//  1. every `${VAR}` used by the root Compose files is documented in it,
//  2. every EduLog key in it is actually used by a Compose file,
//  3. its Supabase upstream section has exactly the keys of `supabase/.env.example`.
// Usage: node scripts/check-env-example.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b))
const read = (file) => readFileSync(path.join(root, file), 'utf8')

const ROOT_COMPOSE = ['docker-compose.yml', 'docker-compose.prod.yml']
// Overlays that also read EduLog keys from the root `.env` (they are not edited here).
const OVERLAY_COMPOSE = ['supabase/docker-compose.caddy.yml', 'supabase/docker-compose.nginx.yml']
// Provided by the shell, not by `.env`.
const SHELL_VARS = new Set(['PWD', 'HOME'])
const EDULOG_MARKER = /^#\s*EduLog: required/m

/** `${VAR}` references outside YAML comments. */
function composeVars(files) {
  const vars = new Set()
  for (const file of files) {
    for (const line of read(file).split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue
      for (const match of line.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) vars.add(match[1])
    }
  }
  return vars
}

/** Keys defined as `KEY=` or documented as commented-out `# KEY=`. */
function envKeys(text, { includeCommented = true } = {}) {
  const pattern = includeCommented ? /^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/ : /^\s*([A-Z][A-Z0-9_]*)=/
  const keys = new Set()
  for (const line of text.split(/\r?\n/)) {
    const match = pattern.exec(line)
    if (match) keys.add(match[1])
  }
  return keys
}

const example = read('.env.example')
const marker = EDULOG_MARKER.exec(example)
const problems = []
if (!marker) problems.push('.env.example has no "# EduLog: required" section header')

const upstreamPart = marker ? example.slice(0, marker.index) : example
const edulogPart = marker ? example.slice(marker.index) : ''
const allKeys = envKeys(example)
const upstreamKeys = envKeys(upstreamPart)
const edulogKeys = envKeys(edulogPart, { includeCommented: false })
const supabaseKeys = envKeys(read('supabase/.env.example'))

const used = composeVars(ROOT_COMPOSE)
for (const name of sorted(used)) {
  if (!SHELL_VARS.has(name) && !allKeys.has(name)) problems.push(`${name} is used by ${ROOT_COMPOSE.join('/')} but missing from .env.example`)
}

const usedAnywhere = new Set([...used, ...composeVars(OVERLAY_COMPOSE)])
for (const name of sorted(edulogKeys)) {
  if (!usedAnywhere.has(name)) problems.push(`${name} is in the EduLog section of .env.example but no Compose file uses it`)
}

for (const name of sorted(supabaseKeys)) {
  if (!upstreamKeys.has(name)) problems.push(`${name} is in supabase/.env.example but missing from the upstream section of .env.example`)
}
for (const name of sorted(upstreamKeys)) {
  if (!supabaseKeys.has(name)) problems.push(`${name} is in the upstream section of .env.example but not in supabase/.env.example`)
}

if (problems.length) {
  console.error(`env example check failed (${problems.length}):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`env example check passed: ${used.size} Compose variables, ${edulogKeys.size} EduLog keys, ${supabaseKeys.size} upstream keys`)

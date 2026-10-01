// Isolated PostgreSQL runtime: node <this-file> <path-to-pglite/dist/index.js>
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.argv[2]).href)
const db = new PGlite()
try {
  await db.exec('CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE TABLE public.occurrence_reports(id uuid PRIMARY KEY);')
  for (const file of ['../migrations/1000116_web_extension_integrations.sql','../migrations/1000117_web_extension_installations.sql','web_extension_installations.sql']) await db.exec(readFileSync(new URL(file,import.meta.url),'utf8'))
  assert.equal((await db.query('SELECT count(*) AS count FROM public.web_extension_tokens')).rows[0].count, 0)
  console.log('PASS: migration execution, claim/reclaim, rollback, distinct installations, legacy adoption, identity mismatch, restricted roles')
} finally { await db.close() }

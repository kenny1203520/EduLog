// Real MV3 extension, real worker/messaging/storage; synthetic site, no live API writes.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { verifyRelease } from '../../scripts/extension/release.mjs'

const artifacts = resolve(process.env.EXTENSION_PACKAGE_DIR || fileURLToPath(new URL('../dist/beta', import.meta.url)))
const metadata = JSON.parse(readFileSync(join(artifacts, 'release.json'), 'utf8'))
const files = verifyRelease(readFileSync(join(artifacts, metadata.archive)), metadata)
const temporary = mkdtempSync(join(tmpdir(), 'edulog-installed-')), extension = join(temporary, 'extension')
for (const [name, bytes] of files) { mkdirSync(dirname(join(extension, name)), { recursive: true }); writeFileSync(join(extension, name), bytes) }
const profile = join(temporary, 'profile'), errors = []
let context
try {
  const launch = async () => {
    const browser = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    })
    browser.on('page', page => page.on('pageerror', error => errors.push(error.message)))
    await browser.route('https://corp.orangeapple.co/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: readFileSync(new URL('./fixtures/class.html', import.meta.url), 'utf8'),
    }))
    return browser
  }
  context = await launch()
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  assert.equal(new URL(worker.url()).hostname, metadata.extensionId)
  const popup = await context.newPage()
  await popup.goto('chrome-extension://' + metadata.extensionId + '/popup/popup.html')
  const message = payload => popup.evaluate(value => chrome.runtime.sendMessage(value), payload)
  const installation = await message({ type: 'get-edulog-installation' })
  assert.match(installation.installation_id, /^[0-9a-f-]{36}$/)
  assert.equal(installation.extension_version, metadata.version)
  assert.equal((await message({ type: 'get-ui-preferences' })).enabled, true)
  assert.equal((await message({ type: 'set-ui-preferences', enabled: false })).enabled, false)
  await popup.evaluate(() => chrome.storage.local.set({ releaseSmokeDraft: { revision: 1, workId: 'synthetic-only' } }))
  await popup.evaluate(async () => {
    const { workStore } = await import(chrome.runtime.getURL('shared/work-store.js'))
    await workStore.put({ id: 'release-smoke', revision: 1, status: 'draft', snapshot: { content: 'synthetic draft' } }, { instance: 'https://test.example', userId: 'synthetic-user' })
  })
  const source = await context.newPage()
  await source.goto('https://corp.orangeapple.co/courses/dt/101')
  await source.waitForFunction(() => document.querySelector('#edulog-extension-root'))
  // The source page has no extension API: credentials stay in trusted extension contexts.
  assert.equal(await source.evaluate(() => Boolean(window.chrome?.storage)), false)
  await context.close(); context = await launch()
  const resumed = await context.newPage()
  await resumed.goto('chrome-extension://' + metadata.extensionId + '/popup/popup.html')
  const preferences = await resumed.evaluate(() => chrome.runtime.sendMessage({ type: 'get-ui-preferences' }))
  assert.equal(preferences.enabled, false)
  assert.equal((await resumed.evaluate(() => chrome.runtime.sendMessage({ type: 'get-edulog-installation' }))).installation_id, installation.installation_id)
  assert.deepEqual(await resumed.evaluate(() => chrome.storage.local.get('releaseSmokeDraft')), { releaseSmokeDraft: { revision: 1, workId: 'synthetic-only' } })
  assert.equal(await resumed.evaluate(async () => {
    const { workStore } = await import(chrome.runtime.getURL('shared/work-store.js'))
    const work = await workStore.get('release-smoke', { instance: 'https://test.example', userId: 'synthetic-user' })
    return work.snapshot.content
  }), 'synthetic draft')
  const unknown = await context.newPage()
  await unknown.route('https://example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Unknown site</title>' }))
  await unknown.goto('https://example.test/')
  assert.equal(await unknown.locator('#edulog-extension-root').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Installed Chromium: ZIP ID, worker, popup messaging, content scripts, scope and restart persistence passed')
} finally {
  await context?.close()
  rmSync(temporary, { recursive: true, force: true })
}

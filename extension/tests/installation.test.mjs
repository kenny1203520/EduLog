import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const code = readFileSync(new URL('../installation.js', import.meta.url), 'utf8')
function installation(storage, ua = 'Edg/123 Chrome/123') {
  const context = vm.createContext({ crypto: { randomUUID }, navigator: { platform: 'Win32', userAgent: ua }, chrome: { runtime: { getManifest: () => ({ version: '0.1.0' }) }, storage: { local: { get: async () => ({ edulogInstallation: storage.value }), set: async data => { storage.value = data.edulogInstallation } } } } })
  vm.runInContext(code, context)
  return context.edulogInstallation
}
test('installation ID survives worker restart and differs between browser profiles', async () => {
  const storage = {}
  const first = installation(storage)
  const [a, b] = await Promise.all([first.load(), first.load()])
  assert.equal(a.installation_id, b.installation_id)
  assert.equal((await installation(storage).load()).installation_id, a.installation_id)
  assert.notEqual((await installation({}).load()).installation_id, a.installation_id)
  assert.equal(a.device_name, 'Edge · Windows')
  assert.equal(a.extension_version, '0.1.0')
  assert.deepEqual(Object.keys(a).sort(), ['browser_name','device_name','extension_version','installation_id','platform_name'])
})

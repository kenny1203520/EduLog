// Deliberately small ZIP32 codec for our own runtime archives. No external runtime dependencies.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export function safePath(name) {
  if (!name || name.includes('\\') || name.startsWith('/') || name.includes(':') || name.includes('\0') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe archive path: ${name}`)
  return name
}

export function zipFiles(files) {
  const chunks = [], directory = []
  let offset = 0
  for (const [name, source] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const path = Buffer.from(safePath(name)), data = Buffer.from(source), compressed = deflateRawSync(data, { level: 9 })
    const local = Buffer.alloc(30), central = Buffer.alloc(46), checksum = crc32(data)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt16LE(33, 12) // 1980-01-01, independent of timezone and source mtime.
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(path.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10)
    central.writeUInt16LE(33, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(path.length, 28); central.writeUInt32LE(offset, 42)
    chunks.push(local, path, compressed); directory.push(central, path)
    offset += local.length + path.length + compressed.length
  }
  if (files.size > 65535 || offset > 0xffffffff) throw new Error('ZIP32 archive limit exceeded')
  const index = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, index, end])
}

export function unzipFiles(input) {
  const data = Buffer.from(input), files = new Map()
  const end = data.length - 22
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50 || data.readUInt16LE(end + 20) !== 0) throw new Error('Invalid ZIP directory')
  const count = data.readUInt16LE(end + 10), start = data.readUInt32LE(end + 16)
  if (data.readUInt16LE(end + 8) !== count || start + data.readUInt32LE(end + 12) !== end) throw new Error('Invalid ZIP directory bounds')
  let cursor = start, total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry')
    const size = data.readUInt32LE(cursor + 24), length = data.readUInt32LE(cursor + 20), nameLength = data.readUInt16LE(cursor + 28)
    const local = data.readUInt32LE(cursor + 42), method = data.readUInt16LE(cursor + 10)
    const name = safePath(data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'))
    total += size
    if (files.has(name) || total > 50 * 1024 * 1024 || method !== 8 || data.readUInt16LE(cursor + 8) !== 0x800) throw new Error('Unsupported or oversized ZIP entry')
    if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local entry')
    const body = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    if (body + length > start || data.readUInt16LE(local + 8) !== method || data.readUInt32LE(local + 18) !== length || data.readUInt32LE(local + 22) !== size || data.subarray(local + 30, local + 30 + nameLength).toString('utf8') !== name) throw new Error('ZIP local/directory mismatch')
    const content = inflateRawSync(data.subarray(body, body + length), { maxOutputLength: Math.max(1, size) })
    if (content.length !== size || crc32(content) !== data.readUInt32LE(cursor + 16) || crc32(content) !== data.readUInt32LE(local + 14)) throw new Error('ZIP checksum mismatch')
    files.set(name, content)
    cursor += 46 + nameLength + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32)
  }
  if (cursor !== end) throw new Error('Invalid ZIP directory size')
  return files
}
